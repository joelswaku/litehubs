/**
 * Deterministic guard for the customer assistant (website, Messenger,
 * Instagram).  Checked BEFORE the AI: free, instant, and works even if the AI
 * service fails.  Words are chosen so a real customer (products, prices,
 * orders, delivery, jobs, appointments, poultry / pig / farm questions) is not
 * caught: ambiguous words ("histoire", "maladie", "président", "Dieu",
 * "code promo"…) are left to the AI, which also refuses off-topic requests.
 *
 *  - OFF_TOPIC → fixed refusal; 3 in a row → blocked.
 *  - ABUSIVE   → blocked at once (sexual content, insults, money begging).
 */

export type GuardCategory = { label: string; patterns: RegExp[] };

/** Lowercase, no accents, apostrophes and dashes as spaces. */
export function normalizeForGuard(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`´\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const w = (words: string) => new RegExp(`\\b(?:${words})\\b`);

export const OFF_TOPIC_CATEGORIES: GuardCategory[] = [
  {
    label: "Écriture créative",
    patterns: [
      w(
        "poemes?|poesies?|poetiques?|poete|vers rimes?|rimes?|chansons?|refrains?|couplets?|slams?|raps?|paroles de (?:la )?chanson|lyrics|" +
          "contes?|fables?|legendes?|romans?|nouvelle litteraire|recits?|theatres?|pieces? de theatre|sketch(?:s|es)?|scenarios?|" +
          "dialogue entre|monologues?|discours pour|eloges?|lettres? d amour|messages? d amour|mots? d amour|declaration d amour|" +
          "citations?|proverbes?|dictons?|devinettes?|blagues?|histoires? droles?|charades?|recitations?|reciter|" +
          "poems?|songs?|stor(?:y|ies) about|jokes?|riddles?|fairy tales?",
      ),
      /\b(?:raconte|racontez|invente|inventez|compose|composez|imagine|imaginez)(?: moi| nous)? (?:une?|des|la|le)\b/,
      /\b(?:ecris|ecrivez|ecri|redige|redigez)(?: moi| nous)? (?:une?|des|la|le) (?:poeme|chanson|histoire|texte sur|lettre d amour|discours|conte|piece|blague|dissertation|redaction|resume)/,
    ],
  },
  {
    label: "Devoirs et école",
    patterns: [
      w(
        "dissertations?|redactions?|exposes?|devoirs? (?:de|d|a la maison)|exercices? de (?:math|maths|mathematiques|francais|anglais|physique|chimie)|" +
          "dictees?|conjugaisons?|grammaire|orthographe de|equations?|theoremes?|pythagore|thales|derivees?|integrales?|" +
          "memoire de fin|travail de fin de cycle|tfc|these de|interrogations? de|examen d etat|exetat|resume du livre|resume de livre|fiche de lecture|" +
          "homework|essay|assignment",
      ),
    ],
  },
  {
    label: "Politique, guerre et actualité",
    patterns: [
      w(
        "politiques?|elections?|electoral|gouvernements?|ministres?|deputes?|senateurs?|partis? politiques?|opposition|" +
          "tshisekedi|kabila|katumbi|fayulu|mukwege|kagame|museveni|lumumba|mobutu|" +
          "guerres?|massacres?|genocides?|m23|rebelles?|rebellion|milices?|adf|codeco|attentats?|terroris\\w*|coup d etat|" +
          "manifestations?|actualites?|infos? du jour|journal televise",
      ),
    ],
  },
  {
    label: "Religion",
    patterns: [w("religions?|bibles?|versets?|coran|sourates?|predications?|sermons?|pasteurs?|prophetes?|prophetie|priere pour moi|prie pour moi|evangile|islam|chretien\\w*|musulman\\w*|sorcellerie|feticheurs?|marabouts?")],
  },
  {
    label: "Santé humaine et épidémies",
    patterns: [w("ebola|covid|coronavirus|cholera|mpox|variole|vih|sida|hiv|cancer|diabete|grossesse|enceinte|regles douloureuses|medicaments? pour moi|docteur pour moi|ordonnance")],
  },
  {
    label: "Sport, loisirs et divertissement",
    patterns: [
      w(
        "football|foot|match(?:es)? de|ligue des champions|champions league|coupe du monde|can 20\\d\\d|leopards|real madrid|barcelone|barca|psg|messi|ronaldo|" +
          "films?|series? tele|netflix|novelas?|telenovelas?|mangas?|animes?|jeux? video|playstation|free fire|fortnite|" +
          "horoscopes?|astrologie|signe astrologique|zodiaques?|tarot|voyance|signification (?:des |de mon |du )?reves?|loterie|loto|paris sportifs?|pronostics?|betpawa|1xbet",
      ),
    ],
  },
  {
    label: "Programmation et informatique générale",
    patterns: [w("python|javascript|java|html|css|sql|php|c\\+\\+|algorithmes?|programme informatique|code source|hacker|pirater|hack")],
  },
  {
    label: "Vie privée, amour et conseils personnels",
    patterns: [
      w("je t aime|tu es (?:belle|beau|jolie|mignonne)|veux tu (?:sortir|m epouser)|epouse moi|ma cherie|mon cheri|bebe d amour|petite amie|petit ami|celibataire|rencontre amoureuse|conseils? (?:amoureux|en amour)|rupture amoureuse"),
    ],
  },
  {
    label: "Culture générale et questions à l'IA",
    patterns: [
      w(
        "capitale (?:de|du|d)|qui a invente|qui a ecrit|qui est le president|combien d habitants|histoire du congo|histoire de france|" +
          "es tu (?:un robot|une ia|chatgpt|humain)|tu es (?:un robot|une ia|chatgpt)|chatgpt|joue (?:un role|le role)|fais semblant|role play",
      ),
    ],
  },
];

export const ABUSIVE_CATEGORIES: GuardCategory[] = [
  {
    label: "Contenu sexuel",
    patterns: [w("sexe|sexuel\\w*|sexy|porno?\\w*|xxx|nudes?|toute nue|tout nu|seins|fesses|bite|zizi|chatte|baiser avec|coucher avec|faire l amour|masturb\\w*|erotique|sucer|branler|nudite|onlyfans")],
  },
  {
    label: "Insultes et menaces",
    patterns: [w("salope|pute|connard|connasse|encule|fdp|ntm|nique|ta mere|batard|fuck|bitch|asshole|je vais te tuer|je vais vous tuer|on va vous tuer|menace de mort")],
  },
  {
    label: "Demande d'argent ou arnaque",
    patterns: [
      /\b(?:j ai |je |j )?(?:besoin|besoins|besoi|besois) (?:d|de l|de|d un peu d) ?argent\b/,
      /\b(?:envoie|envoyez|envoi|donne|donnez|prete|pretez|aide|aidez)(?:[ -]?(?:moi|nous))? (?:de l |d |du |un peu d |un peu de |le |la |des )?(?:argent|cash|credit|unites|mega|transfert|\d+ ?(?:\$|dollars?|usd|fc|francs?|euros?))(?!\w)/,
      /\b(?:je veux|j ai besoin de|besoin de|donne moi|envoie moi) \d+ ?(?:\$|dollars?|usd|fc|francs?|euros?)(?!\w)/,
      w("aide financiere|pret d argent|preter de l argent|faites moi un pret|transfere moi|cadeau en argent|carte cadeau|bitcoin|crypto|investissement garanti|double ton argent|gagner de l argent facile"),
    ],
  },
];

function firstMatch(categories: GuardCategory[], text: string) {
  return categories.find((category) => category.patterns.some((pattern) => pattern.test(text)))?.label ?? null;
}

/** Returns the category that matched, or null. Abusive wins over off-topic. */
export function checkGuard(text: string): { kind: "abusive" | "off_topic"; label: string } | null {
  const normalized = normalizeForGuard(text);
  if (!normalized) return null;
  const abusive = firstMatch(ABUSIVE_CATEGORIES, normalized);
  if (abusive) return { kind: "abusive", label: abusive };
  const offTopic = firstMatch(OFF_TOPIC_CATEGORIES, normalized);
  return offTopic ? { kind: "off_topic", label: offTopic } : null;
}
