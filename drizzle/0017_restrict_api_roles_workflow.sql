-- Same protection as earlier migrations, for the practice-workflow tables. No-op where the roles do not exist.
DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['firm_counters','client_contacts','onboarding_items','engagement_team','task_dependencies','task_checklist_items','workflow_templates','workflow_template_tasks','workflow_instances','activities','status_history'] LOOP
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
