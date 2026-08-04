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
- Datenstand-Anzeige (konfigurierbar)
- Weiterführende Links (konfigurierbar)
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

## Betriebsarten

Die App kann lokal, eigenstaendig hinter einem Traefik-Reverse-Proxy oder ueber den ODAS
betrieben werden.

### Datenabruf: `proxyAktiv`

| Wert   | Bedeutung                                                                   |
| ------ | --------------------------------------------------------------------------- |
| `nein` | Direkter Abruf der Daten-URL. Standard fuer Entwicklung und Standalone.      |
| `ja`   | Abruf ueber den ODAS-Proxy `…/odp-data`. Nur im ODAS-Live-System verfuegbar. |

Bei `nein` muss die Datenquelle CORS freigeben.

### Standalone-Betrieb

Voraussetzung: ein laufender Traefik mit dem externen Docker-Netzwerk `proxynet`,
dem EntryPoint `websecure` und dem Zertifikatsresolver `letsencrypt`.

1. In `docker-compose.standalone.yml` den Platzhalter `app1.example.com` durch den
   echten FQDN ersetzen.
2. In `odas-config/config.json` `proxyAktiv` auf `nein` belassen.
3. Starten:

```bash
STANDALONE=true make up
STANDALONE=true make logs
STANDALONE=true make down
```

Im Standalone-Betrieb entfaellt die lokale Portfreigabe; Traefik terminiert TLS und
leitet auf den internen Nginx-Port 80 weiter. Die Konfiguration wird aus derselben
`odas-config/config.json` gelesen wie in der Entwicklung und von Nginx unter `/config`
ausgeliefert.

### Beim Aufruf kontaktierte Drittanbieter

Beim Aufruf dieser App werden folgende externe Server kontaktiert:

- `cdn.jsdelivr.net` — Bootstrap (Layout- und UI-Framework)

Diese Anbieter bleiben auch im Standalone-Betrieb extern; ein vollständig autarker Betrieb ohne Internetzugang ist derzeit nicht möglich (siehe F-07 in `Review.md`).

### Auslieferung an den ODAS

`make zip` erzeugt das Liefer-ZIP mit `app/`, `assets/`, `app-package.json` und
`CHANGELOG.md`. Die Infrastrukturdateien (`Dockerfile`, `docker-compose*.yml`,
`nginx.conf`, `Makefile`) sind nicht Teil der Auslieferung.

## Autor

(C) 2025, Ondics GmbH
