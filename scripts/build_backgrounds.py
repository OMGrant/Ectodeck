#!/usr/bin/env python3
"""Builds the built-in background shaders.

Each source shader in src/lib/backgrounds/source/ names its pictures as
ectodeck-asset:folder/file.webp, from beside it; this inlines them as data:
addresses in its ISF IMPORTED list and writes the self-contained shader to
src/lib/backgrounds/, since a background is sent to the deck as one source.
"""

import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def inline(source: Path, text: str) -> str:
	def one(match: re.Match) -> str:
		asset = source.parent / match.group(1)
		kind = {".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg"}[asset.suffix]
		return f"data:{kind};base64,{base64.b64encode(asset.read_bytes()).decode()}"
	return re.sub(r"ectodeck-asset:([\w./-]+)", one, text)


for source in sorted((ROOT / "src/lib/backgrounds/source").glob("*.frag")):
	shader = inline(source, source.read_text())
	out = ROOT / "src/lib/backgrounds" / source.name
	out.write_text(shader)
	print(f"{out.relative_to(ROOT)}: {len(shader) // 1024} KB")
