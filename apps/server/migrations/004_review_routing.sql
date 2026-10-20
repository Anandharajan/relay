-- Route clinical work to the responsible doctor and track report review.

-- A doctor/staff calendar can be linked to the login of the person it belongs to.
alter table staff_members add column user_id uuid references users(id) on delete set null;
create index staff_members_user on staff_members(org_id, user_id);

-- Every processed report waits for a human review; the responsible doctor is stored at intake.
alter table records add column assigned_staff_id uuid references staff_members(id) on delete set null;
alter table records add column reviewed_by uuid references users(id) on delete set null;
alter table records add column reviewed_at timestamptz;
create index records_review_queue on records(org_id, reviewed_at, created_at);
