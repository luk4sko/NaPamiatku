-- handle_new_user je funkcia pre trigger, nemá byť volateľná cez REST API.
-- Trigger ju spúšťa auth služba pod vlastnou rolou, tá tieto grants nepotrebuje.
revoke all on function public.handle_new_user() from anon, authenticated;
