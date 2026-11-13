/**
 * Agent de prospection — sources 100 % gratuites, sans clé API.
 * - BODACC (data.gouv / DILA) : créations d'entreprises du jour
 * - API Recherche d'entreprises (annuaire-entreprises) : NAF, dirigeants, adresse
 * - OpenStreetMap Nominatim : téléphone / e-mail / site si le lieu est cartographié
 * - Brave Search + PagesJaunes via le lecteur Jina (gratuit) : contacts publics
 */

const DOH_URL = "https://cloudflare-dns.com/dns-query";
const USER_AGENT = "Agent-Prospection-Signaletique/1.0";
const BODACC_URL = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";
const SIRENE_URL = "https://recherche-entreprises.api.gouv.fr/search";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const JINA_PREFIX = "https://r.jina.ai/";
const BODACC_PAGE_SIZE = 100;

const STOP_WORDS = new Set([
  "sarl", "sas", "sasu", "eurl", "sci", "selarl", "selas", "snc", "sa", "ei",
  "societe", "ste", "les", "des", "une", "aux", "pour", "avec", "dans", "sur",
  "the", "and", "de", "du", "la", "le", "et", "en", "au", "d", "l", "by", "or", "un"
]);

const DIRECTORY_HOSTS = new Set([
  "societe.com", "www.societe.com", "pappers.fr", "www.pappers.fr",
  "infogreffe.fr", "www.infogreffe.fr", "verif.com", "www.verif.com",
  "manageo.fr", "www.manageo.fr", "score3.fr", "www.score3.fr",
  "annuaire-entreprises.data.gouv.fr", "bodacc.fr", "www.bodacc.fr",
  "entreprise.lefigaro.fr", "www.societeinfo.com", "societeinfo.com"
]);

const RELAY_HOSTS = new Set([
  "le-site-de.com", "www.le-site-de.com", "telephone.city", "www.telephone.city",
  "svaplus.fr", "www.svaplus.fr"
]);

const EMAIL_BLOCK_DOMAINS = [
  "sentry.io", "example.com", "wixpress.com", "pagesjaunes.fr", "duckduckgo.com",
  "jina.ai", "google.com", "gstatic.com", "schema.org", "societe.com", "pappers.fr",
  "facebook.com", "cloudflare.com", "w3.org", "googleapis.com", "microsoft.com",
  "bing.com", "yahoo.com", "gravatar.com", "treatwell.fr", "treatwell.com",
  "planity.com", "planity.fr", "wavy.co", "booksy.com", "cloudinary.com"
];

const NAF_LABELS = {
  "01": "Agriculture",
  "10": "Industries alimentaires",
  "41": "Construction de bâtiments",
  "42": "Génie civil",
  "43": "Travaux de construction spécialisés",
  "45": "Commerce et réparation d'automobiles",
  "46": "Commerce de gros",
  "47": "Commerce de détail",
  "49": "Transports terrestres",
  "52": "Entreposage et services auxiliaires de transport",
  "55": "Hébergement",
  "56": "Restauration",
  "62": "Programmation, conseil et autres activités informatiques",
  "63": "Services d'information",
  "64": "Activités financières",
  "68": "Activités immobilières",
  "69": "Activités juridiques et comptables",
  "70": "Activités des sièges sociaux ; conseil de gestion",
  "71": "Architecture et ingénierie",
  "73": "Publicité et études de marché",
  "74": "Autres activités spécialisées",
  "81": "Services relatifs aux bâtiments et aménagement paysager",
  "82": "Activités administratives de bureau",
  "85": "Enseignement",
  "86": "Activités pour la santé humaine",
  "90": "Arts, spectacles",
  "93": "Activités sportives, récréatives",
  "96": "Autres services personnels",
  "56.10A": "Restauration traditionnelle",
  "56.10B": "Cafétérias et autres libres-services",
  "56.10C": "Restauration de type rapide",
  "56.30Z": "Débits de boissons",
  "96.02A": "Coiffure",
  "96.02B": "Soins de beauté",
  "68.31Z": "Agences immobilières",
  "62.01Z": "Programmation informatique",
  "62.02A": "Conseil en systèmes et logiciels informatiques"
};

// Entreprises sans vitrine ni véhicule à marquer : inutile de les démarcher pour de la signalétique.
const NO_SIGNAGE_NAME = /\b(sci|scpi|sccv|scea|gfa|gaec)\b|soci[eé]t[eé] civile/i;
const NO_SIGNAGE_ACTIVITY = [
  "location de biens", "location de terrains", "location de logement", "location meubl", "lmnp",
  "acquisition, la gestion", "acquisition et la gestion", "gestion de biens immobiliers", "gestion d'un patrimoine", "gestion de patrimoine immobilier",
  "propriété, l'administration", "administration et l'exploitation par bail", "immeubles bâtis ou non bâtis",
  "marchand de biens", "holding", "prise de participation", "prises de participation", "détention de titres", "gestion de titres", "sociétés civiles",
  "livraison de repas", "livraison de plats", "livraison de commandes", "livreur", "coursier", "course urbaine", "uber eats", "ubereats", "deliveroo",
  "vtc", "voiture de transport avec chauffeur", "véhicule de transport avec chauffeur", "plateforme de mise en relation",
  "création de contenu", "créations de vidéos", "réseaux sociaux", "influence", "apporteur d'affaires", "mise en relation commerciale",
  "vente en ligne", "vente à distance", "e-commerce", "dropshipping", "trading", "crypto"
];
// NAF : location de biens (68.20), marchands de biens (68.10), holdings (64.20), sièges (70.10), coursiers (53.20), vente à distance (47.91), gestion de fonds (66.30).
const NO_SIGNAGE_NAF = ["68.20", "68.10", "64.20", "64.30", "70.10", "53.20", "47.91", "66.30"];

function needsSignage(company) {
  const name = `${company.name || ""} ${company.legalName || ""}`;
  if (NO_SIGNAGE_NAME.test(name)) return false;
  const activity = String(company.activity || "").toLowerCase();
  if (NO_SIGNAGE_ACTIVITY.some((needle) => activity.includes(needle))) return false;
  const naf = String(company.naf || "");
  return !NO_SIGNAGE_NAF.some((prefix) => naf.startsWith(prefix));
}

function norm(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Aucune source publique ne dit « domicile » : on déduit d'indices, d'où les libellés « probable ».
const DOMICILIATION_ADDRESS = /\b(c o|chez|domicili\w*)\b/;
const PRO_ADDRESS = /\b(za|zac|zi|zone|parc d activites?|centre commercial|galerie|local|cellule)\b/;
const HOME_ADDRESS = /\b(appartement|appart|apt|app|bat|batiment|residence|etage|logement)\b/;
const MOBILE_ACTIVITY = /a domicile|ambulant|non sedentaire|sur les marches|itinerant/;

function addressKind(company) {
  const address = norm(`${company.address || ""} ${company.addressExtra || ""}`);
  if (DOMICILIATION_ADDRESS.test(address)) return { kind: "domiciliation", reason: "adresse de domiciliation" };
  if ((company.enseignes || []).length) return { kind: "local", reason: `enseigne déclarée : ${company.enseignes[0]}` };
  if (PRO_ADDRESS.test(address)) return { kind: "local", reason: "zone d'activité ou local commercial" };
  if (HOME_ADDRESS.test(address)) return { kind: "domicile", reason: "appartement ou résidence" };
  if (MOBILE_ACTIVITY.test(norm(company.activity))) return { kind: "domicile", reason: "activité sans local (à domicile, marchés…)" };
  if (company.isPerson) return { kind: "domicile", reason: "entrepreneur individuel sans enseigne" };
  return { kind: "inconnu", reason: "" };
}

function parseCities(raw) {
  return String(raw || "").split(/[,;]/).map((value) => value.trim()).filter(Boolean);
}

function cityMatches(company, cities) {
  if (!cities.length) return true;
  return cities.some((city) => (/^\d{5}$/.test(city)
    ? company.postalCode === city
    : norm(company.city) === norm(city)));
}

const SECTORS = [
  {
    id: "tous",
    label: "Tous secteurs (avec besoin de signalétique)",
    nafPrefixes: [],
    keywords: [],
    exclude: []
  },
  {
    id: "restauration",
    label: "Restauration, cafés, bars",
    nafPrefixes: ["56"],
    keywords: ["restaurant", "pizzeria", "brasserie", "snack", "traiteur", "café", "bar ", "salon de thé", "food truck", "glacier", "crêperie", "restauration rapide"],
    exclude: ["livraison de commandes restaurant", "coursier", "restauration de bien", "restauration d'immeuble", "restauration et/ou", "commerce de gros"]
  },
  {
    id: "btp",
    label: "BTP / artisanat du bâtiment",
    nafPrefixes: ["41", "42", "43"],
    keywords: ["maçonnerie", "plomberie", "électricité", "couverture", "peinture", "rénovation", "construction", "carrelage", "menuiserie", "plâtrerie", "chauffage"],
    exclude: []
  },
  {
    id: "commerce",
    label: "Commerce de détail",
    nafPrefixes: ["47"],
    keywords: ["commerce de détail", "boutique", "magasin", "épicerie", "prêt à porter", "vente au détail"],
    exclude: []
  },
  {
    id: "immobilier",
    label: "Immobilier",
    nafPrefixes: ["68"],
    keywords: ["agence immobilière", "transaction immobilière", "gestion locative"],
    exclude: []
  },
  {
    id: "informatique",
    label: "Informatique / digital",
    nafPrefixes: ["62", "63"],
    keywords: ["informatique", "développement web", "logiciel", "numérique", "digital", "application mobile", "sites internet"],
    exclude: []
  },
  {
    id: "conseil",
    label: "Conseil, gestion, juridique",
    nafPrefixes: ["69", "70", "74"],
    keywords: ["conseil", "consulting", "expertise", "audit", "ressources humaines", "cabinet"],
    exclude: []
  },
  {
    id: "sante",
    label: "Santé / médical",
    nafPrefixes: ["86"],
    keywords: ["médical", "dentaire", "infirmier", "kinésith", "ostéopath", "psycholog", "cabinet médical", "orthophon"],
    exclude: []
  },
  {
    id: "beaute",
    label: "Beauté / coiffure",
    nafPrefixes: ["96"],
    keywords: ["coiffure", "esthétique", "salon de coiffure", "onglerie", "institut de beauté", " barbier"],
    exclude: []
  },
  {
    id: "transport",
    label: "Transport / logistique",
    nafPrefixes: ["49", "52"],
    keywords: ["transport", "taxi", "déménagement", "logistique", "ambulance"],
    exclude: []
  },
  {
    id: "enseignement",
    label: "Formation / enseignement",
    nafPrefixes: ["85"],
    keywords: ["formation", "enseignement", "coaching", "auto-école", "soutien scolaire"],
    exclude: []
  },
  {
    id: "arts",
    label: "Arts, spectacles, sport",
    nafPrefixes: ["90", "93"],
    keywords: ["spectacle", "audiovisuel", "salle de sport", "fitness", "yoga", "production"],
    exclude: []
  },
  {
    id: "services",
    label: "Services aux entreprises",
    nafPrefixes: ["81", "82"],
    keywords: ["nettoyage", "sécurité", "secrétariat", "services aux entreprises", "paysagiste"],
    exclude: []
  }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listSectors() {
  return SECTORS.map(({ id, label }) => ({ id, label }));
}

function resolveSector(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const byId = SECTORS.find((s) => s.id === value);
  if (byId) return byId;
  const lowered = value.toLowerCase();
  const byLabel = SECTORS.find((s) => lowered.includes(s.id) || s.label.toLowerCase().includes(lowered) || s.keywords.some((k) => lowered.includes(k.trim())));
  if (byLabel) {
    return {
      ...byLabel,
      extraKeywords: [value]
    };
  }
  return {
    id: "custom",
    label: value,
    nafPrefixes: [],
    keywords: [value],
    exclude: [],
    extraKeywords: []
  };
}

function cleanDisplayName(name) {
  return String(name || "")
    .replace(/["'`«»]/g, " ")
    .replace(/[\u201c\u201d\u00ab\u00bb]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchName(company) {
  const candidates = [company.brandName, company.name, company.legalName]
    .map((value) => cleanDisplayName(value))
    .filter(Boolean);
  const expanded = [];
  for (const candidate of candidates) {
    expanded.push(candidate);
    const withoutParens = candidate.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    if (withoutParens) expanded.push(withoutParens);
    const inner = candidate.match(/\(([^)]+)\)/);
    if (inner && inner[1].trim().length >= 4) expanded.push(inner[1].trim());
  }
  expanded.sort((a, b) => tokenize(b).length - tokenize(a).length || b.length - a.length);
  return expanded[0] || cleanDisplayName(company.name);
}

function isGenericCompanyName(company) {
  const tokens = tokenize(searchName(company));
  if (tokens.some((token) => token.length >= 5)) return false;
  return tokens.length < 2;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function nameSimilarity(a, b) {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (!left.size || !right.size) return 0;
  let hit = 0;
  for (const token of left) {
    if (right.has(token)) hit += 1;
  }
  return hit / Math.min(left.size, right.size);
}

function activityMatchesSector(activity, sector) {
  const text = String(activity || "").toLowerCase();
  if (!text) return false;
  const excluded = (sector.exclude || []).some((needle) => text.includes(needle.toLowerCase()));
  if (excluded) return false;
  const keys = [...(sector.keywords || []), ...(sector.extraKeywords || [])]
    .map((k) => k.toLowerCase().trim())
    .filter(Boolean);
  if (!keys.length) return true;
  return keys.some((key) => text.includes(key.trim()));
}

function nafMatchesSector(naf, sector) {
  const code = String(naf || "");
  if (!code || !(sector.nafPrefixes || []).length) return true;
  return sector.nafPrefixes.some((prefix) => code.startsWith(prefix));
}

function nafLabel(code) {
  if (!code) return "";
  if (NAF_LABELS[code]) return NAF_LABELS[code];
  const two = code.slice(0, 2);
  return NAF_LABELS[two] || "";
}

function parseJsonField(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function firstEtablissement(record) {
  const parsed = parseJsonField(record.listeetablissements);
  if (!parsed) return null;
  const et = parsed.etablissement;
  if (Array.isArray(et)) return et[0] || null;
  return et || null;
}

function extractSiren(record) {
  const registre = record.registre || [];
  for (const item of registre) {
    const digits = String(item || "").replace(/\D/g, "");
    if (digits.length === 9) return digits;
  }
  const personnes = parseJsonField(record.listepersonnes);
  const person = personnes && (Array.isArray(personnes.personne) ? personnes.personne[0] : personnes.personne);
  const raw = person && person.numeroImmatriculation && person.numeroImmatriculation.numeroIdentification;
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length === 9 ? digits : "";
}

function formatPersonName(person) {
  if (!person) return "";
  if (person.denomination) return String(person.denomination).trim();
  const prenom = Array.isArray(person.prenom) ? person.prenom[0] : person.prenom;
  return [prenom, person.nom].filter(Boolean).join(" ").trim();
}

function parseDirectors(record) {
  const personnes = parseJsonField(record.listepersonnes);
  const person = personnes && (Array.isArray(personnes.personne) ? personnes.personne[0] : personnes.personne);
  if (!person) return [];
  if (person.administration) {
    return [String(person.administration).replace(/^Gérant\s*:\s*/i, "").trim()].filter(Boolean);
  }
  const name = formatPersonName(person);
  return name ? [name] : [];
}

function parseBodaccRecord(record) {
  const etab = firstEtablissement(record);
  const adresseObj = (etab && etab.adresse) || {};
  const personnes = parseJsonField(record.listepersonnes);
  const person = personnes && (Array.isArray(personnes.personne) ? personnes.personne[0] : personnes.personne);
  const siegeAdr = person && person.adresseSiegeSocial;
  const addressParts = [
    adresseObj.numeroVoie || (siegeAdr && siegeAdr.numeroVoie),
    adresseObj.typeVoie || (siegeAdr && siegeAdr.typeVoie),
    adresseObj.nomVoie || (siegeAdr && siegeAdr.nomVoie),
    adresseObj.codePostal || (siegeAdr && siegeAdr.codePostal) || record.cp,
    adresseObj.ville || (siegeAdr && siegeAdr.ville) || record.ville
  ].filter(Boolean);
  const acte = parseJsonField(record.acte) || {};
  const createdAt = acte.dateCommencementActivite || record.dateparution || "";
  const commercialName = person && (person.nomCommercial || person.denomination);
  return {
    source: "BODACC",
    bodaccId: record.id || "",
    brandName: cleanDisplayName(commercialName || record.commercant || ""),
    name: cleanDisplayName(commercialName || record.commercant || ""),
    legalName: String(record.commercant || "").trim(),
    activity: String((etab && etab.activite) || "").trim(),
    siren: extractSiren(record),
    createdAt,
    publishedAt: record.dateparution || "",
    address: addressParts.join(" ").replace(/\s+/g, " ").trim(),
    city: String(adresseObj.ville || (siegeAdr && siegeAdr.ville) || record.ville || "").trim(),
    postalCode: String(adresseObj.codePostal || (siegeAdr && siegeAdr.ville && siegeAdr.codePostal) || record.cp || "").trim(),
    department: String(record.numerodepartement || "").trim(),
    directors: parseDirectors(record),
    addressExtra: [adresseObj.complGeographique, adresseObj.typeVoie, siegeAdr && siegeAdr.complGeographique].filter(Boolean).join(" "),
    isPerson: Boolean(person && person.typePersonne === "pp"),
    enseignes: [],
    bodaccUrl: record.url_complete || "",
    naf: "",
    nafLabel: "",
    email: "",
    phone: "",
    website: "",
    contactSource: "",
    contactConfidence: "none"
  };
}

function normalizeFrPhone(raw) {
  if (!raw) return "";
  let digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("33") && digits.length >= 11) {
    digits = `0${digits.slice(2)}`;
  }
  if (digits.length > 10 && digits.startsWith("0")) {
    digits = digits.slice(0, 10);
  }
  if (digits.length !== 10 || !digits.startsWith("0")) return "";
  if (digits.startsWith("089") || (digits.startsWith("08") && digits[2] === "9")) return "";
  if (digits.startsWith("0033")) return "";
  return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
}

function phoneFitsCompany(phone, company) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length !== 10) return false;
  const prefix = digits.slice(0, 2);
  if (prefix === "06" || prefix === "07" || prefix === "09") return true;
  const dep = String(company.department || "").padStart(2, "0");
  const idf = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);
  if (idf.has(dep) && prefix !== "01") return false;
  if (dep && !idf.has(dep) && prefix === "01") return false;
  return true;
}

function extractPhones(text) {
  const matches = String(text || "").match(/(?:\+33|0)\s*[1-9](?:[\s.\-]?\d{2}){4}/g) || [];
  const out = [];
  for (const match of matches) {
    const normalized = normalizeFrPhone(match);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

function extractEmails(text) {
  const matches = String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const out = [];
  for (const raw of matches) {
    const email = raw.toLowerCase().replace(/[.,;:]+$/, "");
    if (email.includes("...")) continue;
    const [localPart = "", domainPart = ""] = email.split("@");
    if (/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i.test(email) || /\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i.test(localPart)) continue;
    if (!domainPart.includes(".")) continue;
    if (EMAIL_BLOCK_DOMAINS.some((blocked) => domainPart === blocked || domainPart.endsWith(`.${blocked}`))) continue;
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

function pageMatchesCompany(text, company) {
  const hay = String(text || "").toLowerCase();
  if (company.siren && hay.includes(company.siren)) return true;
  const city = String(company.city || "").toLowerCase();
  const hugeCities = new Set(["paris", "lyon", "marseille", "toulouse", "lille", "bordeaux", "nantes", "nice", "strasbourg"]);
  const streetTokens = tokenize(company.address).filter((token) => token !== city && !/^\d+$/.test(token) && token !== "rue" && token !== "av" && token !== "avenue" && token !== "bd" && token !== "boulevard" && token !== "chemin" && token !== "place");
  const hasStreet = streetTokens.length >= 2 && streetTokens.filter((token) => hay.includes(token)).length >= 2;
  const hasPlace = Boolean(
    (company.postalCode && hay.includes(String(company.postalCode).toLowerCase()))
    || hasStreet
    || (city && hay.includes(city) && !hugeCities.has(city))
  );
  const nameScore = nameSimilarity(company.name, hay.slice(0, 4000));
  const tokens = tokenize(company.name);
  if (tokens.length <= 1) {
    return hasPlace && nameScore >= 0.99;
  }
  if (hasPlace && nameScore >= 0.34) return true;
  if (nameScore >= 0.8) return true;
  return false;
}

function decodeDuckDuckGoUrl(href) {
  try {
    const parsed = new URL(href, "https://duckduckgo.com/");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : href;
  } catch {
    return href;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isDirectoryHost(url) {
  const host = hostOf(url);
  return DIRECTORY_HOSTS.has(host) || (host.endsWith(".gouv.fr") && host.includes("annuaire"));
}

function isRelayHost(url) {
  return RELAY_HOSTS.has(hostOf(url));
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(sarl|sas|sasu|eurl|sci|selarl|ste|societe)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function parseMarkdownLinks(markdown) {
  const links = [];
  const re = /\[([^\]]+)\]\((https?:[^)]+)\)/g;
  let match;
  while ((match = re.exec(markdown))) {
    const title = match[1].replace(/\s+/g, " ").trim();
    if (title.startsWith("![") || title.startsWith("Image ")) continue;
    const href = decodeDuckDuckGoUrl(match[2]);
    if (!href.startsWith("http")) continue;
    if (href.includes("duckduckgo.com") || href.includes("jina.ai") || href.includes("r.jina.ai")) continue;
    links.push({ title, href });
  }
  return links;
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = options.timeoutMs || 20000;
  const retries = options.retries ?? 2;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: options.accept || "application/json,text/html,text/plain;q=0.9,*/*;q=0.8",
          "Accept-Language": "fr-FR,fr;q=0.9",
          ...(options.headers || {})
        },
        signal: controller.signal
      });
      if (response.status === 429 && attempt < retries) {
        const waitSec = Number(response.headers.get("retry-after") || 2);
        await sleep(Math.min(Math.max(waitSec, 1), 8) * 1000);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`Échec de récupération: ${url}`);
}

// DNS-over-HTTPS : marche dans un Worker comme dans Node, sans module dns.
async function dnsHas(name, type) {
  try {
    const data = await fetchJson(`${DOH_URL}?${new URLSearchParams({ name, type })}`, {
      timeoutMs: 5000,
      retries: 0,
      accept: "application/dns-json"
    });
    return (data.Answer || []).some((answer) => answer.type === (type === "MX" ? 15 : 1));
  } catch {
    return false;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} pour ${url}`);
  }
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(url, { ...options, accept: "text/html,text/plain,*/*" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} pour ${url}`);
  }
  return response.text();
}

async function fetchViaJina(targetUrl) {
  const wrapped = `${JINA_PREFIX}${targetUrl}`;
  return fetchText(wrapped, {
    timeoutMs: 12000,
    retries: 0,
    headers: { "X-No-Cache": "true", Accept: "text/markdown" }
  });
}

function buildBodaccWhere(sector, days, department, cities = []) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - Math.max(1, Number(days) || 30));
  const iso = start.toISOString().slice(0, 10);
  const clauses = [
    "familleavis='creation'",
    `dateparution>=date'${iso}'`
  ];
  if (department) {
    const dep = String(department).padStart(2, "0");
    clauses.push(`numerodepartement='${dep}'`);
  }
  if (cities.length) {
    // Le BODACC stocke les villes sans accents ; search() est large (« Le Vieil-Evreux »), cityMatches affine ensuite.
    const ors = cities.map((city) => (/^\d{5}$/.test(city) ? `cp='${city}'` : `search(ville, '${norm(city)}')`));
    clauses.push(`(${ors.join(" OR ")})`);
  }
  const keywords = [...(sector.keywords || [])].slice(0, 6);
  if (keywords.length) {
    const likes = keywords.map((kw) => `listeetablissements LIKE '%${kw.replace(/'/g, "''")}%'`);
    clauses.push(`(${likes.join(" OR ")})`);
  }
  return clauses.join(" AND ");
}

// Une page BODACC par appel : la page web enchaîne les offsets (limite de sous-requêtes des Workers).
async function fetchBodaccPage(params = {}) {
  const sector = resolveSector(params.sector);
  if (!sector) throw new Error("Choisissez un secteur d'activité.");
  const days = Math.min(180, Math.max(7, Number(params.days) || 30));
  const department = String(params.department || "").replace(/\D/g, "").slice(0, 3);
  const cities = parseCities(params.cities);
  const offset = Math.max(0, Math.floor(Number(params.offset) || 0));
  const url = `${BODACC_URL}?${new URLSearchParams({
    where: buildBodaccWhere(sector, days, department, cities),
    limit: String(BODACC_PAGE_SIZE),
    offset: String(offset),
    order_by: "dateparution desc"
  }).toString()}`;
  const payload = await fetchJson(url, { timeoutMs: 25000 });
  const total = Number(payload.total_count || 0);
  const rows = payload.results || [];
  const companies = rows
    .map(parseBodaccRecord)
    .filter((company) => company.name && company.activity
      && activityMatchesSector(company.activity, sector)
      && needsSignage(company)
      && cityMatches(company, cities));
  const next = offset + rows.length;
  // shortcut: 2000 annonces lues au plus par recherche, préciser ville/département au-delà.
  const nextOffset = rows.length === BODACC_PAGE_SIZE && next < Math.min(total, 2000) ? next : null;
  return { total, nextOffset, companies };
}

function isNonDiffusible(value) {
  return /NON-DIFFUSIBLE/i.test(String(value || ""));
}

async function enrichSirene(company) {
  if (!company.siren) return company;
  const url = `${SIRENE_URL}?${new URLSearchParams({ q: company.siren }).toString()}`;
  try {
    const payload = await fetchJson(url, { timeoutMs: 15000, retries: 3 });
    const hit = (payload.results || [])[0];
    if (!hit) return company;
    const nom = hit.nom_complet || hit.nom_raison_sociale || "";
    if (nom && !isNonDiffusible(nom)) {
      company.name = nom;
    }
    company.naf = hit.activite_principale || company.naf;
    company.nafLabel = nafLabel(company.naf);
    if (hit.date_creation && !String(hit.date_creation).startsWith("1900")) {
      company.createdAt = hit.date_creation;
    }
    const siege = hit.siege || {};
    if (Array.isArray(siege.liste_enseignes)) company.enseignes = siege.liste_enseignes.filter((name) => name && !isNonDiffusible(name));
    if (siege.complement_adresse) company.addressExtra = `${company.addressExtra || ""} ${siege.complement_adresse}`.trim();
    if (hit.complements && hit.complements.est_entrepreneur_individuel) company.isPerson = true;
    const sireneAddress = siege.geo_adresse || siege.adresse || "";
    if (sireneAddress && !isNonDiffusible(sireneAddress)) {
      company.address = sireneAddress;
      company.city = siege.libelle_commune || company.city;
      company.postalCode = siege.code_postal || company.postalCode;
    }
    if (siege.latitude && !isNonDiffusible(sireneAddress)) {
      company.latitude = Number(siege.latitude);
      company.longitude = Number(siege.longitude);
    }
    const dirigeants = Array.isArray(hit.dirigeants) ? hit.dirigeants : [];
    const names = dirigeants
      .map((d) => [d.prenoms, d.nom, d.denomination].filter(Boolean).join(" ").trim())
      .filter((name) => name && !isNonDiffusible(name));
    if (names.length) company.directors = names;
    company.sireneUrl = `https://annuaire-entreprises.data.gouv.fr/entreprise/${company.siren}`;
  } catch {
    // L'annonce BODACC reste exploitable si Sirene est limitée.
  }
  return company;
}

function applyContact(company, { email, phone, website, source, confidence }) {
  if (email && !company.email) company.email = email;
  if (phone && !company.phone) company.phone = phone;
  if (website && !company.website) company.website = website;
  if ((email || phone) && !company.contactSource) {
    company.contactSource = source;
    company.contactConfidence = confidence || "medium";
  }
}

async function enrichFromNominatim(company) {
  if (!company.city && !company.postalCode) return false;
  const query = [searchName(company), company.postalCode, company.city, "France"].filter(Boolean).join(" ");
  const url = `${NOMINATIM_URL}?${new URLSearchParams({
    q: query,
    format: "json",
    addressdetails: "1",
    extratags: "1",
    limit: "5"
  }).toString()}`;
  try {
    const rows = await fetchJson(url, {
      timeoutMs: 12000,
      headers: { "User-Agent": USER_AGENT }
    });
    for (const row of rows || []) {
      const extra = row.extratags || {};
      const display = `${row.name || ""} ${row.display_name || ""} ${JSON.stringify(extra)}`;
      const sameCity = company.city && display.toLowerCase().includes(String(company.city).toLowerCase());
      const sameCp = company.postalCode && display.includes(company.postalCode);
      if (!sameCity && !sameCp) continue;
      if (nameSimilarity(company.name, row.name || row.display_name) < 0.5) continue;
      const phone = normalizeFrPhone(extra.phone || extra["contact:phone"] || "");
      if (phone && !phoneFitsCompany(phone, company)) continue;
      const email = extractEmails(extra.email || extra["contact:email"] || "")[0] || "";
      const website = extra.website || extra["contact:website"] || "";
      if (phone || email) {
        applyContact(company, {
          email,
          phone,
          website,
          source: "OpenStreetMap",
          confidence: "high"
        });
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

async function enrichFromDomainGuess(company) {
  const base = slugify(searchName(company));
  const city = slugify(company.city);
  if (!base || base.length < 4) return false;
  const parts = base.split("-").filter(Boolean);
  const forms = new Set([base, parts.join("")]);
  if (parts.length >= 3) {
    forms.add(parts.filter((part) => part !== "le" && part !== "la" && part !== "les").join("-"));
  }
  if (city) forms.add(`${base}-${city}`);
  const unique = [...forms].filter((form) => form.length >= 4).slice(0, 5);
  for (const form of unique) {
    for (const tld of [".fr", ".com"]) {
      const host = form + tld;
      if (!(await dnsHas(host, "A"))) continue;
      const url = `https://${host}`;
      try {
        const scraped = await scrapeWebsiteQuick(url, company);
        if (scraped.email || scraped.phone) {
          applyContact(company, {
            email: scraped.email,
            phone: scraped.phone,
            website: scraped.website || url,
            source: `site ${hostOf(url) || host}`,
            confidence: scraped.confidence || "medium"
          });
          return true;
        }
      } catch {
        // skip
      }
      await sleep(100);
    }
  }
  return false;
}

async function scrapeWebsiteQuick(url, company) {
  const paths = ["", "/contact"];
  let combined = "";
  for (const p of paths) {
    const target = p ? new URL(p, url).toString() : url;
    let html = "";
    try {
      html = await fetchText(target, { timeoutMs: 8000, retries: 0 });
    } catch {
      continue;
    }
    if (!html) continue;
    combined += `\n${html}`;
    const picked = pickBestFromText(combined, company, `site ${hostOf(url)}`, target, { fullText: true });
    if (picked && (picked.email || picked.phone)) {
      return { ...picked, website: url };
    }
  }
  return { website: pageMatchesCompany(combined, company) ? url : "" };
}

function pickBestFromText(text, company, source, href = "", options = {}) {
  if (!options.lenient && !pageMatchesCompany(text, company)) return null;
  if (options.lenient && nameSimilarity(company.name, String(text || "").slice(0, 6000)) < 0.2) return null;
  const hay = String(text || "");
  const lowered = hay.toLowerCase();
  const tokens = tokenize(searchName(company)).sort((a, b) => b.length - a.length);
  const needle = tokens[0] || "";
  const idx = needle ? lowered.indexOf(needle) : 0;
  const sample = options.fullText
    ? hay
    : (idx >= 0 ? hay.slice(Math.max(0, idx - 120), idx + 900) : hay.slice(0, 1800));
  const relayPage = /2,99\s*€|mise en relation|n'est pas le numéro du destinataire/i.test(sample) || isRelayHost(href);
  const emails = extractEmails(sample);
  const phones = (relayPage ? [] : extractPhones(sample)).filter((phone) => phoneFitsCompany(phone, company));
  if (!emails.length && !phones.length) return null;
  return {
    email: emails[0] || "",
    phone: phones[0] || "",
    source,
    confidence: company.postalCode && sample.includes(company.postalCode) ? "high" : "medium"
  };
}

function discoverContactUrls(html, baseUrl) {
  const found = [];
  const re = /href=["']([^"'#]+)["']/gi;
  let match;
  while ((match = re.exec(String(html || "")))) {
    if (!/contact|mention|legal|coordonn|acces|acc[eè]s|rdv|horaire/i.test(match[1])) continue;
    try {
      const absolute = new URL(match[1], baseUrl).toString();
      if (hostOf(absolute) === hostOf(baseUrl) && !found.includes(absolute)) found.push(absolute);
    } catch {
      // ignore
    }
  }
  return found.slice(0, 5);
}

async function scrapeWebsite(url, company) {
  const paths = ["", "/contact", "/mentions-legales"];
  let combined = "";
  let baseText = "";
  const visited = new Set();
  const queue = paths.map((pathName) => (pathName ? new URL(pathName, url).toString() : url));
  for (let i = 0; i < queue.length; i += 1) {
    const target = queue[i];
    if (visited.has(target)) continue;
    visited.add(target);
    let html = "";
    try {
      html = await fetchText(target, { timeoutMs: 8000, retries: 0 });
    } catch {
      try {
        html = await fetchViaJina(target);
      } catch {
        html = "";
      }
    }
    if (!html) continue;
    combined += `\n${html}`;
    if (i === 0) {
      baseText = html;
      for (const extra of discoverContactUrls(html, url)) {
        if (!visited.has(extra)) queue.push(extra);
      }
    }
    const picked = pickBestFromText(combined, company, `site ${hostOf(url)}`, target, { fullText: true });
    if (picked && (picked.email || picked.phone)) {
      return { ...picked, website: url, html: baseText || combined };
    }
    await sleep(150);
  }
  return { website: pageMatchesCompany(combined, company) ? url : "", html: combined };
}

async function enrichFromSociete(company) {
  if (!company.siren) return false;
  const target = `https://www.societe.com/societe/${slugify(company.name)}-${company.siren}.html`;
  try {
    const markdown = await fetchViaJina(target);
    if (!markdown || markdown.length < 200) return false;
    const phones = extractPhones(markdown).filter((p) => phoneFitsCompany(p, company));
    const emails = extractEmails(markdown);
    if (phones[0] || emails[0]) {
      applyContact(company, {
        email: emails[0] || "",
        phone: phones[0] || "",
        source: "societe.com",
        confidence: "medium"
      });
      return true;
    }
  } catch {
    // societe.com might block Jina
  }
  return false;
}

async function enrichFromDirectorSearch(company) {
  const director = (company.directors || [])[0];
  if (!director || director.length < 4) return false;
  const query = `"${director}" ${company.name} email OR téléphone OR contact ${company.city || ""}`;
  const target = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
  let markdown = "";
  try {
    markdown = await fetchViaJina(target);
  } catch {
    return false;
  }
  const allEmails = extractEmails(markdown);
  const allPhones = extractPhones(markdown).filter((p) => phoneFitsCompany(p, company));
  const relevantEmails = allEmails.filter((e) => {
    const local = e.split("@")[0];
    const dirTokens = tokenize(director);
    return dirTokens.some((t) => local.includes(t)) || nameSimilarity(company.name, e) > 0.3;
  });
  if (relevantEmails[0] || allPhones[0]) {
    applyContact(company, {
      email: relevantEmails[0] || "",
      phone: allPhones[0] || "",
      source: "recherche dirigeant",
      confidence: "medium"
    });
    return true;
  }
  return false;
}

async function enrichFromEmailGuess(company) {
  const base = slugify(searchName(company));
  if (!base || base.length < 3) return false;
  const parts = base.split("-").filter(Boolean);
  const forms = new Set([base, parts.join("")]);
  if (parts.length >= 2) {
    forms.add(parts.slice(0, 2).join(""));
  }
  const tlds = [".fr", ".com"];
  for (const form of forms) {
    if (form.length < 3) continue;
    for (const tld of tlds) {
      const domain = form + tld;
      if (!(await dnsHas(domain, "MX"))) continue;
      const prefixes = ["contact", "info", "hello", "bonjour"];
      for (const prefix of prefixes) {
        const email = `${prefix}@${domain}`;
        applyContact(company, {
          email,
          phone: "",
          website: `https://${domain}`,
          source: `devin\u00e9 (MX ${domain})`,
          confidence: "low"
        });
        return true;
      }
    }
  }
  return false;
}

async function enrichFromPagesJaunes(company) {
  const target = `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodeURIComponent(searchName(company))}&ou=${encodeURIComponent(company.city || "")}`;
  try {
    const markdown = await fetchViaJina(target);
    if (/aucun résultat/i.test(markdown) || /terme manquant/i.test(markdown)) return false;
    if (!pageMatchesCompany(markdown, company)) {
      return false;
    }
      const phones = extractPhones(markdown).filter((phone) => phoneFitsCompany(phone, company));
    const emails = extractEmails(markdown);
    const links = parseMarkdownLinks(markdown)
      .map((l) => l.href)
      .filter((href) => href.includes("pagesjaunes.fr/pros/"));
    if (phones[0] || emails[0]) {
      applyContact(company, {
        email: emails[0] || "",
        phone: phones[0] || "",
        website: links[0] || "",
        source: "PagesJaunes",
        confidence: "medium"
      });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function enrichFromSearch(company) {
  const queries = [
    `${searchName(company)} ${company.city || ""} téléphone email`.trim(),
    `"${searchName(company)}" téléphone email`
  ];
  const seenHref = new Set();
  for (const query of queries) {
    const target = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;
    let markdown = "";
    try {
      markdown = await fetchViaJina(target);
    } catch {
      continue;
    }
    const snippetHit = pickBestFromText(markdown, company, "Brave Search");
    if (snippetHit && (snippetHit.email || snippetHit.phone)) {
      applyContact(company, snippetHit);
      return true;
    }
    const links = parseMarkdownLinks(markdown);
    const candidates = [];
    for (const link of links) {
      if (seenHref.has(link.href)) continue;
      const host = hostOf(link.href);
      if (host.includes("brave.com") || host.includes("search.brave")) continue;
      if (isDirectoryHost(link.href) && !link.href.includes("pagesjaunes.fr/pros/")) continue;
      if (isRelayHost(link.href)) continue;
      const score = nameSimilarity(searchName(company), `${link.title} ${link.href}`);
      if (score < 0.2 && !/pagesjaunes\.fr\/pros\//.test(link.href)) continue;
      seenHref.add(link.href);
      candidates.push({ ...link, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const candidate of candidates.slice(0, 2)) {
      if (company.email && company.phone) break;
      try {
        const scraped = await scrapeWebsite(candidate.href, company);
        if (scraped.email || scraped.phone) {
          applyContact(company, {
            email: scraped.email,
            phone: scraped.phone,
            website: scraped.website || candidate.href,
            source: scraped.source || `web ${hostOf(candidate.href)}`,
            confidence: scraped.confidence || "medium"
          });
        } else if (scraped.website && !company.website) {
          company.website = scraped.website;
        }
      } catch {
        // suivant
      }
      await sleep(400);
    }
    if (company.email || company.phone) return true;
    await sleep(400);
  }
  return Boolean(company.email || company.phone);
}

function buildProposal(company, sender = {}) {
  const who = sender.name || "Notre atelier de signalétique";
  const director = company.directors[0] ? ` ${company.directors[0]}` : "";
  const activity = company.activity || company.nafLabel || "votre activité";
  const subject = `Votre enseigne et votre signalétique — ${company.name}`;
  const body = `Bonjour${director},

Félicitations pour la création de ${company.name}${company.createdAt ? ` (${company.createdAt})` : ""}.

Une nouvelle activité, c'est le bon moment pour se rendre visible : une enseigne et une vitrine soignées attirent vos premiers clients dès l'ouverture.

${who} peut vous accompagner sur :
- l'enseigne de façade (lettres découpées, caisson lumineux, drapeau)
- la vitrophanie et le marquage de vitrine (horaires, logo, adhésifs)
- le marquage de vos véhicules
- la signalétique intérieure, les panneaux de chantier et les supports imprimés

Activité déclarée : ${activity}
${company.address ? `Adresse : ${company.address}` : ""}

Je peux passer vous voir pour un devis gratuit, avec une maquette de votre future enseigne.

Cordialement,
${sender.name || ""}
${sender.email || ""}
${sender.phone || ""}`.replace(/\n{3,}/g, "\n\n").trim();

  const mailto = company.email
    ? `mailto:${encodeURIComponent(company.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : "";
  return { subject, body, mailto };
}

function publicCompany(company, sender) {
  const proposal = buildProposal(company, sender);
  return {
    name: company.name,
    legalName: company.legalName,
    activity: company.activity,
    naf: company.naf,
    nafLabel: company.nafLabel,
    siren: company.siren,
    createdAt: company.createdAt,
    publishedAt: company.publishedAt,
    address: company.address,
    city: company.city,
    postalCode: company.postalCode,
    department: company.department,
    directors: company.directors,
    email: company.email || "",
    phone: company.phone || "",
    website: company.website || "",
    contactSource: company.contactSource || "",
    place: addressKind(company),
    hasContact: Boolean(company.email || company.phone),
    bodaccUrl: company.bodaccUrl,
    sireneUrl: company.sireneUrl || (company.siren ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${company.siren}` : ""),
    proposal
  };
}

async function findContacts(company) {
  if (isGenericCompanyName(company)) return;
  const steps = [
    enrichFromEmailGuess, enrichFromNominatim, enrichFromDomainGuess, enrichFromPagesJaunes,
    enrichFromSearch, enrichFromSociete, enrichFromDirectorSearch
  ];
  for (const step of steps) {
    if (company.email || company.phone) return;
    // Au-delà de 50 sous-requêtes (Workers gratuit), fetch échoue : les étapes suivantes renvoient « rien trouvé ».
    await step(company);
    await sleep(250);
  }
}

// Une entreprise par appel : Sirene, filtres, puis recherche de contacts.
async function enrichCompany(body = {}) {
  const raw = body.company;
  if (!raw || typeof raw !== "object" || typeof raw.name !== "string" || !raw.name.trim()) {
    throw new Error("Entreprise manquante.");
  }
  const text = (value) => String(value || "").slice(0, 2000);
  const company = {
    ...parseBodaccRecord({}),
    name: text(raw.name), brandName: text(raw.brandName), legalName: text(raw.legalName),
    activity: text(raw.activity), siren: String(raw.siren || "").replace(/\D/g, "").slice(0, 9),
    createdAt: text(raw.createdAt), publishedAt: text(raw.publishedAt), address: text(raw.address),
    city: text(raw.city), postalCode: text(raw.postalCode), department: text(raw.department),
    directors: Array.isArray(raw.directors) ? raw.directors.slice(0, 5).map(text) : [],
    addressExtra: text(raw.addressExtra), isPerson: Boolean(raw.isPerson), bodaccUrl: text(raw.bodaccUrl)
  };
  const sender = {
    name: text(body.senderName).trim(),
    email: text(body.senderEmail).trim(),
    phone: text(body.senderPhone).trim()
  };
  await enrichSirene(company);
  if (!needsSignage(company)) return { skipped: "pas de besoin de signalétique" };
  const place = addressKind(company);
  if (body.hideHome && (place.kind === "domicile" || place.kind === "domiciliation")) {
    return { skipped: `${place.kind} : ${place.reason}` };
  }
  if (body.enrichContacts !== false) await findContacts(company);
  return { company: publicCompany(company, sender) };
}

module.exports = {
  SECTORS,
  fetchBodaccPage,
  enrichCompany,
  listSectors,
  resolveSector,
  parseBodaccRecord,
  normalizeFrPhone,
  extractEmails,
  extractPhones,
  activityMatchesSector,
  needsSignage,
  addressKind,
  cityMatches,
  parseCities,
  buildBodaccWhere,
  nameSimilarity,
  buildProposal,
  decodeDuckDuckGoUrl,
  pageMatchesCompany,
  phoneFitsCompany,
  searchName,
  isGenericCompanyName,
  enrichFromDomainGuess
};
