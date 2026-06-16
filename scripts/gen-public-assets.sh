#!/usr/bin/env bash
# Regenerate the binary static assets in public/ from the source SVGs in
# scripts/assets/. Run from the repo root: bash scripts/gen-public-assets.sh
#
# Sources (committed, source-of-truth):
#   public/favicon.svg            -> rounded-tile browser mark (also served as-is)
#   scripts/assets/app-icon.svg   -> full-bleed maskable icon (apple-touch + PWA)
#   scripts/assets/og-image.svg   -> 1200x630 social/link-preview card
#
# Outputs (committed, served from /): og-image.png, favicon.ico, favicon-16/32/48.png,
#   apple-touch-icon.png, icon-192.png, icon-512.png
#
# Requires: rsvg-convert (librsvg) + magick (ImageMagick). Both are installed via
# Homebrew. PNGs keep transparency; the .ico bundles the 16/32/48 marks.
set -euo pipefail

cd "$(dirname "$0")/.."
PUB=public
ASSETS=scripts/assets

command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found (brew install librsvg)"; exit 1; }
command -v magick       >/dev/null || { echo "magick not found (brew install imagemagick)"; exit 1; }

echo "→ og-image.png (1200x630)"
rsvg-convert -w 1200 -h 630 "$ASSETS/og-image.svg" -o "$PUB/og-image.png"

# Browser favicons + the .ico bundle render from the rounded-tile favicon.svg.
for s in 16 32 48; do
  echo "→ favicon-${s}.png"
  rsvg-convert -w "$s" -h "$s" "$PUB/favicon.svg" -o "$PUB/favicon-${s}.png"
done

echo "→ favicon.ico (16/32/48 bundle)"
magick "$PUB/favicon-16.png" "$PUB/favicon-32.png" "$PUB/favicon-48.png" "$PUB/favicon.ico"

# Apple-touch + PWA icons render from the full-bleed maskable source.
echo "→ apple-touch-icon.png (180)"
rsvg-convert -w 180 -h 180 "$ASSETS/app-icon.svg" -o "$PUB/apple-touch-icon.png"
echo "→ icon-192.png"
rsvg-convert -w 192 -h 192 "$ASSETS/app-icon.svg" -o "$PUB/icon-192.png"
echo "→ icon-512.png"
rsvg-convert -w 512 -h 512 "$ASSETS/app-icon.svg" -o "$PUB/icon-512.png"

echo "✓ public assets regenerated"
