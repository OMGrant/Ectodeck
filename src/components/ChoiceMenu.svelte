<script lang="ts" context="module">
	export type ChoiceItem = { id: string; label: string; selected?: boolean };
	export type ChoiceSection = { heading?: string; items: ChoiceItem[] };
</script>

<script lang="ts">
	// A dropdown drawn in the app's own menu style. Native <select> popups
	// are drawn by the system toolkit and ignore the app's theme, and a menu
	// can hold commands ("HTML file…") beside choices without the select
	// value tricks that some web engines do not honour.
	import CaretDown from "phosphor-svelte/lib/CaretDown";
	import Check from "phosphor-svelte/lib/Check";
	import { createEventDispatcher, tick } from "svelte";

	export let label: string;
	export let current: string;
	export let sections: ChoiceSection[];

	const dispatch = createEventDispatcher<{ choose: string }>();
	let open = false;
	let root: HTMLDivElement;
	let menu: HTMLDivElement;

	$: items = sections.flatMap((s) => s.items);

	async function toggle() {
		open = !open;
		if (open) {
			await tick();
			const selected = menu?.querySelector<HTMLButtonElement>("[aria-checked='true']") ?? menu?.querySelector<HTMLButtonElement>("button");
			selected?.focus();
		}
	}

	function choose(id: string) {
		open = false;
		dispatch("choose", id);
	}

	function onKeydown(event: KeyboardEvent) {
		if (!open) return;
		const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button"));
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key == "Escape") {
			open = false;
			root.querySelector<HTMLButtonElement>("button")?.focus();
		} else if (event.key == "ArrowDown") {
			buttons[(index + 1) % buttons.length]?.focus();
		} else if (event.key == "ArrowUp") {
			buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
		} else return;
		event.preventDefault();
	}

	function onWindowClick(event: MouseEvent) {
		if (open && !root.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window on:click={onWindowClick} on:keydown={onKeydown} />

<div class="relative" bind:this={root}>
	<button
		class="flex flex-row items-center gap-2 px-2 py-0.5 text-neutral-300 bg-neutral-700 hover:bg-neutral-600 transition-colors border border-neutral-600 rounded-lg max-w-56"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label={label}
		on:click|stopPropagation={toggle}
	>
		<span class="truncate">{current}</span>
		<CaretDown size="12" class="shrink-0 text-neutral-400" />
	</button>

	{#if open}
		<div
			bind:this={menu}
			role="menu"
			aria-label={label}
			class="absolute left-0 top-full mt-1 min-w-full w-max max-w-72 py-1 text-sm text-neutral-300 bg-neutral-700 border border-neutral-600 rounded-lg shadow-lg shadow-black/40 z-30"
		>
			{#each sections as section, i}
				{#if i > 0}<div class="my-1 border-t border-neutral-600"></div>{/if}
				{#if section.heading}
					<div class="px-3 pt-1 pb-0.5 text-xs text-neutral-400">{section.heading}</div>
				{/if}
				{#each section.items as item}
					<button
						role="menuitemradio"
						aria-checked={!!item.selected}
						class="flex flex-row items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-neutral-600 focus:bg-neutral-600 outline-none transition-colors"
						on:click|stopPropagation={() => choose(item.id)}
					>
						<span class="w-4 shrink-0">{#if item.selected}<Check size="14" class="text-neutral-200" />{/if}</span>
						<span class="truncate" class:text-neutral-100={item.selected}>{item.label}</span>
					</button>
				{/each}
			{/each}
		</div>
	{/if}
</div>
