/**
 * Public, indexable product pages. Each one targets a search intent that the
 * home page alone cannot rank for ("logiciel gestion avicole", "logiciel
 * élevage porcin"…) and links back to the others, so search engines see
 * LiteHubs as a real product site rather than a single login page.
 */
export type MarketingPage = {
  slug: string;
  /** <title> — the root template appends " | LiteHubs". */
  title: string;
  description: string;
  eyebrow: string;
  h1: string;
  intro: string;
  keywords: string[];
  sections: { title: string; text: string; points: string[] }[];
  benefits: string[];
  faq: { question: string; answer: string }[];
};

export const MARKETING_PAGES: MarketingPage[] = [
  {
    slug: "gestion-avicole",
    title: "Logiciel de gestion avicole — poulets de chair et pondeuses",
    description:
      "LiteHubs, logiciel de gestion avicole : suivi des lots, mortalité, alimentation, provenderie, vaccins, ponte, ventes et équipes, par site et en temps réel.",
    eyebrow: "AVICULTURE",
    h1: "Logiciel de gestion avicole pour poulets de chair et pondeuses",
    intro:
      "LiteHubs aide les fermes avicoles à suivre chaque lot du démarrage à la vente : effectifs, mortalité, aliment consommé, santé, ponte et résultats. Les équipes saisissent sur le terrain depuis un téléphone, les responsables voient les chiffres de chaque bâtiment et de chaque site sans attendre les rapports papier.",
    keywords: [
      "logiciel gestion avicole",
      "logiciel élevage poulet",
      "gestion ferme avicole",
      "suivi mortalité poulets",
      "logiciel poulet de chair",
      "logiciel pondeuses",
      "poultry farm management software",
      "LiteHubs",
    ],
    sections: [
      {
        title: "Suivi des lots et des bâtiments",
        text: "Chaque bande a sa fiche : date de mise en place, souche, effectif, bâtiment et responsable.",
        points: [
          "Effectifs, mortalité et réformes jour par jour",
          "Poids, indice de consommation et performances par lot",
          "Historique complet de chaque bâtiment",
        ],
      },
      {
        title: "Alimentation et provenderie",
        text: "Maîtrisez le coût de l’aliment, premier poste de dépense d’un élevage.",
        points: [
          "Consommation d’aliment par lot et par jour",
          "Production de la provenderie, formules et stocks de matières premières",
          "Alertes quand un stock devient bas",
        ],
      },
      {
        title: "Santé, vaccins et biosécurité",
        text: "Le calendrier sanitaire n’est plus dans un cahier.",
        points: [
          "Plans de vaccination et traitements enregistrés",
          "Incidents et observations remontés depuis le terrain",
          "Traçabilité pour les contrôles et les clients",
        ],
      },
      {
        title: "Ponte, ventes et résultats",
        text: "De la production à la marge, chaque chiffre est relié à son lot.",
        points: [
          "Collecte d’œufs et taux de ponte",
          "Ventes, clients et chiffre d’affaires par lot",
          "Tableaux de bord par site, par province et pour toute l’entreprise",
        ],
      },
    ],
    benefits: [
      "Saisie rapide sur téléphone, même pour les équipes terrain",
      "Accès par rôle : chacun voit seulement son site et ses tâches",
      "Plusieurs fermes et provinces dans un seul espace",
      "Interface en français et en anglais",
    ],
    faq: [
      {
        question: "LiteHubs convient-il aux petites fermes avicoles ?",
        answer:
          "Oui. LiteHubs fonctionne pour un seul bâtiment comme pour plusieurs fermes réparties dans différentes provinces. Vous activez uniquement les modules utiles.",
      },
      {
        question: "Peut-on suivre à la fois des poulets de chair et des pondeuses ?",
        answer:
          "Oui. Chaque lot a son type de production, avec les indicateurs adaptés : croissance et indice de consommation pour le chair, ponte pour les pondeuses.",
      },
      {
        question: "Les employés doivent-ils avoir un ordinateur ?",
        answer:
          "Non. LiteHubs s’utilise dans le navigateur d’un téléphone. Les employés saisissent leurs données directement depuis le bâtiment.",
      },
    ],
  },
  {
    slug: "elevage-porcin",
    title: "Logiciel d’élevage porcin — truies, porcelets et engraissement",
    description:
      "Logiciel de gestion d’élevage porcin LiteHubs : enclos, reproduction, mises bas, sevrage, traitements, poids, alimentation et ventes, en temps réel.",
    eyebrow: "ÉLEVAGE PORCIN",
    h1: "Logiciel de gestion d’élevage porcin",
    intro:
      "LiteHubs suit votre élevage de porcs de la saillie à la vente : truies, verrats, portées, croissance et santé. Les soigneurs enregistrent les événements au fil de la journée et la direction suit la productivité de chaque bâtiment.",
    keywords: [
      "logiciel élevage porcin",
      "logiciel gestion porcherie",
      "suivi truies et porcelets",
      "gestion élevage de porcs",
      "pig farm management software",
      "LiteHubs",
    ],
    sections: [
      {
        title: "Reproduction et portées",
        text: "Chaque truie a son historique de reproduction.",
        points: [
          "Saillies, gestations, mises bas et sevrages",
          "Nés vivants, mort-nés et porcelets sevrés par portée",
          "Rappels des prochaines étapes",
        ],
      },
      {
        title: "Enclos, groupes et mouvements",
        text: "Sachez à tout moment où se trouve chaque animal.",
        points: [
          "Enclos et groupes d’animaux",
          "Transferts entre bâtiments et sites",
          "Pesées et suivi de croissance",
        ],
      },
      {
        title: "Santé et traitements",
        text: "Les soins sont enregistrés au moment où ils sont faits.",
        points: [
          "Traitements, vaccins et observations",
          "Mortalité et causes",
          "Historique sanitaire par animal ou par groupe",
        ],
      },
      {
        title: "Alimentation, ventes et performance",
        text: "Comparez le coût de production à ce que rapporte chaque bande.",
        points: [
          "Consommation d’aliment par groupe",
          "Ventes et clients",
          "Indicateurs par site et pour toute l’exploitation",
        ],
      },
    ],
    benefits: [
      "Pensé pour les équipes terrain : simple sur téléphone",
      "Données par site avec des accès par rôle",
      "Un seul logiciel avec l’aviculture et l’agriculture",
      "Disponible en français et en anglais",
    ],
    faq: [
      {
        question: "Peut-on gérer plusieurs porcheries ?",
        answer:
          "Oui. Chaque site a ses enclos et son équipe, et la direction voit l’ensemble des sites dans un même tableau de bord.",
      },
      {
        question: "LiteHubs gère-t-il aussi les volailles et les cultures ?",
        answer:
          "Oui. LiteHubs réunit la gestion avicole, porcine et agricole, ainsi que les équipes, les stocks et les achats.",
      },
    ],
  },
  {
    slug: "gestion-agricole",
    title: "Logiciel de gestion agricole — champs, cultures et récoltes",
    description:
      "LiteHubs, logiciel de gestion agricole : fermes, parcelles, cultures, intrants, travaux, observations, récoltes et ventes, pour une ou plusieurs exploitations.",
    eyebrow: "AGRICULTURE",
    h1: "Logiciel de gestion agricole pour fermes et exploitations",
    intro:
      "LiteHubs organise le travail agricole autour de vos parcelles : ce qui est semé, ce qui a été appliqué, qui a travaillé où, et ce qui a été récolté. Les décisions reposent sur des chiffres saisis le jour même, pas sur des souvenirs.",
    keywords: [
      "logiciel gestion agricole",
      "logiciel ferme agricole",
      "gestion des cultures",
      "suivi des récoltes",
      "gestion exploitation agricole Afrique",
      "farm management software",
      "LiteHubs",
    ],
    sections: [
      {
        title: "Fermes, parcelles et cultures",
        text: "Structurez vos exploitations comme elles sont sur le terrain.",
        points: [
          "Fermes, champs et parcelles avec leurs surfaces",
          "Campagnes et cultures par parcelle",
          "Plan de travaux de la saison",
        ],
      },
      {
        title: "Intrants et stocks",
        text: "Chaque sac d’engrais et chaque semence est suivi.",
        points: [
          "Semences, engrais et produits de traitement",
          "Entrées et sorties de stock par site",
          "Coût des intrants par culture",
        ],
      },
      {
        title: "Travaux et observations",
        text: "Le terrain remonte l’information sans détour.",
        points: [
          "Travaux réalisés et main-d’œuvre utilisée",
          "Observations, maladies et ravageurs signalés depuis le terrain",
          "Tâches assignées aux équipes",
        ],
      },
      {
        title: "Récoltes et ventes",
        text: "Mesurez enfin le rendement réel de chaque parcelle.",
        points: [
          "Quantités récoltées par parcelle",
          "Ventes et clients",
          "Rendement et marge par culture",
        ],
      },
    ],
    benefits: [
      "Utilisable sur téléphone directement dans les champs",
      "Plusieurs exploitations et provinces dans un même espace",
      "Accès par rôle pour chaque responsable",
      "Interface en français et en anglais",
    ],
    faq: [
      {
        question: "LiteHubs fonctionne-t-il pour plusieurs exploitations ?",
        answer:
          "Oui. Vous pouvez organiser vos fermes par province et par site, avec des responsables qui ne voient que leur périmètre.",
      },
      {
        question: "Peut-on combiner cultures et élevage ?",
        answer:
          "Oui. LiteHubs regroupe la gestion agricole, avicole et porcine dans le même logiciel.",
      },
    ],
  },
  {
    slug: "equipes-rh",
    title: "Gestion des équipes, RH et paie pour entreprises agricoles",
    description:
      "LiteHubs gère vos employés : dossiers, rôles et accès, horaires, formations, recrutement, paie et messages, sur un espace sécurisé par site.",
    eyebrow: "ÉQUIPES ET RH",
    h1: "Gestion des équipes, des RH et de la paie",
    intro:
      "Une exploitation avance avec ses équipes. LiteHubs réunit les dossiers des employés, leurs accès, leurs horaires, leurs formations et leur paie, et permet de recruter et de communiquer avec eux depuis le même espace.",
    keywords: [
      "logiciel gestion RH",
      "logiciel paie Congo",
      "gestion des employés",
      "logiciel recrutement",
      "gestion des équipes agricoles",
      "LiteHubs",
    ],
    sections: [
      {
        title: "Dossiers employés et accès",
        text: "Chaque personne a un dossier et des droits adaptés à son rôle.",
        points: [
          "Dossiers, contrats et documents",
          "Rôles et accès par site ou par province",
          "Espace personnel pour chaque employé",
        ],
      },
      {
        title: "Recrutement",
        text: "Publiez vos offres et suivez les candidats jusqu’à l’embauche.",
        points: [
          "Page carrières publique",
          "Espace candidat pour suivre sa candidature et envoyer ses documents",
          "Demandes de documents avec date limite",
        ],
      },
      {
        title: "Formation et communication",
        text: "Gardez tout le monde informé et formé.",
        points: [
          "Formations et suivi des participants",
          "Messages directs par e-mail, SMS ou notification",
          "Rendez-vous en ligne avec vos visiteurs",
        ],
      },
      {
        title: "Paie et suivi",
        text: "Préparez la paie à partir de données fiables.",
        points: [
          "Éléments de paie par employé",
          "Historique et journal d’audit",
          "Bulletins de paie en PDF",
        ],
      },
    ],
    benefits: [
      "Données sécurisées et séparées par organisation",
      "Accès par rôle et par site",
      "Journal d’audit des actions importantes",
      "Interface en français et en anglais",
    ],
    faq: [
      {
        question: "Les employés ont-ils leur propre accès ?",
        answer:
          "Oui. Chaque employé peut recevoir un compte et voir ses informations, ses tâches et ses messages, sans accéder aux données des autres.",
      },
      {
        question: "Peut-on recruter avec LiteHubs ?",
        answer:
          "Oui. Vos offres sont publiées sur une page carrières, les candidats postulent en ligne et suivent leur dossier dans un espace candidat.",
      },
    ],
  },
];

export function marketingPage(slug: string) {
  return MARKETING_PAGES.find((page) => page.slug === slug) ?? null;
}

/** Fixed date for sitemap `lastmod`: change it when page content changes. */
export const MARKETING_CONTENT_UPDATED = "2026-10-16";
