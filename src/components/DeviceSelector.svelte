<script lang="ts">
	import type { DeviceInfo } from "$lib/DeviceInfo";
	import type { Profile } from "$lib/Profile";

	import { t } from "$lib/i18n";
	import { profileManager } from "$lib/singletons";
	import { transparentKeyDevices } from "$lib/rendererHelper";

	import { invoke } from "@tauri-apps/api/core";
	import { listen } from "@tauri-apps/api/event";
	import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
	import SquaresFour from "phosphor-svelte/lib/SquaresFour";
	import ChoiceMenu, { type ChoiceSection } from "./ChoiceMenu.svelte";

	export let devices: { [id: string]: DeviceInfo } = {};
	export let value: string;
	export let selectedProfiles: { [id: string]: Profile } = {};

	let registered: string[] = [];
	$: {
		if (!value || !devices[value]) value = Object.keys(devices).sort()[0];
		for (const [id, device] of Object.entries(devices)) {
			// before the profile is selected, so its first key images keep transparency
			if (device.has_background) transparentKeyDevices.add(id);
			if (!registered.includes(id)) {
				(async () => {
					let profile: Profile = await invoke("get_selected_profile", { device: device.id });
					selectedProfiles[id] = profile;
					await invoke("set_selected_profile", { device: id, id: profile.id });
				})();
				registered.push(id);
			}
		}
	}

	export function reloadProfiles() {
		registered = [];
	}

	listen("switch_profile", async ({ payload }: { payload: { device: string; profile: string } }) => {
		if (payload.device == value) {
			$profileManager?.setProfile(payload.profile);
		} else {
			await invoke("set_selected_profile", { device: payload.device, id: payload.profile });
			selectedProfiles[payload.device] = await invoke("get_selected_profile", { device: payload.device });
		}
	});

	(async () => (devices = await invoke("get_devices")))();
	listen("devices", ({ payload }: { payload: { [id: string]: DeviceInfo } }) => (devices = payload));

	// The stage draws any deck to fit, so the window keeps whatever size the
	// person gives it; it only needs a floor below which the layout would crush.
	const appWindow = getCurrentWindow();
	appWindow.setMinSize(new LogicalSize(900, 560));

	$: deviceSections = [
		{ heading: $t("device_selector.devices"), items: Object.entries(devices).sort().map(([id, device]) => ({ id, label: device.name, selected: id == value })) },
	] as ChoiceSection[];
</script>

<div class="flex flex-row items-center">
{#if Object.keys(devices).length > 0}
	<span class="text-neutral-600 text-[15px] px-[3px]" aria-hidden="true">/</span>
	<ChoiceMenu variant="crumb" label={$t("device_selector.device")} current={devices[value]?.name ?? ""} sections={deviceSections} on:choose={(e) => (value = e.detail)}>
		<SquaresFour slot="icon" size="14" class="shrink-0 text-neutral-500" />
	</ChoiceMenu>
{/if}
{#if Object.keys(devices).length == 0}
	<span class="text-neutral-600 text-[15px] px-[3px]" aria-hidden="true">/</span>
	<span class="flex flex-row items-center gap-1.5 h-[26px] px-[7px] font-medium text-neutral-400">
		<SquaresFour size="14" class="shrink-0 text-neutral-500" />{$t("device_selector.none")}
	</span>
{/if}
</div>
