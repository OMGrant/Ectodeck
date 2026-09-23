<script lang="ts">
	import type { Action } from "$lib/Action";

	import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";
	import Plus from "phosphor-svelte/lib/Plus";

	import { t } from "$lib/i18n";
	import { getWebserverUrl } from "$lib/ports";
	import { strippedIcon } from "$lib/rendererHelper";
	import { copiedItem, placeAction } from "$lib/propertyInspector";
	import { markFits } from "$lib/dragFits";
	import { localisations } from "$lib/settings";
	import { pluginManager } from "$lib/singletons";

	import { invoke } from "@tauri-apps/api/core";

	let categories: { [name: string]: { icon?: string; actions: Action[] } } = {};
	let plugins: any[] = [];
	// the selected deck: a deck driver's own actions show only for its decks
	export let deviceId: string | undefined = undefined;
	// Background Preset belongs to decks with a display behind their keys
	export let hasBackground = false;
	$: foreign = new Set(plugins.filter((p) => p.device_namespace && !(deviceId ?? "").startsWith(p.device_namespace)).map((p) => p.id));
	export async function reload() {
		categories = await invoke("get_categories");
		plugins = await invoke("list_plugins");
	}
	reload();

	let query: string = "";

	// Actions are grouped by what they do, under the names Elgato's software
	// uses, whichever plugin brings them. Actions this list doesn't know keep
	// the category their plugin gives them, after these.
	const GROUPS: { key: string; uuids: string[] }[] = [
		{ key: "navigation", uuids: ["com.amansprojects.starterpack.switchprofile"] },
		{ key: "multi", uuids: ["opendeck.multiaction", "opendeck.toggleaction"] },
		{ key: "system", uuids: ["com.amansprojects.starterpack.openurl", "com.amansprojects.starterpack.runcommand", "com.amansprojects.starterpack.inputsimulation"] },
		{ key: "device", uuids: ["com.amansprojects.starterpack.devicebrightness", "opendeck.backgroundpreset"] },
	];
	type Group = { id: string; name: string; about?: string; actions: Action[] };
	let groups: Group[] = [];
	$: {
		const known: Group[] = GROUPS.map((g) => ({ id: g.key, name: $t(`action_list.group.${g.key}`), about: $t(`action_list.group.${g.key}.about`), actions: [] }));
		const others: { [name: string]: Group } = {};
		for (const [categoryName, { actions }] of Object.entries(categories)) {
			for (const action of actions) {
				if (foreign.has(action.plugin) || (!hasBackground && action.uuid == "opendeck.backgroundpreset")) continue;
				const at = GROUPS.findIndex((g) => g.uuids.includes(action.uuid));
				if (at >= 0) known[at].actions.push(action);
				else (others[categoryName] ||= { id: "plugin:" + categoryName, name: categoryName, actions: [] }).actions.push(action);
			}
		}
		// each group in its own order, so related actions sit side by side
		known.forEach((g, at) => g.actions.sort((a, b) => GROUPS[at].uuids.indexOf(a.uuid) - GROUPS[at].uuids.indexOf(b.uuid)));
		groups = [...known, ...Object.values(others).sort((a, b) => a.name.localeCompare(b.name))].filter((g) => g.actions.length);
	}
	// "All", or one group
	let only: string | null = null;
	$: if (only && !groups.some((g) => g.id == only)) only = null;
	let shown: Group[] = [];
	$: {
		const q = query.toLowerCase().trim();
		shown = groups
			.filter((g) => !only || g.id == only)
			.map((g) => (q && !g.name.toLowerCase().includes(q) ? { ...g, actions: g.actions.filter((a) => nameOf(a).toLowerCase().includes(q)) } : g))
			.filter((g) => g.actions.length);
	}

	// the selected key or multi action takes it; if nothing can, nothing happens
	function place(action: Action) {
		placeAction.set(action);
		setTimeout(() => placeAction.set(null), 0);
	}
	const iconUrl = (icon: string) => (!icon.startsWith("opendeck/") ? getWebserverUrl(icon) : icon.replace("opendeck", ""));
	const nameOf = (action: Action) => $localisations?.[action.plugin]?.[action.uuid]?.Name ?? action.name;
</script>

<div class="flex flex-col flex-1 min-h-0 bg-neutral-800 border-t border-neutral-700">
	<div class="flex flex-row items-center gap-2 px-3.5 pt-2.5 pb-2">
		<label class="flex flex-row items-center gap-[7px] w-[200px] shrink-0 h-7 px-[9px] bg-neutral-900 border border-neutral-700 rounded-[7px] focus-within:border-blue-500">
			<MagnifyingGlass size="13" class="shrink-0 text-neutral-500" />
			<input bind:value={query} class="w-full min-w-0 bg-transparent text-neutral-200 placeholder:text-neutral-500 outline-none" placeholder={$t("action_list.search_placeholder")} type="search" spellcheck="false" />
		</label>
		<div class="chips flex flex-row items-center gap-0.5 min-w-0 overflow-x-auto">
			<button class="chip" class:on={!only} on:click={() => (only = null)}>{$t("action_list.all")}</button>
			{#each groups as g}
					<button class="chip" class:on={only == g.id} title={g.about} on:click={() => (only = only == g.id ? null : g.id)}>{g.name}</button>
				{/each}
		</div>
		<button class="ml-auto flex flex-row items-center gap-1.5 shrink-0 h-7 px-2 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-750 transition-colors" on:click={() => $pluginManager?.openStore()}>
			<Plus size="13" />{$t("action_list.more")}
		</button>
	</div>

	<span id="action-list-hint" class="sr-only">{$t("action_list.hint")}</span>
	<div class="flex flex-row flex-wrap content-start gap-x-[18px] gap-y-1.5 flex-1 min-h-0 overflow-y-auto px-3.5 pt-1 pb-3.5 select-none">
		{#each shown as { name, about, actions }}
				<div class="flex flex-col gap-1.5" role="listbox" aria-label={name} aria-describedby="action-list-hint" tabindex="-1">
					<span class="pl-0.5 text-[11px] font-medium text-neutral-400" title={about}>{name}</span>
				<div class="flex flex-row flex-wrap gap-1">
					{#each actions as action}
						<div
							class="flex flex-col items-center gap-1.5 w-[78px] px-1 pt-2 pb-[7px] rounded-lg text-center text-[11.5px] leading-tight text-neutral-300 hover:bg-neutral-750 cursor-grab active:cursor-grabbing outline-none focus-visible:bg-neutral-750 focus-visible:ring-1 focus-visible:ring-blue-500 transition-colors"
							draggable="true"
							title={$localisations?.[action.plugin]?.[action.uuid]?.Tooltip ?? action.tooltip}
							role="option"
							aria-selected="false"
							tabindex="0"
							aria-label={nameOf(action)}
							on:dragstart={(event) => {
								if (!event.dataTransfer) return;
								event.dataTransfer.effectAllowed = "copy";
								event.dataTransfer.setData("action", JSON.stringify(action));
								markFits(event.dataTransfer, action.controllers);
							}}
							on:dblclick={() => place(action)}
							on:keydown={(event) => {
								if ((event.ctrlKey || event.metaKey) && event.key == "c") copiedItem.set({ type: "action", action });
								else if (event.key == "Enter") place(action);
							}}
						>
							<span class="flex items-center justify-center w-10 h-10 rounded-[9px] bg-neutral-950 pointer-events-none">
								<img use:strippedIcon={iconUrl(action.icon)} alt="" class="w-7 h-7" />
							</span>
							<span class="line-clamp-1 min-[960px]:line-clamp-2">{nameOf(action)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/each}
		{#if shown.length == 0}
			<p class="py-3 text-neutral-500">{$t("action_list.none", { query })}</p>
		{/if}
	</div>
</div>
