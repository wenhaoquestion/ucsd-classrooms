"""Draws assembled polygons + assigned labels over the plan for visual QA.

usage: python -I check.py plans_dir trace.json FLOOR out.png x0 y0 x1 y1
"""
import json
import sys

from PIL import Image, ImageDraw, ImageFont

plans, trace_path, floor, out = sys.argv[1:5]
x0, y0, x1, y1 = map(int, sys.argv[5:9])
S = 3
data = json.load(open(trace_path))[floor]
img = Image.open(f"{plans}/{floor}.jpg").convert("RGB").crop((x0, y0, x1, y1))
img = img.resize(((x1 - x0) * S, (y1 - y0) * S), Image.LANCZOS).convert("RGBA")
layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(layer)
font = ImageFont.truetype("arial.ttf", 16)
pts = lambda poly: [((x - x0) * S, (y - y0) * S) for x, y in poly]
for part in data["outline"]:
    draw.line(pts(part + [part[0]]), fill=(255, 0, 255, 255), width=3)
for region in data["unlabeledRegions"]:
    draw.polygon(pts(region["polygon"]), fill=(255, 80, 0, 90), outline=(255, 80, 0, 255))
for room in data["rooms"]:
    p = pts(room["polygon"])
    draw.polygon(p, fill=(0, 120, 255, 50), outline=(0, 60, 220, 255))
for room in data["rooms"]:
    lx, ly = room["labelAt"]
    px, py = (lx - x0) * S, (ly - y0) * S + 18
    box = draw.textbbox((px, py), room["label"], font=font, anchor="mm")
    draw.rectangle(box, fill=(255, 255, 0, 230))
    draw.text((px, py), room["label"], fill=(180, 0, 0, 255), font=font, anchor="mm")
Image.alpha_composite(img, layer).convert("RGB").save(out)
