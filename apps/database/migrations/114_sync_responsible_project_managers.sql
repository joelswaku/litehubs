-- 114_sync_responsible_project_managers.sql
-- A named responsible manager must have a current manager assignment and the
-- project_manager role. Backfill existing projects without deleting history.

BEGIN;

-- End the currently active primary-manager flag for another person only where
-- a project explicitly names a responsible manager.
UPDATE management_project_members assignment
   SET is_manager = false
  FROM management_projects project
 WHERE project.organization_id = assignment.organization_id
   AND project.id = assignment.project_id
   AND project.responsible_member_id IS NOT NULL
   AND assignment.member_id <> project.responsible_member_id
   AND assignment.is_manager
   AND assignment.assignment_start_date <= current_date
   AND (assignment.assignment_end_date IS NULL OR assignment.assignment_end_date >= current_date);

-- Promote any active assignment held by the named responsible manager.
UPDATE management_project_members assignment
   SET assignment_role = 'project_manager',
       is_manager = true
  FROM management_projects project
  JOIN organization_members member
    ON member.organization_id = project.organization_id
   AND member.id = project.responsible_member_id
   AND member.status = 'active'
 WHERE project.organization_id = assignment.organization_id
   AND project.id = assignment.project_id
   AND assignment.member_id = project.responsible_member_id
   AND assignment.assignment_start_date <= current_date
   AND (assignment.assignment_end_date IS NULL OR assignment.assignment_end_date >= current_date);

-- Create a current manager assignment when the named person was not yet on the
-- project team. Earlier history remains unchanged.
INSERT INTO management_project_members
  (organization_id, project_id, member_id, assignment_role, is_manager,
   assignment_start_date, assigned_by, notes)
SELECT project.organization_id, project.id, project.responsible_member_id,
       'project_manager', true, current_date, project.created_by_user_id,
       'Automatically assigned from Responsible manager'
  FROM management_projects project
  JOIN organization_members member
    ON member.organization_id = project.organization_id
   AND member.id = project.responsible_member_id
   AND member.status = 'active'
 WHERE project.responsible_member_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM management_project_members assignment
      WHERE assignment.organization_id = project.organization_id
        AND assignment.project_id = project.id
        AND assignment.member_id = project.responsible_member_id
        AND assignment.assignment_start_date <= current_date
        AND (assignment.assignment_end_date IS NULL OR assignment.assignment_end_date >= current_date)
   );

-- Give the responsible person the project-scoped role required by API access.
INSERT INTO member_roles (organization_id, member_id, role_id, assigned_by)
SELECT project.organization_id, project.responsible_member_id, role.id,
       project.created_by_user_id
  FROM management_projects project
  JOIN organization_members member
    ON member.organization_id = project.organization_id
   AND member.id = project.responsible_member_id
   AND member.status = 'active'
  JOIN roles role
    ON role.organization_id = project.organization_id
   AND role.code = 'project_manager'
 WHERE project.responsible_member_id IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;