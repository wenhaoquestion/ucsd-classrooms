"""Renders region IDs (or assigned labels) over a plan crop for checking.

usage: python -I overlay.py plan.jpg regions.json out.png x0 y0 x1 y1 [labels.json FLOOR]
"""
import json
import sys

from PIL import Image, ImageDraw, ImageFont

plan, seg, out = sys.argv[1:4]
x0, y0, x1, y1 = map(int, sys.argv[4:8])
S = 3
data = json.load(open(seg))
names = {}
if len(sys.argv) > 9:
    sheet = json.load(open(sys.argv[8]))[sys.argv[9]]
    for label, ids in sheet.get("rooms", {}).items():
        for i in ids:
            names[i] = label
img = Image.open(plan).convert("RGB").crop((x0, y0, x1, y1))
img = img.resize(((x1 - x0) * S, (y1 - y0) * S), Image.LANCZOS)
draw = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype("arial.ttf", 15)
except OSError:
    font = ImageFont.load_default()
for region in data["regions"]:
    pts = [((x - x0) * S, (y - y0) * S) for x, y in region["polygon"]]
    draw.line(pts + [pts[0]], fill=(230, 0, 0), width=2)
for region in data["regions"]:
    cx, cy = region["centroid"]
    text = names.get(region["id"], str(region["id"])) if names else str(region["id"])
    if names and region["id"] not in names:
        text = f"?{region['id']}"
    px, py = (cx - x0) * S, (cy - y0) * S + 14
    box = draw.textbbox((px, py), text, font=font)
    draw.rectangle(box, fill=(255, 255, 0))
    draw.text((px, py), text, fill=(200, 0, 0), font=font)
img.save(out)
