#!/bin/sh
# Regenerates design/brand/cover.png and the phone screenshots in this folder.
# Needs: the preview server running (bun design/serve.ts) and Google Chrome.
# Usage: sh design/screenshots/make.sh
set -e
cd "$(dirname "$0")/../.."
BASE="${BASE:-http://127.0.0.1:4173/prototype}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFILE="$(mktemp -d)"
trap 'rm -rf "$PROFILE"' EXIT

shot() { # width height file url
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
    --user-data-dir="$PROFILE" --window-size="$1,$2" --force-device-scale-factor=2 \
    --virtual-time-budget=8000 --screenshot="$3" "$4" >/dev/null 2>&1
}
# A phone-sized page is taken through frame.html in an 800 px window, then cropped to the frame.
phone() { # file query
  src=$(printf 'index.html?%s' "$2" | sed 's/&/%26/g; s/?/%3F/; s/=/%3D/g')
  shot 800 844 "$1" "$BASE/frame.html?src=$src"
  sips -c 1688 780 "$1" >/dev/null
}

shot 1280 640 design/brand/cover.png "$BASE/cover.html?export=1"
for skin in socket display home; do
  for theme in light dark; do
    phone "design/screenshots/$skin-$theme.png" "skin=$skin&state=calm&lang=en&theme=$theme&bar=0"
  done
done
phone design/screenshots/route-detail.png "skin=socket&state=calm&lang=en&theme=light&bar=0&route=home"
echo "done"
