/**
 * Ready-to-use contract templates (French, DRC labour context).
 *
 * Each one is a complete contract the company adds to its template library in
 * one click and then adjusts.  Fields in {{…}} are filled from the contract
 * record when a version is generated; the signature block is added
 * automatically, so none of these texts contain one.
 *
 * These texts are a professional starting point, not legal advice: have them
 * reviewed by a labour-law adviser before use.
 */

export type ReadyContractTemplate = {
  key: string;
  code: string;
  name: string;
  contractType: "employment";
  summary: string;
  text: string;
};

const PARTIES = `Entre les soussignés :
**{{company.name}}**, dont le siège est situé à {{company.address}}, représentée par son représentant dûment habilité en qualité de {{contract.employerSignerRole}}, ci-après dénommée « l’Employeur », d’une part,
Et **{{employee.fullName}}**, matricule {{employee.employeeNumber}}, ci-après dénommé(e) « le Travailleur », d’autre part.
Il a été convenu et arrêté ce qui suit.`;

const DUTIES = (n: number) => `## Article ${n} — Fonctions et obligations du Travailleur
Le Travailleur s’engage à :
1. exécuter avec soin, honnêteté et professionnalisme les tâches liées à son poste ;
2. respecter les consignes de ses responsables et le règlement intérieur ;
3. préserver les biens, outils, stocks, animaux, cultures, équipements et informations de l’Employeur ;
4. respecter les horaires et les procédures de présence (pointage LiteHubs) ;
5. signaler sans délai tout incident, accident, perte, maladie animale ou risque pour la sécurité.`;

const LOCATION = (n: number) => `## Article ${n} — Lieu de travail
Le Travailleur exerce principalement ses fonctions à **{{employee.workLocation}}**. Selon les besoins de l’activité, il peut être affecté à un autre site de l’Employeur, après information préalable.`;

const HOURS = (n: number) => `## Article ${n} — Durée du travail et horaires
La durée du travail et les horaires sont ceux affectés au Travailleur dans LiteHubs, dans le respect de la durée légale du travail. Les heures supplémentaires ne sont effectuées qu’à la demande de l’Employeur et sont rémunérées conformément à la loi. Toute absence ou tout retard doit être signalé et justifié selon les procédures internes.`;

const SAFETY = (n: number) => `## Article ${n} — Santé, sécurité et biosécurité
Le Travailleur respecte toutes les règles de santé, de sécurité, d’hygiène et de biosécurité applicables à son site, et porte les équipements de protection fournis. Il est interdit de contourner une procédure de sécurité ou de mettre en danger des personnes, des animaux ou des installations.`;

const CONFIDENTIALITY = (n: number) => `## Article ${n} — Confidentialité et matériel
Le Travailleur s’engage à ne pas divulguer, pendant et après le contrat, les informations confidentielles de l’Employeur : données financières, clients, fournisseurs, procédures internes, documents et accès LiteHubs. Tout matériel, outil ou équipement confié reste la propriété de l’Employeur et doit être restitué à la fin du contrat ou sur demande.`;

const DISCIPLINE = (n: number) => `## Article ${n} — Règlement intérieur et discipline
Le Travailleur reconnaît avoir reçu un exemplaire du règlement intérieur de {{company.name}} ({{company.rulesVersion}}), en avoir pris connaissance et s’engage à le respecter. Les mises à jour du règlement, adoptées selon les formes prévues par la loi, lui sont communiquées par LiteHubs ou par affichage.
Tout manquement aux obligations du présent contrat ou au règlement intérieur peut donner lieu à une procédure disciplinaire conforme à la législation applicable et aux procédures internes de l’Employeur.`;

const DISPUTES = (n: number) => `## Article ${n} — Règlement des différends
Les parties s’efforcent de régler à l’amiable tout différend lié au présent contrat. À défaut, le différend est soumis à l’inspection du travail puis, le cas échéant, au tribunal du travail compétent.`;

const FINAL = (n: number) => `## Article ${n} — Dispositions finales
Le présent contrat est régi par le Code du travail de la République démocratique du Congo et ses mesures d’application. Toute modification fait l’objet d’un avenant écrit signé par les deux parties. Les parties déclarent avoir lu, compris et accepté l’ensemble de ses clauses. Il est établi en deux exemplaires originaux, un pour chaque partie.`;

const CDI = `${PARTIES}

## Article 1 — Engagement
L’Employeur engage le Travailleur, qui accepte, en qualité de **{{employee.jobTitle}}**, par contrat de travail **à durée indéterminée**. Le Travailleur exerce ses fonctions sous l’autorité de l’Employeur ou de tout responsable désigné par lui.

## Article 2 — Date d’effet
Le présent contrat prend effet le **{{contract.startDate}}**.

## Article 3 — Période d’essai
Le contrat ne devient définitif qu’à l’issue d’une période d’essai de **trois (3) mois**, dans la limite de la durée maximale prévue par la loi. Pendant cette période, chaque partie peut mettre fin au contrat dans les conditions prévues par la loi. À l’issue de l’essai concluant, l’engagement est confirmé sans autre formalité.

${LOCATION(4)}

${DUTIES(5)}

${HOURS(6)}

## Article 7 — Rémunération
En contrepartie de son travail, le Travailleur perçoit une rémunération mensuelle de base de **{{contract.salary}} {{contract.currency}}**. Modalités de paiement : {{contract.paymentTerms}}.
Les primes, indemnités (notamment de logement et de transport) et retenues légales suivent la réglementation applicable et les règles internes. Chaque paiement est accompagné d’un bulletin de paie.

## Article 8 — Congés
Le Travailleur bénéficie des congés payés annuels, des jours fériés légaux et des congés de circonstance prévus par la législation du travail. Les dates de congé sont fixées en accord avec l’Employeur selon les besoins du service.

${SAFETY(9)}

${CONFIDENTIALITY(10)}

${DISCIPLINE(11)}

## Article 12 — Suspension et fin du contrat
Le contrat peut être suspendu dans les cas prévus par la loi (maladie, accident, congé de maternité, etc.). Il peut prendre fin d’un commun accord, par démission ou par licenciement fondé sur un motif valable, dans le respect du préavis légal et des procédures prévues par la loi. À la fin du contrat, l’Employeur remet au Travailleur un certificat de fin de contrat (certificat de services).

${DISPUTES(13)}

${FINAL(14)}`;

const CDD = `${PARTIES}

## Article 1 — Engagement
L’Employeur engage le Travailleur, qui accepte, en qualité de **{{employee.jobTitle}}**, par contrat de travail **à durée déterminée**. Le Travailleur exerce ses fonctions sous l’autorité de l’Employeur ou de tout responsable désigné par lui.

## Article 2 — Durée du contrat
Le présent contrat prend effet le **{{contract.startDate}}** et prend fin de plein droit le **{{contract.endDate}}**, sans qu’un préavis soit nécessaire.
Il peut être renouvelé une seule fois, par avenant écrit signé avant son échéance, dans la limite de la durée maximale prévue par la loi. Si la relation de travail se poursuit au-delà du terme sans avenant, ou en dépassement des limites légales, le contrat est réputé conclu pour une durée indéterminée.

## Article 3 — Motif du recours
Le présent contrat est conclu pour faire face aux besoins de l’activité de l’Employeur pendant la période indiquée (surcroît temporaire d’activité, saison, projet ou remplacement).

## Article 4 — Période d’essai
Le contrat comporte une période d’essai d’**un (1) mois**, dans la limite prévue par la loi. Pendant cette période, chaque partie peut y mettre fin dans les conditions prévues par la loi.

${LOCATION(5)}

${DUTIES(6)}

${HOURS(7)}

## Article 8 — Rémunération
En contrepartie de son travail, le Travailleur perçoit une rémunération mensuelle de base de **{{contract.salary}} {{contract.currency}}**. Modalités de paiement : {{contract.paymentTerms}}.
Les primes, indemnités et retenues légales suivent la réglementation applicable et les règles internes. Chaque paiement est accompagné d’un bulletin de paie.

## Article 9 — Congés
Le Travailleur acquiert des droits à congés payés au prorata de la durée du contrat, conformément à la loi. Les congés non pris à l’échéance donnent lieu à l’indemnité prévue par la loi.

${SAFETY(10)}

${CONFIDENTIALITY(11)}

${DISCIPLINE(12)}

## Article 13 — Rupture anticipée
Avant son terme, le contrat ne peut être rompu que d’un commun accord, pour faute grave ou dans les autres cas prévus par la loi. À la fin du contrat, l’Employeur remet au Travailleur un certificat de fin de contrat (certificat de services).

${DISPUTES(14)}

${FINAL(15)}`;

const DAILY = `${PARTIES}

## Article 1 — Engagement
L’Employeur engage le Travailleur, qui accepte, en qualité de **{{employee.jobTitle}}**, comme **travailleur journalier** pour des travaux ponctuels (récolte, entretien, chargement, campagne de vaccination ou tout travail similaire).

## Article 2 — Durée
Le présent engagement prend effet le **{{contract.startDate}}** et prend fin le **{{contract.endDate}}**. Chaque journée travaillée est enregistrée dans LiteHubs (pointage). En cas de besoin au-delà de cette période, un nouveau contrat ou un avenant est établi ; l’emploi répété ou continu peut entraîner la requalification prévue par la loi.

${LOCATION(3)}

## Article 4 — Travaux à effectuer
Le Travailleur effectue les tâches qui lui sont confiées chaque jour par son responsable, dans le respect des consignes reçues, des horaires de la journée et des règles du site.

## Article 5 — Rémunération
Le Travailleur perçoit **{{contract.salary}} {{contract.currency}} par journée de travail effectuée**, sur la base des présences enregistrées. Modalités de paiement : {{contract.paymentTerms}}.
Aucune journée non travaillée n’est payée, sauf disposition légale contraire.

${SAFETY(6)}

## Article 7 — Matériel
Le matériel et les outils confiés restent la propriété de l’Employeur et sont restitués à la fin de chaque journée ou sur demande. Toute perte ou détérioration doit être signalée immédiatement.

${DISCIPLINE(8)}

${DISPUTES(9)}

${FINAL(10)}`;

const INTERNSHIP = `Entre les soussignés :
**{{company.name}}**, dont le siège est situé à {{company.address}}, représentée par son représentant dûment habilité en qualité de {{contract.employerSignerRole}}, ci-après dénommée « l’Entreprise d’accueil », d’une part,
Et **{{employee.fullName}}**, ci-après dénommé(e) « le Stagiaire », d’autre part.
Il a été convenu et arrêté ce qui suit.

## Article 1 — Objet du stage
L’Entreprise d’accueil accueille le Stagiaire pour un stage de formation pratique en **{{employee.jobTitle}}**. Le stage a pour but de permettre au Stagiaire de mettre en pratique ses connaissances ; il ne constitue pas un emploi.

## Article 2 — Durée
Le stage commence le **{{contract.startDate}}** et se termine le **{{contract.endDate}}**. Il peut être interrompu par l’une ou l’autre partie moyennant information écrite, ou immédiatement en cas de faute grave.

## Article 3 — Lieu et encadrement
Le stage se déroule à **{{employee.workLocation}}**. Un maître de stage désigné par l’Entreprise d’accueil encadre le Stagiaire, fixe ses activités et évalue son travail.

## Article 4 — Horaires, présence et règlement intérieur
Le Stagiaire respecte les horaires du site et les procédures de présence (pointage LiteHubs). Toute absence doit être signalée et justifiée.
Le Stagiaire reconnaît avoir reçu un exemplaire du règlement intérieur de {{company.name}} ({{company.rulesVersion}}), en avoir pris connaissance et s’engage à le respecter pendant toute la durée du stage.

## Article 5 — Gratification
Le Stagiaire perçoit une gratification de **{{contract.salary}} {{contract.currency}}** par mois de stage. Modalités : {{contract.paymentTerms}}.

${SAFETY(6).replace(/le Travailleur/g, "le Stagiaire").replace(/Le Travailleur/g, "Le Stagiaire")}

## Article 7 — Confidentialité
Le Stagiaire ne divulgue aucune information confidentielle de l’Entreprise d’accueil (données, clients, procédures, documents, accès LiteHubs), pendant et après le stage, et restitue tout matériel confié.

## Article 8 — Attestation de stage
À la fin du stage, l’Entreprise d’accueil remet au Stagiaire une attestation précisant la durée du stage et les activités réalisées.

## Article 9 — Dispositions finales
La présente convention est établie en deux exemplaires originaux. Les parties déclarent en avoir lu, compris et accepté toutes les clauses.`;

export const READY_CONTRACT_TEMPLATES: ReadyContractTemplate[] = [
  { key: "cdi", code: "cdi", name: "Contrat de travail à durée indéterminée (CDI)", contractType: "employment", summary: "Emploi permanent, période d’essai de 3 mois, salaire mensuel.", text: CDI },
  { key: "cdd", code: "cdd", name: "Contrat de travail à durée déterminée (CDD)", contractType: "employment", summary: "Emploi pour une période fixe, avec date de fin, renouvelable une fois.", text: CDD },
  { key: "journalier", code: "journalier", name: "Contrat de travailleur journalier", contractType: "employment", summary: "Travaux ponctuels payés par journée de travail pointée.", text: DAILY },
  { key: "stage", code: "stage", name: "Convention de stage", contractType: "employment", summary: "Stage de formation encadré, avec gratification et attestation.", text: INTERNSHIP },
];
