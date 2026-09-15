-- A recovery balance applies exclusively to deductions (for example, an
-- employee advance). Older form submissions could store zero on an earning
-- when the recovery field was omitted. It is not a valid recovery value for
-- an allowance and caused the payroll engine to cap the allowance at zero.
-- Keep legitimate deduction balances intact while normalising the invalid
-- cross-type values for every tenant.
UPDATE employee_payroll_components AS employee_component
SET total_to_recover = NULL,
    recovered_to_date = 0
FROM payroll_components AS component
WHERE component.organization_id = employee_component.organization_id
  AND component.id = employee_component.component_id
  AND component.component_type IN ('earning', 'employer_cost')
  AND employee_component.total_to_recover IS NOT NULL;