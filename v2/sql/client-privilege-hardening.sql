-- Client roles must never have non-DML administrative privileges on application tables.
-- Does not change SELECT/INSERT/UPDATE/DELETE, data, or RLS policies.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
DO $$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_tables t CROSS JOIN (VALUES ('anon'),('authenticated')) r(role_name)
 WHERE t.schemaname='public' AND (
 has_table_privilege(r.role_name,format('%I.%I',t.schemaname,t.tablename),'TRUNCATE')
 OR has_table_privilege(r.role_name,format('%I.%I',t.schemaname,t.tablename),'REFERENCES')
 OR has_table_privilege(r.role_name,format('%I.%I',t.schemaname,t.tablename),'TRIGGER'));
 IF n<>0 THEN RAISE EXCEPTION 'Unexpected inherited administrative grants: %',n; END IF;
END $$;
