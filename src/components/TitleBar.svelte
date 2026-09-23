<script lang="ts">
	// Ectodeck draws its own title bar so it can carry the mark and wordmark,
	// which a system-drawn bar cannot. That makes the window's controls ours
	// too: dragging and double-click to maximise (data-tauri-drag-region),
	// the minimise, maximise and close buttons, and resizing from the edges.
	import mark from "../../src-tauri/icons/mark.svg";
	import Minus from "phosphor-svelte/lib/Minus";
	import Square from "phosphor-svelte/lib/Square";
	import CopySimple from "phosphor-svelte/lib/CopySimple";
	import X from "phosphor-svelte/lib/X";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import { goHome } from "$lib/navigation";
	import { t } from "$lib/i18n";
	import { onDestroy, onMount } from "svelte";

	const appWindow = getCurrentWindow();
	// while a window such as Profiles is open, only it and the window buttons respond
	export let blocked = false;
	let maximized = false;
	let unlisten: (() => void) | undefined;

	// The window has rounded corners except when maximised; the page reads
	// this attribute to square them off.
	$: if (typeof document != "undefined") document.documentElement.toggleAttribute("data-maximized", maximized);

	onMount(async () => {
		maximized = await appWindow.isMaximized();
		unlisten = await appWindow.onResized(async () => (maximized = await appWindow.isMaximized()));
	});
	onDestroy(() => unlisten?.());

	type Edge = "North" | "South" | "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest";
	const resize = (edge: Edge) => (event: MouseEvent) => {
		if (event.button == 0) appWindow.startResizeDragging(edge);
	};

	const button = "flex items-center justify-center w-10 h-full text-neutral-400 hover:text-neutral-100 transition-colors";
</script>

<header class="relative flex flex-row items-center h-9 shrink-0 pl-3 gap-0.5 bg-neutral-800 border-b border-neutral-700 select-none" data-tauri-drag-region>
	<!-- The title bar reads as a path: Ectodeck, then the device, then the profile. -->
	<button class="flex flex-row items-center gap-[7px] h-[26px] px-1.5 -ml-1.5 rounded-md hover:bg-neutral-700 transition-colors" on:click={goHome} title={$t("navigation.home")} aria-label={$t("navigation.home")}>
		<img src={mark} alt="" class="w-4 h-4" draggable="false" />
		<span class="wordmark text-[13.5px] text-neutral-100">Ectodeck</span>
	</button>
	<div class="flex flex-row items-center min-w-0" inert={blocked || undefined}><slot name="path" /></div>
	<div class="ml-auto flex flex-row items-center h-full gap-1">
		<div class="flex flex-row items-center gap-1" inert={blocked || undefined}><slot name="actions" /></div>
		<div class="flex flex-row h-full ml-1.5">
			<button class="{button} hover:bg-neutral-700" aria-label="Minimise" on:click={() => appWindow.minimize()}>
				<Minus size="14" />
			</button>
			<button class="{button} hover:bg-neutral-700" aria-label={maximized ? "Restore" : "Maximise"} on:click={() => appWindow.toggleMaximize()}>
				{#if maximized}<CopySimple size="13" />{:else}<Square size="12" />{/if}
			</button>
			<button class="{button} hover:bg-red-600" aria-label="Close" on:click={() => appWindow.close()}>
				<X size="14" />
			</button>
		</div>
	</div>
</header>

{#if !maximized}
	<!-- Resize handles along the window's edges and corners. -->
	<div class="fixed top-0 left-2 right-2 h-1 z-50 cursor-n-resize" on:mousedown={resize("North")} aria-hidden="true"></div>
	<div class="fixed bottom-0 left-2 right-2 h-1 z-50 cursor-s-resize" on:mousedown={resize("South")} aria-hidden="true"></div>
	<div class="fixed left-0 top-2 bottom-2 w-1 z-50 cursor-w-resize" on:mousedown={resize("West")} aria-hidden="true"></div>
	<div class="fixed right-0 top-2 bottom-2 w-1 z-50 cursor-e-resize" on:mousedown={resize("East")} aria-hidden="true"></div>
	<div class="fixed top-0 left-0 w-2 h-2 z-50 cursor-nw-resize" on:mousedown={resize("NorthWest")} aria-hidden="true"></div>
	<div class="fixed top-0 right-0 w-2 h-2 z-50 cursor-ne-resize" on:mousedown={resize("NorthEast")} aria-hidden="true"></div>
	<div class="fixed bottom-0 left-0 w-2 h-2 z-50 cursor-sw-resize" on:mousedown={resize("SouthWest")} aria-hidden="true"></div>
	<div class="fixed bottom-0 right-0 w-2 h-2 z-50 cursor-se-resize" on:mousedown={resize("SouthEast")} aria-hidden="true"></div>
{/if}
