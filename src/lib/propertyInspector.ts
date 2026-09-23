import type { Action } from "./Action.ts";
import type { Context } from "./Context.ts";

import { type Writable, writable } from "svelte/store";

export const inspectedInstance: Writable<string | Context | null> = writable(null);

import { invoke } from "@tauri-apps/api/core";
let old: string | Context | null = null;
inspectedInstance.subscribe(async (value) => {
	await invoke("switch_property_inspector", {
		old: typeof old == "string" ? old : null,
		new: typeof value == "string" ? value : null,
	});
	old = value;
});

export const inspectedParentAction: Writable<Context | null> = writable(null);

export const openContextMenu: Writable<{ context: Context; x: number; y: number } | null> = writable(null);
document.addEventListener("click", () => openContextMenu.set(null));
globalThis.addEventListener("blur", () => openContextMenu.set(null));

export type CopiedItem = { type: "instance"; source: Context } | { type: "action"; action: Action };
export const copiedItem: Writable<CopiedItem | null> = writable(null);

// Which tab the inspector shows for a key: what its action does, or how it looks.
export const inspectorTab: Writable<"action" | "appearance"> = writable("action");

// A command for one key, sent from the inspector's menu to the key itself,
// which already knows how to copy, paste and delete.
export const keyCommand: Writable<{ context: string; command: "copy" | "paste" | "delete" } | null> = writable(null);
export const contextKey = (context: Context) => `${context.device}.${context.profile}.${context.controller}.${context.position}`;

// Double-clicking an action in the tray puts it on the selected empty key,
// or adds it as a step to the selected multi action.
export const placeAction: Writable<Action | null> = writable(null);
