"""Render the cited full-page PDFs into textures without cropping their coordinate frame.

Usage: python3 scripts/render-geisel-plans.py /path/to/downloaded/maps
Requires Poppler's pdftoppm and Pillow. Input names: floor1.pdf, floor2.pdf, etc.
The source hashes are checked so the raster and trace cannot silently drift.
"""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

from PIL import Image


def main():
    root = Path(__file__).resolve().parent.parent
    source = Path(sys.argv[1])
    maps = json.loads((root / "data/indoor/GEISEL/trace.json").read_text())["maps"]
    with tempfile.TemporaryDirectory(prefix="geisel-plans-") as temp:
        for floor, metadata in maps.items():
            number = floor[1:]
            pdf = source / f"floor{number}.pdf"
            if hashlib.sha256(pdf.read_bytes()).hexdigest() != metadata["sha256"]:
                raise ValueError(f"{pdf}: source changed; update and check the trace first")
            output = Path(temp) / floor
            subprocess.run([
                "pdftoppm", "-f", "1", "-singlefile", "-scale-to", "2048", "-png",
                str(pdf), str(output),
            ], check=True)
            with Image.open(output.with_suffix(".png")) as image:
                target = root / f"static/indoor/geisel-floor-{number}.webp"
                image.convert("RGB").save(target, quality=88, method=6)
                print(target.relative_to(root))


if __name__ == "__main__":
    main()
