/**
 * Built-in privacy policy for public company websites.
 *
 * Served at /confidentialite (and a few aliases) when the company has not
 * published its own page with that address.  The text describes what LiteHubs
 * actually does with visitor data: contact forms, job applications, customer
 * accounts, shop order requests, the website chat with its AI assistant,
 * Facebook / Instagram messages and comments, and e-mail.
 */

export const PRIVACY_SLUGS = [
  "confidentialite",
  "politique-de-confidentialite",
  "privacy",
  "privacy-policy",
] as const;

export const PRIVACY_PATH = "/confidentialite";

export function isPrivacySlug(slug: string | undefined | null): boolean {
  return Boolean(slug && (PRIVACY_SLUGS as readonly string[]).includes(slug.toLowerCase()));
}

/** Legal entity behind a public brand, when it differs from the brand. */
export function legalOwnerForHost(host: string | undefined | null): string | null {
  const clean = (host ?? "").replace(/^www\./i, "").toLowerCase();
  return clean === "congoomega.com" ? "Lakenah LLC" : null;
}

type Company = {
  brand: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  domain: string | null;
};

export type LegalBlock = {
  id: string;
  title_fr: string;
  title_en: string;
  paragraphs_fr: string[];
  paragraphs_en: string[];
  items_fr?: string[];
  items_en?: string[];
};

export type LegalContent = {
  title_fr: string;
  title_en: string;
  updated_fr: string;
  updated_en: string;
  intro_fr: string;
  intro_en: string;
  blocks: LegalBlock[];
};

const UPDATED_FR = "Dernière mise à jour : 10 octobre 2026";
const UPDATED_EN = "Last updated: October 10, 2026";

export function companyForPrivacy(input: {
  host?: string | null;
  displayName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  addressText?: string | null;
}): Company {
  const domain = (input.host ?? "").replace(/^www\./i, "").toLowerCase() || null;
  const congoOmega = domain === "congoomega.com";
  return {
    brand: congoOmega ? "Congo Omega" : input.displayName?.trim() || "notre entreprise",
    legalName: legalOwnerForHost(domain),
    email: input.contactEmail?.trim() || (congoOmega ? "contact@congoomega.com" : null),
    phone: input.contactPhone?.trim() || null,
    address:
      congoOmega
        ? "17200 E Iliff Ave, Ste A12 PMB 1011, Aurora, CO 80013, United States"
        : input.addressText?.trim() || null,
    domain,
  };
}

export function privacyPolicyContent(company: Company): LegalContent {
  const { brand, legalName, email, phone, address, domain } = company;
  const operatorFr = legalName ? `${legalName}, qui exploite la marque ${brand}` : brand;
  const operatorEn = legalName ? `${legalName}, operating under the brand ${brand}` : brand;
  const site = domain ? `https://${domain}` : "notre site";
  const siteEn = domain ? `https://${domain}` : "our website";
  const contactFr = [
    email ? `par e-mail : ${email}` : null,
    phone ? `par téléphone : ${phone}` : null,
    address ? `par courrier : ${legalName ?? brand}, ${address}` : null,
    "ou par le formulaire de contact du site",
  ].filter(Boolean) as string[];
  const contactEn = [
    email ? `by e-mail: ${email}` : null,
    phone ? `by phone: ${phone}` : null,
    address ? `by mail: ${legalName ?? brand}, ${address}` : null,
    "or through the contact form on the website",
  ].filter(Boolean) as string[];
  const writeFr = email ? `écrivez-nous à ${email}` : "écrivez-nous via le formulaire de contact du site";
  const writeEn = email ? `write to us at ${email}` : "write to us through the website contact form";

  return {
    title_fr: "Politique de confidentialité",
    title_en: "Privacy Policy",
    updated_fr: UPDATED_FR,
    updated_en: UPDATED_EN,
    intro_fr: `Cette politique explique quelles données personnelles ${brand} collecte, pourquoi, comment elles sont protégées et quels sont vos droits. Elle s'applique au site ${site}, à notre chat en ligne, à nos pages Facebook et Instagram, à nos échanges par e-mail et à notre boutique en ligne.`,
    intro_en: `This policy explains what personal data ${brand} collects, why, how it is protected and what your rights are. It applies to ${siteEn}, our online chat, our Facebook and Instagram pages, our e-mail exchanges and our online shop.`,
    blocks: [
      {
        id: "responsable",
        title_fr: "1. Qui sommes-nous ?",
        title_en: "1. Who we are",
        paragraphs_fr: [
          `Le responsable du traitement de vos données est ${operatorFr}.`,
          "Vous pouvez nous contacter pour toute question sur vos données :",
        ],
        paragraphs_en: [
          `The controller of your personal data is ${operatorEn}.`,
          "You can contact us about your data:",
        ],
        items_fr: contactFr,
        items_en: contactEn,
      },
      {
        id: "donnees",
        title_fr: "2. Les données que nous collectons",
        title_en: "2. The data we collect",
        paragraphs_fr: [
          "Nous collectons uniquement les données nécessaires pour vous répondre et vous servir :",
        ],
        paragraphs_en: ["We only collect the data we need to answer and serve you:"],
        items_fr: [
          "Formulaire de contact : nom, e-mail, téléphone et contenu de votre message.",
          "Chat du site : prénom ou nom si vous le donnez, vos messages et nos réponses.",
          "Messages Facebook Messenger et Instagram : votre nom public et votre identifiant sur ces plateformes, vos messages, les pièces jointes que vous envoyez, et nos réponses.",
          "Commentaires sur nos publications Facebook et Instagram : votre nom public, votre commentaire et nos réponses.",
          "E-mails que vous nous envoyez : adresse e-mail, nom, contenu et pièces jointes.",
          "Compte client (facultatif) : nom, e-mail et/ou téléphone, préférences de communication et historique de vos commandes.",
          "Demandes de commande sur la boutique : nom, téléphone, e-mail, adresse de livraison, produits demandés et remarques.",
          "Candidatures : informations et documents que vous fournissez (CV, lettre, coordonnées).",
          "Données techniques : adresse IP, type de navigateur et journaux de sécurité, utilisés pour faire fonctionner et protéger le site.",
        ],
        items_en: [
          "Contact form: name, e-mail, phone number and the content of your message.",
          "Website chat: your name if you provide it, your messages and our replies.",
          "Facebook Messenger and Instagram messages: your public name and platform-scoped ID, your messages, attachments you send, and our replies.",
          "Comments on our Facebook and Instagram posts: your public name, your comment and our replies.",
          "E-mails you send us: e-mail address, name, content and attachments.",
          "Customer account (optional): name, e-mail and/or phone, communication preferences and order history.",
          "Shop order requests: name, phone, e-mail, delivery address, requested products and notes.",
          "Job applications: information and documents you provide (CV, cover letter, contact details).",
          "Technical data: IP address, browser type and security logs, used to run and protect the website.",
        ],
      },
      {
        id: "finalites",
        title_fr: "3. Pourquoi nous utilisons vos données",
        title_en: "3. Why we use your data",
        paragraphs_fr: ["Vos données servent uniquement à :"],
        paragraphs_en: ["Your data is only used to:"],
        items_fr: [
          "répondre à vos questions et messages (site, chat, Messenger, Instagram, e-mail) ;",
          "traiter vos demandes de commande, les préparer et organiser la livraison ou le retrait ;",
          "gérer votre compte client si vous en créez un ;",
          "étudier les candidatures ;",
          "vous envoyer des informations ou offres, uniquement si vous l'avez accepté (vous pouvez vous désinscrire à tout moment) ;",
          "assurer la sécurité du site et prévenir les abus ;",
          "respecter nos obligations légales et comptables.",
        ],
        items_en: [
          "answer your questions and messages (website, chat, Messenger, Instagram, e-mail);",
          "process order requests, prepare them and arrange delivery or pickup;",
          "manage your customer account if you create one;",
          "review job applications;",
          "send you news or offers, only if you agreed (you can unsubscribe at any time);",
          "keep the website secure and prevent abuse;",
          "comply with our legal and accounting obligations.",
        ],
      },
      {
        id: "assistant",
        title_fr: "4. Assistant automatique (intelligence artificielle)",
        title_en: "4. Automated assistant (artificial intelligence)",
        paragraphs_fr: [
          "Pour vous répondre rapidement, certains messages reçus sur le chat du site, Messenger ou Instagram peuvent recevoir une première réponse générée par un assistant d'intelligence artificielle, à partir des informations publiques de notre entreprise. Le contenu de votre message est alors transmis à notre fournisseur de service d'IA uniquement pour produire cette réponse.",
          "Un membre de notre équipe peut reprendre la conversation à tout moment, et vous pouvez demander à parler à une personne. L'assistant ne prend aucune décision ayant un effet juridique ou important vous concernant.",
        ],
        paragraphs_en: [
          "To answer quickly, some messages received through the website chat, Messenger or Instagram may receive a first reply generated by an artificial intelligence assistant, based on our company's public information. The content of your message is sent to our AI service provider only to produce that reply.",
          "A member of our team can take over the conversation at any time, and you can ask to speak with a person. The assistant makes no decision with legal or similarly significant effects on you.",
        ],
      },
      {
        id: "meta",
        title_fr: "5. Données provenant de Facebook et Instagram",
        title_en: "5. Data from Facebook and Instagram",
        paragraphs_fr: [
          `Lorsque vous écrivez à notre Page Facebook ou à notre compte Instagram, ou que vous commentez nos publications, nous recevons ces informations par les outils officiels de Meta (Meta Platforms, Inc.). Nous ne recevons que ce que vous nous envoyez : nous n'avons pas accès à votre mot de passe, à vos contacts ni à vos autres conversations.`,
          "Ces données servent uniquement à vous répondre et à suivre votre demande. Nous ne les vendons pas, ne les utilisons pas pour de la publicité ciblée et ne les partageons pas avec d'autres annonceurs.",
          "Votre utilisation de Facebook et d'Instagram reste aussi soumise à la politique de confidentialité de Meta.",
        ],
        paragraphs_en: [
          "When you message our Facebook Page or Instagram account, or comment on our posts, we receive this information through Meta's official tools (Meta Platforms, Inc.). We only receive what you send us: we have no access to your password, your contacts or your other conversations.",
          "This data is only used to answer you and follow up on your request. We do not sell it, use it for targeted advertising, or share it with other advertisers.",
          "Your use of Facebook and Instagram is also governed by Meta's own privacy policy.",
        ],
      },
      {
        id: "partage",
        title_fr: "6. Avec qui vos données sont partagées",
        title_en: "6. Who we share your data with",
        paragraphs_fr: [
          "Vos données ne sont jamais vendues. Elles sont accessibles uniquement aux membres de notre équipe qui en ont besoin (par exemple le service client), et à des prestataires techniques qui travaillent pour nous et sont tenus de les protéger :",
        ],
        paragraphs_en: [
          "We never sell your data. It is only accessible to team members who need it (for example customer service), and to technical providers working on our behalf who must protect it:",
        ],
        items_fr: [
          "hébergement du site et des bases de données, réseau de diffusion et sécurité ;",
          "messagerie électronique et envoi de SMS ou d'e-mails de vérification ;",
          "stockage des images et fichiers ;",
          "fournisseur d'intelligence artificielle pour les réponses automatiques ;",
          "Meta (Facebook, Instagram) pour les échanges sur ces plateformes ;",
          "transporteurs ou partenaires de livraison, seulement pour livrer une commande ;",
          "autorités publiques, uniquement lorsque la loi l'exige.",
        ],
        items_en: [
          "website and database hosting, content delivery network and security;",
          "e-mail services and delivery of verification codes by SMS or e-mail;",
          "image and file storage;",
          "an artificial intelligence provider for automated replies;",
          "Meta (Facebook, Instagram) for conversations on those platforms;",
          "delivery partners, only to deliver an order;",
          "public authorities, only where required by law.",
        ],
      },
      {
        id: "transferts",
        title_fr: "7. Transferts internationaux",
        title_en: "7. International transfers",
        paragraphs_fr: [
          "Certains de nos prestataires sont situés hors de votre pays, notamment aux États-Unis. Dans ce cas, nous choisissons des prestataires reconnus qui appliquent des mesures de protection adaptées (chiffrement, contrats de protection des données).",
        ],
        paragraphs_en: [
          "Some of our providers are located outside your country, notably in the United States. In that case we use recognised providers that apply appropriate safeguards (encryption, data protection agreements).",
        ],
      },
      {
        id: "conservation",
        title_fr: "8. Durée de conservation",
        title_en: "8. How long we keep data",
        paragraphs_fr: [
          "Nous gardons vos données seulement le temps nécessaire : les conversations et messages pendant la durée utile au suivi de votre demande et du service client ; les données de commande et de facturation pendant la durée imposée par les obligations comptables et fiscales ; les candidatures pendant la durée du recrutement et, avec votre accord, un peu plus longtemps pour d'autres postes ; le compte client jusqu'à ce que vous le supprimiez. Ensuite, les données sont supprimées ou rendues anonymes.",
        ],
        paragraphs_en: [
          "We keep your data only as long as needed: conversations and messages for as long as useful to follow up on your request and for customer service; order and billing data for the period required by accounting and tax rules; job applications for the duration of recruitment and, with your consent, a little longer for other positions; your customer account until you delete it. After that, data is deleted or anonymised.",
        ],
      },
      {
        id: "cookies",
        title_fr: "9. Cookies et stockage dans le navigateur",
        title_en: "9. Cookies and browser storage",
        paragraphs_fr: [
          "Le site utilise uniquement des cookies et un stockage local nécessaires à son fonctionnement : garder votre session de compte client, retenir votre panier, la langue choisie et la conversation de chat en cours. Nous n'utilisons pas de cookies publicitaires.",
        ],
        paragraphs_en: [
          "The website only uses cookies and local storage needed for it to work: keeping your customer account session, remembering your cart, your chosen language and the current chat conversation. We do not use advertising cookies.",
        ],
      },
      {
        id: "securite",
        title_fr: "10. Sécurité",
        title_en: "10. Security",
        paragraphs_fr: [
          "Les échanges avec le site sont chiffrés (HTTPS). L'accès aux données est limité aux personnes autorisées, protégé par mot de passe, et les informations sensibles de connexion aux services tiers sont chiffrées. Aucun système n'est parfaitement sûr, mais nous corrigeons rapidement tout problème identifié.",
        ],
        paragraphs_en: [
          "Traffic to the website is encrypted (HTTPS). Access to data is limited to authorised people and protected by passwords, and sensitive credentials for third-party services are encrypted. No system is perfectly secure, but we promptly fix any issue we identify.",
        ],
      },
      {
        id: "droits",
        title_fr: "11. Vos droits",
        title_en: "11. Your rights",
        paragraphs_fr: [
          `Vous pouvez à tout moment demander à accéder à vos données, à les corriger, à les supprimer, à en limiter l'utilisation, à vous opposer à leur utilisation ou à les recevoir dans un format courant. Vous pouvez aussi retirer votre accord pour les communications commerciales. Pour cela, ${writeFr}. Nous répondons dans un délai maximum de 30 jours.`,
          "Si vous estimez que vos droits ne sont pas respectés, vous pouvez aussi contacter l'autorité de protection des données de votre pays.",
        ],
        paragraphs_en: [
          `You may at any time ask to access, correct or delete your data, restrict or object to its use, or receive it in a common format. You can also withdraw your consent to marketing messages. To do so, ${writeEn}. We answer within 30 days at most.`,
          "If you believe your rights are not respected, you may also contact the data protection authority in your country.",
        ],
      },
      {
        id: "suppression",
        title_fr: "12. Supprimer vos données (y compris Facebook et Instagram)",
        title_en: "12. Deleting your data (including Facebook and Instagram)",
        paragraphs_fr: [
          "Pour demander la suppression de toutes les données que nous détenons sur vous, y compris les messages et commentaires reçus via Facebook ou Instagram :",
        ],
        paragraphs_en: [
          "To ask us to delete all the data we hold about you, including messages and comments received through Facebook or Instagram:",
        ],
        items_fr: [
          email
            ? `envoyez un e-mail à ${email} avec pour objet « Suppression de mes données » ;`
            : "envoyez-nous un message via le formulaire de contact avec pour objet « Suppression de mes données » ;",
          "indiquez votre nom et le moyen par lequel vous nous avez contactés (site, Messenger, Instagram, e-mail, téléphone), avec votre nom de profil Facebook ou Instagram si besoin ;",
          "vous pouvez aussi nous l'écrire directement en message privé sur notre Page Facebook ou notre compte Instagram ;",
          "nous confirmons la suppression dans un délai maximum de 30 jours, sauf pour les données que la loi nous oblige à conserver (par exemple les factures).",
        ],
        items_en: [
          email
            ? `send an e-mail to ${email} with the subject "Delete my data";`
            : 'send us a message through the contact form with the subject "Delete my data";',
          "include your name and how you contacted us (website, Messenger, Instagram, e-mail, phone), with your Facebook or Instagram profile name if relevant;",
          "you can also ask us directly by private message on our Facebook Page or Instagram account;",
          "we confirm the deletion within 30 days at most, except for data we must keep by law (for example invoices).",
        ],
      },
      {
        id: "mineurs",
        title_fr: "13. Mineurs",
        title_en: "13. Children",
        paragraphs_fr: [
          "Nos services ne s'adressent pas aux enfants de moins de 13 ans et nous ne collectons pas sciemment leurs données. Si vous pensez qu'un enfant nous a transmis des données, contactez-nous pour que nous les supprimions.",
        ],
        paragraphs_en: [
          "Our services are not intended for children under 13 and we do not knowingly collect their data. If you believe a child has sent us data, contact us so we can delete it.",
        ],
      },
      {
        id: "modifications",
        title_fr: "14. Modifications de cette politique",
        title_en: "14. Changes to this policy",
        paragraphs_fr: [
          "Nous pouvons mettre à jour cette politique. La date de dernière mise à jour figure en haut de la page. En cas de changement important, nous l'indiquerons clairement sur le site.",
        ],
        paragraphs_en: [
          "We may update this policy. The date of the last update appears at the top of the page. If there is a significant change, we will clearly say so on the website.",
        ],
      },
    ],
  };
}
