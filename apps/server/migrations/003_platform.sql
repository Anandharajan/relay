-- Agent observability, ratings, and platform (super-admin) data.

create table agent_runs (                -- one row per agent decision, with its steps and procedural tags
  id uuid primary key,
  org_id uuid references orgs(id) on delete cascade,
  agent text not null,                    -- frontdesk | booking | safety | actions | intake | findings | investigations | followup | telecaller | queue
  trigger text not null default '',       -- customer_message | upload | schedule | staff | webhook
  conversation_id uuid,
  client_id uuid,
  status text not null,                   -- ok | handoff | failed
  outcome text not null default '',
  tags jsonb not null default '[]',       -- e.g. ["retrieval.no_match","handoff.low_confidence"], ["llm.error"], ["action.http_error"]
  steps jsonb not null default '[]',      -- [{ "name": "retrieve", "detail": "5 passages" }, …]
  provider text,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_inr double precision not null default 0,
  latency_ms int not null default 0,
  complexity int not null default 1,      -- 1 simple · 2 multi-step · 3 sensitive/escalation
  created_at timestamptz not null default now()
);
create index agent_runs_org on agent_runs(org_id, created_at desc);
create index agent_runs_agent on agent_runs(agent, created_at desc);
create index agent_runs_status on agent_runs(status, created_at desc);

create table visit_ratings (             -- patients/clients rate the visit and the staff member
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  appointment_id uuid not null unique references appointments(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  staff_id uuid not null references staff_members(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  ai_rating int check (ai_rating between 1 and 5),   -- how helpful the assistant was before/after the visit
  comment text not null default '',
  created_at timestamptz not null default now()
);
create index visit_ratings_staff on visit_ratings(staff_id, created_at desc);

create table leads (                     -- early access requests and sales leads
  id uuid primary key,
  name text not null,
  email text not null,
  phone text,
  org_name text not null default '',
  institution_type text not null default 'general',
  size text not null default '',
  message text not null default '',
  source text not null default 'landing',
  status text not null default 'new',     -- new | contacted | early_access | converted | rejected
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_status on leads(status, created_at desc);
