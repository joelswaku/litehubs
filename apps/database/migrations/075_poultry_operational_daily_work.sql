-- Evidence-based poultry daily work: allow controlled operational checklist categories.
ALTER TABLE poultry_daily_work_items
  DROP CONSTRAINT IF EXISTS poultry_daily_work_items_type_check;

ALTER TABLE poultry_daily_work_items
  ADD CONSTRAINT poultry_daily_work_items_type_check CHECK (
    work_type IN (
      'feed_record',
      'water_record',
      'live_bird_check',
      'weight_check',
      'egg_collection',
      'mortality_review',
      'vaccination',
      'health_check',
      'health_follow_up',
      'treatment_follow_up',
      'climate_check',
      'biosecurity_check',
      'performance_model_setup',
      'other'
    )
  );