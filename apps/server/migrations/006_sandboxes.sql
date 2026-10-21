-- Private, disposable demo workspaces: one per visitor, deleted when they expire.
alter table orgs add column expires_at timestamptz;
create index orgs_expiring on orgs(expires_at) where expires_at is not null;
