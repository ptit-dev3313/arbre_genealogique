-- Close direct API bypasses; changes do not modify family records.
revoke all on public.families, public.family_members, public.allowed_emails from public, anon, authenticated;
grant select, delete on public.families, public.family_members to authenticated;
drop policy if exists families_update on public.families;
drop policy if exists families_insert on public.families;
drop policy if exists members_insert on public.family_members;

revoke all on all functions in schema public, private from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname in (
      'publish_family','list_my_families','save_family','patch_family',
      'acquire_family_lock','heartbeat_family_lock','release_family_lock',
      'invite_to_family','list_family_shares','revoke_family_share','set_member_trees'
    )
  loop
    execute format('grant execute on function %s to authenticated', f.signature);
  end loop;
end $$;
grant execute on function private.is_family_member(uuid), private.is_family_owner(uuid) to authenticated;
grant execute on function public.hook_restrict_signup(jsonb) to supabase_auth_admin;

create or replace function private.can_edit_person_photo(object_name text)
returns boolean language plpgsql stable security definer
set search_path = pg_catalog
as $$
declare
  parts text[] := string_to_array(object_name, '/');
  fid uuid;
  pid text;
  member public.family_members%rowtype;
  doc jsonb;
begin
  if auth.uid() is null or cardinality(parts) <> 2
     or parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$' then
    return false;
  end if;
  fid := parts[1]::uuid;
  pid := left(parts[2], length(parts[2]) - 4);
  select * into member from public.family_members where family_id=fid and user_id=auth.uid();
  if not found then return false; end if;
  if member.role='owner' then return true; end if;
  select payload into doc from public.families where id=fid;
  if not found then return false; end if;
  -- Photos are uploaded before save_family, so allow a new person for an editor with assigned trees.
  return pid = any(private.payload_person_ids_in_trees(doc, member.tree_ids))
    or (not (coalesce(doc->'persons','{}'::jsonb) ? pid) and cardinality(member.tree_ids)>0);
end $$;
revoke all on function private.can_edit_person_photo(text) from public, anon;
grant execute on function private.can_edit_person_photo(text) to authenticated;

alter policy "person photos insert" on storage.objects
  with check (bucket_id='person-photos' and private.can_edit_person_photo(name));
alter policy "person photos update" on storage.objects
  using (bucket_id='person-photos' and private.can_edit_person_photo(name))
  with check (bucket_id='person-photos' and private.can_edit_person_photo(name));
alter policy "person photos delete" on storage.objects
  using (bucket_id='person-photos' and private.can_edit_person_photo(name));
notify pgrst, 'reload schema';
