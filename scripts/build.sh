#!/usr/bin/env bash
# Baut ein veröffentlichungsfertiges ZIP für den Chrome Web Store.
#
#   ./scripts/build.sh                 # Version aus manifest.json
#   VERSION=1.2.3 ./scripts/build.sh   # Version überschreiben (nur im Build)
#
# Ergebnis: dist/multi-tab-sync-<version>.zip
set -euo pipefail

cd "$(dirname "$0")/.."

# Nur was die Extension zur Laufzeit braucht – keine Tests, Doku oder Git-Dateien
FILES=(manifest.json background.js content.js popup.html popup.css popup.js icons)

VERSION="${VERSION:-$(node -p "require('./manifest.json').version")}"
OUT_DIR=dist/extension
ZIP="dist/multi-tab-sync-${VERSION}.zip"

fail() { echo "Fehler: $*" >&2; exit 1; }

# Chrome erlaubt 1–4 Zahlen zwischen 0 und 65535, ohne führende Nullen
[[ "$VERSION" =~ ^(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4})){0,3}$ ]] || fail "ungültige Version '$VERSION'"
for part in ${VERSION//./ }; do
  (( part <= 65535 )) || fail "Versionsteil $part > 65535"
done

echo "› Baue Multi-Tab Sync $VERSION"
rm -rf dist
mkdir -p "$OUT_DIR"
cp -r "${FILES[@]}" "$OUT_DIR/"

# Version in die Build-Kopie des Manifests schreiben
node -e '
  const fs = require("fs");
  const [file, version] = process.argv.slice(1);
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  m.version = version;
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
' "$OUT_DIR/manifest.json" "$VERSION"

echo "› Prüfe Manifest und Skripte"
for f in "$OUT_DIR"/*.js; do node --check "$f"; done
node -e '
  const fs = require("fs");
  const path = require("path");
  const dir = process.argv[1];
  const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const errors = [];
  // Limits des Chrome Web Store
  if (m.name.length > 75) errors.push(`name länger als 75 Zeichen (${m.name.length})`);
  if (m.description.length > 132) errors.push(`description länger als 132 Zeichen (${m.description.length})`);
  if (!m.icons?.["128"]) errors.push("128px-Icon fehlt");
  // Alle referenzierten Dateien müssen im Build liegen
  const refs = [
    m.background?.service_worker,
    m.action?.default_popup,
    ...Object.values(m.icons || {}),
    ...Object.values(m.action?.default_icon || {}),
  ].filter(Boolean);
  for (const r of refs) if (!fs.existsSync(path.join(dir, r))) errors.push(`referenzierte Datei fehlt: ${r}`);
  // Vom Popup geladene Dateien
  const html = fs.readFileSync(path.join(dir, m.action.default_popup), "utf8");
  for (const [, r] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (!/^[a-z]+:/.test(r) && !fs.existsSync(path.join(dir, r))) errors.push(`popup referenziert fehlende Datei: ${r}`);
  }
  if (errors.length) { console.error(errors.map((e) => "  - " + e).join("\n")); process.exit(1); }
' "$OUT_DIR" || fail "Manifest-Prüfung fehlgeschlagen"

echo "› Packe $ZIP"
(cd "$OUT_DIR" && zip -q -r -X "../$(basename "$ZIP")" .)

echo "✓ Fertig: $ZIP ($(du -h "$ZIP" | cut -f1))"

# Für GitHub Actions: Ergebnis als Step-Outputs bereitstellen
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "version=$VERSION" >> "$GITHUB_OUTPUT"
  echo "zip=$ZIP" >> "$GITHUB_OUTPUT"
fi
