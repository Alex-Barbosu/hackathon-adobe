-- The RETURNS TABLE columns shadow the table columns inside the body; prefer the column.
create or replace function public.register_batches(p_analysis_id uuid, p_batches jsonb)
  returns table (id uuid, condition_id uuid, batch_index int)
  language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare inserted_count int;
begin
  with ins as (
    insert into public.panel_batches
      (analysis_id, condition_id, batch_index, model, persona_ids, exposure_ad_ids, candidate_order)
    select p_analysis_id, (b ->> 'condition_id')::uuid, (b ->> 'batch_index')::int, b ->> 'model',
           array(select jsonb_array_elements_text(b -> 'persona_ids')),
           array(select jsonb_array_elements_text(b -> 'exposure_ad_ids')::uuid),
           array(select jsonb_array_elements_text(b -> 'candidate_order')::uuid)
    from jsonb_array_elements(p_batches) b
    on conflict (condition_id, batch_index) do nothing
    returning 1
  )
  select count(*) into inserted_count from ins;
  update public.analyses set pending_batches = pending_batches + inserted_count, updated_at = now()
    where analyses.id = p_analysis_id;
  return query
    select pb.id, pb.condition_id, pb.batch_index from public.panel_batches pb
    where pb.analysis_id = p_analysis_id
      and pb.condition_id in (select (b ->> 'condition_id')::uuid from jsonb_array_elements(p_batches) b)
      and pb.finished_at is null;
end $$;
