insert into storage.buckets (id, name, public)
values ('ads-original', 'ads-original', false), ('ads-derived', 'ads-derived', false)
on conflict (id) do nothing;

-- Paths start with <owner_id>/. Uploads use signed upload URLs created by the api function,
-- and the worker uses the service role, so only a read policy is needed for owners.
create policy ads_objects_owner_read on storage.objects for select to authenticated
  using (bucket_id in ('ads-original', 'ads-derived') and (storage.foldername(name))[1] = (select auth.uid())::text);
