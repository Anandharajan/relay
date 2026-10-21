-- Reports processed before review routing existed: attach them to the patient's doctor
-- (latest non-cancelled appointment) so the review queue never shows them as unassigned.
update records r set assigned_staff_id = (
  select a.staff_id from appointments a
   where a.client_id = r.client_id and a.status <> 'cancelled'
   order by a.starts_at desc limit 1
)
where r.assigned_staff_id is null and r.reviewed_at is null;
