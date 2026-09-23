// Where you are in Ectodeck, and what is open on top of it.
//
// A place is a whole screen, and only one is shown at a time: the deck
// (home), Plugins (its Installed or Store tab, or one plugin's page) or
// Settings. The title bar's path always names the current place, and every
// part of the path is a way back.
//
// A layer sits above the place for a moment: a window such as Profiles, a
// menu, or a plugin's own pop-up. Layers stack; while any is open, what is
// under it cannot be used, and Escape closes the top one. With no layer
// open, Escape steps back one level.

import { get, type Writable, writable } from "svelte/store";

import { inspectedInstance, inspectedParentAction, openContextMenu } from "./propertyInspector.ts";

export type Place = { name: "deck" } | { name: "plugins"; tab: "installed" | "store"; plugin?: string; title?: string } | { name: "settings" };

export const place: Writable<Place> = writable({ name: "deck" });

export function goHome() {
	place.set({ name: "deck" });
}

type Layer = { id: number; close: () => void; blocking: boolean };
let layers: Layer[] = [];
let nextLayer = 1;
// How many windows (not menus) are open; the page disables what is under them.
export const blockingLayers: Writable<number> = writable(0);

/** Registers something open above the page; returns the function that removes it. */
export function openLayer(close: () => void, blocking = false): () => void {
	const layer = { id: nextLayer++, close, blocking };
	layers.push(layer);
	blockingLayers.set(layers.filter((l) => l.blocking).length);
	return () => {
		layers = layers.filter((l) => l.id != layer.id);
		blockingLayers.set(layers.filter((l) => l.blocking).length);
	};
}

function isTextField(element: Element | null) {
	return !!element && (element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && !["checkbox", "radio", "range", "button", "color", "file"].includes(element.type)) || (element as HTMLElement).isContentEditable);
}

/** Escape: close the top layer, or leave a text field, or step back one level. */
function back(event: KeyboardEvent) {
	if (event.key != "Escape" || event.defaultPrevented) return;
	if (layers.length) {
		layers[layers.length - 1].close();
		event.preventDefault();
		return;
	}
	if (isTextField(document.activeElement)) {
		(document.activeElement as HTMLElement).blur();
		return;
	}
	const current = get(place);
	if (current.name == "plugins" && current.plugin) place.set({ name: "plugins", tab: current.tab });
	else if (current.name != "deck") goHome();
	else if (get(inspectedParentAction) && typeof get(inspectedInstance) == "string") inspectedInstance.set(null);
	else {
		inspectedParentAction.set(null);
		inspectedInstance.set(null);
	}
}

// the right-click menu on a key is a layer while it is open
let releaseContextMenu: (() => void) | null = null;
openContextMenu.subscribe((menu) => {
	if (menu && !releaseContextMenu) releaseContextMenu = openLayer(() => openContextMenu.set(null));
	if (!menu && releaseContextMenu) {
		releaseContextMenu();
		releaseContextMenu = null;
	}
});

if (typeof window != "undefined") {
	window.addEventListener("keydown", back);
	// WebKit's own right-click menu offers Reload and page navigation, which
	// would throw away the app's state; text fields keep theirs for copy and paste.
	window.addEventListener("contextmenu", (event) => {
		if (!isTextField(event.target as Element)) event.preventDefault();
	});
}
