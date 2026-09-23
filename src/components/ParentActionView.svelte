<script lang="ts">
	import type { Action } from "$lib/Action";
	import type { ActionInstance } from "$lib/ActionInstance";
	import type { Profile } from "$lib/Profile";

	import Trash from "phosphor-svelte/lib/Trash";
	import { getWebserverUrl } from "$lib/ports";
	import { strippedIcon } from "$lib/rendererHelper";

	import { t } from "$lib/i18n";
	import { copiedItem, inspectedInstance, inspectedParentAction, placeAction } from "$lib/propertyInspector";

	import { invoke } from "@tauri-apps/api/core";
	import { tick } from "svelte";

	export let profile: Profile;

	let listEl: HTMLDivElement;

	const iconUrl = (icon: string) => (!icon.startsWith("opendeck/") ? getWebserverUrl(icon) : icon.replace("opendeck", ""));
	// A line that says what a step does, from the first thing typed into its settings.
	function summary(instance: ActionInstance): string {
		const text = instance.states[instance.current_state]?.text;
		if (text) return text;
		for (const value of Object.values(instance.settings ?? {})) if (typeof value == "string" && value.trim()) return value.trim();
		return "";
	}
	let dropping = false;

	$: if ($placeAction && $inspectedParentAction) {
		const action = $placeAction;
		$placeAction = null;
		addAction(action);
	}

	let children: ActionInstance[];
	$: children = profile.keys[$inspectedParentAction!.position]!.children!;
	let parentUuid: string;
	$: parentUuid = profile.keys[$inspectedParentAction!.position]!.action.uuid;
	let parentContext: string;
	$: parentContext = profile.keys[$inspectedParentAction!.position]!.context;
	let parentSettings: any;
	$: parentSettings = profile.keys[$inspectedParentAction!.position]!.settings;

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer?.types.includes("action")) event.dataTransfer.dropEffect = "copy";
	}

	async function addAction(action: Action) {
		if (
			(parentUuid == "opendeck.multiaction" && !action.supported_in_multi_actions) ||
			(parentUuid == "opendeck.toggleaction" && (action.uuid == "opendeck.multiaction" || action.uuid == "opendeck.toggleaction"))
		) {
			return;
		}
		let response: ActionInstance | null = await invoke("create_instance", { context: $inspectedParentAction, action });
		if (response) profile.keys[$inspectedParentAction!.position] = response;
	}

	async function handleDrop({ dataTransfer }: DragEvent) {
		if (dataTransfer?.getData("action")) {
			let action = JSON.parse(dataTransfer?.getData("action"));
			await addAction(action);
		}
	}

	async function handlePaste() {
		if (!$copiedItem || $copiedItem.type != "action") return;
		await addAction($copiedItem.action);
	}

	async function removeInstance(index: number, refocus = false) {
		await invoke("remove_instance", { context: children[index].context });
		children.splice(index, 1);
		profile.keys[$inspectedParentAction!.position]!.children = children;

		if (index == 0) {
			profile.keys[$inspectedParentAction!.position]!.settings.delays?.splice(0, 1);
		} else {
			profile.keys[$inspectedParentAction!.position]!.settings.delays?.splice(index - 1, 1);
		}

		if (!refocus) return;

		await tick();
		const items = Array.from(listEl?.querySelectorAll("[role='listitem']") ?? []) as HTMLElement[];
		if (items.length == 0) return;

		const targetIndex = children.length == 0 ? 0 : Math.min(index, children.length - 1);
		for (let i = 0; i < items.length; i++) {
			items[i].tabIndex = i == targetIndex ? 0 : -1;
		}
		items[targetIndex]?.focus();
	}

	async function setDelay(index: number, event: Event) {
		const target = event.currentTarget as HTMLInputElement;
		const val = Math.max(0, parseInt(target.value) || 0);
		const settings = await invoke<any>("set_child_delay", { parentContext, index, delayMs: val });
		profile.keys[$inspectedParentAction!.position]!.settings = settings;
	}

	function handleListKeydown(event: KeyboardEvent) {
		if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
		const list = event.currentTarget as HTMLElement;
		const items = Array.from(list.querySelectorAll("[role='listitem']"));
		const currentIndex = items.indexOf(document.activeElement?.closest("[role='listitem']") as Element);
		if (currentIndex == -1) return;

		event.preventDefault();

		let newIndex = currentIndex;
		switch (event.key) {
			case "ArrowDown":
				newIndex = Math.min(currentIndex + 1, items.length - 1);
				break;
			case "ArrowUp":
				newIndex = Math.max(currentIndex - 1, 0);
				break;
			case "Home":
				newIndex = 0;
				break;
			case "End":
				newIndex = items.length - 1;
				break;
		}

		if (newIndex == currentIndex) return;
		(items[currentIndex] as HTMLElement).tabIndex = -1;
		(items[newIndex] as HTMLElement).tabIndex = 0;
		(items[newIndex] as HTMLElement).focus();
	}
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
	bind:this={listEl}
	class="flex flex-col pt-1"
	role="list"
	aria-label="{parentUuid == 'opendeck.toggleaction' ? $t('parent_action_view.toggle') : $t('parent_action_view.multi')} {$t('parent_action_view.children')}"
	on:keydown={handleListKeydown}
>
	{#each children as instance, index}
		{#if parentUuid == "opendeck.toggleaction"}
			<div class="mt-1 mb-1 text-xs font-semibold text-neutral-400">{index == 0 ? $t("parent_action_view.first_press") : $t("parent_action_view.second_press")}</div>
		{/if}
		<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
		<div
			class="group flex flex-row items-center gap-2.5 p-2 rounded-lg bg-neutral-750 border outline-none cursor-pointer transition-colors"
			class:border-blue-500={$inspectedInstance == instance.context}
			class:border-neutral-700={$inspectedInstance != instance.context}
			on:click|stopPropagation={() => ($inspectedInstance = instance.context)}
			on:focus|stopPropagation={() => ($inspectedInstance = instance.context)}
			on:keydown={(e) => {
				if (e.key == "Delete") removeInstance(index, true);
			}}
			role="listitem"
			tabindex={index == 0 ? 0 : -1}
		>
			<span class="flex items-center justify-center shrink-0 w-[30px] h-[30px] rounded-[7px] bg-neutral-950">
				<img use:strippedIcon={iconUrl(instance.states[instance.current_state]?.image || instance.action.icon)} alt="" class="w-6 h-6 pointer-events-none" />
			</span>
			<div class="min-w-0">
				<div class="font-medium leading-tight text-neutral-100">{instance.action.name}</div>
				{#if summary(instance)}<div class="truncate max-w-52 font-mono text-xs text-neutral-400">{summary(instance)}</div>{/if}
			</div>
			<button
				class="row-act ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100 text-neutral-400"
				on:click|stopPropagation={() => removeInstance(index)}
				tabindex={-1}
				aria-label={$t("parent_action_view.remove", { name: instance.action.name })}
			>
				<Trash size="15" />
			</button>
		</div>

		{#if parentUuid == "opendeck.multiaction" && index < children.length - 1}
			<div class="flex flex-row items-center gap-1.5 py-[5px] pl-[22px] text-xs text-neutral-500">
				<span class="w-px h-[18px] mr-2 bg-neutral-600"></span>
				{$t("parent_action_view.delay.label")}
				<input
					type="number"
					min="0"
					max="300000"
					step="100"
					value={parentSettings?.delays?.[index] ?? 100}
					on:input={(e) => setDelay(index, e)}
					class="no-spinner w-16 h-[22px] px-1.5 text-center tabular-nums text-neutral-200 bg-neutral-900 border border-neutral-700 rounded-md outline-none focus:border-blue-500"
					aria-label={$t("parent_action_view.delay.aria", { name: children[index + 1].action.name })}
				/>
				ms
			</div>
		{/if}
	{/each}
	{#if parentUuid != "opendeck.toggleaction" || children.length < 2}
		<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
		<div
			class="flex items-center justify-center mt-2 h-11 rounded-lg border-[1.5px] border-dashed text-[12.5px] transition-colors outline-none focus:border-blue-500"
			class:border-blue-500={dropping}
			class:text-neutral-200={dropping}
			class:border-neutral-600={!dropping}
			class:text-neutral-500={!dropping}
			on:dragover={(e) => {
				handleDragOver(e);
				dropping = true;
			}}
			on:dragleave={() => (dropping = false)}
			on:drop={(e) => {
				dropping = false;
				handleDrop(e);
			}}
			on:keydown={(e) => {
				if ((e.ctrlKey || e.metaKey) && e.key == "v") handlePaste();
			}}
			role="listitem"
			tabindex={children.length == 0 ? 0 : -1}
			aria-label={$t("parent_action_view.drag_copy")}
		>
			{$t("parent_action_view.drag_paste")}
		</div>
	{/if}
</div>
