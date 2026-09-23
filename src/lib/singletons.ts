import text from "../../product_name.txt?raw" with { type: "text" };
export const PRODUCT_NAME = text.trim();

import { type Writable, writable } from "svelte/store";

import type ActionList from "../components/ActionList.svelte";
import type DeviceSelector from "../components/DeviceSelector.svelte";
import type ProfileManager from "../components/ProfileManager.svelte";
import type PluginManager from "../components/PluginManager.svelte";

export const actionList: Writable<ActionList | null> = writable(null);
export const deviceSelector: Writable<DeviceSelector | null> = writable(null);
export const profileManager: Writable<ProfileManager | null> = writable(null);
export const pluginManager: Writable<PluginManager | null> = writable(null);
