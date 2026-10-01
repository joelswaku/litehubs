BEGIN;

-- Congo Omega's public domain now points at LiteHubs.  The first production
-- publish must therefore have a complete public shell as well as the tables
-- created by the website builder migrations.  This seed is deliberately
-- limited to the known Congo Omega organisation and contains no operational,
-- HR, stock or project information.
WITH congo_omega AS (
  SELECT id
    FROM organizations
   WHERE slug = 'congo-omega' AND status = 'active'
), website AS (
  INSERT INTO organization_website_settings (
    organization_id, display_name, tagline, default_locale,
    publication_status, theme_preset, primary_color, accent_color,
    contact_email, address_text, footer_text, custom_domain
  )
  SELECT
    id,
    'Congo Omega',
    'Une agriculture locale, responsable et utile.',
    'fr',
    'published',
    'verdant',
    '#075c4d',
    '#e9a43a',
    'contact@congoomega.com',
    'République démocratique du Congo',
    'Une entreprise proche du terrain, engagée pour une production locale solide et durable.',
    'congoomega.com'
  FROM congo_omega
  ON CONFLICT (organization_id) DO UPDATE SET
    custom_domain = EXCLUDED.custom_domain,
    publication_status = 'published',
    contact_email = COALESCE(organization_website_settings.contact_email, EXCLUDED.contact_email),
    address_text = COALESCE(organization_website_settings.address_text, EXCLUDED.address_text),
    footer_text = COALESCE(organization_website_settings.footer_text, EXCLUDED.footer_text),
    updated_at = now()
  RETURNING id, organization_id
), page_definitions (
  slug, label_fr, label_en, title_fr, title_en, description_fr, description_en,
  template_code, is_home, sort_order
) AS (
  VALUES
    ('accueil', 'Accueil', 'Home', 'Accueil', 'Home',
      'Découvrez notre entreprise, nos activités et nos projets.',
      'Discover our company, our activities and our projects.', 'company', true, 0),
    ('notre-entreprise', 'Notre entreprise', 'Our company', 'Notre entreprise', 'Our company',
      'Notre vision, notre méthode et notre engagement.',
      'Our vision, our approach and our commitment.', 'company', false, 1),
    ('activites', 'Activités', 'Activities', 'Nos activités', 'Our activities',
      'Production, agriculture, élevage et transformation.',
      'Production, agriculture, livestock and transformation.', 'operations', false, 2),
    ('projets', 'Projets', 'Projects', 'Nos projets', 'Our projects',
      'Des investissements suivis jusqu’à leurs résultats.',
      'Investments followed through to their results.', 'project', false, 3),
    ('carrieres', 'Carrières', 'Careers', 'Carrières', 'Careers',
      'Rejoignez une équipe qui agit sur le terrain.',
      'Join a team that makes a difference on the ground.', 'careers', false, 4),
    ('contact', 'Contact', 'Contact', 'Contact', 'Contact',
      'Échangeons sur votre besoin ou votre projet.',
      'Let’s discuss your need or project.', 'contact', false, 5),
    ('impact', 'Impact', 'Impact', 'Notre impact', 'Our impact',
      'Une production locale responsable, utile et durable.',
      'Responsible, useful and sustainable local production.', 'impact', false, 6)
), pages AS (
  INSERT INTO organization_website_pages (
    organization_id, website_id, slug, navigation_label_fr, navigation_label_en,
    title_fr, title_en, description_fr, description_en, template_code,
    status, is_home, sort_order
  )
  SELECT
    website.organization_id, website.id, d.slug, d.label_fr, d.label_en,
    d.title_fr, d.title_en, d.description_fr, d.description_en,
    d.template_code, 'published', d.is_home, d.sort_order
  FROM website
  CROSS JOIN page_definitions d
  ON CONFLICT (organization_id, slug) DO UPDATE SET
    status = 'published', updated_at = now()
  RETURNING id, organization_id, slug
), section_definitions (slug, section_type, section_order, content) AS (
  VALUES
    ('notre-entreprise', 'hero', 0, jsonb_build_object(
      'kickerFr', 'NOTRE ENTREPRISE', 'kickerEn', 'OUR COMPANY',
      'titleFr', 'Grandir avec le terrain.', 'titleEn', 'Growing with the ground.',
      'bodyFr', 'Congo Omega construit une production locale fiable avec des équipes formées, des ressources suivies et une ambition durable.',
      'bodyEn', 'Congo Omega builds reliable local production with trained teams, tracked resources and lasting ambition.',
      'imageUrl', '/website/congo-omega-team.png',
      'buttonLabelFr', 'Voir nos activités', 'buttonLabelEn', 'Explore our work', 'buttonHref', '/activites'
    )),
    ('activites', 'hero', 0, jsonb_build_object(
      'kickerFr', 'NOS ACTIVITÉS', 'kickerEn', 'OUR ACTIVITIES',
      'titleFr', 'Du champ à l’élevage, une chaîne maîtrisée.', 'titleEn', 'From field to livestock, one controlled chain.',
      'bodyFr', 'Agriculture, aviculture, élevage et transformation avancent ensemble pour créer une valeur locale durable.',
      'bodyEn', 'Agriculture, poultry, livestock and transformation move together to create lasting local value.',
      'imageUrl', '/website/congo-omega-operations.png',
      'buttonLabelFr', 'Nous contacter', 'buttonLabelEn', 'Contact us', 'buttonHref', '/contact'
    )),
    ('projets', 'hero', 0, jsonb_build_object(
      'kickerFr', 'NOS PROJETS', 'kickerEn', 'OUR PROJECTS',
      'titleFr', 'Des investissements transformés en résultats.', 'titleEn', 'Investments turned into results.',
      'bodyFr', 'Nos projets sont pensés pour devenir des opérations utiles, mesurables et proches des communautés.',
      'bodyEn', 'Our projects are designed to become useful, measurable operations close to communities.',
      'imageUrl', '/website/congo-omega-projects.png',
      'buttonLabelFr', 'Parlons de votre projet', 'buttonLabelEn', 'Discuss your project', 'buttonHref', '/contact'
    )),
    ('carrieres', 'careers', 0, jsonb_build_object(
      'kickerFr', 'CARRIÈRES', 'kickerEn', 'CAREERS',
      'titleFr', 'Construisons une agriculture locale forte.', 'titleEn', 'Let’s build stronger local agriculture.',
      'bodyFr', 'Découvrez les opportunités ouvertes et rejoignez des équipes qui agissent concrètement sur le terrain.',
      'bodyEn', 'Discover open opportunities and join teams taking real action in the field.',
      'buttonLabelFr', 'Voir les postes ouverts', 'buttonLabelEn', 'See open roles'
    )),
    ('contact', 'contact', 0, jsonb_build_object(
      'kickerFr', 'CONTACT', 'kickerEn', 'CONTACT',
      'titleFr', 'Parlons de votre besoin.', 'titleEn', 'Let’s discuss your needs.',
      'bodyFr', 'Notre équipe vous répondra dans le bon contexte : partenariat, projet, service ou recrutement.',
      'bodyEn', 'Our team will respond in the right context: partnership, project, service or recruitment.',
      'buttonLabelFr', 'Prendre rendez-vous', 'buttonLabelEn', 'Book an appointment', 'buttonHref', '/rendezvous'
    )),
    ('impact', 'hero', 0, jsonb_build_object(
      'kickerFr', 'NOTRE IMPACT', 'kickerEn', 'OUR IMPACT',
      'titleFr', 'Une valeur qui reste proche des communautés.', 'titleEn', 'Value that stays close to communities.',
      'bodyFr', 'Nous mesurons l’impact dans les équipes, les ressources, la production locale et les résultats obtenus dans la durée.',
      'bodyEn', 'We measure impact through teams, resources, local production and long-term results.',
      'imageUrl', '/website/congo-omega-impact.png',
      'buttonLabelFr', 'Découvrir nos activités', 'buttonLabelEn', 'Explore our work', 'buttonHref', '/activites'
    ))
)
INSERT INTO organization_website_sections (
  organization_id, page_id, section_type, section_order, is_visible, content
)
SELECT pages.organization_id, pages.id, d.section_type, d.section_order, true, d.content
  FROM pages
  JOIN section_definitions d ON d.slug = pages.slug
 WHERE NOT EXISTS (
   SELECT 1 FROM organization_website_sections existing
    WHERE existing.organization_id = pages.organization_id AND existing.page_id = pages.id
 );

COMMIT;
