#!/usr/bin/env python3
"""Prekódovanie nahratých videí na 1080p H.264 + náhľadový obrázok.

Prečo: telefóny točia 4K s 15-55 Mbit/s. Server má domácu linku s ~33 Mbit/s
uploadom, takže také video sa nedá plynulo prehrať ani jednému divákovi, a
HEVC z iPhonu mnohé Android telefóny nevedia prehrať vôbec. Po prekódovaní
je video 10-15x menšie (~4 Mbit/s), prehrá ho každý prehliadač a linka
utiahne niekoľko divákov naraz. Robí to to isté, čo YouTube či Instagram -
originál sa nikdy nestreamuje.

Beh (cron každú minútu, flock zabráni dvom behom naraz):
  1. z tabuľky photos vezme najstaršie video so stavom pending,
  2. stiahne ho z bucketu photos, ffmpeg-om prekóduje a vyrobí poster (JPEG),
  3. oba súbory nahrá do bucketu pod novým UUID,
  4. riadku nastaví novú storage_path, poster_path a video_status = ready,
  5. originál z bucketu zmaže (rozhodnutie z 2026-09-21: originál sa nenecháva).
Pri chybe nastaví video_status = failed a originál nechá - galéria ho potom
prehráva tak ako doteraz.

Používa iba štandardnú knižnicu Pythonu + ffmpeg (apt install ffmpeg).
Nastavenie číta z .env self-hosted Supabase (SERVICE_ROLE_KEY).

Spustenie:
  python3 transcode.py            - spracuje všetky čakajúce videá (to volá cron)
  python3 transcode.py --dry-run  - len vypíše, čo by spracoval
"""

import json
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

ENV_FILE = Path("/home/lukasko/servers/napamiatku-web/docker/.env")
# Rovnako ako retention.py: priamo na Envoy bránu, nie cez Cloudflare.
API_URL = "http://100.81.135.86:8000"
BUCKET = "photos"

# Dlhšia strana najviac 1920 px (1080p), -2 = druhú stranu dopočítaj a zaokrúhli
# na párne číslo (H.264 nepárne rozmery nezvládne). Otočenie z metadát
# (video z telefónu na výšku) ffmpeg aplikuje sám ešte pred týmto filtrom.
SCALE = "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'"
FFMPEG_TIMEOUT = 15 * 60  # sekúnd na jedno video


def log(message):
    print(f"{datetime.now():%Y-%m-%d %H:%M:%S} {message}", flush=True)


# ---------- Nastavenie ----------

def load_env(path):
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


# ---------- Supabase API (REST + Storage) ----------

class Api:
    """Service_role kľúč obchádza RLS - nesmie opustiť server."""

    def __init__(self, base_url, service_key):
        self.base_url = base_url.rstrip("/")
        self.headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    def call(self, method, path, body=None, content_type="application/json", extra_headers=None, timeout=60):
        if body is not None and content_type == "application/json":
            body = json.dumps(body).encode()
        headers = {**self.headers, **(extra_headers or {})}
        if body is not None:
            headers["Content-Type"] = content_type
        request = urllib.request.Request(self.base_url + path, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"{method} {path} -> {error.code}: {error.read().decode()[:300]}")

    def json(self, method, path, body=None, extra_headers=None):
        text = self.call(method, path, body, extra_headers=extra_headers).decode()
        return json.loads(text) if text else None

    def pending_videos(self):
        return self.json("GET", "/rest/v1/photos?media_type=eq.video&video_status=eq.pending"
                                "&select=id,event_id,storage_path&order=created_at.asc&limit=20")

    def update_photo(self, photo_id, fields):
        self.json("PATCH", f"/rest/v1/photos?id=eq.{photo_id}", body=fields,
                  extra_headers={"Prefer": "return=minimal"})

    def download(self, path, target):
        # Storage streamuje súbor po kúskoch - 100 MB neťaháme celé do pamäte.
        request = urllib.request.Request(f"{self.base_url}/storage/v1/object/{BUCKET}/{path}",
                                         headers=self.headers)
        with urllib.request.urlopen(request, timeout=300) as response, open(target, "wb") as file:
            shutil.copyfileobj(response, file)

    def upload(self, path, source, content_type):
        # Storage prijíma aj surové telo s Content-Type (nie len multipart).
        self.call("POST", f"/storage/v1/object/{BUCKET}/{path}", body=source.read_bytes(),
                  content_type=content_type, timeout=300)

    def delete_files(self, paths):
        self.call("DELETE", f"/storage/v1/object/{BUCKET}", body={"prefixes": paths})


# ---------- ffmpeg ----------

def run(command):
    result = subprocess.run(command, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
    if result.returncode != 0:
        # Posledné riadky stderr stačia - ffmpeg je ukecaný.
        raise RuntimeError("ffmpeg: " + " | ".join(result.stderr.strip().splitlines()[-4:]))


def transcode(source, video_out, poster_out):
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(source),
        "-vf", SCALE,
        # veryfast = rozumný pomer rýchlosť/kvalita na notebooku bez GPU;
        # crf 26 + strop 5 Mbit/s = ~3-5 Mbit/s pri 1080p.
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
        "-maxrate", "5M", "-bufsize", "10M", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2",
        # Index (moov) na začiatok súboru - inak prehliadač musí stiahnuť
        # celé video, kým začne hrať.
        "-movflags", "+faststart",
        str(video_out),
    ])
    # Poster z už zmenšeného videa; 0,3 s namiesto úplne prvej snímky, ktorá
    # býva rozmazaná/čierna. Pri kratšom klipe ffmpeg vezme poslednú dostupnú.
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", "0.3", "-i", str(video_out), "-frames:v", "1", "-q:v", "4", str(poster_out),
    ])


# ---------- Hlavný beh ----------

def process(api, photo, dry_run):
    original = photo["storage_path"]
    log(f"video {photo['id']} ({original})")
    if dry_run:
        return

    new_id = uuid.uuid4()
    video_path = f"{photo['event_id']}/{new_id}.mp4"
    poster_path = f"{photo['event_id']}/{new_id}.jpg"

    with tempfile.TemporaryDirectory(prefix="napamiatku-") as tmp:
        tmp = Path(tmp)
        source = tmp / ("source." + original.rsplit(".", 1)[-1])
        video_out = tmp / "out.mp4"
        poster_out = tmp / "poster.jpg"

        api.download(original, source)
        transcode(source, video_out, poster_out)
        before, after = source.stat().st_size, video_out.stat().st_size

        api.upload(video_path, video_out, "video/mp4")
        api.upload(poster_path, poster_out, "image/jpeg")

    # Až keď sú nové súbory hore, prepneme riadok - divák nikdy neuvidí dieru.
    api.update_photo(photo["id"], {
        "storage_path": video_path, "poster_path": poster_path, "video_status": "ready",
    })
    api.delete_files([original])
    log(f"  hotovo: {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB ({video_path})")


def main():
    dry_run = "--dry-run" in sys.argv
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg nie je nainštalovaný (sudo apt install ffmpeg)")

    env = load_env(ENV_FILE)
    if not env.get("SERVICE_ROLE_KEY"):
        sys.exit(f"V {ENV_FILE} chýba SERVICE_ROLE_KEY")
    api = Api(API_URL, env["SERVICE_ROLE_KEY"])

    # Cyklus, kým je čo robiť - videá nahraté počas behu chytí ten istý beh.
    processed = 0
    while True:
        pending = api.pending_videos()
        if not pending:
            break
        for photo in pending:
            try:
                process(api, photo, dry_run)
                processed += 1
            except Exception as error:  # noqa: BLE001 - jedno zlé video nesmie zastaviť ostatné
                log(f"  CHYBA: {error}")
                if not dry_run:
                    api.update_photo(photo["id"], {"video_status": "failed"})
        if dry_run:
            break

    if processed:
        log(f"{'[dry-run] ' if dry_run else ''}hotovo, spracované: {processed}")


if __name__ == "__main__":
    main()
