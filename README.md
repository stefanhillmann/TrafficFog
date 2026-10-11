# Nebelkammer Berlin

Eine künstlerische Echtzeit-Visualisierung des Berliner Nahverkehrs im Stil einer Nebelkammer.

Deine Position ist die Bildmitte. Busse, Bahnen und Fähren in der Umgebung erscheinen als Teilchen. Beim Fahren hinterlassen sie Spuren aus Kondensationströpfchen, die langsam verblassen. Spurform und Farbe verraten das Verkehrsmittel, angelehnt an echte Nebelkammerspuren:

| Verkehrsmittel | Spur | Farbe |
|---|---|---|
| S-Bahn | lang, fein, gerade | kühles Hellblau |
| U-Bahn | gedämpft, unterbrochen | Violett |
| Tram | schmal, glatt, weiche Bögen | Gelb-Bernstein |
| Bus | breit, ausgefranst, unruhig, mit kurzen, sich einrollenden Seitenästen (wie Delta-Elektronen) | Rosarot |
| Regional-/Fernzug (RE, RB, ICE) | dicht, gerade, hell, mit leichtem Halo (wie ein Alpha-Teilchen) | Blassgrün-Weiß |
| Fähre | breit gestreut, gewellt, schwach | Türkis |

Die Legende zeichnet ihre Beispielspuren mit demselben Code wie die Visualisierung. Stehende Fahrzeuge verdichten den Nebel zu kleinen, langsam verblassenden Flecken. So werden Haltestellen mit der Zeit sichtbar. Die Ringe markieren je nach Radius z. B. 500 m, 1 km und 2 km.

## Bedienung

- **Radius:** Abfrage- und Anzeigebereich um deine Position (1–10 km, Vorgabe 2,5 km). Die Ringe passen sich an (z. B. 500 m / 1 km / 2 km oder 1 / 2 / 5 km). Beim Verstellen werden vorhandene Spuren mitskaliert, der neue Bereich wird nach spätestens 8 s geladen.
- **Nachleuchten:** wie lange Spuren sichtbar bleiben (1–60 min, Vorgabe 3 min)
- **unendlich:** Spuren und Haltestellen-Flecken verblassen nie
- **❚❚ / ▶:** Pause (hält auch die Abfragen an)
- **i:** Legende ein/aus
- **Auf eine Spur zeigen** (Maus) oder **antippen** (Touch): Ein kleines Feld nennt Verkehrsmittel, Linie und Fahrtrichtung, die Spur wird hervorgehoben. Bei älteren Spurstücken steht dabei, wie lange die Durchfahrt her ist und ob das Fahrzeug noch im Bereich ist.

Die Einstellungen werden lokal im Browser gespeichert.

URL-Parameter:

| Parameter | Bedeutung |
|---|---|
| `?source=bvg` | Standard: BVG-HAFAS-Radar |
| `?source=vbb-rest` / `?source=bvg-rest` | transport.rest-Instanzen (v6.vbb / v6.bvg) |
| `?source=sim` | Demo-Modus mit simulierten Fahrzeugen; `&density=1…10` vervielfacht sie (Lasttest) |
| `?at=52.5219,13.4132` | feste Mittelposition statt Geolocation (bleibt im Browser, siehe unten) |

Fällt die gewählte Quelle aus, zeigt die Statuszeile unten links das dezent an. Es gibt **keinen stillen Wechsel** auf eine andere Quelle oder auf simulierte Daten.

## Datenquelle

Details und Testergebnisse stehen in [DATA_SOURCES.md](DATA_SOURCES.md). Kurz:

- **Standard: BVG-HAFAS-Radar.** `POST https://bvg.hafas.cloud/apps/gate` mit der Methode `JourneyGeoPos`. Das ist das Backend der BVG-Web-App. Es erlaubt CORS, liefert Fahrzeuge in einer Bounding Box und dazu vorausberechnete Bewegungsframes (alle 5 s für die nächsten 35 s). Abgefragt wird alle 25 s.
- **Alternative: transport.rest** (`/radar`). Liefert dieselben HAFAS-Daten, dokumentiert und mit CORS. Zum Zeitpunkt der Entwicklung waren die Instanzen aber nicht erreichbar.
- Die offiziellen GTFS-Realtime-Feeds (VBB, gtfs.de) enthalten derzeit **keine** Fahrzeugpositionen und sind deshalb nicht eingebunden.

**Wichtig:** Die HAFAS-Positionen sind keine GPS-Meldungen. HAFAS berechnet sie serverseitig aus den Echtzeit-Prognosen (Ist-Zeiten an den Halten) entlang der Strecke. Die App selbst interpoliert nicht aus Fahrplandaten. Zwischen zwei Abfragen nutzt sie die gelieferten Frames, ohne Frames schreibt sie höchstens 4 s linear fort.

### Lizenz und Namensnennung der Daten

- Fahrzeugdaten: **BVG / VBB**, bereitgestellt über HAFAS (HaCon). Die BVG-Schnittstelle ist inoffiziell und nicht dokumentiert. Eine ausdrückliche Lizenz für die Nutzung durch Dritte gibt es nicht. Die App nennt die Quelle in der Fußzeile.
- transport.rest: Projekt von Jannis R ([transport.rest](https://transport.rest)). Die Daten stammen ebenfalls von VBB/BVG.
- Das BVG-Profil (Endpoint, Client-Kennung) stammt aus dem Open-Source-Projekt [hafas-client](https://github.com/public-transport/hafas-client).

## Datenschutz: Welche Daten verlassen den Browser?

- **Standort:** Die Geolocation-API fragt nach Erlaubnis. Wird sie verweigert, ist der Alexanderplatz die Mitte, und ein Hinweis erscheint.
- Die **genaue Position verlässt den Browser nicht.** Sie dient nur der lokalen Projektion.
- An die Datenquelle geht **nur eine Bounding Box** im eingestellten Radius (1–10 km) um die Position. Deren Mitte ist auf 3 Nachkommastellen gerundet (≈ 110 m × 70 m), die Kanten ebenfalls. Bei der BVG-Quelle gehen außerdem Datum und Uhrzeit der Abfrage mit.
- Wie bei jeder Webanfrage sehen die Server deine **IP-Adresse** und den User-Agent. Je nach Quelle sind das BVG/HaCon (`bvg.hafas.cloud`) oder transport.rest. Cookies und Referrer werden nicht mitgeschickt (`credentials: 'omit'`, `no-referrer`).
- Auch `?at=…` bleibt lokal. Gerundet wird genauso.
- In `localStorage` liegen nur die Anzeigeeinstellungen. Es gibt keine Analyse und keine weiteren Dienste.

## Lokale Entwicklung

Voraussetzung: Node.js 22.12+ oder 24+.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # Vitest
npm run build        # Typprüfung und Build nach dist/
```

Für die Entwicklung ohne Netz eignet sich `http://localhost:5173/?source=sim`.

### Struktur

```
src/
  types.ts              Vehicle, Mode, VehicleSource (Adapter-Schnittstelle)
  geo.ts                Projektion, Rundung, Bounding Box, Polylinien-Dekodierung
  motion.ts             Positionsschätzung aus Frames bzw. Fortschreibung
  fleet.ts              verfolgte Fahrzeuge, weiche Korrektur, Halt-Erkennung
  poller.ts             Abfrage-Takt, Backoff, Status
  trailIndex.ts         Spurverlauf für das Zeigen auf Spuren (Treffersuche)
  sources/
    registry.ts         alle Quellen; hier werden neue eingetragen
    hafas.ts            generischer HAFAS-JourneyGeoPos-Adapter + BVG-Profil
    transportRest.ts    transport.rest /radar
    sim.ts              simulierte Fahrzeuge
  render/
    scene.ts            Zusammensetzen der Ebenen, Ringe, eigene Position
    trails.ts           Spur-Canvas mit Tröpfchen, Strichelung, Delta-Ästen
    fog.ts              driftender Nebel, Haltestellen-Verdichtungen
    fader.ts            destination-out-Ausblendung ohne 8-Bit-Geisterspuren
    styles.ts           Spurcodierung je Verkehrsmittel
```

### Eine neue Datenquelle hinzufügen

1. Eine Datei unter `src/sources/` anlegen, die `VehicleSource` implementiert (siehe `src/types.ts`):
   - `fetchVehicles(bbox, signal)` liefert `Vehicle[]` mit `id`, `mode`, `line`, `lat`, `lon`, `timestamp` und optional `frames` (absolute Zeitpunkte).
   - Fehler werden als `SourceError` geworfen. Der Poller zeigt sie an, und die Animation läuft weiter.
   - `pollIntervalMs` legt fest, wie oft die Quelle höchstens abgefragt wird.
2. In `src/sources/registry.ts` einen Eintrag ergänzen. Der Schlüssel ist der Wert für `?source=…`.
3. Für einen weiteren HAFAS-Verbund mit Radar-Unterstützung genügt ein neues `HafasProfile` für `createHafasRadarSource`.
4. Parser-Tests mit einer echten, gekürzten Antwort unter `tests/fixtures/` anlegen.

## Deployment

`.github/workflows/deploy.yml` testet und baut bei jedem Push. Pushes auf `main` werden auf GitHub Pages veröffentlicht.

Einmalig nötig: unter *Settings → Pages* als Quelle „GitHub Actions“ wählen. Die Seite nutzt relative Pfade und läuft deshalb auch unter `https://<user>.github.io/<repo>/`.

## Bekannte Einschränkungen

- **Inoffizielle Hauptquelle.** Die BVG-HAFAS-Schnittstelle kann sich jederzeit ändern oder CORS einschränken, etwa wenn sich Client-Kennung oder `ver` ändern. Rate Limits sind nicht veröffentlicht. Die App fragt pro Besucher alle 25 s ab und pausiert, solange der Tab im Hintergrund ist.
- **Keine GPS-Positionen.** Die Positionen sind von HAFAS aus Echtzeit-Prognosen berechnet (siehe oben). Fahrzeuge ohne Echtzeitdaten können fehlen oder planmäßig positioniert sein.
- **transport.rest** war während der Entwicklung nicht erreichbar (Timeouts bzw. 503). Fehlerhafte Antworten tragen keine CORS-Header, deshalb meldet der Browser sie nur als „Netzwerkfehler“.
- Der **Standort wird einmal beim Start** bestimmt. Wer sich bewegt, lädt die Seite neu.
- **Datenmenge bei großem Radius:** Der BVG-Server komprimiert nicht. Bei 2,5 km sind es ca. 0,2 MB pro Abfrage, bei 10 km ca. 1,9 MB (rund 800 Fahrzeuge). Alle 25 s ergibt das bis zu ~270 MB pro Stunde, was im Mobilfunk zählt.
- Der Bereich ist ein Quadrat um die Position. Auf sehr breiten oder hohen Bildschirmen bleiben die Ränder deshalb leer.
- Bei **langer oder unendlicher Nachleuchtdauer** merkt sich das Zeigen auf Spuren höchstens ~250.000 Punkte. Sehr alte Spuren bleiben sichtbar, lassen sich dann aber nicht mehr zuordnen. Bei „unendlich“ füllt sich das Bild über Stunden.
- Bei langer Nachleuchtdauer kann ein schwacher Rest (unter 3 % Helligkeit) stehen bleiben. Das liegt an der 8-Bit-Genauigkeit des Canvas.
- **Lizenz des Codes:** noch nicht festgelegt.
