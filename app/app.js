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
-         "apiUrl": "https://dein-open-data-portal.de/dataset/beispiel.json"
-     }
-
- @param {Object} configdata - Alle Konfigurationsdaten der App
- @enclosingHtmlDivElement - HTML Knoten des umschließenden Tags
- @returns {string | NULL} - darzustellendes HTML oder NULL, wenn direkt in den Knoten geschrieben wird
*/
function escapeHtml(str) {
  const s = String(str ?? "");
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
  return `${appPath}/odp-data?path=${encodeURIComponent(
    extractPathFromUrl(targetUrl),
  )}`;
}

async function fetchViaOdasProxy(targetUrl) {
  const response = await fetch(getOdasProxyEndpoint(targetUrl), {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`ODAS-Proxy-Fehler: HTTP ${response.status}`);
  }

  const proxyData = await response.json();
  if (!proxyData || typeof proxyData.content !== "string") {
    throw new Error("ODAS-Proxy-Antwort enthält keinen content-String.");
  }

  return proxyData.content;
}

async function fetchOdasResource(targetUrl, configdata = {}) {
  if (isOdasProxyEnabled(configdata)) {
    return fetchViaOdasProxy(targetUrl);
  }

  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  } catch (error) {
    throw new Error(
      `Direkter Datenabruf fehlgeschlagen (${error.message}). Bitte prüfen Sie die Daten-URL und die CORS-Freigabe der Datenquelle.`,
    );
  }
}

async function fetchOdasJson(targetUrl, configdata = {}) {
  return JSON.parse(await fetchOdasResource(targetUrl, configdata));
}

function app(configdata = {}, enclosingHtmlDivElement) {
  // Container leeren und Ladeindikator anzeigen
  enclosingHtmlDivElement.innerHTML = "";
  const loader = document.createElement("div");
  loader.className = "spinner-border text-primary";
  loader.setAttribute("role", "status");
  loader.innerHTML = '<span class="visually-hidden">Lade Daten...</span>';
  enclosingHtmlDivElement.appendChild(loader);

  // Daten laden: direkt oder ueber den ODAS-Proxy (proxyAktiv)
  fetchOdasJson(configdata.apiurl, configdata)
    .then((data) => {
      // Daten im globalen Scope speichern (für Services- und Personen-Lookup)
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
            item._siblingList = items;
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
        const tabId0 = "tab-" + Math.random().toString(36).substr(2, 9);
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
          beschreibungHTML = item.beschreibung.join("<br>");
        }
        let kontaktHTML = "";
        if (item.kontakt) {
          kontaktHTML =
            "<p><strong>Telefon:</strong> " +
            (item.kontakt.telefon || "") +
            "<br>" +
            "<strong>Email:</strong> " +
            (item.kontakt.email || "") +
            "<br>" +
            "<strong>Fax:</strong> " +
            (item.kontakt.fax || "") +
            "</p>";
        }
        tabPane0.innerHTML = beschreibungHTML + kontaktHTML;
        tabContent.appendChild(tabPane0);

        // Tab 2: Services
        const tabId1 = "tab-" + Math.random().toString(36).substr(2, 9);
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
        if (item["service-id"] && Array.isArray(item["service-id"])) {
          item["service-id"].forEach((id) => {
            const service = globalData.services.find((s) => s.id === id);
            if (service) {
              servicesHTML +=
                "<p><strong>" +
                service.titel +
                "</strong><br>" +
                service.beschreibung +
                "<br>" +
                (service.url
                  ? '<a href="' + service.url + '">Mehr Infos</a>'
                  : "") +
                "</p>";
            }
          });
        }
        tabPane1.innerHTML = servicesHTML;
        tabContent.appendChild(tabPane1);

        // Tab 3: Personen
        const tabId2 = "tab-" + Math.random().toString(36).substr(2, 9);
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
        if (item["personen-id"] && Array.isArray(item["personen-id"])) {
          item["personen-id"].forEach((id) => {
            const person = globalData.personen.find((p) => p.id === id);
            if (person) {
              personenHTML +=
                "<p><strong>" +
                person.name +
                "</strong><br>" +
                person.beschreibung +
                "<br>" +
                "<strong>Telefon:</strong> " +
                (person.telefon || "") +
                "<br>" +
                "<strong>Email:</strong> " +
                (person.email || "") +
                "</p>";
            }
          });
        }
        tabPane2.innerHTML = personenHTML;
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
              stelle._siblingList = item.stellen;
              displayDetail(stelle);
            });
            childrenContainer.appendChild(childButton);
          });
          contentContainer.appendChild(childrenContainer);
        }
      }

      // Neue Funktion: Suche in globalData.personen und Anzeige der Ergebnisse
      function searchPersonen() {
        contentContainer.innerHTML = "";
        // Suchformular
        const searchDiv = document.createElement("div");
        searchDiv.className = "mb-3";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "form-control";
        input.placeholder = "Nach Personen suchen...";
        searchDiv.appendChild(input);
        const searchButton = document.createElement("button");
        searchButton.className = "btn btn-primary mt-2";
        searchButton.textContent = "Suchen";
        searchDiv.appendChild(searchButton);
        contentContainer.appendChild(searchDiv);

        // Ergebnisse-Container
        const resultsContainer = document.createElement("div");
        resultsContainer.id = "personen-result";
        resultsContainer.className = "mt-3";
        contentContainer.appendChild(resultsContainer);

        // Event: Suche ausführen
        searchButton.addEventListener("click", function () {
          const query = input.value.trim().toLowerCase();
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
        const resultsContainer = document.getElementById("personen-result");
        resultsContainer.innerHTML = "";
        if (!query) {
          resultsContainer.innerHTML =
            "<p>Bitte geben Sie einen Suchbegriff ein.</p>";
          return;
        }
        // Prüfe, ob Personen vorhanden sind
        if (!globalData.personen || !Array.isArray(globalData.personen)) {
          resultsContainer.innerHTML = "<p>Keine Personendaten vorhanden.</p>";
          return;
        }
        const matches = globalData.personen.filter(
          (p) =>
            (p.name && p.name.toLowerCase().includes(query)) ||
            (p.beschreibung && p.beschreibung.toLowerCase().includes(query))
        );
        if (matches.length === 0) {
          resultsContainer.innerHTML = "<p>Keine Treffer gefunden.</p>";
          return;
        }
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
          (person.beschreibung || "") +
          "<br><strong>Telefon:</strong> " +
          (person.telefon || "") +
          "<br><strong>Email:</strong> " +
          (person.email || "");
        cardBody.appendChild(details);
        card.appendChild(cardBody);
        contentContainer.appendChild(card);
      }
    })
    .catch((error) => {
      console.error("Fehler beim Laden der Daten:", error);
      enclosingHtmlDivElement.innerHTML =
        '<div class="alert alert-danger"><strong>Fehler beim Laden:</strong> ' +
        escapeHtml(error.message) +
        "</div>";
    });

  // Da direkt in den Knoten geschrieben wird, Rückgabewert NULL
  return null;
}

/*
- Diese Funktion kann Bibliotheken und benötigte Skripte laden.
- Sie hängt die Skripte und Stylesheets in die Head Section an.
*/
function addToHead() {}
