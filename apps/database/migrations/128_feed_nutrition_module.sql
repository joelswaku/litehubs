-- Dedicated feed-mill and nutrition domain. Inventory remains the single
-- physical-stock ledger; these records describe recipes, nutrition standards
-- and production orders that consume/produce that stock atomically.

CREATE TABLE nutrition_feed_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  species text NOT NULL,
  stage text NOT NULL,
  min_age_days integer,
  max_age_days integer,
  daily_ration_kg numeric(12,4) NOT NULL,
  ration_mode text NOT NULL DEFAULT 'rationed',
  benchmark_fcr numeric(10,4),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT nutrition_feed_profiles_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT nutrition_feed_profiles_code_unique UNIQUE (organization_id, code),
  CONSTRAINT nutrition_feed_profiles_species_check CHECK (species IN ('poultry','pigs')),
  CONSTRAINT nutrition_feed_profiles_age_check CHECK (min_age_days IS NULL OR max_age_days IS NULL OR max_age_days >= min_age_days),
  CONSTRAINT nutrition_feed_profiles_ration_check CHECK (daily_ration_kg > 0 AND ration_mode IN ('rationed','ad_libitum')),
  CONSTRAINT nutrition_feed_profiles_notes_check CHECK (notes IS NULL OR btrim(notes) <> '')
);
CREATE TRIGGER nutrition_feed_profiles_set_updated_at BEFORE UPDATE ON nutrition_feed_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX nutrition_feed_profiles_species_idx ON nutrition_feed_profiles (organization_id, species, is_active);
SELECT enable_tenant_rls('nutrition_feed_profiles');

CREATE TABLE nutrition_feed_recipes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  target_species text NOT NULL,
  feed_stage text,
  base_quantity_kg numeric(14,3) NOT NULL DEFAULT 100,
  output_item_id uuid,
  overhead_per_kg numeric(16,4) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by_member_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT nutrition_feed_recipes_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT nutrition_feed_recipes_code_unique UNIQUE (organization_id, code),
  CONSTRAINT nutrition_feed_recipes_output_item_fk FOREIGN KEY (organization_id, output_item_id)
    REFERENCES management_inventory_items(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT nutrition_feed_recipes_member_fk FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT nutrition_feed_recipes_species_check CHECK (target_species IN ('poultry','pigs','mixed')),
  CONSTRAINT nutrition_feed_recipes_values_check CHECK (base_quantity_kg > 0 AND overhead_per_kg >= 0),
  CONSTRAINT nutrition_feed_recipes_text_check CHECK (btrim(code) <> '' AND btrim(name) <> '' AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER nutrition_feed_recipes_set_updated_at BEFORE UPDATE ON nutrition_feed_recipes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX nutrition_feed_recipes_species_idx ON nutrition_feed_recipes (organization_id, target_species, is_active);
SELECT enable_tenant_rls('nutrition_feed_recipes');

CREATE TABLE nutrition_feed_recipe_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL,
  inventory_item_id uuid,
  ingredient_name text NOT NULL,
  unit text NOT NULL DEFAULT 'kg',
  quantity_per_base numeric(14,4) NOT NULL,
  unit_cost_override numeric(16,4),
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT nutrition_feed_recipe_lines_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT nutrition_feed_recipe_lines_recipe_fk FOREIGN KEY (organization_id, recipe_id)
    REFERENCES nutrition_feed_recipes(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT nutrition_feed_recipe_lines_item_fk FOREIGN KEY (organization_id, inventory_item_id)
    REFERENCES management_inventory_items(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT nutrition_feed_recipe_lines_unit_check CHECK (unit IN ('g','kg','bag_50')),
  CONSTRAINT nutrition_feed_recipe_lines_values_check CHECK (quantity_per_base > 0 AND (unit_cost_override IS NULL OR unit_cost_override >= 0)),
  CONSTRAINT nutrition_feed_recipe_lines_text_check CHECK (btrim(ingredient_name) <> '' AND (notes IS NULL OR btrim(notes) <> ''))
);
CREATE TRIGGER nutrition_feed_recipe_lines_set_updated_at BEFORE UPDATE ON nutrition_feed_recipe_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX nutrition_feed_recipe_lines_recipe_idx ON nutrition_feed_recipe_lines (organization_id, recipe_id, sort_order, created_at);
SELECT enable_tenant_rls('nutrition_feed_recipe_lines');

CREATE TABLE nutrition_feed_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_number text NOT NULL,
  recipe_id uuid NOT NULL,
  project_id uuid,
  site_id uuid NOT NULL,
  input_warehouse_id uuid NOT NULL,
  output_warehouse_id uuid NOT NULL,
  output_item_id uuid,
  planned_quantity_kg numeric(14,3) NOT NULL,
  actual_quantity_kg numeric(14,3),
  bag_weight_kg numeric(14,3) NOT NULL DEFAULT 50,
  overhead_total numeric(16,2) NOT NULL DEFAULT 0,
  production_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'draft',
  produced_by_member_id uuid,
  stock_applied_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT nutrition_feed_orders_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT nutrition_feed_orders_number_unique UNIQUE (organization_id, order_number),
  CONSTRAINT nutrition_feed_orders_recipe_fk FOREIGN KEY (organization_id, recipe_id)
    REFERENCES nutrition_feed_recipes(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT nutrition_feed_orders_project_fk FOREIGN KEY (organization_id, project_id)
    REFERENCES management_projects(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT nutrition_feed_orders_site_fk FOREIGN KEY (organization_id, site_id)
    REFERENCES sites(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT nutrition_feed_orders_input_warehouse_fk FOREIGN KEY (organization_id, input_warehouse_id)
    REFERENCES management_warehouses(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT nutrition_feed_orders_output_warehouse_fk FOREIGN KEY (organization_id, output_warehouse_id)
    REFERENCES management_warehouses(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT nutrition_feed_orders_output_item_fk FOREIGN KEY (organization_id, output_item_id)
    REFERENCES management_inventory_items(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT nutrition_feed_orders_member_fk FOREIGN KEY (organization_id, produced_by_member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT nutrition_feed_orders_values_check CHECK (planned_quantity_kg > 0 AND (actual_quantity_kg IS NULL OR actual_quantity_kg > 0) AND bag_weight_kg > 0 AND overhead_total >= 0),
  CONSTRAINT nutrition_feed_orders_status_check CHECK (status IN ('draft','in_progress','confirmed','cancelled')),
  CONSTRAINT nutrition_feed_orders_notes_check CHECK (notes IS NULL OR btrim(notes) <> '')
);
CREATE TRIGGER nutrition_feed_orders_set_updated_at BEFORE UPDATE ON nutrition_feed_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX nutrition_feed_orders_site_date_idx ON nutrition_feed_orders (organization_id, site_id, production_date DESC);
CREATE INDEX nutrition_feed_orders_recipe_idx ON nutrition_feed_orders (organization_id, recipe_id, status);
SELECT enable_tenant_rls('nutrition_feed_orders');

CREATE TABLE nutrition_feed_order_inputs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  recipe_line_id uuid,
  inventory_item_id uuid,
  warehouse_id uuid NOT NULL,
  ingredient_name text NOT NULL,
  planned_quantity_kg numeric(14,4) NOT NULL,
  actual_quantity_kg numeric(14,4) NOT NULL,
  unit_cost numeric(16,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT nutrition_feed_order_inputs_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT nutrition_feed_order_inputs_order_fk FOREIGN KEY (organization_id, order_id)
    REFERENCES nutrition_feed_orders(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT nutrition_feed_order_inputs_recipe_line_fk FOREIGN KEY (organization_id, recipe_line_id)
    REFERENCES nutrition_feed_recipe_lines(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT nutrition_feed_order_inputs_item_fk FOREIGN KEY (organization_id, inventory_item_id)
    REFERENCES management_inventory_items(organization_id, id) ON DELETE SET NULL,
  CONSTRAINT nutrition_feed_order_inputs_warehouse_fk FOREIGN KEY (organization_id, warehouse_id)
    REFERENCES management_warehouses(organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT nutrition_feed_order_inputs_values_check CHECK (planned_quantity_kg > 0 AND actual_quantity_kg > 0 AND unit_cost >= 0),
  CONSTRAINT nutrition_feed_order_inputs_text_check CHECK (btrim(ingredient_name) <> '')
);
CREATE INDEX nutrition_feed_order_inputs_order_idx ON nutrition_feed_order_inputs (organization_id, order_id);
SELECT enable_tenant_rls('nutrition_feed_order_inputs');

-- Standard nutrition profiles are references only. Organizations may adjust or
-- deactivate them later without changing historical feed records.
INSERT INTO nutrition_feed_profiles (
  organization_id, code, species, stage, min_age_days, max_age_days,
  daily_ration_kg, ration_mode, benchmark_fcr, notes
)
SELECT o.id, v.code, v.species, v.stage, v.min_age_days, v.max_age_days,
       v.daily_ration_kg, v.ration_mode, v.benchmark_fcr, v.notes
FROM organizations o
CROSS JOIN (VALUES
  ('poultry_broiler_starter','poultry','Broiler starter',0,21,0.0450,'rationed',1.55,'W1–W3'),
  ('poultry_broiler_grower','poultry','Broiler grower',22,35,0.1050,'rationed',1.70,'W4–W5'),
  ('poultry_broiler_finisher','poultry','Broiler finisher',36,NULL,0.1650,'rationed',1.85,'W6+'),
  ('poultry_layer_chick_starter','poultry','Layer chick starter',0,42,0.0350,'rationed',1.90,'W1–W6'),
  ('poultry_layer_pullet_grower','poultry','Layer pullet grower',43,112,0.0600,'rationed',2.20,'W7–W16'),
  ('poultry_layer_pre_layer','poultry','Pre-layer',113,126,0.0800,'rationed',2.30,'W17–W18'),
  ('poultry_layer_phase_1','poultry','Layer phase 1',127,315,0.1100,'rationed',2.15,'W19–W45'),
  ('poultry_layer_phase_2','poultry','Layer phase 2',316,NULL,0.1150,'rationed',2.25,'W46+'),
  ('pig_piglet_prestarter','pigs','Piglet / pre-starter',NULL,NULL,0.3500,'rationed',1.60,'0.2–0.5 kg/head/day'),
  ('pig_post_weaning_starter','pigs','Post-weaning / starter',NULL,NULL,1.0000,'rationed',1.85,'0.8–1.2 kg/head/day'),
  ('pig_grower','pigs','Grower',NULL,NULL,1.8500,'rationed',2.30,'1.5–2.2 kg/head/day'),
  ('pig_finisher','pigs','Finisher',NULL,NULL,3.0000,'rationed',2.80,'2.5–3.5 kg/head/day'),
  ('pig_gestating_sow','pigs','Gestating sow',NULL,NULL,2.2000,'rationed',3.00,'Rationed'),
  ('pig_lactating_sow','pigs','Lactating sow',NULL,NULL,6.0000,'ad_libitum',3.20,'5.0–7.0 kg/head/day')
) AS v(code, species, stage, min_age_days, max_age_days, daily_ration_kg, ration_mode, benchmark_fcr, notes)
ON CONFLICT (organization_id, code) DO NOTHING;

CREATE UNIQUE INDEX nutrition_feed_order_input_ledger_unique
  ON management_inventory_stock_movements (organization_id, reference_type, reference_id)
  WHERE reference_type = 'nutrition_feed_order_input' AND reference_id IS NOT NULL;
CREATE UNIQUE INDEX nutrition_feed_order_output_ledger_unique
  ON management_inventory_stock_movements (organization_id, reference_type, reference_id)
  WHERE reference_type = 'nutrition_feed_order_output' AND reference_id IS NOT NULL;

COMMENT ON TABLE nutrition_feed_recipes IS 'Reusable feed formulations defined by a base batch, with kg, g and 50 kg bag ingredient units.';
COMMENT ON TABLE nutrition_feed_orders IS 'Feed manufacturing orders. Confirming an order issues recipe inputs and receives finished feed into the existing inventory ledger exactly once.';
