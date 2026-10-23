-- Regression checks use synthetic records and always roll back.
begin;
insert into public.allowed_emails(email) values
 ('security-owner@example.invalid'),('security-editor@example.invalid'),('security-outsider@example.invalid');
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','security-owner@example.invalid'),
 ('10000000-0000-4000-8000-000000000002','security-editor@example.invalid'),
 ('10000000-0000-4000-8000-000000000003','security-outsider@example.invalid');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
insert into public.families(id,name,created_by,payload) values
 ('20000000-0000-4000-8000-000000000001','security regression',
 '10000000-0000-4000-8000-000000000001',
 '{"persons":{"30000000-0000-4000-8000-000000000001":{"name":"editable"},"30000000-0000-4000-8000-000000000002":{"name":"protected"}},"trees":[{"id":"editable","placements":{"30000000-0000-4000-8000-000000000001":{}}},{"id":"protected","placements":{"30000000-0000-4000-8000-000000000002":{}}}],"couples":[]}');
insert into public.family_members(family_id,user_id,role,tree_ids) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','editor',array['editable']);

set local role authenticated;
do $$
declare fid uuid := '20000000-0000-4000-8000-000000000001'; lock_result jsonb; saved jsonb; doc jsonb;
begin
  if not private.can_edit_person_photo(fid||'/30000000-0000-4000-8000-000000000002.jpg') then raise exception 'owner photo denied'; end if;
  perform public.publish_family('RPC publish regression','{}'::jsonb);
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
  if not exists(select 1 from public.list_my_families() where id=fid) then raise exception 'editor read denied'; end if;
  begin update public.families set name='bypass' where id=fid; raise exception 'direct update allowed';
    exception when insufficient_privilege then null; end;
  begin insert into public.family_members(family_id,user_id,role) values(fid,'10000000-0000-4000-8000-000000000003','owner'); raise exception 'direct membership insert allowed';
    exception when insufficient_privilege then null; end;
  begin perform public.invite_to_family(fid,'security-outsider@example.invalid',array['editable'],false,false); raise exception 'editor invite allowed';
    exception when raise_exception then if sqlerrm <> 'famille introuvable' then raise; end if; end;
  if not private.can_edit_person_photo(fid||'/30000000-0000-4000-8000-000000000001.jpg') then raise exception 'editor photo denied'; end if;
  if private.can_edit_person_photo(fid||'/30000000-0000-4000-8000-000000000002.jpg') then raise exception 'protected photo writable'; end if;
  if private.can_edit_person_photo('bad/path.jpg') then raise exception 'malformed photo allowed'; end if;
  lock_result := public.acquire_family_lock(fid);
  if lock_result->>'kind' <> 'acquired' then raise exception 'editor lock denied'; end if;
  select payload into doc from public.families where id=fid;
  doc := jsonb_set(doc,'{persons,30000000-0000-4000-8000-000000000001,name}','"edited"');
  doc := jsonb_set(doc,'{persons,30000000-0000-4000-8000-000000000002,name}','"ATTACK"');
  saved := public.save_family(fid,'ATTACK',doc,null,(lock_result->>'token')::uuid);
  if saved->>'kind' <> 'saved' then raise exception 'editor save denied'; end if;
  if (select payload#>>'{persons,30000000-0000-4000-8000-000000000002,name}' from public.families where id=fid) <> 'protected' then raise exception 'protected person overwritten'; end if;
  if (select name from public.families where id=fid) <> 'security regression' then raise exception 'editor renamed family'; end if;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
  if exists(select 1 from public.families where id=fid) then raise exception 'outsider table read allowed'; end if;
  if exists(select 1 from public.list_my_families() where id=fid) then raise exception 'outsider RPC read allowed'; end if;
  if private.can_edit_person_photo(fid||'/30000000-0000-4000-8000-000000000001.jpg') then raise exception 'outsider photo allowed'; end if;
  begin perform public.save_family(fid,'ATTACK','{}',null,(lock_result->>'token')::uuid); raise exception 'outsider save allowed';
    exception when raise_exception then if sqlerrm <> 'famille introuvable' then raise; end if; end;
end $$;
reset role;
do $$
begin
  if has_table_privilege('anon','public.families','select') then raise exception 'anonymous table grant'; end if;
  if has_function_privilege('anon','public.list_my_families()','execute') then raise exception 'anonymous RPC grant'; end if;
  begin insert into auth.users(id,email) values(gen_random_uuid(),'security-unlisted@example.invalid'); raise exception 'unlisted signup allowed';
    exception when raise_exception then if sqlerrm <> 'signup_not_allowed' then raise; end if; end;
end $$;
rollback;
select 'PASS: owner/editor/outsider, direct bypass, restricted save, photos, signup; fixtures rolled back' as result;
