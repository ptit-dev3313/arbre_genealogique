-- Read-only audit. Run in the Supabase SQL Editor as postgres.
-- This returns schema/security metadata, without selecting family data or emails.
begin transaction read only;

select jsonb_pretty(jsonb_build_object(
  'tables', (select jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'table', c.relname,
    'rls_enabled', c.relrowsecurity, 'rls_forced', c.relforcerowsecurity
  )) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p')),
  'policies', (select jsonb_agg(to_jsonb(p)) from pg_policies p
    where schemaname in ('public', 'storage')),
  'table_grants', (select jsonb_agg(to_jsonb(g)) from information_schema.role_table_grants g
    where table_schema in ('public', 'storage')
      and grantee in ('anon', 'authenticated', 'PUBLIC', 'supabase_auth_admin')),
  'column_grants', (select jsonb_agg(to_jsonb(g)) from information_schema.column_privileges g
    where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')),
  'functions', (select jsonb_agg(jsonb_build_object(
    'name', p.oid::regprocedure::text, 'security_definer', p.prosecdef,
    'owner', pg_get_userbyid(p.proowner), 'settings', p.proconfig,
    'anon_execute', has_function_privilege('anon', p.oid, 'execute'),
    'authenticated_execute', has_function_privilege('authenticated', p.oid, 'execute'),
    'definition', pg_get_functiondef(p.oid)
  )) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'),
  'buckets', (select jsonb_agg(jsonb_build_object(
    'id', id, 'public', public, 'file_size_limit', file_size_limit,
    'allowed_mime_types', allowed_mime_types
  )) from storage.buckets),
  'default_privileges', (select jsonb_agg(jsonb_build_object(
    'owner', pg_get_userbyid(d.defaclrole), 'schema', n.nspname,
    'type', d.defaclobjtype, 'acl', d.defaclacl::text
  )) from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname = 'public' or d.defaclnamespace = 0)
)) as security_audit;

rollback;
