<script lang="ts">
	import type { KeyStyle } from "$lib/DeviceInfo";
	import type { ActionInstance } from "$lib/ActionInstance";
	import type { ActionState } from "$lib/ActionState";
	import type { Context } from "$lib/Context";
	import type { CopiedItem } from "$lib/propertyInspector";

	import Clipboard from "phosphor-svelte/lib/Clipboard";
	import Copy from "phosphor-svelte/lib/Copy";
	import PencilSimple from "phosphor-svelte/lib/PencilSimple";
	import Trash from "phosphor-svelte/lib/Trash";

	import { t } from "$lib/i18n";
	import { contextKey, copiedItem, inspectedInstance, inspectedParentAction, inspectorTab, keyCommand, openContextMenu } from "$lib/propertyInspector";
	import { portal } from "$lib/portal";
	import { CanvasLock, KEY_CORNER, renderImage } from "$lib/rendererHelper";
	import { settings } from "$lib/settings";

	import { invoke } from "@tauri-apps/api/core";
	import { listen } from "@tauri-apps/api/event";
	import { tick } from "svelte";

	export let context: Context | null;
	export let label: string = "";
	export let tabindex: number = 0;
	export let role: string = "gridcell";

	// One-way binding for slot data.
	export let inslot: ActionInstance | null;
	let slot: ActionInstance | null;
	let lastInslot: ActionInstance | null | undefined;
	const update = (inslot: ActionInstance | null) => {
		if (inslot === lastInslot) return;
		if (inslot && context && inslot.context.split(".")[0] != context.device) return;
		lastInslot = inslot;
		slot = inslot;
	};
	$: update(inslot);

	export let active: boolean = true;
	export let scale: number = 1;
	// On a device that draws keys onto its own display, how they sit on it:
	// without a backdrop the display shows through. Such keys are drawn with
	// the tighter corners the plugin paints on the hardware.
	export let keyStyle: KeyStyle | null = null;
	export let isTouchPoint: boolean = false;
	let pressed: boolean = false;
	// an action or key being dragged over this one
	let dropping = false;

	let state: ActionState | undefined;
	$: {
		if (!slot) {
			state = undefined;
		} else {
			state = slot.states[slot.current_state];
		}
	}

	listen("update_state", ({ payload }: { payload: { context: string; contents: ActionInstance | null } }) => {
		if (payload.context == slot?.context) slot = payload.contents;
	});

	listen("key_moved", ({ payload }: { payload: { context: Context; pressed: boolean } }) => {
		if (JSON.stringify(context) == JSON.stringify(payload.context)) pressed = payload.pressed;
	});

	const isParent = (s: ActionInstance | null) => !!s && (s.action.uuid == "opendeck.multiaction" || s.action.uuid == "opendeck.toggleaction");

	// Selecting a key shows it in the inspector; a multi or toggle action shows its steps.
	function inspect() {
		if (!active || !context) return;
		$openContextMenu = null;
		if (isParent(slot)) {
			if (JSON.stringify($inspectedParentAction) != JSON.stringify(context)) {
				$inspectedParentAction = context;
				$inspectedInstance = null;
			}
			return;
		}
		$inspectedParentAction = null;
		$inspectedInstance = slot ? slot.context : context;
	}

	function select(event: MouseEvent | KeyboardEvent) {
		if (event instanceof MouseEvent && event.ctrlKey) return;
		inspect();
	}

	function onfocus() {
		inspect();
	}

	let contextMenuEl: HTMLDivElement;
	async function contextMenu(event: MouseEvent | KeyboardEvent) {
		event.preventDefault();
		if (!active || !context) return;
		const rect = canvas.getBoundingClientRect();
		let x = event instanceof MouseEvent && event.x ? event.x : rect.left;
		let y = event instanceof MouseEvent && event.y ? event.y : rect.bottom;
		// Right-clicking a key selects it first, so there is no doubt which key the menu acts on.
		if (event instanceof MouseEvent) select(event);
		$openContextMenu = { context, x, y };
		await tick();
		// Keep the menu inside the window.
		if (contextMenuEl) {
			const menu = contextMenuEl.getBoundingClientRect();
			$openContextMenu = { context, x: Math.min(x, window.innerWidth - menu.width - 8), y: Math.min(y, window.innerHeight - menu.height - 8) };
		}
		contextMenuEl?.querySelector("button")?.focus();
	}

	async function edit() {
		$openContextMenu = null;
		if (!slot) return;
		inspect();
		// after the inspector has taken the new selection, which opens on Action
		await tick();
		$inspectorTab = "appearance";
	}

	function copy() {
		$openContextMenu = null;
		if (!context || !slot) return;
		copiedItem.set({ type: "instance", source: context });
	}

	export let handlePaste: ((item: CopiedItem, destination: Context) => Promise<void>) | undefined = undefined;
	async function paste() {
		$openContextMenu = null;
		if (!$copiedItem || !context || !handlePaste) return;
		await handlePaste($copiedItem, context);
		await tick();
		$inspectedInstance = `${context.device}.${context.profile}.${context.controller}.${context.position}.0`;
	}

	async function clear() {
		$openContextMenu = null;
		if (!slot) return;
		await invoke("remove_instance", { context: slot.context });
		slot = null;
		inslot = slot;
		await tick();
		$inspectedInstance = context;
	}

	$: if ($keyCommand && context && $keyCommand.context == contextKey(context)) {
		const { command } = $keyCommand;
		$keyCommand = null;
		if (command == "copy") copy();
		else if (command == "paste") paste();
		else if (command == "delete") clear();
	}

	let showAlert: boolean = false;
	let showOk: boolean = false;
	let timeouts: number[] = [];
	listen("show_alert", ({ payload }: { payload: string }) => {
		if (!slot || payload != slot.context) return;
		timeouts.forEach(clearTimeout);
		showOk = false;
		showAlert = true;
		timeouts.push(setTimeout(() => (showAlert = false), 1.5e3));
	});
	listen("show_ok", ({ payload }: { payload: string }) => {
		if (!slot || payload != slot.context) return;
		timeouts.forEach(clearTimeout);
		showAlert = false;
		showOk = true;
		timeouts.push(setTimeout(() => (showOk = false), 1.5e3));
	});

	let canvas: HTMLCanvasElement;
	let lock = new CanvasLock();
	export let size = 144;
	// Canvas resolution defaults to a square `size`, but rectangular controllers (e.g. the Neo's infobar) can override this.
	export let width: number = size;
	export let height: number = size;
	$: (async () => {
		const sl = structuredClone(slot);
		if (!sl) {
			const unlock = await lock.lock();
			try {
				const ctx = canvas?.getContext("2d");
				if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
				if (active) await invoke("update_image", { context, image: null });
			} finally {
				unlock();
			}
		} else {
			const unlock = await lock.lock();
			try {
				let fallback = sl.action.states[sl.current_state]?.image ?? sl.action.icon;
				if (state) await renderImage(canvas, context, state, fallback, showOk, showAlert, true, active, pressed, $settings?.rotation, keyStyle != null && !keyStyle.backdrop);
			} finally {
				unlock();
			}
		}
	})();

	function clearAndRedraw() {
		canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
		slot = slot;
	}
	$: if ($settings?.rotation != undefined) {
		clearAndRedraw();
	}

	async function triggerVirtualPress() {
		if (!active || !context || !slot) return;
		await invoke("trigger_virtual_press", { context });
	}

	$: accessibleLabel = label + (slot ? ": " + slot.action.name + (state?.show && state?.text ? " - " + state.text : "") : "");
</script>

<div class="relative" style={`transform: scale(${(112 /* desired inner size */ / size) * scale});`}>
	<canvas
		bind:this={canvas}
		class="relative border-3 border-neutral-700 rounded-3xl outline-none outline-offset-2 outline-blue-500 transition-colors"
		class:cursor-pointer={active}
		class:hover:border-neutral-500={active && !dropping}
		class:border-blue-500!={dropping}
		style={`margin: ${-((size + 3 * 2 /* border */ - 132) /* desired outer size */ / 2)}px;` +
			// the image inside is clipped to KEY_CORNER of its width; the border's
			// outer radius is that plus the border's own width, so the two meet
			(keyStyle ? ` border-radius: ${width * KEY_CORNER + 3}px;` : "")}
		class:outline-solid={active &&
			((slot && $inspectedInstance == slot.context) ||
				(context && $inspectedInstance == context) ||
				(context && $inspectedParentAction && contextKey($inspectedParentAction) == contextKey(context)))}
		class:rounded-full!={context?.controller == "Encoder"}
		class:bg-neutral-900={context?.controller == "Encoder"}
		class:border-neutral-600!={context?.controller == "Encoder"}
		class:rounded-lg!={context?.controller == "Infobar"}
		class:bg-black={context?.controller != "Encoder" && slot != null && (keyStyle?.backdrop ?? true)}
		{width}
		{height}
		draggable={slot != null}
		{tabindex}
		{role}
		aria-label={accessibleLabel}
		on:dragstart
		on:dragover
		on:drop
		on:dragenter={() => active && (dropping = true)}
		on:dragleave={() => (dropping = false)}
		on:drop={() => (dropping = false)}
		on:click|stopPropagation={select}
		on:dblclick|stopPropagation={triggerVirtualPress}
		on:keydown={(e) => {
			if (!active || !context) return;
			if (e.key == "Enter") select(e);
			else if (e.key == "F2") edit();
			else if ((e.ctrlKey || e.metaKey) && e.key == "c") copy();
			else if ((e.ctrlKey || e.metaKey) && e.key == "v") paste();
			else if (e.key == "Delete") clear();
			else if (e.key == "ContextMenu" || (e.shiftKey && e.key == "F10")) contextMenu(e);
		}}
		on:keyup|stopPropagation={(e) => {
			if (!active || !context) return;
			if (e.key == " ") select(e);
		}}
		on:focus={onfocus}
		on:contextmenu={contextMenu}
	/>
	{#if isTouchPoint && !slot}
		<div class="absolute left-1/4 top-1/2 w-1/2 border-t-4 border-neutral-700 pointer-events-none"></div>
	{/if}
</div>

{#if $openContextMenu && $openContextMenu?.context == context}
	<div
		use:portal={"body"}
		bind:this={contextMenuEl}
		class="fixed w-52 p-[5px] text-[13px] text-neutral-200 bg-neutral-800 border border-neutral-600 rounded-[10px] shadow-xl shadow-black/50 z-50"
		style={`left: ${$openContextMenu.x}px; top: ${$openContextMenu.y}px;`}
		role="menu"
	>
		{#if !slot}
			<button class="menu-item" role="menuitem" disabled={!$copiedItem} on:click|stopPropagation={paste}>
				<Clipboard size="15" class="text-neutral-400" /><span>{$t("key.paste")}</span><span class="kbd">Ctrl V</span>
			</button>
		{:else}
			<button class="menu-item" role="menuitem" on:click|stopPropagation={edit}>
				<PencilSimple size="15" class="text-neutral-400" /><span>{$t("key.edit")}</span><span class="kbd">F2</span>
			</button>
			<button class="menu-item" role="menuitem" on:click|stopPropagation={copy}>
				<Copy size="15" class="text-neutral-400" /><span>{$t("key.copy")}</span><span class="kbd">Ctrl C</span>
			</button>
			<div class="my-[5px] mx-1 border-t border-neutral-700"></div>
			<button class="menu-item text-red-400!" role="menuitem" on:click|stopPropagation={clear}>
				<Trash size="15" /><span>{$t("key.delete")}</span><span class="kbd">Del</span>
			</button>
		{/if}
	</div>
{/if}
