import sys
import numpy as np
from PIL import Image

img = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(int)
print("size", img.shape)
for spec in sys.argv[2:]:
    x, y = map(int, spec.split(","))
    patch = img[y - 2 : y + 3, x - 2 : x + 3].reshape(-1, 3)
    print(spec, np.median(patch, axis=0).astype(int).tolist())
