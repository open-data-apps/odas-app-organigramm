# ODAS App Organigramm

Organigramm-App für den Open Data App-Store (ODAP)

Die App Organigramm bietet eine übersicht über Daten des Organigramms.

Die App ist eine "ODAP App V1".

## Systemvorraussetzungen

- Docker/Docker compose
- Make

Die Entwicklung wurde getestet unter Windows und Ubuntu

## Funktionen

Die APP ist eine Single Page Application Webapp. Mit:

- Logo Anzeige
- Menü
- Seiten für Impressum, Datenschutz, Beschreibung, Kontakt, Hauptinhalt
- Inhaltsbereich
- Anzeige der strukturierten Daten als Organigramm im Inhaltsbereich
- Personen Suchfunktion innerhalb des Organigramms
- Fußzeile

Die Konfiguration wird vom ODAS geladen.

Die APP zeigt Ihre Konfiguration im JSON Format an.

## Entwicklung

    $ make build up

Die App wird dadurch gestartet und steht auf Port 8091 zur Verfügung:

http://localhost:8091

Weil die App mit localhost gestartet wird wird die Konfiguration lokal geladen.

### Aufbau der App

Inhaltsbereich wird in app.js erstellt.

#### Desktop Version

![Alt-Text](/assets/Desktop_Screenshot.png)

![Alt-Text](/assets/Desktop_Screenshot_2.png)

## Autor

(C) 2025, Ondics GmbH
