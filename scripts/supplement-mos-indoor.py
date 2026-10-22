#!/usr/bin/env python3
"""Build Mosaic's two retained public FIS raster supplements in order."""
from pathlib import Path
import runpy

build = runpy.run_path(str(Path(__file__).with_name('supplement-fis-raster.py')))['build']
build('MOS', '-L1')
build('MOS', '-L2')
