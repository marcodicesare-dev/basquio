create table if not exists public.chat_web_search_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  user_id uuid references auth.users(id),
  query text not null,
  result_count int not null default 0,
  credits_used int not null default 0,
  created_at timestamptz default now()
);

create index if not exists idx_chat_web_search_calls_conversation_id
  on public.chat_web_search_calls(conversation_id);

create index if not exists idx_chat_web_search_calls_created_at
  on public.chat_web_search_calls(created_at);

create table if not exists public.chat_tool_telemetry (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  user_id uuid references auth.users(id),
  tool_name text not null,
  input_hash text,
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_ms int,
  status text not null check (status in ('success', 'error', 'timeout')),
  error_message text,
  result_size_bytes int,
  created_at timestamptz default now()
);

create index if not exists idx_chat_tool_telemetry_conversation_id
  on public.chat_tool_telemetry(conversation_id);

create index if not exists idx_chat_tool_telemetry_tool_name_status
  on public.chat_tool_telemetry(tool_name, status);

create index if not exists idx_chat_tool_telemetry_created_at
  on public.chat_tool_telemetry(created_at);
