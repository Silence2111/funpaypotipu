#!/bin/bash
# Объёмные предметы GameMarket (палитра C): bash дизайн/3d/render.sh "coins gem key ..."
# Обрезка по альфе, квадрат 400×400 webp → apps/web/public/3d/<вид>.webp
cd "$(dirname "$0")"
B=~/Applications/Blender.app/Contents/MacOS/Blender
OUT=../../apps/web/public/3d
mkdir -p "$OUT" /tmp/gm3d
for k in $1; do
  "$B" -b -P obj3d.py -- gm "$k" "/tmp/gm3d/$k.png" ${SIZE:-640} ${SAMPLES:-64} >/tmp/gm3d/$k.log 2>&1 || { echo "сбой $k"; tail -5 /tmp/gm3d/$k.log; continue; }
  python3 - "/tmp/gm3d/$k.png" "$OUT/$k.webp" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA')
a = im.split()[3].point(lambda v: 255 if v > 8 else 0)
box = a.getbbox(); im = im.crop(box)
s = int(max(im.size) * 1.04); c = Image.new('RGBA', (s, s), (0, 0, 0, 0)); c.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
c.resize((400, 400), Image.LANCZOS).save(sys.argv[2], 'WEBP', quality=88)
print('ok', sys.argv[2])
PY
done
