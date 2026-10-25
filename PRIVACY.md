# Privacy Policy – Multi-Tab Sync

*Last updated: October 25, 2026* · [Deutsche Version unten](#datenschutzerklärung--multi-tab-sync)

Multi-Tab Sync is a browser extension that mirrors scrolling, clicks, keyboard input and navigation from one browser tab to other tabs you select. This policy explains what data the extension handles and how.

## Summary

- The extension **does not collect, transmit, sell or share any data**.
- All processing happens **locally in your browser**. The extension makes no network requests of its own and contains no analytics, tracking or third-party code.
- Only a minimal amount of state is kept in temporary browser storage. It is **deleted automatically when you close the browser**.

## What data the extension handles

| Data | Why | Where it goes |
|---|---|---|
| **Titles and URLs of your open tabs** | Shown in the popup so you can choose which tabs to sync | Displayed locally only, never stored |
| **Interaction events in synced tabs**: scroll position, click position, the clicked element's CSS selector, key presses, values of form fields you edit, the page path you navigate to | Replayed in your other synced tabs, which is the extension's core purpose | Passed between tabs inside your browser. Nothing is written to storage or sent anywhere. |
| **IDs of the synced tabs, your settings, and technical error messages** | Remembering your selection while the browser is open | `chrome.storage.session` (temporary, cleared when the browser closes) |

Interaction events are only captured in tabs you have explicitly selected, and only while sync is switched on.

### Sensitive input is never mirrored

Input in **password fields**, **one-time-code fields** and **credit card fields** (`autocomplete="cc-…"`) is never captured or replayed.

### Effects on websites

Mirrored actions are performed on the websites open in your synced tabs, as if you had performed them yourself. For example, a mirrored form submission sends the form to that website. Whatever those websites do with your input is governed by their own privacy policies.

## Permissions

| Permission | Purpose |
|---|---|
| `tabs` | List your open tabs in the popup and follow navigation in synced tabs |
| `scripting` + host access to all sites | Inject the sync script into the tabs you select. Without access to all sites, the extension couldn't work on arbitrary staging or production domains. |
| `storage` | Keep your tab selection and settings for the current browser session |
| `debugger` | Used **only** when you enable *Precision mode*, and only for the tabs you selected. It dispatches real mouse and keyboard events. Chrome shows a visible notice while it is active. |

## Limited Use disclosure

The use of information received from Chrome APIs adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements. Data is used solely to provide the extension's single purpose: mirroring user input between selected tabs. It is not transferred to anyone, used for advertising, or used to determine creditworthiness.

## Changes

If this policy changes, the updated version will be published at this location with a new date.

## Contact

Christian Aysner · [chrome@aysner.at](mailto:chrome@aysner.at)

---

# Datenschutzerklärung – Multi-Tab Sync

*Stand: 25. Oktober 2026*

Multi-Tab Sync ist eine Browser-Erweiterung, die Scrollen, Klicks, Tastatureingaben und Navigation von einem Tab auf andere, von dir ausgewählte Tabs überträgt. Diese Erklärung beschreibt, welche Daten die Erweiterung verarbeitet und wie.

## Kurzfassung

- Die Erweiterung **erhebt, überträgt, verkauft und teilt keine Daten**.
- Die gesamte Verarbeitung findet **lokal in deinem Browser** statt. Die Erweiterung stellt selbst keine Netzwerkverbindungen her und enthält keine Analyse-, Tracking- oder Drittanbieter-Software.
- Nur ein minimaler Zustand wird im temporären Browser-Speicher gehalten. Er wird **beim Schließen des Browsers automatisch gelöscht**.

## Welche Daten verarbeitet werden

| Daten | Zweck | Verbleib |
|---|---|---|
| **Titel und URLs deiner offenen Tabs** | Anzeige im Popup, damit du die zu synchronisierenden Tabs auswählen kannst | Nur lokale Anzeige, keine Speicherung |
| **Interaktionen in synchronisierten Tabs**: Scroll-Position, Klickposition, CSS-Selektor des angeklickten Elements, Tastendrücke, Werte von Formularfeldern, die du bearbeitest, aufgerufener Seitenpfad | Werden in deinen anderen synchronisierten Tabs nachgespielt, das ist die Kernfunktion der Erweiterung | Werden innerhalb deines Browsers zwischen den Tabs weitergereicht. Nichts wird gespeichert oder versendet. |
| **IDs der synchronisierten Tabs, deine Einstellungen und technische Fehlermeldungen** | Merken deiner Auswahl, solange der Browser geöffnet ist | `chrome.storage.session` (temporär, wird beim Schließen des Browsers gelöscht) |

Interaktionen werden nur in Tabs erfasst, die du ausdrücklich ausgewählt hast, und nur, solange die Synchronisierung eingeschaltet ist.

### Sensible Eingaben werden nie übertragen

Eingaben in **Passwortfeldern**, **Feldern für Einmal-Codes** und **Kreditkartenfeldern** (`autocomplete="cc-…"`) werden weder erfasst noch übertragen.

### Auswirkungen auf Websites

Übertragene Aktionen werden auf den Websites in deinen synchronisierten Tabs so ausgeführt, als hättest du sie selbst ausgeführt. Ein übertragenes Absenden eines Formulars schickt das Formular zum Beispiel an die jeweilige Website. Was diese Websites mit deinen Eingaben machen, richtet sich nach deren eigenen Datenschutzerklärungen.

## Berechtigungen

| Berechtigung | Zweck |
|---|---|
| `tabs` | Offene Tabs im Popup auflisten und Navigation in synchronisierten Tabs verfolgen |
| `scripting` + Zugriff auf alle Websites | Das Sync-Skript in die ausgewählten Tabs einfügen. Ohne Zugriff auf alle Websites würde die Erweiterung nicht auf beliebigen Staging- und Produktiv-Domains funktionieren. |
| `storage` | Tab-Auswahl und Einstellungen für die aktuelle Browser-Sitzung merken |
| `debugger` | Wird **nur** im *Präzisionsmodus* genutzt, und nur für die ausgewählten Tabs. Damit werden echte Maus- und Tastatur-Events ausgelöst. Chrome zeigt währenddessen einen sichtbaren Hinweis an. |

## Änderungen

Bei Änderungen wird die aktualisierte Fassung an dieser Stelle mit neuem Datum veröffentlicht.

## Kontakt

Christian Aysner · [chrome@aysner.at](mailto:chrome@aysner.at)
