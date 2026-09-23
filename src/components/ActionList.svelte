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
	import { PRODUCT_NAME, pluginManager } from "$lib/singletons";

	import { invoke } from "@tauri-apps/api/core";

	let categories: { [name: string]: { icon?: string; actions: Action[] } } = {};
	let plugins: any[] = [];
	// the selected deck: a deck driver's own actions show only for its decks
	export let deviceId: string | undefined = undefined;
	$: foreign = new Set(plugins.filter((p) => p.device_namespace && !(deviceId ?? "").startsWith(p.device_namespace)).map((p) => p.id));
	export async function reload() {
		categories = await invoke("get_categories");
		plugins = await invoke("list_plugins");
	}
	reload();

	let query: string = "";
	// "All", or one plugin's actions
	let only: string | null = null;
	$: categoryNames = Object.keys(categories).sort((a, b) => (a == PRODUCT_NAME ? -1 : b == PRODUCT_NAME ? 1 : a.localeCompare(b)));
	$: if (only && !categories[only]) only = null;
	let filteredCategories: [string, { icon?: string; actions: Action[] }][] = [];
	$: {
		let lowerCaseQuery = query.toLowerCase().trim();
		filteredCategories = Object.entries(categories)
			.sort((a, b) => (a[0] == PRODUCT_NAME ? -1 : b[0] == PRODUCT_NAME ? 1 : a[0].localeCompare(b[0])))
			.map(([categoryName, { icon, actions }]): [string, { icon?: string; actions: Action[] }] => {
				if (!categoryName.toLowerCase().includes(lowerCaseQuery)) {
					actions = actions.filter((action) => action.name.toLowerCase().includes(lowerCaseQuery));
				}
				actions = actions.filter((action) => !foreign.has(action.plugin));
				return [categoryName, { icon, actions }];
			})
			.filter(([name, { actions }]) => actions.length > 0 && (!only || name == only));
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
			{#each categoryNames as name}
				<button class="chip" class:on={only == name} on:click={() => (only = only == name ? null : name)}>{name}</button>
			{/each}
		</div>
		<button class="ml-auto flex flex-row items-center gap-1.5 shrink-0 h-7 px-2 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-750 transition-colors" on:click={() => $pluginManager?.openStore()}>
			<Plus size="13" />{$t("action_list.more")}
		</button>
	</div>

	<span id="action-list-hint" class="sr-only">{$t("action_list.hint")}</span>
	<div class="flex flex-row flex-wrap content-start gap-x-[18px] gap-y-1.5 flex-1 min-h-0 overflow-y-auto px-3.5 pt-1 pb-3.5 select-none">
		{#each filteredCategories as [name, { actions }]}
			<div class="flex flex-col gap-1.5" role="listbox" aria-label={name} aria-describedby="action-list-hint" tabindex="-1">
				<span class="pl-0.5 text-[11px] font-medium text-neutral-500">{name}</span>
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
		{#if filteredCategories.length == 0}
			<p class="py-3 text-neutral-500">{$t("action_list.none", { query })}</p>
		{/if}
	</div>
</div>
