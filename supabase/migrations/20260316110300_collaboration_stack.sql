-- Migration: 20260316_collaboration_stack.sql
-- Collaboration stack tables for the Discord bot

-- Voice/text session transcripts
CREATE TABLE public.transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type TEXT NOT NULL CHECK (session_type IN ('voice', 'text')),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  participants TEXT[] NOT NULL DEFAULT '{}',
  raw_transcript TEXT NOT NULL,
  ai_summary TEXT,
  decisions JSONB DEFAULT '[]',
  action_items JSONB DEFAULT '[]',
  key_quotes JSONB DEFAULT '[]',
  sales_mentions JSONB DEFAULT '[]',
  audio_storage_path TEXT,
  discord_message_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- CRM leads (auto-populated from voice/text mentions)
CREATE TABLE public.crm_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'mentioned' CHECK (status IN (
    'mentioned', 'researching', 'outreach', 'demo_scheduled',
    'pilot', 'negotiation', 'closed_won', 'closed_lost'
  )),
  owner TEXT,
  context TEXT,
  last_mentioned_at TIMESTAMPTZ DEFAULT now(),
  notes JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- CRM events timeline
CREATE TABLE public.crm_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'mentioned', 'status_change', 'note_added', 'demo', 'follow_up'
  )),
  description TEXT NOT NULL,
  source_transcript_id UUID REFERENCES public.transcripts(id),
  actor TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Decisions log
CREATE TABLE public.decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision TEXT NOT NULL,
  context TEXT,
  participants TEXT[] DEFAULT '{}',
  source_transcript_id UUID REFERENCES public.transcripts(id),
  category TEXT CHECK (category IN (
    'product', 'technical', 'financial', 'sales', 'marketing', 'general'
  )),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_transcripts_search ON public.transcripts
  USING GIN (to_tsvector('english', raw_transcript));
CREATE INDEX idx_transcripts_participants ON public.transcripts
  USING GIN (participants);
CREATE INDEX idx_transcripts_started_at ON public.transcripts (started_at DESC);
CREATE INDEX idx_crm_leads_company ON public.crm_leads (company_name);
CREATE INDEX idx_crm_leads_status ON public.crm_leads (status);
CREATE INDEX idx_decisions_category ON public.decisions (category);

-- RLS
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;

-- Cofounders can read everything
CREATE POLICY "Cofounders can read transcripts"
  ON public.transcripts FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Cofounders can read leads"
  ON public.crm_leads FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Cofounders can read events"
  ON public.crm_events FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Cofounders can read decisions"
  ON public.decisions FOR SELECT
  TO authenticated USING (true);

-- Service role (bot) can do everything
CREATE POLICY "Bot can manage transcripts"
  ON public.transcripts FOR ALL
  TO service_role USING (true);

CREATE POLICY "Bot can manage leads"
  ON public.crm_leads FOR ALL
  TO service_role USING (true);

CREATE POLICY "Bot can manage events"
  ON public.crm_events FOR ALL
  TO service_role USING (true);

CREATE POLICY "Bot can manage decisions"
  ON public.decisions FOR ALL
  TO service_role USING (true);

-- Storage bucket for audio recordings
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-recordings', 'voice-recordings', false);

CREATE POLICY "Bot can upload recordings"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'voice-recordings');

CREATE POLICY "Cofounders can download recordings"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'voice-recordings');
