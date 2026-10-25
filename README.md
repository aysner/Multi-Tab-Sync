# Multi-Tab Sync

Chrome-Extension (Manifest V3), die Scrollen, Klicks, Tastatureingaben und Navigation von einem Tab auf beliebig viele andere Tabs spiegelt. Gedacht für den Vergleich **Staging vs. Produktion**: Du bedienst eine Seite, die anderen machen dasselbe.

## Installation

1. `chrome://extensions` öffnen
2. Oben rechts **Entwicklermodus** einschalten
3. **Entpackte Erweiterung laden** → diesen Ordner auswählen
4. Optional: Icon an die Toolbar anheften

## Benutzung

1. Staging und Produktion jeweils in einem Tab öffnen
2. Extension-Icon → beide Tabs anhaken → Schalter oben rechts einschalten
3. **„Nebeneinander anordnen“** legt jeden Tab in ein eigenes Fenster, gekachelt über den Bildschirm
4. In einem beliebigen Tab arbeiten, die anderen folgen

Das Badge am Icon zeigt die Anzahl synchronisierter Tabs. Grün steht für den Standardmodus, Orange für den Präzisionsmodus.

| Tastenkürzel | Aktion |
|---|---|
| `Alt+Shift+S` | Sync ein/aus |
| `Alt+Shift+A` | Aktuellen Tab hinzufügen/entfernen |

Ändern lassen sich die Kürzel unter `chrome://extensions/shortcuts`.

## Was synchronisiert wird

| Option | Verhalten |
|---|---|
| **Scrollen** | Seite und verschachtelte Scroll-Bereiche. *Absolut* nutzt dieselbe Pixel-Position, *relativ* denselben Prozentsatz der Seitenlänge (sinnvoll, wenn Prod mehr Inhalt hat). |
| **Klicks** | Einfach- und Doppelklicks, auch in Shadow DOM und iframes |
| **Tastatur & Eingaben** | Tasten, Textfelder, Textareas, Selects, Checkboxen, Radios, Contenteditable. **Passwortfelder, Einmal-Codes und Kreditkartenfelder werden nie gespiegelt.** |
| **Navigation (Pfad)** | Navigiert ein Tab zu `/produkte?seite=2`, öffnen die anderen denselben Pfad **auf ihrer eigenen Domain**, z.B. `staging.shop.de/produkte?seite=2` → `www.shop.de/produkte?seite=2`. Das funktioniert auch bei Eingaben in der Adresszeile und bei SPA-Routing. |

### Element-Zuordnung

Ein Klick wird über einen CSS-Selektor dem „gleichen“ Element im anderen Tab zugeordnet. Die Reihenfolge der Kriterien:

1. `data-testid`, `data-test`, `data-cy`, `data-qa`
2. Stabile `id` (generierte IDs wie `:r1:`, `ember123` oder Hashes werden übersprungen)
3. `name` bei Formularfeldern
4. DOM-Pfad mit `:nth-of-type`

Wird kein passendes Element gefunden, greift die relative Bildschirmposition.

## Standardmodus vs. Präzisionsmodus

|  | Standard | Präzision |
|---|---|---|
| Technik | Content-Script mit synthetischen DOM-Events | `chrome.debugger` (DevTools-Protokoll) |
| Events | `isTrusted = false` | echte Maus- und Tastatur-Events |
| Funktioniert mit | den meisten Seiten | auch Seiten, die synthetische Events ignorieren, sowie Tastenkürzeln von Web-Apps und Rich-Text-Editoren |
| Nebenwirkung | keine | Chrome zeigt pro Tab eine gelbe Leiste „… debuggt diesen Browser“ |

Im Präzisionsmodus gilt außerdem:
- Klicks per Debugger funktionieren nur in **sichtbaren** Tabs. Verdeckte Tabs bekommen automatisch einen Standard-Klick. Die Fenster sollten daher nebeneinander liegen.
- Klickst du in der gelben Leiste auf „Abbrechen“, schaltet sich der Präzisionsmodus aus.
- Bei geöffneten DevTools im Ziel-Tab kann sich der Debugger nicht verbinden. Dann wird der Standardmodus genutzt.

## Grenzen

- Auf `chrome://`-Seiten, im Chrome Web Store und im PDF-Viewer dürfen Extensions nicht laufen. Das Popup markiert solche Tabs mit ⚠.
- Drag & Drop, Rechtsklick, Mittelklick und Datei-Uploads werden nicht gespiegelt.
- Native Select-Dropdowns öffnen sich im Ziel-Tab nicht, der gewählte Wert wird aber übernommen.
- Unterscheidet sich das Layout zwischen Staging und Prod stark (anderes Markup), kann die Element-Zuordnung danebenliegen. `data-testid`-Attribute helfen hier am meisten.
- Mit einem Browser-Zoom ungleich 100 % können Präzisionsklicks versetzt sein.

## Testen

```bash
./test/serve.sh
```

Das Skript startet die Testseite auf `http://127.0.0.1:8001` („Staging“) und `http://127.0.0.1:8002` („Prod“). Öffne beide, verbinde sie im Popup und probiere Scrollen, Klicks, Formulare, Shadow DOM, Links und Navigation aus.

## Build & Release

```bash
./scripts/build.sh                 # -> dist/multi-tab-sync-<version>.zip
VERSION=1.2.3 ./scripts/build.sh   # Version nur für den Build überschreiben
```

Das ZIP enthält nur die Laufzeitdateien und kann direkt im [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) hochgeladen werden. Vor dem Packen prüft das Skript Version, Syntax, Web-Store-Limits und referenzierte Dateien.

Jeder Push auf `main` erstellt per GitHub Actions (`.github/workflows/release.yml`) ein Release mit dem ZIP. Die Version setzt sich aus `<major>.<minor>` aus `manifest.json` und der Run-Nummer zusammen, z.B. `v1.0.42`. Für einen Versionssprung hebst du die Version in `manifest.json` an.

Die Datenschutzerklärung für den Web Store steht in [`PRIVACY.md`](PRIVACY.md), auf Englisch und Deutsch.

## Aufbau

```
manifest.json   Berechtigungen, Popup, Tastenkürzel
background.js   Service Worker: Sync-Gruppe, Event-Routing, Navigations-Sync, Debugger, Fenster-Tiling
content.js      Wird in jeden Frame der Sync-Tabs injiziert: erfasst echte Events, spielt fremde nach
popup.*         Tab-Auswahl und Optionen (State in chrome.storage.session)
test/           Testseite für Staging/Prod-Simulation
```

Echo-Schutz: Es werden nur echte Nutzer-Events (`isTrusted`) erfasst. Zusätzlich ignoriert der Service Worker Events aus einem Tab, solange dort ein Replay läuft, und noch 250 ms danach. So werden nachgespielte Aktionen nicht zurückgespiegelt.
