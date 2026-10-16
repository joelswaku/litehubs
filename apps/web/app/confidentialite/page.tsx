import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";
import { INDEXABLE, publicUrl } from "@/lib/seo";

/**
 * LiteHubs privacy policy, in French then English (Meta and other platform
 * reviewers read the English part). Server-rendered and public: the same URL
 * is given to Meta, app stores and customers.
 */

const UPDATED_FR = "16 octobre 2026";
const UPDATED_EN = "October 16, 2026";
const CONTACT_FORM = "litehubs.com/contact";
const PRIVACY_FORM = "/contact?sujet=privacy";
const COMPANY = "Lakenah LLC";
const ADDRESS = "17200 E Iliff Ave, Ste A12 PMB 1011, Aurora, CO 80013, États-Unis";
const ADDRESS_EN = "17200 E Iliff Ave, Ste A12 PMB 1011, Aurora, CO 80013, United States";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description:
    "Comment LiteHubs collecte, utilise, protège et supprime les données des organisations, de leurs employés, de leurs clients et de leurs candidats.",
  alternates: { canonical: "/confidentialite" },
  openGraph: {
    type: "website",
    siteName: "LiteHubs",
    url: publicUrl("/confidentialite"),
    title: "Politique de confidentialité | LiteHubs",
  },
  robots: INDEXABLE,
};

type Section = { id: string; title: string; paragraphs?: string[]; items?: string[]; link?: { href: string; label: string } };

const FRENCH: Section[] = [
  {
    id: "qui",
    title: "1. Qui sommes-nous",
    paragraphs: [
      `LiteHubs est une plateforme de gestion pour entreprises agricoles et leurs équipes (élevage avicole et porcin, agriculture, ressources humaines, recrutement, rendez-vous, messagerie client). LiteHubs est exploité par ${COMPANY}, ${ADDRESS}.`,
      "Chaque entreprise cliente (« l’organisation ») dispose de son propre espace. L’organisation décide quelles données elle enregistre sur ses employés, ses clients et ses candidats : pour ces données, elle est responsable du traitement et LiteHubs agit comme sous-traitant, uniquement sur ses instructions.",
    ],
  },
  {
    id: "donnees",
    title: "2. Données que nous traitons",
    items: [
      "Comptes utilisateurs : nom, adresse e-mail, téléphone, mot de passe (stocké chiffré, jamais lisible), rôle et organisation.",
      "Données d’employés saisies par l’organisation : dossier, poste, site, horaires, présences, congés, formations, éléments de paie et documents.",
      "Candidats : informations de candidature, CV et documents envoyés via l’Espace candidat.",
      "Clients et visiteurs : demandes de contact, rendez-vous (nom, e-mail ou téléphone, motif) et messages échangés.",
      "Messages reçus via Facebook Messenger et Instagram lorsque l’organisation connecte sa Page Facebook ou son compte Instagram professionnel : identifiant de l’expéditeur, nom affiché, contenu des messages et pièces jointes.",
      "Données d’exploitation : lots, animaux, cultures, stocks, ventes et rapports saisis par les équipes.",
      "Données techniques : journaux de connexion, adresse IP, navigateur et journal d’audit des actions importantes, pour la sécurité du service.",
    ],
  },
  {
    id: "usages",
    title: "3. Pourquoi nous les utilisons",
    items: [
      "Fournir le service à l’organisation et à ses utilisateurs (connexion, accès par rôle, fonctionnalités).",
      "Envoyer les e-mails et SMS liés au service : invitations, réinitialisation du mot de passe, rendez-vous, suivi de candidature, messages de l’organisation.",
      "Recevoir et répondre aux messages Messenger et Instagram dans la boîte de l’organisation, par un membre de l’équipe ou par un assistant automatique configuré par l’organisation. Un membre de l’équipe peut reprendre la conversation à tout moment.",
      "Assurer la sécurité, prévenir les abus et conserver un journal d’audit.",
      "Mesurer la fréquentation de nos pages publiques (statistiques anonymisées).",
    ],
    paragraphs: [
      "Nous ne vendons pas les données, nous ne les louons pas et nous ne les utilisons pas pour de la publicité ciblée. Les données d’une organisation ne sont jamais visibles par une autre organisation.",
    ],
  },
  {
    id: "partage",
    title: "4. Prestataires (sous-traitants)",
    paragraphs: ["Nous faisons appel à des prestataires techniques, uniquement pour faire fonctionner le service :"],
    items: [
      "Railway Corporation (États-Unis) : hébergement de l’application et de la base de données.",
      "Cloudflare, Inc. (États-Unis) : réseau, sécurité et nom de domaine.",
      "Cloudinary Ltd. : stockage des images.",
      "Brevo (Sendinblue SAS, France) : envoi des e-mails et SMS.",
      "OpenAI, L.L.C. (États-Unis) : fonctions d’intelligence artificielle (assistant de réponse, aide à la rédaction, images), lorsqu’elles sont activées par l’organisation. Les données envoyées via l’API ne servent pas à entraîner les modèles d’OpenAI.",
      "Meta Platforms, Inc. : réception et envoi des messages Messenger et Instagram, si l’organisation connecte ses comptes.",
      "Google LLC : statistiques de fréquentation des pages publiques (Google Analytics).",
    ],
  },
  {
    id: "conservation",
    title: "5. Durée de conservation",
    paragraphs: [
      "Les données sont conservées tant que l’organisation utilise LiteHubs, ou moins longtemps si l’organisation les supprime. Quand une organisation ferme son compte, ses données sont supprimées dans un délai de 90 jours, sauf obligation légale de conservation. Les sessions de connexion expirent au plus tard après 30 jours.",
    ],
  },
  {
    id: "securite",
    title: "6. Sécurité",
    items: [
      "Connexions chiffrées (HTTPS) et mots de passe stockés sous forme chiffrée.",
      "Séparation stricte des données de chaque organisation au niveau de la base de données.",
      "Accès par rôle et par site : chaque personne ne voit que ce qui la concerne.",
      "Journal d’audit des connexions et des actions sensibles.",
    ],
  },
  {
    id: "droits",
    title: "7. Vos droits",
    paragraphs: [
      "Vous pouvez demander l’accès à vos données, leur correction, leur suppression ou leur export, et vous opposer à certains traitements. Si vos données ont été enregistrées par une organisation (votre employeur, une entreprise que vous avez contactée), adressez-vous d’abord à elle ; nous l’aiderons à répondre. Vous pouvez aussi nous écrire directement.",
    ],
  },
  {
    id: "suppression",
    title: "8. Suppression des données (y compris Facebook et Instagram)",
    link: { href: PRIVACY_FORM, label: "Demander la suppression de mes données" },
    paragraphs: [
      `Pour faire supprimer vos données, y compris les messages échangés via Messenger ou Instagram, utilisez le formulaire ${CONTACT_FORM} avec le sujet « Confidentialité et suppression de données », en indiquant votre nom, votre adresse e-mail ou votre identifiant Facebook / Instagram et l’entreprise concernée. Nous confirmons la suppression sous 30 jours.`,
      "Une organisation peut aussi déconnecter à tout moment sa Page Facebook ou son compte Instagram depuis LiteHubs ; LiteHubs cesse alors de recevoir ses messages.",
    ],
  },
  {
    id: "cookies",
    title: "9. Cookies",
    paragraphs: [
      "LiteHubs utilise des cookies nécessaires à la connexion (session sécurisée) et à vos préférences (langue, thème). Les pages publiques utilisent des cookies de mesure d’audience (Google Analytics).",
    ],
  },
  {
    id: "contact",
    title: "10. Contact et modifications",
    paragraphs: [
      `Pour toute question sur cette politique : formulaire ${CONTACT_FORM} (sujet « Confidentialité ») — ${COMPANY}, ${ADDRESS}.`,
      "Nous pouvons mettre à jour cette politique ; la date de dernière mise à jour figure en haut de la page. En cas de changement important, les organisations clientes sont prévenues.",
    ],
  },
];

const ENGLISH: Section[] = [
  {
    id: "en-who",
    title: "1. Who we are",
    paragraphs: [
      `LiteHubs is a management platform for agricultural businesses and their teams (poultry, pigs, crops, HR, recruitment, appointments and customer messaging). LiteHubs is operated by ${COMPANY}, ${ADDRESS_EN}.`,
      "Each customer business (the “organization”) has its own workspace and decides what data it records about its employees, customers and applicants. For that data the organization is the controller and LiteHubs acts as a processor, only on its instructions.",
    ],
  },
  {
    id: "en-data",
    title: "2. Data we process",
    items: [
      "User accounts: name, e-mail, phone, password (stored hashed), role and organization.",
      "Employee records entered by the organization: profile, position, site, schedules, attendance, leave, training, payroll items and documents.",
      "Job applicants: application details, CV and documents uploaded through the candidate space.",
      "Customers and visitors: contact requests, appointments and messages.",
      "Messages received through Facebook Messenger and Instagram when the organization connects its Facebook Page or Instagram professional account: sender ID, display name, message content and attachments.",
      "Operational data: batches, animals, crops, stock, sales and reports.",
      "Technical data: sign-in logs, IP address, browser and an audit log, for security.",
    ],
  },
  {
    id: "en-use",
    title: "3. How we use it",
    items: [
      "To provide the service to the organization and its users.",
      "To send service e-mails and SMS (invitations, password reset, appointments, application updates, messages from the organization).",
      "To receive and answer Messenger and Instagram messages in the organization’s inbox, by a team member or by an automatic assistant configured by the organization; a team member can take over at any time.",
      "To keep the service secure and maintain an audit log.",
      "To measure traffic on our public pages.",
    ],
    paragraphs: [
      "We do not sell or rent data and do not use it for targeted advertising. One organization’s data is never visible to another organization.",
    ],
  },
  {
    id: "en-processors",
    title: "4. Service providers",
    items: [
      "Railway Corporation (USA): application and database hosting.",
      "Cloudflare, Inc. (USA): network, security and domain.",
      "Cloudinary Ltd.: image storage.",
      "Brevo (Sendinblue SAS, France): e-mail and SMS delivery.",
      "OpenAI, L.L.C. (USA): AI features when enabled by the organization; API data is not used to train OpenAI models.",
      "Meta Platforms, Inc.: Messenger and Instagram messaging, when the organization connects its accounts.",
      "Google LLC: public page analytics (Google Analytics).",
    ],
  },
  {
    id: "en-retention",
    title: "5. Retention",
    paragraphs: [
      "Data is kept while the organization uses LiteHubs, or less if the organization deletes it. When an organization closes its account, its data is deleted within 90 days unless the law requires otherwise. Sign-in sessions expire after 30 days at most.",
    ],
  },
  {
    id: "en-rights",
    title: "6. Your rights",
    paragraphs: [
      "You may request access, correction, deletion or export of your data, and object to certain processing. If your data was recorded by an organization (your employer, a business you contacted), contact it first; we will help it respond. You can also write to us directly.",
    ],
  },
  {
    id: "en-deletion",
    title: "7. Data deletion (including Facebook and Instagram)",
    link: { href: PRIVACY_FORM, label: "Request deletion of my data" },
    paragraphs: [
      `To delete your data, including Messenger or Instagram conversations, use the form at ${CONTACT_FORM} with the topic “Privacy and data deletion”, giving your name, your e-mail or Facebook / Instagram ID and the business concerned. We confirm deletion within 30 days. An organization can also disconnect its Facebook Page or Instagram account from LiteHubs at any time; LiteHubs then stops receiving its messages.`,
    ],
  },
  {
    id: "en-contact",
    title: "8. Contact",
    paragraphs: [
      `Questions about this policy: contact form at ${CONTACT_FORM} (topic “Privacy”) — ${COMPANY}, ${ADDRESS_EN}. We may update this policy; the date above shows the latest version.`,
    ],
  },
];

function Sections({ sections }: { sections: Section[] }) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.id} id={section.id} className="scroll-mt-6">
          <h2 className="mt-10 text-xl font-semibold tracking-[-0.03em] text-ink">{section.title}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph.slice(0, 40)} className="mt-3 text-[15px] leading-7 text-ink-secondary">
              {paragraph}
            </p>
          ))}
          {section.items ? (
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-ink-secondary">
              {section.items.map((item) => (
                <li key={item.slice(0, 40)}>{item}</li>
              ))}
            </ul>
          ) : null}
          {section.link ? (
            <Link
              href={section.link.href}
              className="mt-4 inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-brand-ink hover:bg-brand-hover"
            >
              {section.link.label}
            </Link>
          ) : null}
        </section>
      ))}
    </>
  );
}

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-page pt-16 text-ink">
      <SiteHeader />
      <article className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Politique de confidentialité</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Dernière mise à jour : {UPDATED_FR} ·{" "}
          <a href="#english" className="font-semibold text-brand hover:underline">English version</a>
        </p>
        <Sections sections={FRENCH} />

        <div id="english" className="mt-16 scroll-mt-6 border-t border-border pt-12">
          <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Privacy Policy</h1>
          <p className="mt-2 text-sm text-ink-muted">Last updated: {UPDATED_EN}</p>
          <Sections sections={ENGLISH} />
        </div>
      </article>
      <SiteFooter />
    </main>
  );
}
