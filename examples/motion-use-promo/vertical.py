"""Compose a 1080x1920 vertical cut from the subtitle-free landscape render.

Title above, the film in the middle, large subtitles below it (timed from film.json copy.subs), repo at the bottom.
Usage: python3 vertical.py <landscape-nosubs.mp4> <out.mp4>
"""
import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
FONT = os.path.expanduser("~/.local/share/motion-use/versions/0.4.1/assets/fonts/NotoSansSC[wght].ttf")
W, H, VH = 1080, 1920, 608  # the film scaled to 1080 wide
VY = 600                    # film top edge
film = json.load(open("film.json"))
subs = [s.split("~") for s in film["copy"]["zh"]["subs"].split("|")]


def font(size, weight):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def centred(d, y, text, f, fill):
    w = d.textlength(text, font=f)
    d.text(((W - w) / 2, y), text, font=f, fill=fill)


tmp = tempfile.mkdtemp()
bg = Image.new("RGB", (W, H), (3, 4, 7))
d = ImageDraw.Draw(bg)
centred(d, 250, "Claude Opus 5.5 写代码", font(76, 800), (255, 255, 255))
centred(d, 350, "做出的 3D 宣传片", font(76, 800), (95, 227, 255))
centred(d, 468, "1250 行代码 · 无手动动画 · 无素材库", font(40, 500), (160, 176, 190))
centred(d, 1700, "开源工具 motion-use", font(42, 600), (230, 236, 242))
centred(d, 1760, "github.com/leeguooooo/motion-use", font(36, 500), (130, 146, 160))
bg.save(f"{tmp}/bg.png")

inputs, chain = ["-loop", "1", "-i", f"{tmp}/bg.png", "-i", src], []
chain.append(f"[1:v]scale={W}:{VH}[film]")
chain.append(f"[0:v][film]overlay=0:{VY}:shortest=1[v0]")
last = "v0"
f_sub = font(54, 650)
for i, (a, b, text) in enumerate(subs):
    img = Image.new("RGBA", (W, 170), (0, 0, 0, 0))
    dd = ImageDraw.Draw(img)
    size = 54
    while dd.textlength(text, font=f_sub) > W - 120 and size > 30:
        size -= 2; f_sub = font(size, 650)
    centred(dd, 40, text, f_sub, (244, 247, 250))
    f_sub = font(54, 650)
    p = f"{tmp}/s{i:02d}.png"; img.save(p)
    inputs += ["-i", p]
    nxt = f"v{i + 1}"
    chain.append(f"[{last}][{i + 2}:v]overlay=0:{VY + VH + 70}:enable='between(t,{float(a) - 0.05:.2f},{float(b) + 0.2:.2f})'[{nxt}]")
    last = nxt
cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(chain), "-map", f"[{last}]", "-map", "1:a",
       "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "60", "-c:a", "aac", "-b:a", "192k",
       "-movflags", "+faststart", "-shortest", out]
subprocess.run(cmd, check=True)
print("wrote", out)
