"""Render source-backed SME polygon overlays for visual review (Poppler + Pillow)."""
from hashlib import sha256
from pathlib import Path
import json
import subprocess

from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
trace = json.loads((root / "data/indoor/SME/trace.json").read_text())
source = root / trace["sourcePdf"]
if sha256(source.read_bytes()).hexdigest() != trace["sourceSha256"]:
    raise SystemExit("Source PDF hash changed; review the trace before rendering.")
output = root / "local/indoor-sources/SME-render"
output.mkdir(parents=True, exist_ok=True)
subprocess.run([
    "pdftoppm", "-f", "2", "-l", "6", "-scale-to", "1800", "-png",
    str(source), str(output / "floor"),
], check=True)
for floor in trace["floors"]:
    original = Image.open(output / floor["image"]).convert("RGBA")
    if list(original.size) != trace["render"]["size"]:
        raise SystemExit("Unexpected render size; pixel traces would no longer align.")
    overlay = Image.new("RGBA", original.size)
    draw = ImageDraw.Draw(overlay)
    for ring in floor["outline"]:
        draw.line([tuple(p) for p in ring + [ring[0]]], fill=(235, 95, 0, 220), width=4)
    for room in floor["rooms"]:
        draw.polygon([tuple(p) for p in room["polygon"]],
                     fill=(10, 155, 90, 65), outline=(0, 125, 65, 255), width=3)
        x, y = room["labelAt"]
        draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=(200, 10, 10, 255))
    result = Image.alpha_composite(original, overlay).convert("RGB")
    result.save(output / f"{floor['id']}-review-full.png")
    result.crop((50, 500, 1800, 1160)).save(output / f"{floor['id']}-review.png")
print(f"Reviewed overlays: {output}")
