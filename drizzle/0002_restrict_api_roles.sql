-- Defense in depth for hosted Postgres platforms (e.g. Supabase) that expose the
-- `public` schema over an HTTP API to the roles `anon` and `authenticated`.
-- This app never uses that API: it connects as the table owner, which RLS does not restrict.
-- 0001 enables RLS with no policies (deny-all for non-owners); this migration also removes
-- those roles' privileges on THIS APP'S tables only, so other schemas/apps are untouched.
-- On plain PostgreSQL / PGlite, where the roles do not exist, this is a no-op.
DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['users', 'sessions', 'invitations', 'clients', 'client_assignments',
                               'engagements', 'tasks', 'audit_events'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
