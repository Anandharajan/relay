-- Relay schema v1. Runs on Postgres 15+ (with pgvector) and on PGlite.
create extension if not exists vector;

create table users (
  id uuid primary key,
  email text not null unique,
  name text not null default '',
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table orgs (
  id uuid primary key,
  name text not null,
  plan text not null default 'free',
  site_key text not null unique,
  settings jsonb not null default '{}',
  secrets jsonb not null default '{}',          -- encrypted per-org secrets (whatsapp token, ...)
  created_at timestamptz not null default now()
);

create table members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'agent',            -- owner | admin | agent
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table invites (
  token text primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role text not null default 'agent',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table knowledge_sources (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  type text not null,                            -- url | file | faq | learned
  title text not null default '',
  uri text,
  blob_key text,
  content text,
  options jsonb not null default '{}',
  status text not null default 'queued',         -- queued | processing | ready | error
  error text,
  chunk_count int not null default 0,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index knowledge_sources_org on knowledge_sources(org_id);

create table chunks (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  source_id uuid not null references knowledge_sources(id) on delete cascade,
  position int not null default 0,
  title text not null default '',
  url text,
  content text not null,
  lang text not null default 'en',
  embedding vector,
  embed_model text not null,
  tsv tsvector generated always as (to_tsvector('simple', title || ' ' || content)) stored,
  created_at timestamptz not null default now()
);
create index chunks_org on chunks(org_id);
create index chunks_source on chunks(source_id);
create index chunks_tsv on chunks using gin(tsv);

create table conversations (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  channel text not null default 'web',           -- web | whatsapp | email | agent
  visitor_id text not null,
  customer_name text,
  customer_contact text,
  status text not null default 'ai',             -- ai | escalated | human | resolved
  lang text not null default 'en',
  csat int,
  resolved_by text,                              -- ai | human
  assigned_to uuid references users(id) on delete set null,
  meta jsonb not null default '{}',
  last_message_at timestamptz not null default now(),
  last_message_preview text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index conversations_org_status on conversations(org_id, status, last_message_at desc);
create index conversations_visitor on conversations(org_id, visitor_id);

create table messages (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null,                            -- customer | ai | human | system | note
  content text not null,
  redacted text,
  citations jsonb not null default '[]',
  confidence real,
  tokens int not null default 0,
  cost_inr real not null default 0,
  author_id uuid references users(id) on delete set null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index messages_conversation on messages(conversation_id, created_at);

create table ai_drafts (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  question text not null default '',
  draft text not null,
  final text,
  citations jsonb not null default '[]',
  confidence real,
  status text not null default 'pending',        -- pending | sent | edited | discarded
  edited_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index ai_drafts_conversation on ai_drafts(conversation_id);

create table actions (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  description text not null default '',
  keywords jsonb not null default '[]',
  method text not null default 'GET',
  url text not null,
  headers_enc text,
  params jsonb not null default '[]',            -- [{name, description, required, pattern}]
  body_template text,
  response_template text not null default '',
  sensitive boolean not null default false,
  enabled boolean not null default true,
  health text not null default 'unknown',        -- unknown | ok | failing
  last_error text,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create table action_runs (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  action_id uuid not null references actions(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  params jsonb not null default '{}',
  status text not null,                          -- ok | error | pending_approval | rejected
  response jsonb,
  error text,
  latency_ms int,
  approved_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table simulations (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  status text not null default 'queued',         -- queued | running | done | failed
  total int not null default 0,
  passed int not null default 0,
  pass_rate real,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table simulation_cases (
  id uuid primary key,
  simulation_id uuid not null references simulations(id) on delete cascade,
  position int not null default 0,
  question text not null,
  expected text,
  answer text,
  confidence real,
  citations jsonb not null default '[]',
  handoff boolean,
  passed boolean,
  reason text
);

create table model_settings (
  org_id uuid primary key references orgs(id) on delete cascade,
  provider text not null default 'default',
  model text,
  base_url text,
  key_enc text,
  key_hint text,
  monthly_budget_inr real,
  updated_at timestamptz not null default now()
);

create table usage_daily (
  org_id uuid not null references orgs(id) on delete cascade,
  day date not null,
  conversations int not null default 0,
  ai_messages int not null default 0,
  resolutions int not null default 0,
  tokens int not null default 0,
  cost_inr real not null default 0,
  primary key (org_id, day)
);

create table subscriptions (
  org_id uuid primary key references orgs(id) on delete cascade,
  provider text not null default 'razorpay',
  external_id text,
  plan text not null,
  status text not null,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  actor text not null,
  action text not null,
  target text,
  payload jsonb not null default '{}',
  at timestamptz not null default now()
);
create index audit_log_org on audit_log(org_id, at desc);

create table consents (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  visitor_id text not null,
  purpose text not null,
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create table jobs (
  id uuid primary key,
  type text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued',         -- queued | running | done | failed
  attempts int not null default 0,
  run_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_queue on jobs(status, run_at);

create table answer_cache (
  org_id uuid not null references orgs(id) on delete cascade,
  key text not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  primary key (org_id, key)
);
