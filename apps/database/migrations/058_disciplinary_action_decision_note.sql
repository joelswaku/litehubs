-- A recorded decision must state the rationale as well as its outcome.
ALTER TABLE disciplinary_actions
  ADD COLUMN IF NOT EXISTS decision_note text;

ALTER TABLE disciplinary_actions
  DROP CONSTRAINT IF EXISTS disciplinary_actions_decision_note_not_blank;
ALTER TABLE disciplinary_actions
  ADD CONSTRAINT disciplinary_actions_decision_note_not_blank
  CHECK (decision_note IS NULL OR btrim(decision_note) <> '');
