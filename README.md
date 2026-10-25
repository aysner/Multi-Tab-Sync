# Multi-Tab Sync

Chrome extension (Manifest V3) that mirrors scrolling, clicks, keyboard input and navigation from one tab to any number of other tabs. Built for comparing **staging vs. production**: you use one page, the others follow along.

## Installation

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Optional: pin the icon to the toolbar

## Usage

1. Open staging and production in one tab each
2. Click the extension icon and tick both tabs. Sync switches on automatically once two tabs are selected; the switch in the top right turns it off and on again.
3. **„Ausgewählte Tabs nebeneinander anordnen“** (arrange side by side) moves each tab into its own window and tiles them across the screen
4. Work in any of the tabs, the others follow

The badge on the icon shows the number of synced tabs: green for standard mode, orange for precision mode. If the extension cannot access a selected tab (for example because site access or file access is restricted), the popup shows the reason and the fix directly below that tab.

| Shortcut | Action |
|---|---|
| `Alt+Shift+S` | Toggle sync on/off |
| `Alt+Shift+A` | Add/remove the current tab |

Shortcuts can be changed at `chrome://extensions/shortcuts`.

## What gets synced

| Option | Behavior |
|---|---|
| **Scrolling** | The page and nested scroll areas. *Absolute* uses the same pixel position, *relative* the same percentage of the page length (useful when production has more content). |
| **Clicks** | Single and double clicks, including inside Shadow DOM and iframes |
| **Keyboard & input** | Keys, text fields, textareas, selects, checkboxes, radios, contenteditable. **Password, one-time-code and credit card fields are never mirrored.** |
| **Navigation (path)** | When one tab navigates to `/products?page=2`, the others open the same path **on their own domain**, e.g. `staging.shop.com/products?page=2` → `www.shop.com/products?page=2`. Also works for URLs typed into the address bar and for SPA routing. |

### Element matching

A click is mapped to the "same" element in the other tab via a CSS selector. Criteria, in order:

1. `data-testid`, `data-test`, `data-cy`, `data-qa`
2. A stable `id` (generated IDs such as `:r1:`, `ember123` or hashes are skipped)
3. `name` on form fields
4. DOM path using `:nth-of-type`

If no matching element is found, the relative screen position is used instead.

## Standard mode vs. precision mode

|  | Standard | Precision |
|---|---|---|
| Technique | Content script with synthetic DOM events | `chrome.debugger` (DevTools Protocol) |
| Events | `isTrusted = false` | real mouse and keyboard events |
| Works with | most pages | also pages that ignore synthetic events, web-app keyboard shortcuts and rich-text editors |
| Side effect | none | Chrome shows a yellow bar per tab saying the extension is debugging the browser |

In precision mode:
- Clicks via the debugger only work in **visible** tabs. Tabs Chrome reports as hidden automatically get a standard click instead. The windows should therefore sit side by side.
- Clicking "Cancel" in the yellow bar turns precision mode off.
- If DevTools are open in a target tab, the debugger cannot attach and standard mode is used for that tab.

## Limitations

- Extensions are not allowed to run on `chrome://` pages, in the Chrome Web Store or in the PDF viewer. The popup marks such tabs with ⚠.
- Drag & drop, right click, middle click and file uploads are not mirrored.
- Native select dropdowns don't open in the target tab, but the chosen value is applied.
- If the markup differs a lot between staging and production, element matching can miss. `data-testid` attributes help the most.
- Precision clicks can be offset if the browser zoom is not 100 %.

## Testing

```bash
./test/serve.sh
```

The script serves the test page on `http://127.0.0.1:8001` ("staging") and `http://127.0.0.1:8002` ("production"). Open both, connect them in the popup and try scrolling, clicks, forms, Shadow DOM, links and navigation.

## Build & release

```bash
./scripts/build.sh                 # -> dist/multi-tab-sync-<version>.zip
VERSION=1.2.3 ./scripts/build.sh   # override the version for this build only
```

The ZIP contains only the runtime files and can be uploaded directly in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). Before packing, the script checks the version, syntax, Web Store limits and referenced files.

Every push to `main` creates a GitHub release with the ZIP via GitHub Actions (`.github/workflows/release.yml`). The version is `<major>.<minor>` from `manifest.json` plus the run number, e.g. `v1.0.42`. Bump the version in `manifest.json` for a minor or major release.

The privacy policy for the Web Store is in [`PRIVACY.md`](PRIVACY.md), in English and German.

## Structure

```
manifest.json   Permissions, popup, keyboard shortcuts
background.js   Service worker: sync group, event routing, navigation sync, debugger, window tiling
content.js      Injected into every frame of the synced tabs: captures real events, replays others
popup.*         Tab selection and options (state in chrome.storage.session)
scripts/        Build script
test/           Test page simulating staging/production
```

Echo protection: only real user events (`isTrusted`) are captured. In addition, the service worker ignores events from a tab while a replay is running there and for 250 ms afterwards, so replayed actions are not mirrored back.
