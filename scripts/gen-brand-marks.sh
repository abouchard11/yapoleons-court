#!/usr/bin/env bash
# Render the monochrome / knockout mark variants from the recolorable master.
# Run from the repo root: bash scripts/gen-brand-marks.sh
#
# Source: scripts/assets/mark-mono.svg  (single-color crown + favor meter, no gem,
#         fill=currentColor). This script swaps the color and renders transparent PNGs.
# Outputs: docs/brand/mark-mono-{ink,cream,gold}.png  (512, transparent background)
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=scripts/assets/mark-mono.svg
OUT=docs/brand
mkdir -p "$OUT"

# name -> hex  (ink on light · cream on dark/photo · gold on navy)
for pair in "ink:#1A1714" "cream:#FBF6EC" "gold:#E8B84B"; do
  name=${pair%%:*}; hex=${pair##*:}
  tmp="$(mktemp -t markmono).svg"
  sed -e "s/currentColor/$hex/" -e 's/ color="#1A1714"//' "$SRC" > "$tmp"
  rsvg-convert -w 512 -h 512 "$tmp" -o "$OUT/mark-mono-$name.png"
  rm -f "$tmp"
  echo "→ $OUT/mark-mono-$name.png ($hex, transparent)"
done
echo "✓ knockout marks regenerated"
