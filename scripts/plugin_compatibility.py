#!/usr/bin/env python3
"""Records how each plugin in the OpenAction store runs on Linux.

The store's catalogue lists names and repositories only, so this reads each
plugin's manifest from GitHub and applies the same rules the backend uses to
launch a plugin (src-tauri/src/plugins/mod.rs):

  native   the manifest lists Linux, or its code is a web page or a Node script
  wine     the manifest lists Windows only, with a Windows program
  none     neither Linux nor Windows is listed
  unknown  no manifest could be found in the repository

Run with an authenticated `gh` (about 400 API calls). Writes
src/lib/pluginCompatibility.json, which ships with the app.
"""

import base64
import json
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

CATALOGUE = "https://openactionapi.github.io/plugins/catalogue.json"
OUT = Path(__file__).resolve().parent.parent / "src/lib/pluginCompatibility.json"
WEB_OR_NODE = (".html", ".htm", ".xhtml", ".js", ".mjs", ".cjs")


def gh(path):
	result = subprocess.run(["gh", "api", path], capture_output=True, text=True)
	return json.loads(result.stdout) if result.returncode == 0 else None


def find_manifest(repo):
	tree = gh(f"repos/{repo}/git/trees/HEAD?recursive=1")
	if not tree:
		return None
	paths = [item["path"] for item in tree.get("tree", []) if item["path"].lower().endswith("manifest.json")]
	# Prefer the manifest inside a .sdPlugin folder, then the shallowest one that looks like a plugin manifest.
	paths.sort(key=lambda p: (".sdplugin/" not in p.lower(), p.count("/")))
	for path in paths:
		if "node_modules" in path:
			continue
		blob = gh(f"repos/{repo}/contents/{path}")
		if not blob or "content" not in blob:
			continue
		try:
			manifest = json.loads(base64.b64decode(blob["content"]).decode("utf-8-sig"))
		except (ValueError, UnicodeDecodeError):
			continue
		if isinstance(manifest, dict) and ("OS" in manifest or "CodePath" in manifest or "Actions" in manifest):
			return manifest
	return None


def classify(manifest):
	if manifest is None:
		return "unknown"
	platforms = {str(os.get("Platform", "")).lower() for os in manifest.get("OS", []) if isinstance(os, dict)}
	if "linux" in platforms:
		return "native"
	if "windows" in platforms:
		code = manifest.get("CodePathWin") or manifest.get("CodePath") or ""
		return "native" if code.lower().endswith(WEB_OR_NODE) else "wine"
	return "none"


def main():
	catalogue = json.load(urllib.request.urlopen(CATALOGUE))

	def one(item):
		plugin_id, entry = item
		repo = entry["repository"].removeprefix("https://github.com/").strip("/")
		verdict = classify(find_manifest(repo))
		print(f"{verdict:8} {plugin_id}", file=sys.stderr)
		return plugin_id, verdict

	with ThreadPoolExecutor(8) as pool:
		results = dict(sorted(pool.map(one, catalogue.items())))
	OUT.write_text(json.dumps(results, indent="\t") + "\n")
	counts = {}
	for verdict in results.values():
		counts[verdict] = counts.get(verdict, 0) + 1
	print(counts)


if __name__ == "__main__":
	main()
