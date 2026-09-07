-- Sprísnenie politík (tighten_rls_policies) zmazalo starú voľnú "photos_insert_public"
-- politiku, ale nenahradilo ju žiadnou pre prihlásených správcov eventu - hostia mali
-- svoju cestu cez guest_add_photo (security definer), ale Organizátor na event.html
-- vkladá riadok priamo, takže mu chýbala akákoľvek insert politika.
create policy photos_insert_manager on public.photos
  for insert to authenticated
  with check (public.can_manage_event(event_id));
