(() => {
  const sectorSelect = document.getElementById("sectorSelect");
  const sectorCustom = document.getElementById("sectorCustom");
  const daysSelect = document.getElementById("daysSelect");
  const departmentInput = document.getElementById("departmentInput");
  const citiesInput = document.getElementById("citiesInput");
  const hideHomeCb = document.getElementById("hideHomeCb");
  const PLACE_LABELS = { local: "Local pro", domicile: "Domicile probable", domiciliation: "Domiciliation", inconnu: "Adresse non qualifiée" };
  const senderName = document.getElementById("senderName");
  const senderEmail = document.getElementById("senderEmail");
  const senderPhone = document.getElementById("senderPhone");
  const runBtn = document.getElementById("runBtn");
  const csvBtn = document.getElementById("csvBtn");
  const logBox = document.getElementById("logBox");
  const statsBox = document.getElementById("statsBox");
  const companyList = document.getElementById("companyList");
  const mailTemplate = document.getElementById("mailTemplate");
  const previewMailBtn = document.getElementById("previewMailBtn");
  const saveTemplateBtn = document.getElementById("saveTemplateBtn");
  const mailPreview = document.getElementById("mailPreview");
  const mailPreviewContent = document.getElementById("mailPreviewContent");
  const massMailBar = document.getElementById("massMailBar");
  const selectAllCb = document.getElementById("selectAllCb");
  const selectedCount = document.getElementById("selectedCount");
  const massEditBtn = document.getElementById("massEditBtn");
  const massSendBtn = document.getElementById("massSendBtn");

  const STORAGE_KEY = "prospection-sender";
  const TEMPLATE_KEY = "prospection-mail-template";
  const FALLBACK_SECTORS = [
    { id: "tous", label: "Tous secteurs (avec besoin de signalétique)" },
    { id: "restauration", label: "Restauration, cafés, bars" },
    { id: "btp", label: "BTP / artisanat du bâtiment" },
    { id: "commerce", label: "Commerce de détail" },
    { id: "immobilier", label: "Immobilier" },
    { id: "informatique", label: "Informatique / digital" },
    { id: "conseil", label: "Conseil, gestion, juridique" },
    { id: "sante", label: "Santé / médical" },
    { id: "beaute", label: "Beauté / coiffure" },
    { id: "transport", label: "Transport / logistique" },
    { id: "enseignement", label: "Formation / enseignement" },
    { id: "arts", label: "Arts, spectacles, sport" },
    { id: "services", label: "Services aux entreprises" }
  ];
  let companies = [];
  let selectedKeys = new Set();
  let editedMails = {};

  function loadSender() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      senderName.value = saved.name || "";
      senderEmail.value = saved.email || "";
      senderPhone.value = saved.phone || "";
    } catch {
      // ignore
    }
  }

  function saveSender() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      name: senderName.value.trim(),
      email: senderEmail.value.trim(),
      phone: senderPhone.value.trim()
    }));
  }

  function log(message) {
    const stamp = new Date().toLocaleTimeString("fr-FR");
    const line = `[${stamp}] ${message}`;
    const current = logBox.textContent === "En attente d\u2019un secteur\u2026" ? "" : `${logBox.textContent}\n`;
    logBox.textContent = `${current}${line}`.trim();
    logBox.scrollTop = logBox.scrollHeight;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function companyKey(c) {
    return c.siren || c.name;
  }

  function fillTemplate(template, company) {
    return template
      .replace(/\{entreprise\}/g, company.name || "")
      .replace(/\{dirigeant\}/g, (company.directors || [])[0] || "Madame, Monsieur")
      .replace(/\{activite\}/g, company.activity || "")
      .replace(/\{adresse\}/g, company.address || "");
  }

  function getMailForCompany(company) {
    const key = companyKey(company);
    if (editedMails[key]) return editedMails[key];
    return fillTemplate(mailTemplate.value, company);
  }

  function contactBlock(company) {
    if (company.email || company.phone) {
      const bits = [];
      if (company.email) bits.push(`<a href="mailto:${escapeHtml(company.email)}">${escapeHtml(company.email)}</a>`);
      if (company.phone) bits.push(`<a href="tel:${escapeHtml(company.phone.replace(/\s/g, ""))}">${escapeHtml(company.phone)}</a>`);
      return `<div class="contact-row"><strong>Contact</strong>${bits.join(" \u00b7 ")}<div class="meta">Source : ${escapeHtml(company.contactSource || "web public")}</div></div>`;
    }
    return `<div class="contact-row missing"><strong>Contact non publi\u00e9</strong><span class="meta">Aucun e-mail / t\u00e9l\u00e9phone trouv\u00e9 en source ouverte.</span></div>`;
  }

  function renderCompany(company) {
    const key = companyKey(company);
    const checked = selectedKeys.has(key) ? "checked" : "";
    const canSelect = company.hasContact;
    const chip = company.hasContact
      ? `<span class="chip ok">contact</span>`
      : `<span class="chip">\u00e0 qualifier</span>`;
    const place = company.place || { kind: "inconnu", reason: "" };
    const placeChip = `<span class="chip ${place.kind === "local" ? "ok" : "muted"}">${PLACE_LABELS[place.kind] || ""}</span>`;
    const placeText = `${PLACE_LABELS[place.kind] || ""}${place.reason ? ` (${escapeHtml(place.reason)})` : ""}`;
    const directors = (company.directors || []).length ? `<div>Dirigeant : ${escapeHtml(company.directors.join(", "))}</div>` : "";
    const rawActivity = company.activity || "";
    const shortActivity = rawActivity.length > 180 ? `${rawActivity.slice(0, 180)}\u2026` : rawActivity;
    const activity = company.nafLabel
      ? `${escapeHtml(shortActivity)} (${escapeHtml(company.naf)} ${escapeHtml(company.nafLabel)})`
      : escapeHtml(shortActivity);
    const links = [];
    if (company.sireneUrl) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.sireneUrl)}" target="_blank" rel="noopener">Annuaire officiel</a>`);
    if (company.bodaccUrl) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.bodaccUrl)}" target="_blank" rel="noopener">Annonce BODACC</a>`);
    if (company.website) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.website)}" target="_blank" rel="noopener">Site</a>`);
    if (canSelect) links.push(`<button class="btn btn-ghost" type="button" data-edit-mail="${escapeHtml(key)}">Voir / modifier le mail</button>`);

    const mailContent = getMailForCompany(company);
    const editId = `mail-edit-${escapeHtml(key).replace(/[^a-zA-Z0-9]/g, "_")}`;

    return `<li class="company-card" data-key="${escapeHtml(key)}">
      <div class="company-card-header">
        ${canSelect ? `<input type="checkbox" class="select-cb" data-select="${escapeHtml(key)}" ${checked}>` : ""}
        <h3>${escapeHtml(company.name)}${chip}${placeChip}</h3>
      </div>
      <div class="meta">
        <div>Activit\u00e9 : ${activity}</div>
        <div>Cr\u00e9ation : ${escapeHtml(company.createdAt || company.publishedAt || "n.c.")}${company.siren ? ` \u00b7 SIREN ${escapeHtml(company.siren)}` : ""}</div>
        <div>Adresse : ${escapeHtml(company.address || `${company.postalCode || ""} ${company.city || ""}`.trim() || "n.c.")}</div>
        <div>Lieu : ${placeText}</div>
        ${directors}
      </div>
      ${contactBlock(company)}
      <div class="actions">${links.join("")}</div>
      <div class="mail-edit-area" id="${editId}">
        <textarea data-mail-key="${escapeHtml(key)}" style="width:100%;min-height:140px;font-size:.82rem">${escapeHtml(mailContent)}</textarea>
        <div class="actions">
          <button class="btn btn-ghost" type="button" data-save-mail="${escapeHtml(key)}">Enregistrer les modifications</button>
          ${company.email ? `<a class="btn btn-primary" href="mailto:${escapeHtml(company.email)}?subject=${encodeURIComponent("Votre enseigne et votre signal\u00e9tique \u2014 " + company.name)}&body=${encodeURIComponent(mailContent)}">Envoyer ce mail</a>` : ""}
        </div>
      </div>
    </li>`;
  }

  function updateSelectionUI() {
    const contactCompanies = companies.filter((c) => c.hasContact);
    selectedCount.textContent = String(selectedKeys.size);
    massMailBar.style.display = companies.length ? "" : "none";
    massSendBtn.disabled = selectedKeys.size === 0;
    selectAllCb.checked = contactCompanies.length > 0 && contactCompanies.every((c) => selectedKeys.has(companyKey(c)));
  }

  function renderList() {
    if (!companies.length) {
      companyList.innerHTML = `<li class="empty">Aucun r\u00e9sultat pour le moment. Choisissez un secteur puis lancez l\u2019agent.</li>`;
      csvBtn.disabled = true;
      massMailBar.style.display = "none";
      return;
    }
    companyList.innerHTML = companies.map(renderCompany).join("");
    csvBtn.disabled = false;
    const withContact = companies.filter((c) => c.hasContact).length;
    statsBox.innerHTML = `
      <div class="stat"><b>${companies.length}</b> entreprises</div>
      <div class="stat"><b>${withContact}</b> avec e-mail ou t\u00e9l\u00e9phone</div>
    `;
    updateSelectionUI();
  }

  function upsertCompany(company) {
    const key = companyKey(company);
    const index = companies.findIndex((row) => companyKey(row) === key);
    if (index >= 0) companies[index] = company;
    else companies.push(company);
    renderList();
  }

  function renderSectorOptions(sectors) {
    sectorSelect.innerHTML = sectors.map((sector) => (
      `<option value="${escapeHtml(sector.id)}">${escapeHtml(sector.label)}</option>`
    )).join("");
  }

  async function loadSectors() {
    try {
      const response = await fetch("/api/prospection/sectors");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      renderSectorOptions(data.sectors?.length ? data.sectors : FALLBACK_SECTORS);
    } catch (error) {
      renderSectorOptions(FALLBACK_SECTORS);
      log(`Secteurs disponibles (API indisponible : ${error.message})`);
    }
  }

  function selectedSector() {
    const custom = sectorCustom.value.trim();
    return custom || sectorSelect.value;
  }

  function handleEvent(event) {
    if (event.type === "status") {
      log(event.message);
      return;
    }
    if (event.type === "company" || event.type === "contact") {
      upsertCompany(event.company);
      if (event.type === "contact") {
        log(event.company.hasContact
          ? `Contact trouv\u00e9 pour ${event.company.name}`
          : `Pas de contact public pour ${event.company.name}`);
      }
      return;
    }
    if (event.type === "done") {
      companies = event.companies || companies;
      renderList();
      const summary = event.summary || {};
      statsBox.innerHTML = `
        <div class="stat"><b>${summary.found || companies.length}</b> entreprises</div>
        <div class="stat"><b>${summary.withContact || 0}</b> avec contact</div>
        <div class="stat">BODACC brut : <b>${summary.totalBodacc || 0}</b></div>
      `;
      log(`Termin\u00e9 \u2014 ${summary.found || 0} entreprises, ${summary.withContact || 0} contacts publics.`);
      runBtn.disabled = false;
      return;
    }
    if (event.type === "error") {
      log(`Erreur : ${event.message}`);
      runBtn.disabled = false;
    }
  }

  async function api(path, options) {
    const response = await fetch(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }

  // Une requête par page BODACC puis une par entreprise : chaque appel au Worker reste sous sa limite de 50 sous-requêtes.
  async function runSteps(query, options) {
    const found = [];
    const seen = new Set();
    let total = 0;
    let offset = 0;
    while (offset !== null) {
      const page = await api(`/api/prospection/page?${new URLSearchParams({ ...query, offset: String(offset) })}`);
      total = page.total;
      for (const company of page.companies) {
        const key = company.siren || `${company.name}|${company.city}|${company.createdAt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(company);
      }
      handleEvent({ type: "status", message: `BODACC : ${Math.min(page.nextOffset ?? total, total)} / ${total} annonces lues, ${found.length} entreprises retenues.` });
      offset = page.nextOffset;
    }
    for (const [index, raw] of found.entries()) {
      handleEvent({ type: "status", message: `(${index + 1}/${found.length}) Recherche — ${raw.name}` });
      try {
        const result = await api("/api/prospection/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company: raw, ...options })
        });
        if (result.skipped) handleEvent({ type: "status", message: `Écartée (${result.skipped}) — ${raw.name}` });
        else handleEvent({ type: options.enrichContacts ? "contact" : "company", company: result.company });
      } catch (error) {
        handleEvent({ type: "status", message: `Erreur pour ${raw.name} : ${error.message}` });
      }
    }
    handleEvent({
      type: "done",
      companies,
      summary: { found: companies.length, withContact: companies.filter((c) => c.hasContact).length, totalBodacc: total }
    });
  }

  function run() {
    saveSender();
    const sector = selectedSector();
    if (!sector) {
      log("Choisissez un secteur.");
      return;
    }
    companies = [];
    selectedKeys.clear();
    editedMails = {};
    renderList();
    statsBox.innerHTML = "";
    logBox.textContent = "";
    runBtn.disabled = true;
    const query = {
      sector,
      days: daysSelect.value,
      department: departmentInput.value.trim(),
      cities: citiesInput.value.trim()
    };
    const options = {
      hideHome: hideHomeCb.checked,
      enrichContacts: true,
      senderName: senderName.value.trim(),
      senderEmail: senderEmail.value.trim(),
      senderPhone: senderPhone.value.trim()
    };
    log(`D\u00e9marrage \u2014 secteur \u00ab ${sector} \u00bb.`);
    runSteps(query, options).catch((error) => handleEvent({ type: "error", message: error.message }));
  }

  function exportCsv() {
    const header = ["nom", "activite", "siren", "creation", "adresse", "ville", "lieu", "email", "telephone", "dirigeant", "source_contact"];
    const rows = companies.map((c) => [
      c.name, c.activity, c.siren, c.createdAt, c.address, c.city, PLACE_LABELS[(c.place || {}).kind] || "", c.email, c.phone,
      (c.directors || []).join(" | "), c.contactSource
    ]);
    const csv = [header, ...rows]
      .map((line) => line.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "prospection-entreprises.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function loadTemplate() {
    const saved = localStorage.getItem(TEMPLATE_KEY);
    if (saved) mailTemplate.value = saved;
  }

  function saveTemplate() {
    localStorage.setItem(TEMPLATE_KEY, mailTemplate.value);
    log("Mod\u00e8le de mail sauvegard\u00e9.");
  }

  function previewMail() {
    if (!companies.length) {
      log("Lancez d\u2019abord une recherche pour pr\u00e9visualiser le mail.");
      return;
    }
    const filled = fillTemplate(mailTemplate.value, companies[0]);
    mailPreviewContent.textContent = filled;
    mailPreview.classList.add("visible");
  }

  companyList.addEventListener("change", (event) => {
    const cb = event.target.closest("[data-select]");
    if (!cb) return;
    const key = cb.getAttribute("data-select");
    if (cb.checked) selectedKeys.add(key);
    else selectedKeys.delete(key);
    updateSelectionUI();
  });

  companyList.addEventListener("click", (event) => {
    const editBtn = event.target.closest("[data-edit-mail]");
    if (editBtn) {
      const key = editBtn.getAttribute("data-edit-mail");
      const safeId = `mail-edit-${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const area = document.getElementById(safeId);
      if (area) area.classList.toggle("visible");
      return;
    }
    const saveBtn = event.target.closest("[data-save-mail]");
    if (saveBtn) {
      const key = saveBtn.getAttribute("data-save-mail");
      const textarea = companyList.querySelector(`textarea[data-mail-key="${key}"]`);
      if (textarea) {
        editedMails[key] = textarea.value;
        log(`Mail modifi\u00e9 pour ${key}.`);
      }
    }
  });

  selectAllCb.addEventListener("change", () => {
    const contactCompanies = companies.filter((c) => c.hasContact);
    if (selectAllCb.checked) {
      contactCompanies.forEach((c) => selectedKeys.add(companyKey(c)));
    } else {
      selectedKeys.clear();
    }
    renderList();
  });

  massEditBtn.addEventListener("click", () => {
    const areas = companyList.querySelectorAll(".mail-edit-area");
    const anyVisible = [...areas].some((a) => a.classList.contains("visible"));
    areas.forEach((a) => {
      const key = a.id.replace("mail-edit-", "");
      const company = companies.find((c) => companyKey(c).replace(/[^a-zA-Z0-9]/g, "_") === key);
      if (company && company.hasContact) {
        if (anyVisible) a.classList.remove("visible");
        else a.classList.add("visible");
      }
    });
  });

  massSendBtn.addEventListener("click", () => {
    const toSend = companies.filter((c) => c.hasContact && c.email && selectedKeys.has(companyKey(c)));
    if (!toSend.length) {
      log("Aucune entreprise s\u00e9lectionn\u00e9e avec un e-mail.");
      return;
    }
    let sent = 0;
    for (const company of toSend) {
      const body = getMailForCompany(company);
      const subject = `Votre enseigne et votre signal\u00e9tique \u2014 ${company.name}`;
      const mailto = `mailto:${company.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      const a = document.createElement("a");
      a.href = mailto;
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
      sent += 1;
    }
    log(`${sent} fen\u00eatre(s) mailto ouverte(s). V\u00e9rifiez et envoyez depuis votre client mail.`);
  });

  runBtn.addEventListener("click", run);
  csvBtn.addEventListener("click", exportCsv);
  previewMailBtn.addEventListener("click", previewMail);
  saveTemplateBtn.addEventListener("click", saveTemplate);
  [senderName, senderEmail, senderPhone].forEach((input) => input.addEventListener("change", saveSender));

  const scrollTopBtn = document.getElementById("scrollTopBtn");
  window.addEventListener("scroll", () => {
    scrollTopBtn.classList.toggle("visible", window.scrollY > 400);
  }, { passive: true });
  scrollTopBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  loadSender();
  loadTemplate();
  loadSectors();
})();
