#!/bin/sh
# Rebuild the footage composites (they are not committed: examples ship in every release archive).
# Inputs are other films rendered with motion-use:
#   IP   = the iphone-use promo's out/release/ (github.com/leeguooooo/iphone-use, docs/promo)
#   EX   = this repo's examples/ with ocs-film, data-story, whiteboard and kinetic rendered (motion-use render)
#   yarn.mp4 = the yarn relay film from the README (examples/openai-yarn-film), saved next to this script
set -e
cd "$(dirname "$0")"
IP=${IP:?set IP to the iphone-use promo out/release directory}
EX=${EX:-../..}
T="scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2,fps=60,setsar=1"
# wall.mp4: 3x2 grid of six films, 960x540 tiles, 23 s, silent.
ffmpeg -v error -y \
  -ss 2 -i yarn.mp4 \
  -ss 0 -i "$IP/iphone-use-zh-landscape.mp4" \
  -stream_loop 2 -ss 3 -i "$EX/ocs-film/out/ocs-film-en-landscape-VO.mp4" \
  -stream_loop 2 -ss 4.5 -i "$EX/data-story/out/data-story-zh-landscape-VO.mp4" \
  -stream_loop 2 -ss 5 -i "$EX/whiteboard/out/whiteboard-en-landscape-VO.mp4" \
  -stream_loop 2 -ss 2.5 -i "$EX/kinetic/out/kinetic-zh-landscape-VO.mp4" \
  -filter_complex "[0:v]$T[a];[1:v]$T[b];[2:v]$T[c];[3:v]$T[d];[4:v]$T[e];[5:v]$T[f];[a][b][c][d][e][f]xstack=inputs=6:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0[v]" \
  -map "[v]" -t 23 -an -c:v libx264 -crf 14 -preset medium -pix_fmt yuv420p wall.mp4
# ip.mp4: iphone-use zh | en from source 5 s (its 2.5–3.5 s headline crossfade overlaps two lines).
ffmpeg -v error -y -ss 5 -i "$IP/iphone-use-zh-landscape.mp4" -ss 5 -i "$IP/iphone-use-en-landscape.mp4" \
  -filter_complex "[0:v]scale=960:540,setsar=1[a];[1:v]scale=960:540,setsar=1[b];[a][b]hstack[v]" \
  -map "[v]" -t 9.5 -an -c:v libx264 -crf 14 -preset medium -pix_fmt yuv420p ip.mp4
# formats.mp4: zh-L / en-L stacked | zh-V | en-V, from source 12 s.
ffmpeg -v error -y -ss 12 -i "$IP/iphone-use-zh-landscape.mp4" -ss 12 -i "$IP/iphone-use-en-landscape.mp4" \
  -ss 12 -i "$IP/iphone-use-zh-vertical.mp4" -ss 12 -i "$IP/iphone-use-en-vertical.mp4" \
  -filter_complex "[0:v]scale=960:540,setsar=1[a];[1:v]scale=960:540,setsar=1[b];[2:v]scale=608:1080,setsar=1[c];[3:v]scale=608:1080,setsar=1[d];[a][b]vstack[l];[l][c][d]hstack=inputs=3[v]" \
  -map "[v]" -t 8 -an -c:v libx264 -crf 14 -preset medium -pix_fmt yuv420p formats.mp4
