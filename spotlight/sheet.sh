#!/bin/sh
# contact sheet of a capture over a grey backdrop: sh spotlight/sheet.sh <capture dir> [every N frames] [cols] [rows]
D=$1; N=${2:-30}; C=${3:-6}; R=${4:-4}
ffmpeg -y -loglevel error -framerate 60 -i "$D/frames/%05d.png" \
  -vf "select='not(mod(n,$N))',scale=360:-2,format=rgba,split[a][b];[b]drawbox=0:0:iw:ih:color=0x7a7a80@1:t=fill[bg];[bg][a]overlay,tile=${C}x${R}" \
  -frames:v 1 -update 1 "$D/sheet.jpg"
