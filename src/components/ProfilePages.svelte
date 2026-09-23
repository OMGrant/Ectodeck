<script lang="ts">
	// The deck's profiles as numbered pages under it, the one in use with its
	// name: click a number to switch, + to add one, drag a tab to move it. The
	// tab in use opens a menu to rename, duplicate or delete it (right-clicking
	// any tab does too), and a delete asks first.
	import CaretLeft from "phosphor-svelte/lib/CaretLeft";
	import CaretRight from "phosphor-svelte/lib/CaretRight";
	import Plus from "phosphor-svelte/lib/Plus";
		import Copy from "phosphor-svelte/lib/Copy";
	import Gear from "phosphor-svelte/lib/Gear";
	import PencilSimple from "phosphor-svelte/lib/PencilSimple";
	import Trash from "phosphor-svelte/lib/Trash";
	import ChoiceMenu, { type ChoiceSection } from "./ChoiceMenu.svelte";
	import { tick } from "svelte";

	import { t } from "$lib/i18n";
	import { leaf, profileIds } from "$lib/profiles";
	import { profileManager } from "$lib/singletons";

	export let current: string;

	let strip: HTMLDivElement;
	let renaming: string | null = null;
	let draft = "";
	let confirming: string | null = null;

	async function add() {
		const id = await $profileManager?.createNext();
		if (!id) return;
		await tick();
		startRename(id);
	}
	async function startRename(id: string) {
		confirming = null;
		renaming = id;
		draft = leaf(id);
		await tick();
		const input = strip?.querySelector<HTMLInputElement>("input[data-rename]");
		input?.focus();
		input?.select();
	}
	async function commitRename() {
		if (!renaming) return;
		const from = renaming;
		const folder = from.includes("/") ? from.split("/")[0] + "/" : "";
		renaming = null;
		if (draft.trim() && folder + draft.trim() != from) await $profileManager?.renameTo(from, folder + draft.trim());
	}
	function renameKey(e: KeyboardEvent) {
		if (e.key == "Enter") (e.currentTarget as HTMLInputElement).blur();
		else if (e.key == "Escape") {
			e.stopPropagation();
			renaming = null;
		}
	}
		// the menu on the tab in use
	let menu: ChoiceMenu;
	$: menuSections = [
		{
			items: [
				{ id: "rename", label: $t("profile_manager.rename"), command: true, icon: PencilSimple },
				{ id: "duplicate", label: $t("profile_manager.duplicate"), command: true, icon: Copy },
				...($profileIds.length > 1 ? [{ id: "delete", label: $t("profile_manager.delete"), command: true, icon: Trash }] : []),
			],
		},
		{ items: [{ id: "manage", label: $t("profile_manager.manage"), command: true, icon: Gear }] },
	] as ChoiceSection[];
	function chooseFromMenu(what: string) {
		if (what == "rename") startRename(current);
		else if (what == "duplicate") $profileManager?.duplicate(current);
		else if (what == "delete") (confirming = current), (renaming = null);
		else if (what == "manage") $profileManager?.openManager();
	}
		// Dragging a tab onto another moves it there.
	let dragging: string | null = null;
	let over: string | null = null;
	function dragStart(event: DragEvent, id: string) {
		dragging = id;
		event.dataTransfer?.setData("profile-page", id);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
	}
	function dragOver(event: DragEvent, id: string) {
		if (!dragging || dragging == id) return;
		event.preventDefault();
		over = id;
	}
	function drop(event: DragEvent, id: string) {
		event.preventDefault();
		const from = dragging;
		dragging = over = null;
		if (!from || from == id) return;
		const ids = $profileIds.filter((p) => p != from);
		const at = ids.indexOf(id) + ($profileIds.indexOf(from) < $profileIds.indexOf(id) ? 1 : 0);
		ids.splice(at, 0, from);
		$profileManager?.reorder(ids);
	}
	function dragEnd() {
		dragging = over = null;
	}

	// a right-click on another tab switches to it and opens its menu
	async function menuFor(event: MouseEvent, id: string) {
		event.preventDefault();
		if (id != current) {
			await $profileManager?.select(id);
			await tick();
		}
		menu?.openMenu();
	}
	async function remove(id: string) {
		confirming = null;
		await $profileManager?.remove(id);
	}

	// the current page stays in view; arrows appear when the pages overflow
	let overflow = false;
	let atStart = true;
	let atEnd = true;
	function measure() {
		if (!strip) return;
		overflow = strip.scrollWidth > strip.clientWidth + 1;
		atStart = strip.scrollLeft < 2;
		atEnd = strip.scrollLeft + strip.clientWidth > strip.scrollWidth - 2;
	}
	$: if (strip && current && $profileIds) tick().then(() => {
		strip.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
		measure();
	});
		// a tab that grows (a name being typed, the delete question) changes the fit too
	function watch(node: HTMLElement) {
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		for (const child of node.children) observer.observe(child);
		const mutations = new MutationObserver(() => {
			for (const child of node.children) observer.observe(child);
			measure();
		});
		mutations.observe(node, { childList: true, subtree: true, characterData: true });
		return { destroy: () => (observer.disconnect(), mutations.disconnect()) };
	}
	function page(direction: number) {
		strip.scrollBy({ left: direction * strip.clientWidth * 0.8, behavior: "smooth" });
	}
</script>

<svelte:window on:resize={measure} />

<div class="flex flex-row items-center justify-center gap-1 max-w-full min-w-0">
	{#if overflow}
		<button class="pg-arrow" disabled={atStart} aria-label={$t("pages.back")} on:click={() => page(-1)}><CaretLeft size="13" /></button>
	{/if}
	<div bind:this={strip} use:watch class="pages flex flex-row items-center gap-1 min-w-0 overflow-x-auto" class:masked={overflow} role="tablist" aria-label={$t("pages.label")} on:scroll={measure}>
		{#each $profileIds as id, i (id)}
			{#if confirming == id}
				<div class="pg on danger" role="group" aria-label={$t("pages.delete_confirm", { name: leaf(id) })}>
					<span class="whitespace-nowrap">{$t("pages.delete_confirm", { name: leaf(id) })}</span>
					<button class="pg-act text-red-300!" on:click={() => remove(id)}>{$t("pages.delete")}</button>
					<button class="pg-act" on:click={() => (confirming = null)}>{$t("pages.keep")}</button>
				</div>
			{:else if renaming == id}
				<div class="pg on">
					<span class="pg-n">{i + 1}</span>
					<input
						data-rename
						bind:value={draft}
						class="w-28 bg-transparent text-neutral-100 outline-none"
						class:text-red-300={!$profileManager?.nameIsValid(draft)}
						aria-label={$t("profile_manager.rename")}
						spellcheck="false"
						on:blur={commitRename}
						on:keydown={renameKey}
					/>
				</div>
			{:else if id == current}
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<div
					class="flex rounded-[7px]"
					class:drop-at={over == id}
					class:opacity-40={dragging == id}
					role="tab"
					aria-selected="true"
					tabindex="-1"
					draggable="true"
					on:dragstart={(e) => dragStart(e, id)}
					on:dragover={(e) => dragOver(e, id)}
					on:dragleave={() => over == id && (over = null)}
					on:drop={(e) => drop(e, id)}
					on:dragend={dragEnd}
					on:contextmenu={(e) => menuFor(e, id)}
					on:dblclick={() => startRename(id)}
				>
					<ChoiceMenu bind:this={menu} variant="tab" label={$t("pages.menu", { name: leaf(id) })} current={leaf(id)} sections={menuSections} on:choose={(e) => chooseFromMenu(e.detail)}>
						<span slot="icon" class="pg-n cur">{i + 1}</span>
					</ChoiceMenu>
				</div>
			{:else}
								<button
					class="pg num"
					class:drop-at={over == id}
					class:opacity-40={dragging == id}
					draggable="true"
					on:dragstart={(e) => dragStart(e, id)}
					on:dragover={(e) => dragOver(e, id)}
					on:dragleave={() => over == id && (over = null)}
					on:drop={(e) => drop(e, id)}
					on:dragend={dragEnd}
					role="tab"
					aria-selected="false"
					aria-label={leaf(id)}
					title={$t("pages.tab_hint", { name: id.replace("/", " / ") })}
					on:click={() => $profileManager?.select(id)}
					on:contextmenu={(e) => menuFor(e, id)}
				>
					<span class="pg-n">{i + 1}</span>
				</button>
			{/if}
		{/each}
		<button class="pg add" aria-label={$t("pages.new")} title={$t("pages.new")} on:click={add}><Plus size="13" /></button>
	</div>
	{#if overflow}
		<button class="pg-arrow" disabled={atEnd} aria-label={$t("pages.forward")} on:click={() => page(1)}><CaretRight size="13" /></button>
	{/if}
</div>

<style>
	.pages {
		scrollbar-width: none;
	}
	.pages::-webkit-scrollbar {
		display: none;
	}
	.pages.masked {
		mask-image: linear-gradient(to right, transparent, black 16px, black calc(100% - 16px), transparent);
		padding-inline: 12px;
	}
	.pg {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 7px;
		height: 28px;
		padding: 0 11px 0 5px;
		border-radius: 7px;
		white-space: nowrap;
		font-weight: 500;
		color: var(--color-neutral-400);
		border: 1px solid transparent;
		transition: color 0.15s, background-color 0.15s;
	}
	.pg:hover {
		color: var(--color-neutral-200);
		background: color-mix(in oklab, var(--color-neutral-700) 45%, transparent);
	}
	.pg.on {
		color: var(--color-neutral-100);
		background: var(--color-neutral-700);
		border-color: var(--color-neutral-600);
	}
	.pg.danger {
		gap: 4px;
		padding-left: 12px;
		padding-right: 3px;
		border-color: color-mix(in oklab, var(--color-red-400) 45%, transparent);
	}
		/* a page other than the one in use: just its number */
	.pg.num {
		padding: 0;
		width: 28px;
		justify-content: center;
	}
	.pg.num .pg-n {
		background: transparent;
		font-size: 12px;
	}
	.pg.num:hover .pg-n {
		color: var(--color-neutral-100);
	}
	.pg.add {
		padding: 0;
		width: 28px;
		justify-content: center;
		border: 1px dashed var(--color-neutral-600);
	}
	.pg-n {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 4px;
		border-radius: 4px;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		color: var(--color-neutral-300);
		background: var(--color-neutral-800);
	}
		.pg-n.cur,
	.pg.on .pg-n {
		color: var(--color-neutral-900);
		background: var(--color-neutral-200);
	}
		/* where a dragged tab will land */
	.drop-at {
		box-shadow: inset 0 0 0 1px var(--color-blue-500);
	}
	.pg-act {
		height: 22px;
		padding: 0 8px;
		border-radius: 5px;
		color: var(--color-neutral-200);
	}
	.pg-act:hover {
		background: var(--color-neutral-600);
	}
	.pg-arrow {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 26px;
		height: 26px;
		border-radius: 6px;
		color: var(--color-neutral-400);
	}
	.pg-arrow:hover:not(:disabled) {
		color: var(--color-neutral-100);
		background: var(--color-neutral-700);
	}
	.pg-arrow:disabled {
		opacity: 0.3;
	}
</style>
