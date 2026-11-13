const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseBodaccRecord,
  normalizeFrPhone,
  extractEmails,
  extractPhones,
  activityMatchesSector,
  resolveSector,
  nameSimilarity,
  buildProposal,
  decodeDuckDuckGoUrl,
  pageMatchesCompany,
  phoneFitsCompany
} = require("./prospection-agent");

test("normalise les téléphones français et ignore les numéros surtaxés", () => {
  assert.equal(normalizeFrPhone("+33 1 64 21 02 02"), "01 64 21 02 02");
  assert.equal(normalizeFrPhone("06.12.34.56.78"), "06 12 34 56 78");
  assert.equal(normalizeFrPhone("0895853832"), "");
});

test("extrait e-mails utiles et filtre les faux positifs", () => {
  const text = "Contact: hello@creole-avenue.fr photo.png@cdn.com user@sentry.io";
  assert.deepEqual(extractEmails(text), ["hello@creole-avenue.fr"]);
});

test("filtre l'activité restauration et exclut les livreurs", () => {
  const sector = resolveSector("restauration");
  assert.equal(activityMatchesSector("Restaurant pizzeria", sector), true);
  assert.equal(activityMatchesSector("livraison de commandes restaurants en vélo", sector), false);
});

test("parse une annonce BODACC personne morale", () => {
  const record = {
    id: "A1",
    commercant: "SARL ELIA",
    dateparution: "2026-08-16",
    ville: "Paris",
    cp: "75011",
    numerodepartement: "75",
    registre: ["108468380"],
    url_complete: "https://www.bodacc.fr/x",
    listepersonnes: JSON.stringify({
      personne: {
        typePersonne: "pm",
        denomination: "SARL ELIA",
        administration: "Gérant : DUPONT Marie"
      }
    }),
    listeetablissements: JSON.stringify({
      etablissement: {
        activite: "Restaurant pizzeria",
        adresse: { numeroVoie: "12", typeVoie: "Rue", nomVoie: "de Malte", codePostal: "75011", ville: "Paris" }
      }
    }),
    acte: JSON.stringify({ dateCommencementActivite: "2026-08-04" })
  };
  const company = parseBodaccRecord(record);
  assert.equal(company.name, "SARL ELIA");
  assert.equal(company.siren, "108468380");
  assert.equal(company.activity, "Restaurant pizzeria");
  assert.equal(company.city, "Paris");
  assert.equal(company.directors[0], "DUPONT Marie");
  assert.match(company.address, /Malte/);
});

test("écarte SCI, holdings, livreurs et VTC mais garde les commerces", () => {
  const { needsSignage } = require("./prospection-agent");
  assert.equal(needsSignage({ name: "SCI DES LILAS", activity: "Acquisition et gestion d'immeubles" }), false);
  assert.equal(needsSignage({ name: "MARTIN", activity: "Livraison de repas à domicile via plateformes type Uber Eats" }), false);
  assert.equal(needsSignage({ name: "DUPONT", activity: "Transport de personnes en VTC" }), false);
  assert.equal(needsSignage({ name: "ALPHA INVEST", activity: "Prise de participations dans toutes sociétés" }), false);
  assert.equal(needsSignage({ name: "XYZ", activity: "Commerce", naf: "68.20A" }), false);
  assert.equal(needsSignage({ name: "L'AUBERGE DU PONT", activity: "Restaurant, auberge" }), true);
  assert.equal(needsSignage({ name: "SCIENCES ET VOUS", activity: "Boutique de jeux éducatifs" }), true);
  assert.equal(needsSignage({ name: "BOULANGERIE DURAND", activity: "Boulangerie pâtisserie", naf: "10.71C" }), true);
});

test("qualifie l'adresse : local pro, domicile, domiciliation", () => {
  const { addressKind } = require("./prospection-agent");
  assert.equal(addressKind({ address: "12 Rue X", enseignes: ["CHEZ MARIE"], isPerson: true }).kind, "local");
  assert.equal(addressKind({ address: "ZA du Long Buisson 27000 Evreux" }).kind, "local");
  assert.equal(addressKind({ address: "12 Cours de la Futaie", addressExtra: "Appartement 152" }).kind, "domicile");
  assert.equal(addressKind({ address: "5 Rue Y", activity: "Vente de vêtements sur les marchés" }).kind, "domicile");
  assert.equal(addressKind({ address: "5 Rue Y", isPerson: true }).kind, "domicile");
  assert.equal(addressKind({ address: "10 Rue Z c/o SeDomicilier" }).kind, "domiciliation");
  assert.equal(addressKind({ address: "24 Chemin de Parigny" }).kind, "inconnu");
});

test("filtre par ville ou code postal, sans tenir compte des accents", () => {
  const { cityMatches, parseCities, buildBodaccWhere } = require("./prospection-agent");
  const cities = parseCities("Évreux, 27400 ; Pont-Audemer");
  assert.deepEqual(cities, ["Évreux", "27400", "Pont-Audemer"]);
  assert.equal(cityMatches({ city: "Evreux", postalCode: "27000" }, cities), true);
  assert.equal(cityMatches({ city: "Le Vieil-Evreux", postalCode: "27930" }, cities), false);
  assert.equal(cityMatches({ city: "Louviers", postalCode: "27400" }, cities), true);
  assert.equal(cityMatches({ city: "Pont Audemer", postalCode: "27500" }, cities), true);
  assert.equal(cityMatches({ city: "Vernon" }, []), true);
  assert.match(buildBodaccWhere(resolveSector("tous"), 30, "27", cities), /\(search\(ville, 'evreux'\) OR cp='27400' OR search\(ville, 'pont audemer'\)\)/);
});

test("le secteur « tous » accepte toute activité", () => {
  assert.equal(activityMatchesSector("Boulangerie", resolveSector("tous")), true);
});

test("similarité de nom et proposition signalétique", () => {
  assert.ok(nameSimilarity("CREOLE AVENUE CHELLES", "Restaurant Creole Avenue Chelles") > 0.6);
  const proposal = buildProposal({
    name: "SARL ELIA",
    activity: "Restaurant pizzeria",
    createdAt: "2026-08-04",
    directors: ["Marie Dupont"],
    address: "12 Rue de Malte 75011 Paris",
    email: "contact@elia.fr"
  }, { name: "Eva Moreau", email: "eva@atelier.fr" });
  assert.match(proposal.subject, /signalétique/);
  assert.match(proposal.body, /enseigne/);
  assert.match(proposal.body, /^Bonjour Marie Dupont,/);
  assert.match(proposal.mailto, /^mailto:contact%40elia\.fr/);
});

test("décode les liens DuckDuckGo", () => {
  const href = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.restaurantelia.com%2F&rut=abc";
  assert.equal(decodeDuckDuckGoUrl(href), "https://www.restaurantelia.com/");
});

test("n'associe pas un site homonyme sans la ville", () => {
  const company = { name: "LA MOUSTACHE", city: "Cheille", postalCode: "37190", siren: "108515347" };
  assert.equal(pageMatchesCompany("La Moustache Production contact@lamoustache.fr Paris", company), false);
  assert.equal(pageMatchesCompany("LA MOUSTACHE 8 HAMEAU DE LA BALLIERE 37190 Cheille", company), true);
});

test("reconnaît la marque officielle même si la ville du site diffère", () => {
  const company = {
    name: "LE QG BY KERT",
    city: "Tournan-en-Brie",
    postalCode: "77220",
    address: "Tournan-en-Brie",
    department: "77"
  };
  assert.equal(
    pageMatchesCompany("Salon de coiffure Le QG By Kert à Ozoir-la-Ferrière. Tél 06 17 92 03 42", company),
    true
  );
});

test("un téléphone 05 n'est pas valable pour Paris", () => {
  const company = { department: "75" };
  assert.equal(phoneFitsCompany("05 53 55 31 20", company), false);
  assert.equal(phoneFitsCompany("01 43 21 00 00", company), true);
  assert.equal(phoneFitsCompany("06 12 34 56 78", company), true);
});

test("extrait plusieurs téléphones uniques", () => {
  assert.deepEqual(extractPhones("tél 01 64 21 02 02 ou 0164210202"), ["01 64 21 02 02"]);
});

test("nettoie le nom de recherche et ignore les noms trop génériques", () => {
  const { searchName, isGenericCompanyName } = require("./prospection-agent");
  assert.equal(searchName({ name: '"LE QG" BY KERT' }), "LE QG BY KERT");
  assert.equal(isGenericCompanyName({ name: "CF" }), true);
  assert.equal(isGenericCompanyName({ name: "LE QG BY KERT" }), false);
});
