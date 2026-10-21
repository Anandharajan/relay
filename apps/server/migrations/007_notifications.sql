-- Personal notifications for staff (reports to review, new bookings, clinical questions, emergencies).
create table notifications (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,                      -- report | booking | clinical_question | emergency
  severity text not null default 'info',   -- info | attention | urgent
  title text not null,
  body text not null default '',
  facts jsonb not null default '[]',       -- [{label, value}] shown as a compact summary
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_inbox on notifications(user_id, org_id, created_at desc);
