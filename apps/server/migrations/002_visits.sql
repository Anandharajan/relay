-- Visits layer (horizontal: clinics, hospitals, salons, service centres, coaching institutes …)
-- plus the healthcare pack (records, observations, findings, investigations) and add-on entitlements.

create table staff_members (            -- doctors / consultants / stylists / counsellors
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  specialty text not null default '',
  languages jsonb not null default '[]',
  avg_minutes int not null default 15,
  schedule jsonb not null default '{"days":[1,2,3,4,5,6],"start":"09:00","end":"13:00"}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index staff_members_org on staff_members(org_id);

create table clients (                  -- patients / customers / students
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  phone text,
  lang text not null default 'en',
  birth_year int,
  sex text,
  notes text not null default '',
  conversation_id uuid references conversations(id) on delete set null,
  consent_at timestamptz,
  face_optin_at timestamptz,             -- camera check-in add-on: explicit opt-in
  created_at timestamptz not null default now()
);
create index clients_org on clients(org_id, created_at desc);
create index clients_phone on clients(org_id, phone);

create table appointments (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  staff_id uuid not null references staff_members(id) on delete cascade,
  starts_at timestamptz not null,
  status text not null default 'booked',  -- booked | checked_in | in_progress | done | cancelled | no_show
  reason text not null default '',
  channel text not null default 'web',
  token_no int,
  code text not null unique,             -- short code for the visit page / QR check-in
  checked_in_at timestamptz,
  checkin_method text,                   -- qr | whatsapp | desk | camera | call
  started_at timestamptz,
  ended_at timestamptz,
  last_eta_min int,
  created_at timestamptz not null default now()
);
create index appointments_day on appointments(org_id, staff_id, starts_at);
create index appointments_client on appointments(client_id, starts_at desc);

create table prep_protocols (           -- doctor-approved pre-visit instructions
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  title text not null,
  keywords jsonb not null default '[]',   -- matched against appointment reason / specialty
  staff_id uuid references staff_members(id) on delete cascade,
  instructions text not null,
  days_before int not null default 1,
  approved_by text,
  created_at timestamptz not null default now()
);

create table outbox (                   -- every message Relay sends a client on its own initiative
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete cascade,
  kind text not null,                     -- confirmation | reminder | prep | eta | finding | investigation | followup | rebook | custom
  body text not null,
  status text not null default 'scheduled', -- pending_approval | scheduled | sent | failed | cancelled
  send_at timestamptz not null default now(),
  approved_by text,
  sent_at timestamptz,
  error text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index outbox_due on outbox(status, send_at);
create index outbox_client on outbox(client_id, created_at desc);

create table records (                  -- uploaded reports, prescriptions, discharge summaries
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  title text not null,
  kind text not null default 'other',     -- lab | prescription | discharge | imaging | other
  blob_key text,
  text text,
  observed_on date,
  status text not null default 'uploaded', -- uploaded | processed | needs_review | failed
  uploaded_by text not null default 'staff',
  summary jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index records_client on records(client_id, created_at desc);

create table observations (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  record_id uuid references records(id) on delete cascade,
  test text not null,                     -- canonical key, e.g. hba1c
  label text not null,
  value double precision not null,
  unit text not null default '',
  ref_low double precision,
  ref_high double precision,
  flag text not null default 'normal',    -- low | high | critical_low | critical_high | normal
  observed_on date,
  created_at timestamptz not null default now()
);
create index observations_client on observations(client_id, test, observed_on);

create table findings (                 -- produced by agents, reviewed by a doctor before any patient sees them
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  severity text not null,                 -- info | attention | urgent
  title text not null,
  detail text not null default '',
  agent text not null,
  source jsonb not null default '{}',
  status text not null default 'open',    -- open | acknowledged | shared | dismissed
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index findings_client on findings(client_id, status);
create index findings_open on findings(org_id, status, severity);

create table investigations (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  test text not null,
  label text not null,
  instructions text not null default '',
  due_by date,
  status text not null default 'ordered', -- suggested | ordered | resulted | overdue | cancelled
  ordered_by text,
  resulted_record_id uuid references records(id) on delete set null,
  reminded_at timestamptz,
  created_at timestamptz not null default now()
);
create index investigations_client on investigations(client_id, status);

create table followups (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  kind text not null,                     -- checkin | review
  due_at timestamptz not null,
  status text not null default 'pending', -- pending | sent | better | same | worse | done | cancelled
  reply text,
  created_at timestamptz not null default now()
);
create index followups_due on followups(status, due_at);

create table addons (                   -- paid add-on entitlements (cloud mode)
  org_id uuid not null references orgs(id) on delete cascade,
  addon text not null,                    -- telecalling | camera_checkin
  status text not null,                   -- trial | active | cancelled
  expires_at timestamptz,
  external_id text,
  updated_at timestamptz not null default now(),
  primary key (org_id, addon)
);

create table calls (                    -- telecalling add-on: outbound and inbound voice calls
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  followup_id uuid references followups(id) on delete set null,
  direction text not null,                -- outbound | inbound
  purpose text not null,                  -- reminder | followup | inbound
  provider text not null,                 -- simulated | twilio | exotel
  to_number text,
  status text not null default 'queued',  -- queued | ringing | completed | no_answer | failed
  outcome text,                           -- confirmed | reschedule | better | worse | transferred | none
  transcript jsonb not null default '[]',
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index calls_org on calls(org_id, created_at desc);

create table edge_devices (             -- camera check-in add-on: on-premises agents
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  token_hash text not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
