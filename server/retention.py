#!/usr/bin/env python3
"""Automatické mazanie obsahu eventu po 12 mesiacoch (podmienky §6).

Beží raz denne z cronu na serveri. Dva kroky:
  1. Eventom, ktorým do zmazania ostáva 14 dní alebo menej, pošle organizátorovi
     e-mail a poznačí to do events.expiry_warning_sent_at.
  2. Eventy po lehote (a s odoslaným upozornením starším ako 14 dní) zmaže:
     najprv súbory v Storage, potom riadok v tabuľke events - databáza
     kaskádou zmaže fotky, odkazy v knihe hostí aj nahlásenia.

Ktoré eventy sú na rade rozhoduje databáza (funkcie retention_events_to_warn
a retention_events_to_delete v sql/migrations/20260918100000_event_retention.sql),
skript je len "ruky". Používa iba štandardnú knižnicu Pythonu - nič netreba
inštalovať.

Nastavenie číta z .env súboru self-hosted Supabase (SERVICE_ROLE_KEY
a SMTP_*), takže heslá nie sú nikde druhýkrát.

Spustenie:
  python3 retention.py                 - ostrý beh (to volá cron)
  python3 retention.py --dry-run       - len vypíše, čo by urobil
  python3 retention.py --test-email a@b.sk - pošle skúšobné upozornenie
"""

import json
import smtplib
import sys
import urllib.error
import urllib.request
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

ENV_FILE = Path("/home/lukasko/servers/napamiatku-web/docker/.env")
# Skript beží na tom istom serveri ako Supabase, preto ide priamo na Envoy
# bránu (port 8000 na Tailscale IP) a nie cez api.napamiatku.com - Cloudflare
# blokuje požiadavky bez prehliadača (chyba 1010) a tunel nemusí byť hore.
API_URL = "http://100.81.135.86:8000"
SITE_URL = "https://www.napamiatku.com"
DELETE_BATCH = 100  # toľko súborov naraz maže aj tlačidlo "Zmazať event" v appke


def log(message):
    print(f"{datetime.now():%Y-%m-%d %H:%M:%S} {message}", flush=True)


# ---------- Nastavenie ----------

def load_env(path):
    """Prečíta KEY=value riadky z .env (bez knižnice python-dotenv)."""
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def require(env, *keys):
    missing = [key for key in keys if not env.get(key)]
    if missing:
        sys.exit(f"V {ENV_FILE} chýba: {', '.join(missing)}")


# ---------- Supabase API (REST + Storage) ----------

class Api:
    """Volania na Supabase so service_role kľúčom - ten obchádza RLS, preto
    nesmie nikdy opustiť server (frontend používa len publishable kľúč)."""

    def __init__(self, base_url, service_key):
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }

    def call(self, method, path, body=None, extra_headers=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base_url + path, data=data, method=method,
                                         headers={**self.headers, **(extra_headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                text = response.read().decode()
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"{method} {path} -> {error.code}: {error.read().decode()[:300]}")
        return json.loads(text) if text else None

    def rpc(self, function):
        return self.call("POST", f"/rest/v1/rpc/{function}", body={})

    def mark_warned(self, event_id):
        self.call("PATCH", f"/rest/v1/events?id=eq.{event_id}",
                  body={"expiry_warning_sent_at": datetime.now().astimezone().isoformat()},
                  extra_headers={"Prefer": "return=minimal"})

    def list_files(self, event_id):
        # Storage vracia názvy súborov v "priečinku" eventu (bez cesty).
        objects = self.call("POST", "/storage/v1/object/list/photos",
                            body={"prefix": event_id, "limit": DELETE_BATCH, "offset": 0})
        return [f"{event_id}/{item['name']}" for item in objects if item.get("id")]

    def delete_files(self, paths):
        self.call("DELETE", "/storage/v1/object/photos", body={"prefixes": paths})

    def delete_event(self, event_id):
        self.call("DELETE", f"/rest/v1/events?id=eq.{event_id}",
                  extra_headers={"Prefer": "return=minimal"})


# ---------- E-mail ----------

def warning_email(env, to_address, event_name, delete_on, event_id):
    delete_on_text = datetime.fromisoformat(delete_on).strftime("%d. %m. %Y")
    message = EmailMessage()
    message["Subject"] = f"NaPamiatku: fotky z eventu „{event_name}“ zmažeme {delete_on_text}"
    message["From"] = f"{env.get('SMTP_SENDER_NAME', 'NaPamiatku')} <{env['SMTP_ADMIN_EMAIL']}>"
    message["To"] = to_address
    message.set_content(f"""Dobrý deň,

od Vášho eventu „{event_name}“ uplynie čoskoro 12 mesiacov. Podľa podmienok
služby obsah eventu (fotky, videá a kniha hostí) dňa {delete_on_text}
automaticky a nenávratne zmažeme.

Ak si ho chcete ponechať, stiahnite si ho do vtedy tlačidlom „Stiahnuť
všetko“ na stránke eventu:

{SITE_URL}/event?id={event_id}

Po zmazaní už obsah nevieme obnoviť. Ak máte otázky, odpovedzte na tento
e-mail.

S pozdravom
NaPamiatku
{SITE_URL}
""")
    return message


def send_email(env, message):
    port = int(env.get("SMTP_PORT", "465"))
    # Port 465 = šifrované od začiatku (SSL), 587 = najprv obyčajné spojenie
    # a potom prepnutie na šifrovanie (STARTTLS). Seznam používa 465.
    if port == 465:
        server = smtplib.SMTP_SSL(env["SMTP_HOST"], port, timeout=30)
    else:
        server = smtplib.SMTP(env["SMTP_HOST"], port, timeout=30)
        server.starttls()
    with server:
        server.login(env["SMTP_USER"], env["SMTP_PASS"])
        server.send_message(message)


# ---------- Hlavný beh ----------

def main():
    dry_run = "--dry-run" in sys.argv

    env = load_env(ENV_FILE)
    require(env, "SERVICE_ROLE_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_ADMIN_EMAIL")

    if "--test-email" in sys.argv:
        to_address = sys.argv[sys.argv.index("--test-email") + 1]
        send_email(env, warning_email(env, to_address, "Skúšobný event", "2026-12-31",
                                      "00000000-0000-0000-0000-000000000000"))
        log(f"Skúšobný e-mail odoslaný na {to_address}")
        return

    api = Api(API_URL, env["SERVICE_ROLE_KEY"])
    prefix = "[dry-run] " if dry_run else ""

    # 1. Upozornenia 14 dní vopred.
    for event in api.rpc("retention_events_to_warn"):
        log(f"{prefix}upozornenie: „{event['name']}“ ({event['id']}) -> {event['organizer_email']}, "
            f"zmazanie {event['delete_on']}")
        if dry_run:
            continue
        send_email(env, warning_email(env, event["organizer_email"], event["name"],
                                      event["delete_on"], event["id"]))
        # Poznačíme až po úspešnom odoslaní - keby SMTP zlyhal, skúsi to zajtra.
        api.mark_warned(event["id"])

    # 2. Mazanie po lehote.
    for event in api.rpc("retention_events_to_delete"):
        log(f"{prefix}mazanie: „{event['name']}“ ({event['id']}), lehota {event['delete_on']}")
        if dry_run:
            continue
        removed = 0
        while True:
            paths = api.list_files(event["id"])
            if not paths:
                break
            api.delete_files(paths)
            removed += len(paths)
        api.delete_event(event["id"])
        log(f"  zmazané: {removed} súborov + riadok eventu (kaskáda: fotky, odkazy, nahlásenia)")

    log(f"{prefix}hotovo")


if __name__ == "__main__":
    main()
