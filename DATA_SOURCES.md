# Datenquellen – Prüfergebnis

Stand: 2026-10-10, Tests zwischen 16:15 und 16:30 MESZ (Samstagnachmittag).
Getestet mit curl. Der CORS-Zugriff des Favoriten wurde zusätzlich in einem echten Browser geprüft (`fetch` von `https://example.com` aus).

Anforderungen:

1. Live-Fahrzeugpositionen, keine Interpolation aus statischen Fahrplänen
2. CORS-Zugriff direkt aus dem Browser
3. akzeptables Rate Limit
4. stabil erreichbar

## Übersicht

| Quelle | Positionen | CORS | Rate Limit | Erreichbar | Ergebnis |
|---|---|---|---|---|---|
| `v6.vbb.transport.rest/radar` | ja (HAFAS-Radar), laut Doku | ja, laut Doku | 100 Anfragen/min (Doku) | **nein**: jede Datenanfrage im Timeout (20–30 s) | ❌ derzeit unbrauchbar |
| `v6.bvg.transport.rest/radar` | ja (HAFAS-Radar), laut Doku | ja, laut Doku | 100 Anfragen/min (Doku) | **nein**: immer HTTP 503 | ❌ derzeit unbrauchbar |
| `v5.vbb.transport.rest`, `v6.db.transport.rest` | – | – | – | Timeout bzw. 503 | ❌ |
| VBB GTFS-RT `production.gtfsrt.vbb.de/data` | **0 VehiclePositions** | ✅ `*` | 60 Anfragen/min | ✅ ca. 1 s | ❌ keine Positionen |
| gtfs.de `realtime.gtfs.de/realtime-free.pb` | **0 VehiclePositions** | ❌ kein Header | nicht angegeben | ✅ | ❌ |
| BVG-HAFAS-Gate `bvg.hafas.cloud/apps/gate` (`JourneyGeoPos`) | ✅ ca. 97 Fahrzeuge pro 2,5-km-Box, mit Frames | ✅ `*`, im Browser bestätigt | **nicht dokumentiert** | ✅ ca. 300 ms | ⚠️ technisch ja, mit erheblichen Vorbehalten |

## Details

### transport.rest (v6.vbb / v6.bvg)

- Laut Doku: `GET /radar?north&west&south&east&results&duration&frames&polylines`. Das ist ein Wrapper um `hafasClient.radar()`. Die Doku nennt CORS, ETag und ein Limit von 100 Anfragen/min.
- Die Startseiten (Doku) antworten sofort mit HTTP 200. **Alle Datenendpunkte** (`/radar`, `/stops/:id`, `/locations`) sind ausgefallen:
  - `v6.vbb`: Timeout bei jeder Anfrage. Kein Byte nach 20–30 s.
  - `v6.bvg`, `v6.db`: HTTP 503 nach ca. 10 s.
- Dauertest: 8 Radar-Anfragen pro Host im Abstand von ca. 50 s (16:22–16:29). **0 von 16 erfolgreich**: alle 8 `v6.vbb`-Anfragen liefen in den Timeout, alle 8 `v6.bvg`-Anfragen endeten mit 503.
- Die UptimeRobot-Statusseite meldet für die letzten 14 Tage fast 100 % (90 Tage: vbb 90,4 %, bvg 95,4 %). Der Monitor prüft also offensichtlich nur die Startseite.
- [derhuerst/vbb-rest#70](https://github.com/derhuerst/vbb-rest/issues/70) (Sept. 2026): 502/503 auf allen Datenendpunkten, über Tage nur „sehr seltene 200er“. Das Issue wurde geschlossen, der Fehler tritt aber erneut auf.
- **Fazit:** Auf dem Papier ideal, praktisch derzeit nicht nutzbar.

### VBB GTFS-Realtime (offiziell)

- `https://production.gtfsrt.vbb.de/data`: CORS `*`, ETag, CC-BY 4.0, ohne Authentifizierung, 60 Anfragen/min, ein aussagekräftiger User-Agent wird erbeten.
- Drei Snapshots dekodiert: jeweils **6.690 TripUpdates, 0 VehiclePositions, 0 Alerts**.
- Größe: 7,25 MB pro Abruf, mit gzip 1,55 MB. Gefiltert nach Bounding Box kann nicht werden.
- Die Betreiberseite meldet eingeschränkte Datenabdeckung seit 2026-06-04, ohne Termin für die Behebung.
- **Fazit:** Verletzt die Kernbedingung. Positionen ließen sich nur aus TripUpdates und dem Fahrplan interpolieren, und genau das ist ausgeschlossen.

### gtfs.de

- `https://realtime.gtfs.de/realtime-free.pb`: 29,6 MB, 49.406 TripUpdates, 63.516 Alerts, **0 VehiclePositions**, kein CORS-Header.
- **Fazit:** ungeeignet.

### BVG-HAFAS-Gate (`JourneyGeoPos`)

Das ist das Backend der BVG-Web-App. Das Open-Source-Projekt `hafas-client` nutzt es im BVG-Profil: Client-Typ `WEB`, Kennung `VBB`/`webapp`, `ver 1.72`, `ext BVG.1`, öffentlich bekannte AID. transport.rest ruft intern genau diese Schnittstelle auf.

Testergebnisse:

- `POST https://bvg.hafas.cloud/apps/gate` mit `JourneyGeoPos` und einer Box von ca. 5 × 5 km rund um den Alexanderplatz: HTTP 200 in ca. 300 ms, ca. 235 KB, **96–98 Fahrzeuge** (S, U, Tram, Bus, RB).
- Eine größere Box (0,15° × 0,30°) mit `maxJny=1000` liefert 739 Fahrzeuge in ca. 1 s und 1,5 MB. `maxJny` begrenzt die Anzahl wie erwartet.
- Pro Fahrzeug: Position (`pos`, Mikrograd), Linie, Richtung, Halte mit Soll- und Ist-Zeiten (`aTimeR`/`dTimeR`) sowie **Bewegungsframes** (`ani.mSec` = 0/10/20/30 s, `ani.polyG` = Polylinie). Genau das braucht die flüssige Animation.
- **CORS:** Preflight (OPTIONS) und POST antworten mit `access-control-allow-origin: *`. Im echten Browser liefert `fetch` lesbares JSON.
  - Die alte URL `bvg-apps-ext.hafas.de/bin/mgate.exe` leitet per 307 weiter. Diese Weiterleitung scheitert im Browser am Preflight („Failed to fetch“). Die App muss deshalb direkt `bvg.hafas.cloud` ansprechen.
- 6 Anfragen kurz hintereinander: kein Throttling. Es gibt keine Rate-Limit- oder Retry-Header.

#### ⚠️ Vorbehalte

1. **Die Positionen sind serverseitig berechnet, nicht per GPS gemeldet.** HAFAS rechnet sie aus den *Echtzeit*-Prognosen (Ist-Zeiten an den Halten) entlang der Streckengeometrie (`trainPosMode: CALC`; `proc` = Fortschritt zwischen zwei Halten).
   - `REPORT_ONLY` und `CALC_REPORT` liefern exakt dieselben Positionen (98 von 98 identisch). Es gibt also keinen Modus mit „echten“ Meldepositionen.
   - Alle Fahrzeuge im Test hatten Echtzeit-Zeiten. Ein Fahrzeug ist damit nicht schlicht nach Fahrplan positioniert. Zwischen den Halten ist die Position aber eine Interpolation, die HAFAS selbst vornimmt.
   - Das gilt für **jede** HAFAS-Radar-Schnittstelle, auch für transport.rest/radar.
2. **Inoffiziell und nicht dokumentiert.** Für Dritte gibt es keine Nutzungsbedingungen. Die Schnittstelle kann jederzeit brechen, etwa wenn AID oder `ver` rotieren oder CORS eingeschränkt wird.
3. **Kein Rate Limit veröffentlicht.** Bekannt ist nur, dass 6 Anfragen in Folge nicht gedrosselt wurden. Ein Abruf alle 20–30 s pro Besucher ist vermutlich unkritisch, aber nicht zugesichert.
4. **Keine explizite Datenlizenz.** CC-BY 4.0 gilt für die VBB-GTFS- und GTFS-RT-Daten, nicht für diese Schnittstelle. Namensnennung wäre „Daten: BVG/VBB (HAFAS)“, die Rechtsgrundlage bleibt aber unklar.
5. **Datenfluss:** Der Browser jedes Besuchers schickt die (gerundete) Bounding Box direkt an den Server von BVG/HaCon.
6. **Stabilität nur über Minuten getestet**, nicht über Stunden oder Tage.

## Ergebnis

Eine **offizielle, dokumentierte** Quelle, die alle Bedingungen erfüllt, gibt es derzeit nicht:

- Die offenen GTFS-RT-Feeds enthalten keine Positionen.
- Die transport.rest-Instanzen sind ausgefallen.

Technisch erfüllt nur das **inoffizielle BVG-HAFAS-Gate** alle Bedingungen: Positionen mit Frames, CORS, schnell, Abfrage per Bounding Box. Es bringt aber die oben genannten Vorbehalte mit, zu Nutzungsrecht, Lizenz, Stabilität und Art der Positionen.

**Offene Entscheidung:**

- Sollen wir das BVG-HAFAS-Gate trotz der unklaren Nutzungs- und Lizenzlage verwenden?
- Optional mit transport.rest/radar als zweitem Adapter, sobald die Instanzen wieder laufen.
- Oder ist das für dich ein Workaround, und wir halten hier an?

## Nachtrag: Entscheidung und Format (2026-10-10)

Entscheidung: Standardquelle ist das **BVG-HAFAS-Gate**. Als zweiter Adapter sind **transport.rest** `/radar` (`v6.vbb` und `v6.bvg`) eingebunden. Die Vorbehalte oben gelten weiter und stehen auch im README.

Antwortformat von `JourneyGeoPos`, wie es der Adapter nutzt:

- `res.jnyL[].pos`: aktuelle Position in Mikrograd (`x` = Länge, `y` = Breite)
- `res.jnyL[].ani.mSec`: Frame-Zeitpunkte relativ zur Anfragezeit (`res.date`/`res.time`, Berliner Ortszeit; das ist ein Echo der gesendeten Zeit)
- `res.jnyL[].ani.polyG.polyXL[0]` → `res.common.polyL[i].crdEncYX`: Google-kodierte Polylinie mit **genau einem Punkt pro Frame**
- `res.common.prodL[prodX].cls`: Produkt-Bitmaske (1 S, 2 U, 4 Tram, 8 Bus, 16 Fähre, 32 Fernzug, 64 Regionalzug)

Abfrage: `perSize` 35 s, `perStep` 5 s, also 8 Frames. Abfrage alle 25 s, damit sich die Frame-Fenster überlappen.

Im Browser bestätigt: Abfragen kommen im 25-s-Takt, auch wenn der Tab häufig zwischen sichtbar und versteckt wechselt.
