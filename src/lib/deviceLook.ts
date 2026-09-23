import type { AnimatedBackground, KeyStyle } from "./DeviceInfo.ts";

import { type Writable, writable } from "svelte/store";

// What each device's screen shows behind its keys. The inspector's device
// view edits it and the stage draws it, so it lives here between them.
export type DeviceLook = { background: string | null; keyStyle: KeyStyle; animated: AnimatedBackground | null };

export const deviceLooks: Writable<{ [device: string]: DeviceLook }> = writable({});

export function ensureLook(device: string) {
	deviceLooks.update((looks) => (looks[device] ? looks : { ...looks, [device]: { background: null, keyStyle: { backdrop: true }, animated: null } }));
}

// The latest frame of each device's animated background, as the plugin sends
// it while the window is visible, for the stage and the inspector's thumbnail.
export const devicePreviews: Writable<{ [device: string]: string }> = writable({});
