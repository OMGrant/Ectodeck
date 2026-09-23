<script lang="ts">
	import type { DeviceInfo } from "$lib/DeviceInfo";
	import type { Profile } from "$lib/Profile";

	import { ensureLook } from "$lib/deviceLook";
	import { initPortBase } from "$lib/ports";
	import { t } from "$lib/i18n";
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

	// The stage draws the deck to fit the room it has, and leaves the tray
	// under it at least enough height for a row of actions.
	// The tray's share can be dragged; double-clicking the divider hides the
	// tray (and shows it again) so the deck can take the whole column.
	const TRAY_DEFAULT = 168;
	let trayMin = TRAY_DEFAULT;
	let lastTray = TRAY_DEFAULT;
	function dragDivider(event: PointerEvent) {
		const startY = event.clientY;
		const start = trayMin;
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);
		const move = (e: PointerEvent) => (trayMin = Math.max(0, Math.min(columnHeight - 160, start - (e.clientY - startY))));
		const up = () => {
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
			if (trayMin < 60) trayMin = 0;
			if (trayMin) lastTray = trayMin;
		};
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", up);
	}
	function toggleTray() {
		trayMin = trayMin ? 0 : lastTray || TRAY_DEFAULT;
	}
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
	$: stageHeight = columnHeight - trayMin - 38 - 5;

	initPortBase();
</script>

<svelte:window on:dragover={(event) => event.preventDefault()} on:drop={(event) => event.preventDefault()} />

<div class="app-window flex flex-col h-screen bg-neutral-800 text-neutral-300">
	<TitleBar>
		<svelte:fragment slot="path">
			<DeviceSelector bind:devices bind:value={selectedDevice} bind:selectedProfiles bind:this={$deviceSelector} />
			{#key selectedDevice}
				{#if selectedDevice && devices[selectedDevice]}
					<ProfileManager device={devices[selectedDevice]} bind:profile={selectedProfiles[selectedDevice]} bind:this={$profileManager} />
				{/if}
			{/key}
		</svelte:fragment>
		<svelte:fragment slot="actions">
			<PluginManager bind:this={$pluginManager} />
			<SettingsView />
		</svelte:fragment>
	</TitleBar>

	<!-- Overlays (sheets, dialogs, menus) are moved here so they cover the app body. -->
	<div id="overlay-host" class="relative flex flex-row flex-1 min-h-0">
		{#if Object.keys(devices).length > 0 && selectedProfiles}
			<div class="flex flex-col flex-1 min-w-0" use:measure>
				<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
				<div
					class="flex flex-row justify-center shrink-0 px-7 pt-5 pb-[18px] bg-stage"
					class:flex-1={trayMin == 0}
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
				{#if trayMin == 0}
					<div class="flex justify-center shrink-0 pb-3 bg-stage">
						<button class="btn quiet" on:click={toggleTray}>{$t("tray.show")}</button>
					</div>
				{/if}
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div
					class="group relative shrink-0 h-[5px] -my-0.5 z-10 cursor-row-resize"
					title={$t("tray.divider")}
					on:pointerdown={dragDivider}
					on:dblclick={toggleTray}
				>
					<div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-1 rounded-full bg-neutral-700 group-hover:bg-neutral-500 transition-colors"></div>
				</div>
				<div class="flex flex-col min-h-0" class:flex-1={trayMin > 0} class:hidden={trayMin == 0}>
					<ActionList bind:this={$actionList} />
				</div>
			</div>

			{#if selectedProfiles[selectedDevice] && devices[selectedDevice]}
				<Inspector device={devices[selectedDevice]} bind:profile={selectedProfiles[selectedDevice]} deviceCount={Object.keys(devices).length} />
			{/if}
		{:else}
			<NoDevicesDetected />
		{/if}
	</div>
</div>
