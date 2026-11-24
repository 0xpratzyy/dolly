#!/bin/sh
# usage: scripts/sheet.sh <dir> t1 t2 ...   -> <dir>/sheet.jpg (contact sheet of out.mp4 at those seconds)
dir=$1; shift
tmp=$(mktemp -d)
n=0
for t in "$@"; do
  n=$((n+1))
  ffmpeg -v error -y -ss "$t" -i "$dir/out.mp4" -frames:v 1 -vf "scale=640:-1,drawtext=text='${t}s':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6" "$tmp/f$(printf %02d $n).png" 2>/dev/null || ffmpeg -v error -y -ss "$t" -i "$dir/out.mp4" -frames:v 1 -vf "scale=640:-1" "$tmp/f$(printf %02d $n).png"
done
ffmpeg -v error -y -i "$tmp/f%02d.png" -vf "tile=3x$(( (n+2)/3 )):padding=6:color=black" -frames:v 1 -q:v 3 "$dir/sheet.jpg"
rm -rf "$tmp"
