#!/usr/bin/env python3
"""Builds the built-in backgrounds that include open-source libraries.

Each source page in src/lib/backgrounds/source/ marks where a library goes
with a /*NAME*/ comment inside an empty <script>. This fills those in from
third_party/ and writes the self-contained page to src/lib/backgrounds/,
since the renderer opens a background as a single file. A page's own
pictures, named as ectodeck-asset:folder/file.webp, are inlined the same way
from beside it.
"""

import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARIES = {
	"BUTTERCHURN": "third_party/butterchurn/butterchurn.min.js",
	"BUTTERCHURN_PRESETS": "third_party/butterchurn/butterchurnPresets.min.js",
	"FLUID": "third_party/webgl-fluid/script.js",
	"THREE": "third_party/three/three.min.js",
	"VANTA_BIRDS": "third_party/vanta/vanta.birds.min.js",
	"VANTA_CLOUDS": "third_party/vanta/vanta.clouds.min.js",
}


def fluid(script: str) -> str:
	"""PavelDoGreat's fluid demo, without the parts that belong to its website:
	the mobile promo, analytics and the settings panel. Its dithering texture
	is inlined, since the page is opened as a single file."""
	start = script.index("// Mobile promo section")
	end = script.index("});", script.index("const googleLink")) + 3
	script = script[:start] + script[end:]
	script = script.replace("startGUI();", "/* Ectodeck: no settings panel */", 1)
	texture = base64.b64encode((ROOT / "third_party/webgl-fluid/LDR_LLL1_0.png").read_bytes()).decode()
	script = script.replace("createTextureAsync('LDR_LLL1_0.png')", f"createTextureAsync('data:image/png;base64,{texture}')", 1)
	return "var ga = function () {};\n" + script


def clouds(script: str) -> str:
	"""Vanta's clouds, keeping each frame until the next is drawn: without it
	the deck's headless Chrome now and then shows a frame with nothing drawn,
	which flickers on the deck."""
	renderer = "new o.WebGLRenderer({alpha:!0,antialias:!0})"
	assert renderer in script, "Vanta's renderer call has changed"
	return script.replace(renderer, "new o.WebGLRenderer({alpha:!0,antialias:!0,preserveDrawingBuffer:!0})", 1)


PATCHES = {"FLUID": fluid, "VANTA_CLOUDS": clouds}

for source in sorted((ROOT / "src/lib/backgrounds/source").glob("*.html")):
	page = source.read_text()
	for name, path in LIBRARIES.items():
		marker = f"<script>/*{name}*/</script>"
		if marker in page:
			library = (ROOT / path).read_text()
			library = PATCHES.get(name, lambda x: x)(library).replace("</script", "<\\/script")
			page = page.replace(marker, f"<script>\n{library}\n</script>")
	def inline(match: re.Match) -> str:
		asset = source.parent / match.group(1)
		kind = {".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg"}[asset.suffix]
		return f"data:{kind};base64,{base64.b64encode(asset.read_bytes()).decode()}"
	page = re.sub(r"ectodeck-asset:([\w./-]+)", inline, page)
	out = ROOT / "src/lib/backgrounds" / source.name
	out.write_text(page)
	print(f"{out.relative_to(ROOT)}: {len(page) // 1024} KB")
