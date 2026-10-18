/**
 * Deterministic guard for the customer assistant (website, Messenger,
 * Instagram).  Checked BEFORE the AI: free, instant, and independent of the
 * AI service.  Words are chosen so a real Congo Omega customer (products,
 * prices, orders, delivery, payment incl. mobile money, poultry / pig / farm
 * questions, jobs, appointments, weddings or parties ordering chickens…) is
 * not caught: ambiguous words ("histoire", "maladie", "président", "Dieu",
 * "mariage", "banque", "Vodacom", "code promo", "chat"…) are left to the AI,
 * which refuses off-topic requests too.
 *
 *  - off_topic → fixed polite refusal; OFF_TOPIC_LIMIT in a row → blocked.
 *  - link      → fixed "we don't open links" reply; counts like off_topic.
 *  - abusive   → blocked at once (sexual content, insults, threats, money
 *                begging, attempts to take control of the assistant).
 *  - ignore    → no reply at all (emoji / sticker / punctuation only).
 *
 * Every pattern is tested on several spellings of the message (accents
 * removed, l33t digits and symbols undone, "p o e m e" / "p.o.e.m.e" joined,
 * "pooooeme" squeezed) so voluntary misspellings do not get through.
 * Languages: French, English, some Lingala and Swahili.
 */

export type GuardKind = "abusive" | "off_topic" | "link" | "ignore";
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

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "€": "e", "!": "i", "|": "i" };

/** The spellings a pattern is tested against. */
function spellings(text: string): string[] {
  const base = normalizeForGuard(text);
  const unleet = base
    .replace(/[013457@$€!|]/g, (char, index: number, all: string) =>
      // Only inside words: "50$" or "1 sac" stay as they are.
      /[a-z]/.test(all[index - 1] ?? "") || /[a-z]/.test(all[index + 1] ?? "") ? LEET[char] ?? char : char,
    )
    // "p.o.e.m.e", "s*e*x*e", "p-o-e-m-e"
    .replace(/([a-z])[.*+~^#•·,;:/\\]+(?=[a-z])/g, "$1")
    // "p o e m e"
    .replace(/\b(?:[a-z] ){2,}[a-z]\b/g, (run) => run.replace(/ /g, ""));
  const squeezed = unleet.replace(/([a-z])\1{2,}/g, "$1");
  return [...new Set([base, unleet, squeezed])];
}

const w = (words: string) => new RegExp(`\\b(?:${words})\\b`);

/* ------------------------------------------------------------------ */
/* Off-topic: polite refusal                                           */
/* ------------------------------------------------------------------ */

export const OFF_TOPIC_CATEGORIES: GuardCategory[] = [
  {
    label: "Poèmes, chansons, histoires, blagues",
    patterns: [
      w(
        "poemes?|poesies?|poetiques?|poete|vers rimes?|rimes?|chansons?|refrains?|couplets?|slams?|raps?|paroles de (?:la )?chanson|dedicaces? musicales?|" +
          "contes?|fables?|legendes?|romans?|nouvelle litteraire|recits?|theatres?|pieces? de theatre|sketch(?:s|es)?|scenarios?|" +
          "dialogue entre|monologues?|discours pour|eloges?|citations?|proverbes?|dictons?|devinettes?|charades?|blagues?|histoires? droles?|fais moi rire|" +
          "recitations?|reciter|recite|jeux de mots|calembours?|" +
          "poems?|songs?|lyrics|stor(?:y|ies) about|tell me a story|jokes?|riddles?|fairy tales?|make me laugh|" +
          "shairi|wimbo|nyimbo|hadithi|mzaha|utani|nzembo|lisapo|masapo",
      ),
      /\b(?:raconte|racontez|invente|inventez)(?: moi| nous)? (?:une?|des|la|le|un petit|une petite)\b/,
      /\b(?:ecris|ecrivez|ecri|ecrit|redige|redigez|fais|faites)(?: moi| nous)? (?:une?|des|la|le|mon|ma) (?:poeme|chanson|histoire|texte sur|lettre d amour|discours|conte|piece de theatre|blague|dissertation|redaction|slam|rap)/,
    ],
  },
  {
    label: "Devoirs, études et langues",
    patterns: [
      w(
        "dissertations?|redactions?|exposes?|devoirs? (?:de|d|a la maison)|mes devoirs|fais mon devoir|exercices? de (?:math|maths|mathematiques|francais|anglais|physique|chimie|grammaire)|" +
          "dictees?|conjugaisons?|grammaire|orthographe de|equations?|theoremes?|pythagore|thales|derivees?|integrales?|" +
          "(?:fais|faites|redige|redigez|ecris|ecrivez|corrige|corrigez|prepare|preparez)(?: moi)? (?:mon|ma|le|la) (?:tfc|memoire|these|soutenance|travail de fin de cycle)|questionnaire de recherche|interrogations? de|examen d etat|exetat|" +
          "resume du livre|resume de livre|fiche de lecture|apprends moi (?:l |le |a parler )?(?:anglais|espagnol|francais|chinois|allemand|lingala|swahili|portugais|arabe)|" +
          "cours d (?:anglais|espagnol|allemand|chinois)|traduis (?:cette|ma|mon|la|le|ce) (?:chanson|devoir|texte|lettre|poeme)|" +
          "homework|essay|assignment|kazi ya nyumbani",
      ),
    ],
  },
  {
    label: "Culture générale et questions encyclopédiques",
    patterns: [
      w(
        "capitale (?:de|du|d|des)|qui a invente|qui a decouvert|qui a ecrit|qui est le president|combien d habitants|plus grand pays|plus haute montagne|" +
          "date de naissance de|histoire du congo|histoire de france|histoire de l afrique|seconde guerre mondiale|premiere guerre mondiale|" +
          "celebrites?|stars? de",
      ),
    ],
  },
  {
    label: "Politique, guerre et actualité",
    patterns: [
      w(
        "politiques?|elections?|electoral|candidat a la presidentielle|presidentielle|ministres?|deputes?|senateurs?|partis? politiques?|opposition|propagande|" +
          "tshisekedi|kabila|katumbi|fayulu|mukwege|kagame|museveni|lumumba|mobutu|" +
          "guerres?|massacres?|genocides?|m23|rebelles?|rebellion|milices?|adf|codeco|attentats?|terroris\\w*|coup d etat|" +
          "actualites?|infos? du jour|journal televise|siasa|vita|uchaguzi|politics|election",
      ),
    ],
  },
  {
    label: "Religion et occultisme",
    patterns: [
      w(
        "religions?|bibles?|versets?|coran|sourates?|predications?|preche|sermons?|prophetes?|prophetie|priere pour moi|prie pour moi|" +
          "dini|" +
          "sorcellerie|sorciers?|feticheurs?|feticheuse|marabouts?|sortileges?|envoutements?|rituels?|magie noire|gris gris|" +
          "horoscopes?|astrologie|signe astrologique|zodiaques?|tarot|voyance|predi(?:s|re|ction)s? (?:mon|l) avenir|lis mon avenir",
      ),
    ],
  },
  {
    label: "Santé humaine, beauté et bien-être",
    patterns: [
      w(
        "ebola|covid|coronavirus|cholera|mpox|variole|vih|sida|hiv|cancer|diabete|hypertension|regles douloureuses|" +
          "medicaments? pour moi|docteur pour moi|j ai mal (?:a la|au|aux)|" +
          "perdre du poids|maigrir|regime minceur|programme minceur|musculation|fitness|seances? de sport|abdos|prendre du muscle|" +
          "maquillage|maquiller|coiffure|coupe de cheveux|tresses?|perruques?|parfums?|cosmetiques?|soins? de la peau|acne",
      ),
    ],
  },
  {
    label: "Vie quotidienne, maison et achats personnels",
    patterns: [
      w(
        "recettes? (?:de|d|du|pour) (?:gateau|cuisine|pain|crepes?|beignets?|sauce|pizza|cocktail|jus|biscuits?)|donne (?:moi )?une recette|que cuisiner|quoi cuisiner|comment cuisiner|" +
          "decorer ma (?:chambre|maison|salle)|decoration de ma|robinet|plomberie chez moi|monter un meuble|" +
          "mon (?:frigo|refrigerateur|congelateur|televiseur|tv|micro onde|four) ne|machine a laver|climatiseur ne|" +
          "ma voiture (?:ne|a)|ma moto ne|garagiste|" +
          "reparer mon (?:telephone|ordinateur|pc|portable)|mon telephone ne|ecran casse|installer (?:un|le|ce) logiciel|" +
          "quel telephone acheter|meilleur telephone|compare (?:ces |les )?(?:telephones|chaussures|televiseurs)|iphone ou samsung|" +
          "vends? mon (?:telephone|canape|lit|ordinateur)|trouve(?:r)? un acheteur|" +
          "cherche une (?:chambre|maison|parcelle) a louer|louer ma maison|appartement a louer|" +
          "comment aller (?:chez|a la maison)|itineraire pour aller chez|" +
          "sejour touristique|billet d avion|reserver (?:un|une) (?:restaurant|table|taxi|hotel|vol|billet)|visa pour (?:la|le|l|les)|" +
          "amazon|shein|aliexpress|temu|alibaba|ebay|" +
          "forfait internet|abonnement netflix|netflix|canal plus|dstv|startimes|" +
          "reveille moi|surveille le prix",
      ),
    ],
  },
  {
    label: "Couple, famille et vie privée",
    patterns: [
      w(
        "je t aime|tu es (?:belle|beau|jolie|mignonne|sexy|charmante)|veux tu (?:sortir|m epouser)|epouse moi|ma cherie|mon cheri|bebe d amour|" +
          "petite amie|petit ami|tu es celibataire|es tu celibataire|rencontre amoureuse|trouve moi (?:une|un) (?:femme|homme|copine|copain|partenaire)|" +
          "ton whatsapp|ton numero personnel|ton snap|ton insta|" +
          "conseils? (?:amoureux|en amour)|mon ex|recuperer mon ex|me trompe|mon mari me|ma femme me|rupture amoureuse|" +
          "punir mon enfant|eduquer mon enfant|mon bebe pleure|" +
          "souhaits? d anniversaire|message d anniversaire|joyeux anniversaire a|condoleances|lettre d excuses|" +
          "je m ennuie|je m ennuis|tiens moi compagnie|" +
          "nalingi yo|makango",
      ),
    ],
  },
  {
    label: "Commérages, surveillance et personnes privées",
    patterns: [
      w(
        "rumeurs?|commerages?|potins?|note (?:cette|ce) (?:fille|garcon|femme|homme)|qui est (?:le|la) plus (?:beau|belle)|" +
          "trouve(?:r)? (?:la localisation|la position) de|localiser (?:un|une|mon|ma) (?:numero|telephone|personne)|" +
          "espionner|espionne|lire les messages de|pirater (?:le|son|sa|un) (?:whatsapp|facebook|compte|telephone)|traquer",
      ),
    ],
  },
  {
    label: "Sport, jeux et divertissement",
    patterns: [
      w(
        "football|foot|regarder (?:un|des) films?|meilleurs? films?|films? (?:a voir|d action|d horreur|romantiques?)|series? netflix|match(?:es)? de|score du match|resultat du match|ligue des champions|champions league|coupe du monde|can 20\\d\\d|leopards|real madrid|barcelone|barca|psg|messi|ronaldo|mpira|" +
          "series? tele|novelas?|telenovelas?|mangas?|animes?|jeux? video|playstation|ps5|free fire|fortnite|pubg|efootball|fifa|" +
          "codes? de triche|cheat codes?|astuces? (?:pour|du) jeu|" +
          "loterie|loto|paris sportifs?|pari sur|ticket gagnant|pronostics?|betpawa|1xbet|premier bet|sportybet|casino|" +
          "action ou verite|devine mon age|devine qui|joue avec moi|jouons|on joue|quiz|" +
          "quel animal suis je|test de personnalite|devine mon caractere|signification (?:des |de mon |du |d un )?reves?|j ai reve|rever d un|" +
          "prenom pour (?:mon|ma) (?:bebe|fille|fils)|pseudo pour|nom pour mon (?:compte|personnage)|" +
          "collection de cartes|cartes pokemon|arbre genealogique|mes ancetres|genealogie",
      ),
    ],
  },
  {
    label: "Réseaux sociaux, contenu et piratage",
    patterns: [
      w(
        "gagner des (?:abonnes|followers|likes|vues)|acheter des (?:abonnes|followers|likes|vues|avis)|faux avis|faux commentaires|hashtags?|" +
          "monter (?:ma|une) video|montage video|fais (?:moi )?(?:une|un) (?:image|logo|affiche|montage|publicite) pour (?:mon|ma)|" +
          "film pirate|telecharger (?:un|le|des) films?|logiciel crack|crack de|compte netflix partage|" +
          "python|javascript|java|html|css|sql|php|c\\+\\+|algorithmes?|programme informatique|code source|ecris (?:moi )?(?:un|du) code|hacker|pirater|hack",
      ),
    ],
  },
  {
    label: "Argent personnel et investissements",
    patterns: [
      w("trading|forex|actions en bourse|comment devenir riche|devenir millionnaire|paie mon loyer|payer mon loyer"),
    ],
  },
  {
    label: "Questions sur l'assistant et demandes impossibles",
    patterns: [
      w(
        "es tu (?:un robot|une ia|chatgpt|humain|reel)|tu es (?:un robot|une ia|chatgpt)|t es (?:un robot|une ia)|chatgpt|gemini|copilot|meilleur que (?:toi|chatgpt)|" +
          "tu dors (?:ou|bien)|tu manges quoi|quel age as tu|t as quel age|tu as quel age|tu habites ou|tu viens d ou|tu es marie|t es marie|" +
          "defends toi|justifie toi|" +
          "teleporte|fais apparaitre|change mon passe|remonter le temps|rends moi riche|" +
          "joue (?:un role|le role)|fais semblant|role play|roleplay|incarne|sois ma (?:copine|femme|cherie)|sois mon (?:copain|mari)|" +
          "compte jusqu|repete (?:le mot |ce mot |ca |cela )?\\d+ fois|\\d+ fois le mot|ecris \\d{3,} (?:fois|mots)|liste infinie",
      ),
    ],
  },
  {
    label: "Spam et publicité",
    patterns: [w("transferez a \\d+|partagez a \\d+|envoie (?:ce message )?a \\d+ (?:personnes|contacts)|offre speciale pour vous|promo exceptionnelle|cliquez ici|gagnez \\d+|vous avez gagne|felicitations vous avez")],
  },
];

/* ------------------------------------------------------------------ */
/* Abusive: blocked at once                                            */
/* ------------------------------------------------------------------ */

export const ABUSIVE_CATEGORIES: GuardCategory[] = [
  {
    label: "Contenu sexuel",
    patterns: [
      w(
        "sexy|relations? sexuelles?|sexe avec|faire du sexe|videos? (?:de )?sexe|photos? de sexe|parler de sexe|plan sexe|porno?\\w*|xxx|nudes?|toute nue|tout nu|seins|fesses|bite|zizi|chatte|baiser avec|coucher avec|faire l amour|masturb\\w*|" +
          "erotique|erotisme|sucer|branler|nudite|onlyfans|histoire erotique|photos? (?:hot|nue|nues|osee)|" +
          "sex|naked|boobs|dick|pussy|ngono|uchi|ndumba",
      ),
    ],
  },
  {
    label: "Insultes et menaces",
    patterns: [w("salope|pute|connard|connasse|encule|fdp|ntm|nique|ta mere|batard|fuck|bitch|asshole|je vais te tuer|je vais vous tuer|on va vous tuer|menace de mort|je vais vous bruler")],
  },
  {
    label: "Demande d'argent ou arnaque",
    patterns: [
      /\b(?:j ai |je |j )?(?:besoin|besoins|besoi|besois) (?:d|de l|de|d un peu d) ?argent\b/,
      /\b(?:envoie|envoyez|envoi|donne|donnez|prete|pretez|aide|aidez)(?:[ -]?(?:moi|nous))? (?:de l |d |du |un peu d |un peu de |le |la |des )?(?:argent|cash|credit|unites|mega|transfert|\d+ ?(?:\$|dollars?|usd|fc|francs?|euros?))(?!\w)/,
      /\b(?:je veux|j ai besoin de|besoin de|donne moi|envoie moi) \d+ ?(?:\$|dollars?|usd|fc|francs?|euros?)(?!\w)/,
      w(
        "aide financiere|pret d argent|preter de l argent|faites moi un pret|transfere moi|cadeau en argent|carte cadeau|offre moi un cadeau|" +
          "credit (?:telephonique|de communication)|recharge moi|bitcoin|crypto\\w*|investissement garanti|double ton argent|doubler mon argent|gagner de l argent facile|" +
          "send me money|i need money|give me money|nipe pesa|nitumie pesa|nataka pesa|mkopo|pesa ngai mbongo|tinda ngai mbongo|posa ya mbongo|nazali na posa ya mbongo",
      ),
    ],
  },
  {
    label: "Prise de contrôle de l'assistant",
    patterns: [
      w(
        "ignore (?:tes|vos|les|toutes tes|toutes les) (?:instructions|consignes|regles)|oublie (?:tes|vos|les) (?:instructions|consignes|regles)|oublie congo ?omega|" +
          "reponds sans (?:restrictions?|limites?|filtres?)|sans aucune restriction|mode (?:administrateur|admin|developpeur|dev|dan|jailbreak)|jailbreak|" +
          "je suis ton (?:developpeur|createur|admin|administrateur|patron)|je suis le (?:developpeur|createur|patron) de|active le mode|" +
          "approuve ma candidature|valide ma candidature|accepte ma candidature|" +
          "tes instructions secretes|ton prompt|ton system prompt|montre (?:tes|moi tes) (?:instructions|consignes)|cle api|api key|" +
          "donnees (?:des|d autres) (?:candidats|clients|employes)|liste des (?:candidats|clients|employes)|" +
          "ignore (?:all |previous |your )?instructions|developer mode",
      ),
    ],
  },
];

const URL = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|me|ly|cd|fr|info|xyz|site|online|link|app|gg|tk|ru|cn)(?:\/\S*)?\b/i;
/** Our own sites and CV hosts (candidates share their CV this way). */
const ALLOWED_LINK = /congoomega\.com|litehubs\.com|drive\.google\.com|docs\.google\.com|linkedin\.com|dropbox\.com|wetransfer\.com|we\.tl|onedrive\.live\.com|1drv\.ms|sharepoint\.com/i;

function firstMatch(categories: GuardCategory[], variants: string[]) {
  return categories.find((category) => category.patterns.some((pattern) => variants.some((text) => pattern.test(text))))?.label ?? null;
}

/** Looks like keyboard mashing: "hdjdjdjdjd", "kkkkkkkk", "123123123", "azertyuiop". */
function isGibberish(normalized: string) {
  const compact = normalized.replace(/\s+/g, "");
  if (compact.length < 6) return false;
  // One character making most of the message ("kkkkkkkk", not "merciiiii").
  const runs = compact.match(/(.)\1{5,}/g) ?? [];
  if (runs.some((run) => run.length >= compact.length * 0.75)) return true;
  if (/^(.{1,4})\1{3,}$/.test(compact)) return true; // short pattern repeated
  const words = normalized.split(" ").filter(Boolean);
  // Long "words" without vowels, or a single 25+ letter blob.
  if (words.some((word) => word.length >= 25 && !/^https?/.test(word))) return true;
  const consonantBlobs = words.filter((word) => word.length >= 6 && !/[aeiouy]/.test(word));
  return consonantBlobs.length > 0 && consonantBlobs.length >= words.length / 2;
}

/** Message made only of emojis, stickers, punctuation or spaces. */
function isEmojiOnly(text: string) {
  return text.trim().length > 0 && !/[\p{L}\p{N}]/u.test(text);
}

/** Returns what to do with one visitor message, or null to let the AI answer. */
export function checkGuard(text: string): { kind: GuardKind; label: string } | null {
  if (isEmojiOnly(text)) return { kind: "ignore", label: "Emojis ou stickers seuls" };
  // E-mail addresses ("jean.kabila@gmail.com") are not words to judge.
  const withoutEmails = text.replace(/\S+@\S+\.\S+/g, " ");
  const variants = spellings(withoutEmails);
  if (!variants[0]) return null;
  const abusive = firstMatch(ABUSIVE_CATEGORIES, variants);
  if (abusive) return { kind: "abusive", label: abusive };
  const links = withoutEmails.match(new RegExp(URL.source, "gi")) ?? [];
  if (links.some((link) => !ALLOWED_LINK.test(link))) return { kind: "link", label: "Lien envoyé" };
  if (withoutEmails.length > 1500) return { kind: "off_topic", label: "Message trop long" };
  if (isGibberish(variants[0])) return { kind: "off_topic", label: "Message incompréhensible" };
  const offTopic = firstMatch(OFF_TOPIC_CATEGORIES, variants);
  return offTopic ? { kind: "off_topic", label: offTopic } : null;
}
