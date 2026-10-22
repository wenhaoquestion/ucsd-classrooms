"""Render the retained source and overlay FAH pixel traces for visual review."""
import hashlib
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
trace = json.loads((root / "data/indoor/FAH/trace.json").read_text())
source = root / trace["sourcePdf"]
if hashlib.sha256(source.read_bytes()).hexdigest() != trace["sourceSha256"]:
    raise SystemExit("FAH source PDF checksum does not match the reviewed trace")
output = root / "local/indoor-sources/FAH-render"
output.mkdir(parents=True, exist_ok=True)
subprocess.run(["pdftoppm", "-f", "2", "-l", "5", "-scale-to", "2400", "-png", str(source), str(output / "floor")], check=True)
for floor in trace["floors"]:
    image = Image.open(output / f"floor-{floor['page']}.png").convert("RGBA")
    assert list(image.size) == trace["render"]["size"]
    overlay = Image.new("RGBA", image.size)
    draw = ImageDraw.Draw(overlay)
    for part in floor["outline"]:
        for ring in [part["outer"], *part.get("holes", [])]:
            points = [tuple(p) for p in ring]
            draw.line(points + points[:1], fill=(255, 145, 0, 245), width=4)
    for room in floor["rooms"]:
        points = [tuple(p) for p in room["polygon"]]
        draw.polygon(points, fill=(0, 180, 70, 65))
        draw.line(points + points[:1], fill=(0, 155, 50, 255), width=4)
    image = Image.alpha_composite(image, overlay).convert("RGB")
    image.save(output / f"{floor['id']}-review-full.png")
    image.crop((770, 250, 1530, 1380)).save(output / f"{floor['id']}-review.png")
print(f"Review overlays generated in {output}")
