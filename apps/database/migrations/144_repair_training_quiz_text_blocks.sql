-- 144_repair_training_quiz_text_blocks.sql
--
-- Earlier course drafts could store an inline quiz JSON array in a Text block.
-- Repair only structured questionnaires (prompt + options + answer) so prose
-- and arbitrary JSON examples remain unchanged.

DO $$
DECLARE
  candidate record;
  parsed jsonb;
  questions jsonb;
  normalized jsonb;
BEGIN
  FOR candidate IN
    SELECT block.id, block.organization_id, lesson.course_id, lesson.version_id,
           block.content
      FROM training_content_blocks block
      JOIN training_lessons lesson
        ON lesson.organization_id = block.organization_id
       AND lesson.id = block.lesson_id
     WHERE block.block_type = 'text'
       AND jsonb_typeof(block.content->'body') = 'string'
  LOOP
    BEGIN
      parsed := (candidate.content->>'body')::jsonb;
      questions := CASE
        WHEN jsonb_typeof(parsed) = 'array' THEN parsed
        WHEN jsonb_typeof(parsed) = 'object'
          AND jsonb_typeof(parsed->'questions') = 'array'
          THEN parsed->'questions'
        ELSE NULL
      END;

      IF questions IS NULL OR jsonb_array_length(questions) = 0 THEN
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(questions) AS item(question)
         WHERE jsonb_typeof(item.question) <> 'object'
            OR COALESCE(item.question->>'question', item.question->>'prompt', '') = ''
            OR jsonb_typeof(item.question->'options') <> 'array'
            OR jsonb_array_length(item.question->'options') < 2
            OR NOT (
              item.question ? 'correctAnswer'
              OR item.question ? 'correctOption'
              OR item.question ? 'correctAnswers'
              OR item.question ? 'answer'
              OR item.question ? 'answers'
            )
      ) THEN
        CONTINUE;
      END IF;

      normalized := CASE
        WHEN jsonb_typeof(parsed) = 'object' THEN parsed
        ELSE jsonb_build_object('questions', questions)
      END;
      normalized := normalized || jsonb_build_object(
        'questions', questions,
        'passingScore', COALESCE(normalized->'passingScore', '70'::jsonb)
      );

      UPDATE training_content_blocks
         SET block_type = 'quiz', content = normalized
       WHERE id = candidate.id;

      INSERT INTO training_audit_events
        (organization_id, course_id, version_id, event_type, detail)
      VALUES
        (candidate.organization_id, candidate.course_id, candidate.version_id,
         'quiz_text_block_repaired',
         jsonb_build_object('blockId', candidate.id, 'source', 'migration_144'));
    EXCEPTION
      WHEN invalid_text_representation THEN
        -- It was regular prose that merely resembled JSON; leave it untouched.
        NULL;
    END;
  END LOOP;
END $$;
