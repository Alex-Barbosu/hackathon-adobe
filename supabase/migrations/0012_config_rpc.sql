-- Atomic updates of analyses.config so parallel jobs (e.g. two detect_regions) cannot lose each other's writes.

create function public.config_merge(p_id uuid, p_patch jsonb) returns void
  language sql security definer set search_path = ''
as $$
  update public.analyses set config = config || p_patch, updated_at = now() where id = p_id
$$;

-- Appends a string to a JSON array under p_key, once.
create function public.config_append(p_id uuid, p_key text, p_value text) returns void
  language sql security definer set search_path = ''
as $$
  update public.analyses
  set config = jsonb_set(
        config,
        array[p_key],
        case
          when coalesce(config -> p_key, '[]'::jsonb) @> to_jsonb(p_value) then coalesce(config -> p_key, '[]'::jsonb)
          else coalesce(config -> p_key, '[]'::jsonb) || to_jsonb(p_value)
        end,
        true),
      updated_at = now()
  where id = p_id
$$;

revoke all on function public.config_merge(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.config_append(uuid, text, text) from public, anon, authenticated;
grant execute on function public.config_merge(uuid, jsonb) to service_role;
grant execute on function public.config_append(uuid, text, text) to service_role;
