create table voice_clients (
 id uuid primary key, org_id uuid not null references orgs(id) on delete cascade,
 name text not null, kind text not null default 'client', created_at timestamptz not null default now(),
 unique(id,org_id)
);
create table voice_documents (
 id uuid primary key, org_id uuid not null references orgs(id) on delete cascade,
 client_id uuid not null, name text not null, raw_enc text not null,
 status text not null default 'queued', error text, created_at timestamptz not null default now(),
 foreign key(client_id,org_id) references voice_clients(id,org_id) on delete cascade,
 unique(id,org_id,client_id)
);
create table voice_chunks (
 id uuid primary key, org_id uuid not null, client_id uuid not null, document_id uuid not null,
 title text not null, content text not null, embedding vector(384) not null,
 foreign key(document_id,org_id,client_id) references voice_documents(id,org_id,client_id) on delete cascade
);
create index voice_chunks_scope on voice_chunks(org_id,client_id);
create table voice_settings (
 org_id uuid primary key references orgs(id) on delete cascade,
 settings jsonb not null default '{}', secrets_enc text, updated_at timestamptz not null default now()
);
create table voice_profiles (
 id uuid primary key, org_id uuid not null references orgs(id) on delete cascade,
 user_id uuid not null references users(id) on delete cascade, name text not null,
 provider text not null, provider_id text, sample_enc text, sample_mime text not null,
 reference_text text not null default '', consent_at timestamptz not null,
 consent_version text not null default 'own-voice-v1', revoked_at timestamptz,
 created_at timestamptz not null default now(), unique(id,org_id,user_id)
);
create table voice_runs (
 id uuid primary key, org_id uuid not null references orgs(id) on delete cascade,
 user_id uuid not null references users(id) on delete cascade,
 client_id uuid not null, voice_id uuid, profession text not null, task text not null,
 question text not null default '', input_enc text, input_mime text,
 answer text not null default '', citations jsonb not null default '[]', steps jsonb not null default '[]',
 status text not null default 'queued', error text, output_enc text, output_mime text,
 approved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(client_id,org_id) references voice_clients(id,org_id) on delete cascade,
 foreign key(voice_id,org_id,user_id) references voice_profiles(id,org_id,user_id)
);
create index voice_runs_scope on voice_runs(org_id,user_id,created_at);
