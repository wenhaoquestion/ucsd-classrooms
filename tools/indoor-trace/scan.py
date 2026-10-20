"""Prints runs of dark (wall) pixels along scanlines, to read wall positions.

usage: python -I scan.py plan.jpg h:Y:X0:X1 v:X:Y0:Y1 ...
"""
import sys

import numpy as np
from PIL import Image

img = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(int)
gray = img.mean(axis=2)
THRESH = float(__import__("os").environ.get("T", "120"))
for spec in sys.argv[2:]:
    kind, a, b0, b1 = spec.split(":")
    a, b0, b1 = int(a), int(b0), int(b1)
    line = gray[a, b0:b1] if kind == "h" else gray[b0:b1, a]
    dark = line < THRESH
    runs = []
    i = 0
    while i < len(dark):
        if dark[i]:
            j = i
            while j < len(dark) and dark[j]:
                j += 1
            runs.append(f"{b0 + i}-{b0 + j - 1}")
            i = j
        else:
            i += 1
    print(spec, " ".join(runs))
