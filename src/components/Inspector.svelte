<script lang="ts">
	// The inspector: one column for whatever is selected. When nothing is,
	// the device itself is selected, so the column always has a job. Its head
	// names the thing, tabs split what an action does from how its key looks,
	// and the body below changes with the selection while the column stays put.
	import type { ActionInstance } from "$lib/ActionInstance";
	import type { Context } from "$lib/Context";
	import type { DeviceInfo } from "$lib/DeviceInfo";
	import type { Profile } from "$lib/Profile";

	import CaretLeft from "phosphor-svelte/lib/CaretLeft";
	import Clipboard from "phosphor-svelte/lib/Clipboard";
	import Copy from "phosphor-svelte/lib/Copy";
	import DotsThree from "phosphor-svelte/lib/DotsThree";
	import PencilSimple from "phosphor-svelte/lib/PencilSimple";
	import Plus from "phosphor-svelte/lib/Plus";
	import SquaresFour from "phosphor-svelte/lib/SquaresFour";
	import Trash from "phosphor-svelte/lib/Trash";
	import BackgroundManager from "./BackgroundManager.svelte";
	import ChoiceMenu, { type ChoiceSection } from "./ChoiceMenu.svelte";
	import InstanceEditor from "./InstanceEditor.svelte";
	import Key from "./Key.svelte";
	import ParentActionView from "./ParentActionView.svelte";
	import PropertyInspectorView from "./PropertyInspectorView.svelte";

	import { deviceLooks } from "$lib/deviceLook";
	import { t } from "$lib/i18n";
	import { contextKey, copiedItem, inspectedInstance, inspectedParentAction, inspectorTab, keyCommand } from "$lib/propertyInspector";
	import { settings } from "$lib/settings";
	import { PRODUCT_NAME } from "$lib/singletons";

	import { invoke } from "@tauri-apps/api/core";

	export let device: DeviceInfo;
	export let profile: Profile;
	export let deviceCount = 1;
	// set while another place (Plugins, Settings) covers the deck
	export let inert: boolean | undefined = undefined;

	// Plugin names, for the line under an action's name.
	let pluginNames: { [id: string]: string } = {};
	(async () => {
		const plugins: { id: string; name: string }[] = await invoke("list_plugins");
		pluginNames = Object.fromEntries(plugins.map((p) => [p.id, p.name]));
	})();
	const pluginName = (id: string) => (id == "opendeck" ? PRODUCT_NAME : (pluginNames[id] ?? pluginNames[id + ".sdPlugin"] ?? id));

	const arrayFor = (controller: string) => (controller == "Encoder" ? "sliders" : controller == "Infobar" ? "infobars" : "keys");

	type Selection =
		| { kind: "device" }
		| { kind: "empty"; context: Context }
		| { kind: "instance"; context: Context; array: "keys" | "sliders" | "infobars"; position: number }
		| { kind: "parent"; context: Context; position: number };

	function resolve(inspected: string | Context | null, parent: Context | null, profile: Profile): Selection {
		if (parent && parent.device == device.id && profile.keys[parent.position]) return { kind: "parent", context: parent, position: parent.position };
		if (typeof inspected == "string") {
			const [dev, prof, controller, position, index] = inspected.split(".");
			const array = arrayFor(controller) as "keys" | "sliders" | "infobars";
			const pos = parseInt(position);
			if (dev == device.id && index == "0" && profile[array][pos]) {
				return { kind: "instance", context: { device: dev, profile: prof, controller, position: pos }, array, position: pos };
			}
		} else if (inspected && inspected.device == device.id) {
			return { kind: "empty", context: inspected };
		}
		return { kind: "device" };
	}
	$: selection = resolve($inspectedInstance, $inspectedParentAction, profile);

	// The selected key's instance, and its settings tab or looks tab.
	$: instance = selection.kind == "instance" ? (profile[selection.array][selection.position] as ActionInstance) : selection.kind == "parent" ? profile.keys[selection.position] : null;
	// Elgato's Pedal has no screens at all; of the decks with dials, only the
	// Stream Deck + and + XL show pictures for them, on their touch strip.
	$: elgato = device.id.startsWith("sd-");
	$: pedal = elgato && device.type == 5;
	$: dialScreens = elgato && (device.type == 7 || device.type == 13);
	$: hasScreen = !pedal && !(selection.kind == "instance" && selection.context.controller == "Encoder" && !dialScreens);
	$: if (!hasScreen && $inspectorTab == "appearance") $inspectorTab = "action";
	// a new selection opens on what the action does (Edit then switches to its looks)
	let lastSelection = "";
	$: {
		const key = selection.kind == "device" ? "device" : contextKey(selection.context);
		if (key != lastSelection) {
			if (lastSelection) $inspectorTab = "action";
			lastSelection = key;
		}
	}

	// Where a control sits, in words: "Key 3", "Dial 1".
	function where(context: Context) {
		if (context.controller == "Encoder") return $t("inspector.dial", { n: context.position + 1 });
		if (context.controller == "Infobar") return $t("inspector.infobar");
		if (context.position >= device.rows * device.columns) return $t("inspector.touchpoint", { n: context.position - device.rows * device.columns + 1 });
		return $t("inspector.key", { n: context.position + 1 });
	}
	function whereEmpty(context: Context) {
		if (context.controller != "Keypad" || context.position >= device.rows * device.columns) return $t("inspector.empty");
		return $t("inspector.row_column", { row: Math.floor(context.position / device.columns) + 1, column: (context.position % device.columns) + 1 });
	}

	$: menuSections = [
		{
			items: [
				...(hasScreen && selection.kind == "instance" ? [{ id: "edit", label: $t("key.edit"), command: true, icon: PencilSimple }] : []),
				{ id: "copy", label: $t("key.copy"), command: true, icon: Copy },
				{ id: "delete", label: $t("key.delete"), command: true, icon: Trash },
			],
		},
	] as ChoiceSection[];
	function menu(id: string) {
		if (selection.kind == "device") return;
		if (id == "edit") $inspectorTab = "appearance";
		else keyCommand.set({ context: contextKey(selection.context), command: id as "copy" | "delete" });
	}

	$: copiedName = (() => {
		const item = $copiedItem;
		if (!item) return null;
		if (item.type == "action") return item.action.name;
		const source = profile[arrayFor(item.source.controller) as "keys"][item.source.position];
		return source ? (source.states[source.current_state]?.text ? `“${source.states[source.current_state].text}” (${source.action.name})` : source.action.name) : null;
	})();

	// Screen settings: stored once for every device, and shown with the device.
	const SLEEP_CHOICES = [0, 1, 5, 10, 15, 30, 60];
	const sleepLabel = (m: number) => (m == 0 ? $t("inspector.sleep.never") : $t("inspector.sleep.minutes", { n: m }));
	$: sleepSections = [
		{
			items: [...new Set([...SLEEP_CHOICES, $settings?.sleep_timeout_minutes ?? 0])].sort((a, b) => a - b).map((m) => ({ id: String(m), label: sleepLabel(m), selected: $settings?.sleep_timeout_minutes == m })),
		},
	] as ChoiceSection[];
	const ROTATIONS = [0, 90, 180, 270];
</script>

<aside class="flex flex-col w-[300px] min-[960px]:w-[348px] shrink-0 min-h-0 bg-neutral-800 border-l border-neutral-700" aria-label={$t("inspector.label")} {inert}>
	{#if selection.kind != "device"}
		<!-- the way back from any selection to the deck's own settings -->
		<button
			class="flex flex-row items-center gap-1 self-start mx-4 mt-3 -mb-1 px-1.5 h-6 -ml-0.5 rounded-md text-xs text-neutral-400 hover:text-neutral-100 hover:bg-neutral-750 transition-colors"
			on:click={() => {
				$inspectedParentAction = null;
				$inspectedInstance = null;
			}}
		>
			<CaretLeft size="11" />{$t("navigation.deck_settings")}
		</button>
	{/if}
	<div class="flex flex-row items-center gap-3 px-4 pt-4 pb-3">
		{#if selection.kind == "device"}
			<div class="flex items-center justify-center shrink-0 w-12 h-12 rounded-[9px] bg-neutral-950 ring-1 ring-inset ring-neutral-700 text-neutral-200"><SquaresFour size="24" /></div>
			<div class="min-w-0">
				<h3 class="truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-neutral-100">{device.name}</h3>
				<div class="mt-0.5 text-xs text-neutral-400">
					{$t("inspector.keys", { n: device.rows * device.columns })}{#if device.encoders}{" · "}{$t("inspector.dials", { n: device.encoders })}{/if}
				</div>
			</div>
		{:else if selection.kind == "empty"}
			<div class="flex items-center justify-center shrink-0 w-12 h-12 rounded-[9px] border-[1.5px] border-dashed border-neutral-600 text-neutral-500"><Plus size="20" /></div>
			<div class="min-w-0">
				<h3 class="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-neutral-100">{where(selection.context)}</h3>
				<div class="mt-0.5 text-xs text-neutral-400">{whereEmpty(selection.context)}</div>
			</div>
		{:else if instance}
			<!-- the key's picture, drawn at 132 px and scaled down; its frame is clipped so it cannot cover nearby controls -->
			<div class="relative shrink-0 w-12 h-12 overflow-hidden rounded-[9px] pointer-events-none">
				<div class="absolute" style="left: -42px; top: -42px; width: 132px; height: 132px;">
					{#key JSON.stringify(instance.states[instance.current_state])}
						<Key inslot={instance} context={null} active={false} size={144} scale={48 / 118} role="presentation" tabindex={-1} keyStyle={$deviceLooks[device.id]?.keyStyle ?? null} />
					{/key}
				</div>
			</div>
			<div class="min-w-0">
				<h3 class="truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-neutral-100">{instance.action.name}</h3>
				<div class="mt-0.5 truncate text-xs text-neutral-400">{pluginName(instance.action.plugin)} · {where(selection.context)}</div>
			</div>
			<div class="ml-auto self-start">
				<ChoiceMenu variant="icon" label={$t("inspector.more")} current="" sections={menuSections} on:choose={(e) => menu(e.detail)}>
					<DotsThree slot="icon" size="18" />
				</ChoiceMenu>
			</div>
		{/if}
	</div>

	{#if (selection.kind == "instance" || selection.kind == "parent") && hasScreen}
		<div class="seg mx-4 mb-1" role="tablist">
			<button role="tab" aria-selected={$inspectorTab == "action"} class:on={$inspectorTab == "action"} on:click={() => ($inspectorTab = "action")}>
				{selection.kind == "parent" ? $t("inspector.steps") : $t("inspector.action")}
			</button>
			<button role="tab" aria-selected={$inspectorTab == "appearance"} class:on={$inspectorTab == "appearance"} on:click={() => ($inspectorTab = "appearance")}>{$t("inspector.appearance")}</button>
		</div>
	{/if}

	<div class="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 pt-1.5 pb-4">
		<!-- The device: always mounted, so its background loads before anything is chosen. -->
		<div class:hidden={selection.kind != "device"}>
			{#if pedal}
				<p class="mt-1 text-[12.5px] leading-normal text-neutral-400">{$t("inspector.pedal")}</p>
			{:else if $settings}
				<section class="insp-sect">
					<h4>{$t("inspector.screen")}</h4>
					{#if deviceCount > 1}<p class="setting-desc -mt-1">{$t("inspector.all_devices")}</p>{/if}
					<div class="insp-row">
						<label class="lb" for="insp-brightness">{$t("inspector.brightness")}</label>
						<input id="insp-brightness" type="range" min="0" max="100" class="range flex-1" bind:value={$settings.brightness} />
						<span class="w-10 text-right tabular-nums text-neutral-200">{$settings.brightness}%</span>
					</div>
					<div class="insp-row">
						<span class="lb">{$t("inspector.orientation")}</span>
						<div class="mini" role="radiogroup" aria-label={$t("inspector.orientation")}>
							{#each ROTATIONS as r}
								<button role="radio" aria-checked={$settings.rotation == r} class:on={$settings.rotation == r} on:click={() => $settings && ($settings.rotation = r)}>{r}°</button>
							{/each}
						</div>
					</div>
					<div class="insp-row">
						<span class="lb">{$t("inspector.sleep")}</span>
						<div class="flex-1 min-w-0">
							<ChoiceMenu variant="field" label={$t("inspector.sleep")} current={sleepLabel($settings.sleep_timeout_minutes)} sections={sleepSections} on:choose={(e) => $settings && ($settings.sleep_timeout_minutes = parseInt(e.detail))} />
						</div>
					</div>
					<label class="insp-row justify-between">
						<span class="text-neutral-300">{$t("inspector.sleep_locked")}</span>
						<input type="checkbox" role="switch" class="switch" bind:checked={$settings.sleep_when_computer_locked} />
					</label>
				</section>
			{/if}
			{#if $deviceLooks[device.id]}
				<BackgroundManager
					{device}
					bind:background={$deviceLooks[device.id].background}
					bind:keyStyle={$deviceLooks[device.id].keyStyle}
					bind:animated={$deviceLooks[device.id].animated}
				/>
			{/if}
		</div>

		{#if selection.kind == "empty"}
			<p class="mt-1.5 mb-3.5 text-[12.5px] leading-normal text-neutral-400">{selection.context.controller == "Encoder" ? $t("inspector.empty.hint_dial") : $t("inspector.empty.hint")}</p>
			{#if copiedName}
				<div>
					<button class="btn" on:click={() => selection.kind == "empty" && keyCommand.set({ context: contextKey(selection.context), command: "paste" })}>
						<Clipboard size="14" />{$t("inspector.paste", { name: copiedName })}
					</button>
				</div>
			{/if}
		{/if}

		{#if selection.kind == "instance" && $inspectorTab == "appearance" && instance}
			{#key instance.context}
				<InstanceEditor bind:instance={profile[selection.array][selection.position]} />
			{/key}
		{/if}

		{#if selection.kind == "parent" && $inspectorTab == "appearance" && instance}
			{#key instance.context}
				<InstanceEditor bind:instance={profile.keys[selection.position]} />
			{/key}
		{/if}

		{#if selection.kind == "parent" && $inspectorTab == "action"}
			<ParentActionView bind:profile />
		{/if}

		{#if (selection.kind == "instance" || (selection.kind == "parent" && typeof $inspectedInstance == "string")) && $inspectorTab == "action" && instance}
			<div class="flex flex-row items-center gap-1.5 mt-1 mb-1 text-[11px] text-neutral-500 after:flex-1 after:h-px after:bg-neutral-750">
				{$t("inspector.plugin_settings", { name: pluginName(selection.kind == "instance" ? instance.action.plugin : (instance.children?.find((c) => c.context == $inspectedInstance)?.action.plugin ?? "")) })}
			</div>
		{/if}

		<PropertyInspectorView
			{device}
			{profile}
			visible={(selection.kind == "instance" && $inspectorTab == "action") || (selection.kind == "parent" && $inspectorTab == "action" && typeof $inspectedInstance == "string")}
		/>
	</div>
</aside>
