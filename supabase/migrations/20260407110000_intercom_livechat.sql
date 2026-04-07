-- Intercom live chat <-> Discord thread bridge

ALTER TABLE public.transcripts
  DROP CONSTRAINT IF EXISTS transcripts_session_type_check;

ALTER TABLE public.transcripts
  ADD CONSTRAINT transcripts_session_type_check
  CHECK (session_type IN ('voice', 'text', 'livechat'));

CREATE TABLE public.intercom_threads (
  intercom_conversation_id TEXT PRIMARY KEY,
  discord_thread_id TEXT NOT NULL,
  customer_name TEXT,
  customer_email TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  last_customer_message_signature TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_intercom_threads_discord_thread_id
  ON public.intercom_threads (discord_thread_id);

CREATE INDEX idx_intercom_threads_status
  ON public.intercom_threads (status);

ALTER TABLE public.intercom_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cofounders can read intercom threads"
  ON public.intercom_threads FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Service role can manage intercom threads"
  ON public.intercom_threads FOR ALL
  TO service_role USING (true) WITH CHECK (true);
