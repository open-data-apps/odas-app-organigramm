/*
- Diese Funktion ist für die Inhalte der Startseite
- zuständig.
-
- Der umschließende HTML Code ist:
-      <body>
-      <div class="container mt-4" id="main-content">
-          ...
-      </div>
-      </body>
- Als CSS Framework wird Bootstrap 5.3 verwendet.
-
- configdata ist ein JSON, das die Referenz auf die Daten im CKAN Open Data Portal enthält:
-     {
-         "apiurls": [
-             { "name": "organigramm", "label": "URL zu den Daten", "url": "https://dein-open-data-portal.de/dataset/beispiel.json" }
-         ]
-     }
-
- @param {Object} configdata - Alle Konfigurationsdaten der App
- @enclosingHtmlDivElement - HTML Knoten des umschließenden Tags
- @returns {string | NULL} - darzustellendes HTML oder NULL, wenn direkt in den Knoten geschrieben wird
*/
let ogInstanzZaehler = 0;

// OG-B1: Instanz-Registry je Container. Die App hatte keinen Lifecycle-Schutz:
// eine spaete .then-Fortsetzung leerte `#main-content` und baute das Organigramm
// in die inzwischen sichtbare naechste Seite.
const ogInstanzen = new Map();

function onPageLeave() {
  ogInstanzen.forEach(function (zustand) {
    try {
      zustand.abmelden();
    } catch (error) {
      console.warn("Fehler beim Abraeumen der Organigramm-Instanz:", error);
    }
  });
  ogInstanzen.clear();
}

function ogVerworfen(root) {
  const zustand = (root && ogInstanzen.get(root)) || null;
  return !zustand || zustand.disposed;
}

function escapeHtml(str) {
  const s = String(str ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Laesst nur http- und https-URLs durch. Ohne diese Pruefung wuerde eine
// javascript:-URL aus der Datenquelle beim Klick ausgefuehrt.
function safeUrl(value = "") {
  try {
    const url = new URL(String(value), window.location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function renderWeitereInfos(configdata) {
  const links = (configdata.weiterfuehrendeLinks || "").trim();
  if (!links) return "";
  return (
    '<section class="og-weitere-infos mt-4">' +
    '<h2 class="h5 mb-3">Weitere Informationen</h2>' +
    '<div class="og-weitere-infos-content">' +
    links +
    "</div></section>"
  );
}

function renderMethodikbox(configdata) {
  const methodik = String(configdata.datenquelleHinweis || "").trim();
  if (!methodik) return "";
  return (
    '<section class="og-methodik mt-4">' +
    '<h2 class="h5 mb-3">Methodik / Datenquelle</h2>' +
    '<div class="og-methodik-content">' +
    methodik +
    "</div></section>"
  );
}

function formatDatenStandLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^stand\s*:/i.test(text) ? text : "Stand: " + text;
}

function isOdasProxyEnabled(configdata = {}) {
  return String(configdata.proxyAktiv || "").trim().toLowerCase() === "ja";
}

function extractPathFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.pathname + parsedUrl.search;
  } catch (_error) {
    return String(url || "");
  }
}

function getOdasAppBasePath(pathname) {
  let appPath =
    pathname === undefined
      ? typeof window !== "undefined"
        ? window.location.pathname
        : "/"
      : String(pathname || "/");

  if (!appPath.endsWith("/")) {
    const lastSlashIndex = appPath.lastIndexOf("/");
    const lastSegment = appPath.substring(lastSlashIndex + 1);
    if (lastSegment.includes(".")) {
      appPath = appPath.substring(0, lastSlashIndex + 1);
    }
  }

  return appPath.replace(/\/+$/, "");
}

function getOdasProxyEndpoint(targetUrl, pathname) {
  const appPath = getOdasAppBasePath(pathname);
  return `${appPath}/odp-data?path=${encodeURIComponent(targetUrl)}`;
}

async function fetchViaOdasProxy(targetUrl, options = {}) {
  if (typeof isKeineDatenquelleKonfiguriert === "function" && isKeineDatenquelleKonfiguriert(targetUrl)) {
    throw new Error("Keine Datenquelle konfiguriert.");
  } else if (typeof isKeineDatenquelleKonfiguriert !== "function") {
    const v = String(targetUrl || "").trim();
    if (!v || /^\{\{.*\}\}$/.test(v) || /^<.*>$/.test(v)) throw new Error("Keine Datenquelle konfiguriert.");
  }

  const response = await fetch(getOdasProxyEndpoint(targetUrl), {
    method: "POST",
    signal: options && options.signal ? options.signal : undefined,
  });

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch (_e) {}
    const originHint = /origin not allowed/i.test(body) ? " – URL origin not allowed" : "";
    throw new Error(`ODAS-Proxy-Fehler: HTTP ${response.status}${originHint}`);
  }

  const proxyData = await response.json();
  if (!proxyData || typeof proxyData.content !== "string") {
    throw new Error("ODAS-Proxy-Antwort enthält keinen content-String.");
  }

  return proxyData.content;
}

async function fetchOdasResource(targetUrl, configdata = {}, options = {}) {
  if (isOdasProxyEnabled(configdata)) {
    return fetchViaOdasProxy(targetUrl, options);
  }

  try {
    const response = await fetch(targetUrl, {
      signal: options && options.signal ? options.signal : undefined,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    throw new Error(
      `Direkter Datenabruf fehlgeschlagen (${error.message}). Bitte prüfen Sie die Daten-URL und die CORS-Freigabe der Datenquelle.`,
    );
  }
}

/**
 * Löst eine benannte Datenressource aus configdata.apiurls auf.
 * Neue apiurls-Form (typ: "array"); das frühere skalare apiurl wird nicht mehr gelesen.
 * @returns {string} getrimmte URL, oder "" für den Zustand "keine Quelle konfiguriert"
 */
function getOdasApiUrl(configdata, name) {
  const liste = Array.isArray(configdata && configdata.apiurls) ? configdata.apiurls : [];
  const treffer = liste.find((eintrag) => eintrag && eintrag.name === name);
  return String((treffer && treffer.url) || "").trim();
}

async function fetchOdasJson(targetUrl, configdata = {}, options = {}) {
  const rawContent = await fetchOdasResource(targetUrl, configdata, options);
  try {
    return JSON.parse(rawContent);
  } catch (_error) {
    throw new Error(
      `Die konfigurierte Daten-URL liefert kein JSON, sondern ${describeNonJsonPayload(rawContent)}. ` +
        "Bitte in der Instanzkonfiguration den API-Endpunkt der Datenquelle eintragen, " +
        "nicht den Datensatz- oder Download-Link.",
    );
  }
}

function describeNonJsonPayload(rawContent) {
  const text = String(rawContent == null ? "" : rawContent).trim();
  if (!text) return "eine leere Antwort";
  if (text.startsWith("<")) return "eine HTML-Seite";
  const firstLine = text.split(/\r?\n/, 1)[0];
  if (/[,;]/.test(firstLine)) return "eine CSV- oder Textdatei";
  return "unlesbaren Inhalt";
}

function isKeineDatenquelleKonfiguriert(targetUrl) {
  const quelle = String(targetUrl || "").trim();
  return !quelle || /^\{\{.*\}\}$/.test(quelle) || /^<.*>$/.test(quelle);
}


const TYP_BEZEICHNUNG = {
  "ckan-dkan-ds": "Tabellen-API mit Daten-ID",
  "ckan-ps": "Datensatz-API",
  "ckan-dl": "Datei-Download",
  "ods21": "Open-Data-Suche (API v2.1)",
  "wfs": "Kartendienst (WFS)",
  "sparql": "Wissensdatenbank (SPARQL)",
  "csv-zip": "Statische Datei"
};

function validateUrlTypErwartung(url, erwarteterTyp) {
  const u = String(url || "");
  if (!erwarteterTyp || isKeineDatenquelleKonfiguriert(u)) return null;
  const checks = {
    "ckan-dkan-ds": /\/api\/3\/action\/datastore_search\?resource_id=/i,
    "ckan-ps": /\/api\/3\/action\/package_show\?id=/i,
    "ckan-dl": /\/dataset\/.*\/resource\/.*\/download\//i,
    "ods21": /\/api\/explore\/v2\.1\//i,
    "wfs": /service=WFS/i,
    "sparql": /\/api\/ts\/v1\/kg\/sparql/i,
    "csv-zip": /\.(csv|json|zip)(\?|$)/i
  };
  const re = checks[erwarteterTyp];
  if (!re) return null;
  if (!re.test(u)) {
    const soll = TYP_BEZEICHNUNG[erwarteterTyp] || erwarteterTyp;
    return `Typ passt nicht: erwartet „${soll}", erhalten „${u.slice(0, 60)}…". Prüfen Sie den Hilfe-Tooltip bei „URLs zu Datenressourcen".`;
  }
  return null;
}

function classifyOdasFehler(error, kontext = {}) {
  const msg = String((error && error.message) || error || "");
  const url = String(kontext.url || "");
  const label = String(kontext.label || "Datenressource");
  const typLabel = String(kontext.typLabel || TYP_BEZEICHNUNG[kontext.erwarteterTyp] || "Datenquelle");
  if (/Keine Datenquelle konfiguriert/i.test(msg) || isKeineDatenquelleKonfiguriert(url)) {
    return {
      kind: "KEINE_QUELLE",
      titel: "Es ist keine Datenquelle konfiguriert.",
      hinweis: `Prüfen Sie unter „URLs zu Datenressourcen → ${label}" ob eine gültige ${typLabel}-URL eingetragen ist (Hilfe-Tooltip beachten).`,
      detail: msg,
      alertClass: "alert-info"
    };
  }
  if (/Typ passt nicht: erwartet/i.test(msg)) {
    return {
      kind: "TYP_MISMATCH",
      titel: msg,
      hinweis: `Diese App erwartet ${typLabel}. Korrigieren Sie die URL gemäß Hilfe-Tooltip (Beispiel dort).`,
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/URL origin not allowed/i.test(msg)) {
    return {
      kind: "PROXY_ORIGIN",
      titel: "ODAS-Proxy blockiert: Ziel-Origin nicht freigegeben.",
      hinweis: "Tragen Sie die Ziel-Origin als eigenen Eintrag unter „URLs zu Datenressourcen“ ein oder prüfen Sie proxyAktiv.",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/ODAS-Proxy-Fehler/i.test(msg) || /kein content-String/i.test(msg)) {
    return {
      kind: "PROXY_HTTP",
      titel: msg,
      hinweis: "Prüfen Sie proxyAktiv und Erreichbarkeit im ODAS-Live-System (lokal 404 ist normal).",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/Direkter Datenabruf fehlgeschlagen/i.test(msg) || /Failed to fetch/i.test(msg)) {
    const corsHint = /Failed to fetch/i.test(msg) ? " – vermutlich CORS blockiert → im ODAS-Live proxyAktiv=ja." : "";
    return {
      kind: "DIREKT_CORS_HTTP",
      titel: msg,
      hinweis: `Prüfen Sie URL und CORS der Quelle${corsHint}`,
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/liefert kein JSON/i.test(msg) || /HTML-Seite|CSV-|leere Antwort|unlesbaren/i.test(msg)) {
    return {
      kind: "PAYLOAD_TYP",
      titel: msg,
      hinweis: "Tragen Sie den passenden Endpunkt ein – nicht die Datensatzseite (/dataset/…) – Hilfe-Tooltip beachten.",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/CKAN.*Fehler|success:false/i.test(msg)) {
    return {
      kind: "CKAN_API",
      titel: msg,
      hinweis: "Prüfen Sie Daten-ID / Datensatz-ID (existiert die Tabelle/Datei noch auf dem Portal?).",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  if (/404|Nicht gefunden/i.test(msg)) {
    return {
      kind: "HTTP_404",
      titel: msg,
      hinweis: "Ressource/Datensatz auf dem Portal nicht gefunden (404).",
      detail: msg,
      alertClass: "alert-danger"
    };
  }
  return {
    kind: "UNBEKANNT",
    titel: msg || "Unbekannter Fehler beim Laden.",
    hinweis: "Prüfen Sie Konfiguration und Erreichbarkeit der Quelle.",
    detail: msg,
    alertClass: "alert-danger"
  };
}

function renderOdasFehler(container, error, kontext = {}) {
  if (!container) return;
  const typWarn = validateUrlTypErwartung(kontext.url, kontext.erwarteterTyp);
  if (typWarn && !/Typ passt nicht/i.test(String(error && error.message))) {
    error = new Error(typWarn);
  }
  const info = classifyOdasFehler(error, kontext);
  const url = String(kontext.url || "");
  const urlZeile = url ? `<p class="mb-1 small text-muted">Konfigurierte URL: <code>${escapeHtml(url.length > 80 ? url.slice(0, 80) + "…" : url)}</code></p>` : "";
  const titel = kontext.leer ? "Keine Datensätze gefunden." : info.titel;
  const alertClass = kontext.leer ? "alert-info" : info.alertClass;
  container.innerHTML = `<div class="alert ${alertClass}" role="alert"><strong>${escapeHtml(titel)}</strong><p class="mb-1">${escapeHtml(info.hinweis)}</p>${urlZeile}<details class="small"><summary>Details</summary><code>${escapeHtml(info.detail || String(error))}</code></details></div>`;
}


function app(configdata = {}, enclosingHtmlDivElement) {
  const ogUid = "i" + ++ogInstanzZaehler;
  const quelle = getOdasApiUrl(configdata, "organigramm");
  if (!quelle || /^\{\{.*\}\}$/.test(quelle) || /^<.*>$/.test(quelle)) {
    renderOdasFehler(
      enclosingHtmlDivElement,
      new Error("Keine Datenquelle konfiguriert."),
      {
        url: quelle,
        label: "Organigramm-API",
        typLabel: "Datei-Download",
        erwarteterTyp: "ckan-dl",
      },
    );
    return;
  }

  // Variante A (F-92): Typprüfung vor dem ersten Fetch.
  const ogTypWarn = validateUrlTypErwartung(quelle, "ckan-dl");
  if (ogTypWarn) {
    renderOdasFehler(enclosingHtmlDivElement, new Error(ogTypWarn), {
      url: quelle,
      label: "Organigramm-API",
      typLabel: "Datei-Download",
      erwarteterTyp: "ckan-dl",
    });
    return;
  }

  // Container leeren und Ladeindikator anzeigen
  enclosingHtmlDivElement.innerHTML = "";
  const loader = document.createElement("div");
  loader.className = "spinner-border text-primary";
  loader.setAttribute("role", "status");
  loader.innerHTML = '<span class="visually-hidden">Lade Daten...</span>';
  enclosingHtmlDivElement.appendChild(loader);

  // OG-B1: Zustand und Teardown SOFORT registrieren — vor dem Abruf.
  const zustand = {
    disposed: false,
    controller: new AbortController(),
    timeoutId: null,
    abmelden: function () {
      this.disposed = true;
      this.controller.abort();
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
    },
  };
  const ogVorheriger = ogInstanzen.get(enclosingHtmlDivElement);
  if (ogVorheriger) {
    try {
      ogVorheriger.abmelden();
    } catch (_e) {}
  }
  ogInstanzen.set(enclosingHtmlDivElement, zustand);

  // OG-B2: Ohne Timeout drehte der Spinner bei haengendem Portal unbegrenzt.
  const OG_REQUEST_TIMEOUT_MS = 30000;
  zustand.timeoutId = setTimeout(() => {
    zustand.controller.abort();
  }, OG_REQUEST_TIMEOUT_MS);

  // Daten laden: direkt oder ueber den ODAS-Proxy (proxyAktiv)
  fetchOdasJson(getOdasApiUrl(configdata, "organigramm"), configdata, {
    signal: zustand.controller.signal,
  })
    .then((data) => {
      if (zustand.timeoutId) {
        clearTimeout(zustand.timeoutId);
        zustand.timeoutId = null;
      }
      // OG-B1: Nach einem Seitenwechsel nichts mehr in den fremden Container schreiben.
      if (ogVerworfen(enclosingHtmlDivElement)) return;
      // Daten im lokalen Scope speichern (für Services- und Personen-Lookup)
      const globalData = data;
      // Ladeindikator entfernen
      enclosingHtmlDivElement.innerHTML = "";

      const datenStandText = String(configdata.datenStand || "").trim();
      if (datenStandText) {
        const frischeDiv = document.createElement("div");
        frischeDiv.className = "text-muted small text-end mb-2";
        frischeDiv.textContent = formatDatenStandLabel(datenStandText);
        enclosingHtmlDivElement.appendChild(frischeDiv);
      }

      // Prüfen, ob Organigramm-Daten vorhanden sind (jetzt "organigramm")
      if (!globalData.organigramm || globalData.organigramm.length === 0) {
        enclosingHtmlDivElement.innerHTML = "<p>Keine Daten gefunden.</p>";
        return;
      }

      // Navigation für die oberste Ebene erstellen (Organigramm-Bereiche + zusätzlicher Tab "Personen-Suche")
      const nav = document.createElement("ul");
      nav.className = "nav nav-tabs";
      // Organigramm-Bereiche
      globalData.organigramm.forEach((bereich, index) => {
        const li = document.createElement("li");
        li.className = "nav-item";
        const a = document.createElement("a");
        a.className = "nav-link" + (index === 0 ? " active" : "");
        a.href = "#";
        a.textContent = bereich.name;
        a.addEventListener("click", (e) => {
          e.preventDefault();
          // Aktive Tab-Markierung updaten
          nav
            .querySelectorAll(".nav-link")
            .forEach((link) => link.classList.remove("active"));
          a.classList.add("active");
          // Bei Auswahl eines Bereichs: zeige dessen "ebene"
          showEbene(bereich.ebene);
        });
        li.appendChild(a);
        nav.appendChild(li);
      });
      // Zusätzlicher Tab für Personen-Suche
      const liSearch = document.createElement("li");
      liSearch.className = "nav-item";
      const aSearch = document.createElement("a");
      aSearch.className = "nav-link";
      aSearch.href = "#";
      aSearch.textContent = "Personen-Suche";
      aSearch.addEventListener("click", (e) => {
        e.preventDefault();
        nav
          .querySelectorAll(".nav-link")
          .forEach((link) => link.classList.remove("active"));
        aSearch.classList.add("active");
        searchPersonen(); // Aufruf der neuen Suche-Funktion
      });
      liSearch.appendChild(aSearch);
      nav.appendChild(liSearch);

      enclosingHtmlDivElement.appendChild(nav);

      // Container für die Anzeige des Organigramms bzw. der Suchseite
      const contentContainer = document.createElement("div");
      contentContainer.id = "organigram-container";
      contentContainer.className = "mt-3";
      enclosingHtmlDivElement.appendChild(contentContainer);

      // Initial: Zeige die erste "ebene" des ersten Organigramm-Bereichs
      showEbene(globalData.organigramm[0].ebene);

      const methodikHTML = renderMethodikbox(configdata);
      if (methodikHTML) {
        const methodikDiv = document.createElement("div");
        methodikDiv.innerHTML = methodikHTML;
        enclosingHtmlDivElement.appendChild(methodikDiv);
      }

      const weitereInfosHTML = renderWeitereInfos(configdata);
      if (weitereInfosHTML) {
        const weitereDiv = document.createElement("div");
        weitereDiv.innerHTML = weitereInfosHTML;
        enclosingHtmlDivElement.appendChild(weitereDiv);
      }

      // Funktion: Zeige eine Liste von Einträgen der aktuellen Ebene
      function showEbene(items) {
        displayList(items, null);
      }

      // Zeigt eine Liste von Einträgen (als Buttons) für die aktuelle Hierarchieebene.
      // parent ist null für die oberste Ebene.
      function displayList(items, parent) {
        contentContainer.innerHTML = "";
        if (parent) {
          const backButton = document.createElement("button");
          backButton.className = "btn btn-secondary mb-3";
          backButton.textContent = "Zurück";
          backButton.addEventListener("click", function () {
            displayDetail(parent);
          });
          contentContainer.appendChild(backButton);
        }
        const listGroup = document.createElement("div");
        listGroup.className = "list-group";
        items.forEach((item) => {
          const listItem = document.createElement("button");
          listItem.className = "list-group-item list-group-item-action";
          listItem.textContent = item.titel || "";
          listItem.addEventListener("click", () => {
            item._parent = parent;
            displayDetail(item);
          });
          listGroup.appendChild(listItem);
        });
        contentContainer.appendChild(listGroup);
      }

      // Zeigt die Detailansicht eines Eintrags (Organigramm-Eintrag), inkl. fest definierter Tabs.
      function displayDetail(item) {
        contentContainer.innerHTML = "";
        if (item._parent) {
          const backButton = document.createElement("button");
          backButton.className = "btn btn-secondary mb-3";
          backButton.textContent = "Zurück";
          backButton.addEventListener("click", function () {
            displayDetail(item._parent);
          });
          contentContainer.appendChild(backButton);
        }
        const card = document.createElement("div");
        card.className = "card mb-3";
        const cardBody = document.createElement("div");
        cardBody.className = "card-body";
        const header = document.createElement("h5");
        header.className = "card-title";
        header.textContent = item.titel || "";
        cardBody.appendChild(header);

        // Feste Tabs: Kontakt/Beschreibung, Services, Personen
        const tabNav = document.createElement("ul");
        tabNav.className = "nav nav-tabs";
        const tabContent = document.createElement("div");
        tabContent.className = "tab-content";

        // Tab 1: Kontakt/Beschreibung
        const tabId0 = "og-tab-" + ogUid + "-kontakt";
        const li0 = document.createElement("li");
        li0.className = "nav-item";
        const a0 = document.createElement("a");
        a0.className = "nav-link active";
        a0.setAttribute("data-bs-toggle", "tab");
        a0.href = "#" + tabId0;
        a0.textContent = "Kontakt/Beschreibung";
        li0.appendChild(a0);
        tabNav.appendChild(li0);
        const tabPane0 = document.createElement("div");
        tabPane0.className = "tab-pane fade show active";
        tabPane0.id = tabId0;
        let beschreibungHTML = "";
        if (Array.isArray(item.beschreibung)) {
          beschreibungHTML = item.beschreibung.map(escapeHtml).join("<br>");
        }
        let kontaktHTML = "";
        if (item.kontakt) {
          kontaktHTML =
            "<p><strong>Telefon:</strong> " +
            escapeHtml(item.kontakt.telefon || "") +
            "<br>" +
            "<strong>Email:</strong> " +
            escapeHtml(item.kontakt.email || "") +
            "<br>" +
            "<strong>Fax:</strong> " +
            escapeHtml(item.kontakt.fax || "") +
            "</p>";
        }
        tabPane0.innerHTML = beschreibungHTML + kontaktHTML;
        tabContent.appendChild(tabPane0);

        // Tab 2: Services
        const tabId1 = "og-tab-" + ogUid + "-services";
        const li1 = document.createElement("li");
        li1.className = "nav-item";
        const a1 = document.createElement("a");
        a1.className = "nav-link";
        a1.setAttribute("data-bs-toggle", "tab");
        a1.href = "#" + tabId1;
        a1.textContent = "Services";
        li1.appendChild(a1);
        tabNav.appendChild(li1);
        const tabPane1 = document.createElement("div");
        tabPane1.className = "tab-pane fade";
        tabPane1.id = tabId1;
        let servicesHTML = "";
        if (item["service-id"] && Array.isArray(item["service-id"]) && Array.isArray(globalData.services)) {
          item["service-id"].forEach((id) => {
            const service = globalData.services.find((s) => s.id === id);
            if (service) {
              const serviceUrl = safeUrl(service.url);
              servicesHTML +=
                "<p><strong>" +
                escapeHtml(service.titel) +
                "</strong><br>" +
                escapeHtml(service.beschreibung) +
                "<br>" +
                (serviceUrl
                  ? '<a href="' +
                    escapeHtml(serviceUrl) +
                    '" target="_blank" rel="noopener">Mehr Infos</a>'
                  : "") +
                "</p>";
            }
          });
        }
        tabPane1.innerHTML = servicesHTML || "<p class=\"text-muted\">Keine Service-Informationen vorhanden.</p>";
        tabContent.appendChild(tabPane1);

        // Tab 3: Personen
        const tabId2 = "og-tab-" + ogUid + "-personen";
        const li2 = document.createElement("li");
        li2.className = "nav-item";
        const a2 = document.createElement("a");
        a2.className = "nav-link";
        a2.setAttribute("data-bs-toggle", "tab");
        a2.href = "#" + tabId2;
        a2.textContent = "Personen";
        li2.appendChild(a2);
        tabNav.appendChild(li2);
        const tabPane2 = document.createElement("div");
        tabPane2.className = "tab-pane fade";
        tabPane2.id = tabId2;
        let personenHTML = "";
        if (item["personen-id"] && Array.isArray(item["personen-id"]) && Array.isArray(globalData.personen)) {
          item["personen-id"].forEach((id) => {
            const person = globalData.personen.find((p) => p.id === id);
            if (person) {
              personenHTML +=
                "<p><strong>" +
                escapeHtml(person.name) +
                "</strong><br>" +
                escapeHtml(person.beschreibung) +
                "<br>" +
                "<strong>Telefon:</strong> " +
                escapeHtml(person.telefon || "") +
                "<br>" +
                "<strong>Email:</strong> " +
                escapeHtml(person.email || "") +
                "</p>";
            }
          });
        }
        tabPane2.innerHTML = personenHTML || "<p class=\"text-muted\">Keine Personendaten vorhanden.</p>";
        tabContent.appendChild(tabPane2);

        cardBody.appendChild(tabNav);
        cardBody.appendChild(tabContent);
        card.appendChild(cardBody);
        contentContainer.appendChild(card);

        // Untergeordnete Einträge (Stellen)
        if (item.stellen && item.stellen.length > 0) {
          const childHeader = document.createElement("h6");
          childHeader.textContent = "Stellen";
          childHeader.className = "mt-4";
          contentContainer.appendChild(childHeader);
          const childrenContainer = document.createElement("div");
          childrenContainer.className = "list-group mt-2";
          item.stellen.forEach((stelle) => {
            const childButton = document.createElement("button");
            childButton.className = "list-group-item list-group-item-action";
            childButton.textContent = stelle.titel || "";
            childButton.addEventListener("click", () => {
              stelle._parent = item;
              displayDetail(stelle);
            });
            childrenContainer.appendChild(childButton);
          });
          contentContainer.appendChild(childrenContainer);
        }
      }

      // Neue Funktion: Suche in globalData.personen und Anzeige der Ergebnisse
      // OG-B3: Ein zuvor eingegebener Suchbegriff wird beim Zurückkehren aus der
      // Detailansicht wieder eingesetzt und erneut gesucht.
      let letzterSuchbegriff = "";
      function searchPersonen() {
        contentContainer.innerHTML = "";
        // Suchformular
        const searchDiv = document.createElement("div");
        searchDiv.className = "mb-3";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "form-control";
        input.placeholder = "Nach Personen suchen...";
        // OG-B3: Suchfeld war nur über den Platzhalter benannt.
        input.setAttribute("aria-label", "Personensuche: Name oder Beschreibung");
        input.value = letzterSuchbegriff;
        searchDiv.appendChild(input);
        const searchButton = document.createElement("button");
        searchButton.className = "btn btn-primary mt-2";
        searchButton.textContent = "Suchen";
        searchDiv.appendChild(searchButton);
        contentContainer.appendChild(searchDiv);

        // Ergebnisse-Container
        const resultsContainer = document.createElement("div");
        resultsContainer.id = "og-personen-result";
        resultsContainer.className = "mt-3";
        contentContainer.appendChild(resultsContainer);

        // Event: Suche ausführen
        searchButton.addEventListener("click", function () {
          const query = input.value.trim().toLowerCase();
          letzterSuchbegriff = input.value.trim();
          performPersonSearch(query);
        });

        // Suche auch per Enter-Taste auslösen
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            searchButton.click();
          }
        });
      }

      // Filtert globalData.personen anhand des Suchbegriffs und zeigt Ergebnisse an
      function performPersonSearch(query) {
        const resultsContainer = enclosingHtmlDivElement.querySelector("#og-personen-result");
        resultsContainer.innerHTML = "";
        if (!query) {
          resultsContainer.innerHTML =
            '<div class="alert alert-info" role="alert">Bitte geben Sie einen Suchbegriff ein.</div>';
          return;
        }
        // Prüfe, ob Personen vorhanden sind
        if (!globalData.personen || !Array.isArray(globalData.personen)) {
          resultsContainer.innerHTML =
            '<div class="alert alert-info" role="alert">Keine Personendaten vorhanden.</div>';
          return;
        }
        const matches = globalData.personen.filter(
          (p) =>
            (p.name && p.name.toLowerCase().includes(query)) ||
            (p.beschreibung && p.beschreibung.toLowerCase().includes(query))
        );
        if (matches.length === 0) {
          resultsContainer.innerHTML =
            '<div class="alert alert-info" role="alert">Keine Treffer gefunden.</div>';
          return;
        }
        resultsContainer.innerHTML =
          '<p class="text-muted small mb-2">' +
          matches.length +
          " Treffer:</p>";
        const listGroup = document.createElement("div");
        listGroup.className = "list-group";
        matches.forEach((person) => {
          const item = document.createElement("button");
          item.className = "list-group-item list-group-item-action";
          item.textContent = person.name;
          // Bei Klick: Detailansicht der Person anzeigen
          item.addEventListener("click", function () {
            displayPersonDetail(person);
          });
          listGroup.appendChild(item);
        });
        resultsContainer.appendChild(listGroup);
      }

      // Zeigt eine Detailansicht einer Person aus globalData.personen
      function displayPersonDetail(person) {
        contentContainer.innerHTML = "";
        const backButton = document.createElement("button");
        backButton.className = "btn btn-secondary mb-3";
        backButton.textContent = "Zurück zur Suche";
        backButton.addEventListener("click", function () {
          searchPersonen();
        });
        contentContainer.appendChild(backButton);

        // Prüfe, ob Person gültig ist
        if (!person || !person.name) {
          const notFound = document.createElement("div");
          notFound.className = "alert alert-warning";
          notFound.textContent = "Person konnte nicht gefunden werden.";
          contentContainer.appendChild(notFound);
          return;
        }

        const card = document.createElement("div");
        card.className = "card mb-3";
        const cardBody = document.createElement("div");
        cardBody.className = "card-body";
        const header = document.createElement("h5");
        header.className = "card-title";
        header.textContent = person.name;
        cardBody.appendChild(header);
        const details = document.createElement("p");
        details.innerHTML =
          escapeHtml(person.beschreibung || "") +
          "<br><strong>Telefon:</strong> " +
          escapeHtml(person.telefon || "") +
          "<br><strong>Email:</strong> " +
          escapeHtml(person.email || "");
        cardBody.appendChild(details);
        card.appendChild(cardBody);
        contentContainer.appendChild(card);
      }
    })
    .catch((error) => {
      if (zustand.timeoutId) {
        clearTimeout(zustand.timeoutId);
        zustand.timeoutId = null;
      }
      if (ogVerworfen(enclosingHtmlDivElement)) return;
      if (error && error.name === "AbortError") {
        // Timeout (der Seitenwechsel-Fall ist oben bereits abgefangen).
        renderOdasFehler(
          enclosingHtmlDivElement,
          new Error(
            "Zeitüberschreitung: Die Datenquelle hat nicht innerhalb von 30 Sekunden geantwortet.",
          ),
          {
            url: quelle,
            label: "Organigramm-API",
            typLabel: "Datei-Download",
            erwarteterTyp: "ckan-dl",
          },
        );
        return;
      }
      console.error("Fehler beim Laden der Daten:", error);
      renderOdasFehler(enclosingHtmlDivElement, error, {
        url: quelle,
        label: "Organigramm-API",
        typLabel: "Datei-Download",
        erwarteterTyp: "ckan-dl",
      });
    });

  // Da direkt in den Knoten geschrieben wird, Rückgabewert NULL
  return null;
}

/*
- Diese Funktion kann Bibliotheken und benötigte Skripte laden.
- Sie hängt die Skripte und Stylesheets in die Head Section an.
*/
function addToHead() {
  return ``;
}
