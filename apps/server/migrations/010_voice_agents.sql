create table voice_challenges (
 id uuid primary key, org_id uuid not null references orgs(id) on delete cascade,
 user_id uuid not null references users(id) on delete cascade, phrase text not null,
 expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now()
);
create index voice_challenges_scope on voice_challenges(org_id,user_id);
alter table voice_runs add column clarify_question text;
alter table voice_runs add column clarified boolean not null default false;
alter table voice_runs add column skipped_documents jsonb not null default '[]';
-- A ticked box never proved who was speaking: those voices must re-enroll with a live phrase.
update voice_profiles set revoked_at = now(), sample_enc = null, reference_text = ''
 where consent_version = 'own-voice-v1' and revoked_at is null;
