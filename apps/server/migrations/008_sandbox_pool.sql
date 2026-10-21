-- Sandboxes are built ahead of time ('pooled') and handed out instantly ('claimed').
alter table orgs add column sandbox_state text;  -- null for real workspaces | pooled | claimed
create index orgs_sandbox_pool on orgs(sandbox_state, created_at) where sandbox_state is not null;
update orgs set sandbox_state = 'claimed' where expires_at is not null;
