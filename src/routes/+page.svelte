<script lang="ts">
	import type { DeviceInfo } from "$lib/DeviceInfo";
	import type { Profile } from "$lib/Profile";

	import { ensureLook } from "$lib/deviceLook";
	import { initPortBase } from "$lib/ports";
	import { t } from "$lib/i18n";
	import { blockingLayers, place } from "$lib/navigation";
	import { inspectedInstance, inspectedParentAction } from "$lib/propertyInspector";
	import { actionList, deviceSelector, pluginManager, profileManager } from "$lib/singletons";

	import ActionList from "../components/ActionList.svelte";
	import DeviceSelector from "../components/DeviceSelector.svelte";
	import DeviceView from "../components/DeviceView.svelte";
	import Inspector from "../components/Inspector.svelte";
	import NoDevicesDetected from "../components/NoDevicesDetected.svelte";
	import PluginManager from "../components/PluginManager.svelte";
	import ProfileManager from "../components/ProfileManager.svelte";
	import SettingsView from "../components/SettingsView.svelte";
	import TitleBar from "../components/TitleBar.svelte";

	let devices: { [id: string]: DeviceInfo } = {};
	let selectedDevice: string;
	let selectedProfiles: { [id: string]: Profile } = {};

	$: for (const id of Object.keys(devices)) ensureLook(id);

	// The stage draws the deck to fit the room it has. On its own it takes the
	// height the deck needs and leaves the tray at least a row of actions.
	// The divider between them is a split: dragging it sets the stage's height
	// directly, so it follows the pointer from the first pixel, and the deck
	// shrinks to fit only once that height gets tight. Dragging it to the
	// bottom, or double-clicking it, hides the tray; doing it again shows it.
	const TRAY_DEFAULT = 168;
	const TRAY_SNAP = 60;
	let stageEl: HTMLDivElement;
	let stageH: number | null = null;
	let trayHidden = false;
	function dragDivider(event: PointerEvent) {
		if (event.button != 0) return;
		const startY = event.clientY;
		const start = trayHidden ? columnHeight - 5 : stageEl.getBoundingClientRect().height;
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);
		const move = (e: PointerEvent) => {
			const h = Math.max(120, Math.min(columnHeight - 5, start + (e.clientY - startY)));
			trayHidden = columnHeight - 5 - h < TRAY_SNAP;
			stageH = trayHidden ? null : h;
		};
		const up = () => {
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
		};
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", up);
	}
	function toggleTray() {
		trayHidden = !trayHidden;
	}
	// a window made smaller keeps the tray reachable
	$: if (stageH != null && columnHeight && stageH > columnHeight - TRAY_SNAP - 5) stageH = Math.max(120, columnHeight - TRAY_SNAP - 5);
	let columnWidth = 0;
	let columnHeight = 0;
	function measure(node: HTMLElement) {
		const update = () => {
			columnWidth = node.clientWidth;
			columnHeight = node.clientHeight;
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(node);
		addEventListener("resize", update);
		return {
			destroy: () => {
				observer.disconnect();
				removeEventListener("resize", update);
			},
		};
	}
	$: stageWidth = columnWidth - 56;
	$: stageHeight = trayHidden ? columnHeight - 38 - 5 - 48 : stageH != null ? stageH - 38 : columnHeight - TRAY_DEFAULT - 38 - 5;

	initPortBase();
</script>

<svelte:window on:dragover={(event) => event.preventDefault()} on:drop={(event) => event.preventDefault()} />

<div class="app-window flex flex-col h-screen bg-neutral-800 text-neutral-300">
	<TitleBar blocked={$blockingLayers > 0}>
		<svelte:fragment slot="path">
			{#if $place.name != "deck"}
				<span class="text-neutral-600 text-[15px] px-[3px]" aria-hidden="true">/</span>
				{#if $place.name == "plugins" && $place.plugin}
					<button class="crumb-link" on:click={() => $place.name == "plugins" && ($place = { name: "plugins", tab: $place.tab })}>{$t("plugin_manager.title")}</button>
					<span class="text-neutral-600 text-[15px] px-[3px]" aria-hidden="true">/</span>
					<span class="crumb-here truncate max-w-60">{$place.title ?? ""}</span>
				{:else}
					<span class="crumb-here">{$place.name == "plugins" ? $t("plugin_manager.title") : $t("settings.button")}</span>
				{/if}
			{/if}
			<div class="contents" class:hidden!={$place.name != "deck"}>
			<DeviceSelector bind:devices bind:value={selectedDevice} bind:selectedProfiles bind:this={$deviceSelector} />
			{#key selectedDevice}
				{#if selectedDevice && devices[selectedDevice]}
					<ProfileManager device={devices[selectedDevice]} bind:profile={selectedProfiles[selectedDevice]} bind:this={$profileManager} />
				{/if}
			{/key}
			</div>
		</svelte:fragment>
		<svelte:fragment slot="actions">
			<PluginManager bind:this={$pluginManager} />
			<SettingsView />
		</svelte:fragment>
	</TitleBar>

	<!-- Overlays (sheets, dialogs, menus) are moved here so they cover the app body. -->
	<div class="relative flex flex-row flex-1 min-w-0 min-h-0">
	<!-- Windows such as Profiles open here, above the places; while one is open, the rest is disabled. -->
	<div id="dialog-host" class="absolute inset-0 z-40 pointer-events-none empty:hidden"></div>
	<div id="overlay-host" class="relative flex flex-row flex-1 min-w-0 min-h-0" inert={$blockingLayers > 0 || undefined}>
		{#if Object.keys(devices).length > 0 && selectedProfiles}
			<div class="flex flex-col flex-1 min-w-0" use:measure inert={$place.name != "deck" || undefined}>
				<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
				<div
					bind:this={stageEl}
					class="flex flex-row justify-center items-center shrink-0 px-7 pt-5 pb-[18px] bg-stage"
					class:flex-1={trayHidden}
					style={!trayHidden && stageH != null ? `height: ${stageH}px;` : ""}
					on:click={() => {
						$inspectedInstance = null;
						$inspectedParentAction = null;
					}}
				>
					{#each Object.entries(devices) as [id, device]}
						{#if device && selectedProfiles[id]}
							<DeviceView bind:device bind:profile={selectedProfiles[id]} bind:selectedDevice availWidth={stageWidth} availHeight={stageHeight} />
						{/if}
					{/each}
				</div>
				{#if trayHidden}
					<div class="flex justify-center shrink-0 pb-3 bg-stage">
						<button class="btn quiet" on:click={toggleTray}>{$t("tray.show")}</button>
					</div>
				{/if}
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div
					class="group relative shrink-0 h-[11px] -my-[3px] z-10 cursor-row-resize touch-none"
					title={$t("tray.divider")}
					on:pointerdown={dragDivider}
					on:dblclick={toggleTray}
				>
					<div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-1 rounded-full bg-neutral-700 group-hover:bg-neutral-500 transition-colors"></div>
				</div>
				<div class="flex flex-col flex-1 min-h-0" class:hidden={trayHidden}>
					<ActionList bind:this={$actionList} deviceId={selectedDevice} />
				</div>
			</div>

			{#if selectedProfiles[selectedDevice] && devices[selectedDevice]}
				<Inspector inert={$place.name != "deck" || undefined} device={devices[selectedDevice]} bind:profile={selectedProfiles[selectedDevice]} deviceCount={Object.keys(devices).length} />
			{/if}
		{:else}
			<NoDevicesDetected />
		{/if}
	</div>
	</div>
</div>
