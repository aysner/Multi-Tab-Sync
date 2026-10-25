#!/usr/bin/env bash
# Startet die Testseite zweimal: :8001 = "Staging", :8002 = "Prod"
cd "$(dirname "$0")"
python3 -m http.server 8001 --bind 127.0.0.1 &
python3 -m http.server 8002 --bind 127.0.0.1 &
trap 'kill $(jobs -p)' EXIT
echo "Staging: http://127.0.0.1:8001/   Prod: http://127.0.0.1:8002/   (Strg+C zum Beenden)"
wait
