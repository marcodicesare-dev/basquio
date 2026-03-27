-- Idempotency guard for template import notification emails
alter table public.template_import_jobs
  add column if not exists import_email_sent_at timestamptz;
