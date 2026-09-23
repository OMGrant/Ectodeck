<script lang="ts" context="module">
	import type { ComponentType } from "svelte";
	export type ChoiceItem = {
		id: string;
		label: string;
		selected?: boolean;
		// a command ("New profile") rather than a choice: no check column, its own icon
		command?: boolean;
		icon?: ComponentType;
		indent?: boolean;
	};
	export type ChoiceSection = { heading?: string; headingIcon?: ComponentType; items: ChoiceItem[] };
</script>

<script lang="ts">
	// A dropdown drawn in the app's own menu style. Native <select> popups
	// are drawn by the system toolkit and ignore the app's theme, and a menu
	// can hold commands ("HTML file…") beside choices without the select
	// value tricks that some web engines do not honour.
	//
	// It comes in three looks: a small button, a full-width field for forms,
	// and a crumb for the title bar's path.
	import CaretDown from "phosphor-svelte/lib/CaretDown";
	import Check from "phosphor-svelte/lib/Check";
	import { createEventDispatcher, tick } from "svelte";
	import { portal } from "$lib/portal";
	import { openLayer } from "$lib/navigation";
	import { onDestroy } from "svelte";

	export let label: string;
	export let current: string;
	export let sections: ChoiceSection[];
	export let variant: "button" | "field" | "crumb" | "icon" = "button";

	const dispatch = createEventDispatcher<{ choose: string }>();
	let open = false;
	let root: HTMLDivElement;
	let menu: HTMLDivElement;

	// The menu is drawn above the whole app, anchored to its button, so no
	// scrolling box or window can cut it off. It opens downwards, or upwards
	// when the window has more room above.
	let place = "";
	let release: (() => void) | null = null;
	$: if (open && !release) release = openLayer(() => {
		open = false;
		root?.querySelector<HTMLButtonElement>("button")?.focus();
	});
	$: if (!open && release) {
		release();
		release = null;
	}
	onDestroy(() => release?.());
	function position() {
		const r = root.getBoundingClientRect();
		const below = innerHeight - r.bottom - 12;
		const over = r.top - 12;
		const above = below < 240 && over > below;
		const maxHeight = Math.min(320, above ? over : below);
		const vertical = above ? `bottom: ${innerHeight - r.top + 4}px;` : `top: ${r.bottom + 4}px;`;
		const horizontal = variant == "icon" ? `right: ${innerWidth - r.right}px;` : `left: ${Math.min(r.left, innerWidth - 200)}px;`;
		place = `${vertical} ${horizontal} max-height: ${maxHeight}px; min-width: ${variant == "icon" ? 176 : Math.max(r.width, variant == "crumb" ? 240 : 0)}px;`;
	}
	async function toggle() {
		open = !open;
		if (open) {
			position();
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
		if (event.key == "ArrowDown") {
			buttons[(index + 1) % buttons.length]?.focus();
		} else if (event.key == "ArrowUp") {
			buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
		} else return;
		event.preventDefault();
	}

	function onWindowClick(event: MouseEvent) {
		if (open && !root.contains(event.target as Node) && !menu?.contains(event.target as Node)) open = false;
	}
	// a menu stays with its button; if the page moves under it, it closes
	function onScroll(event: Event) {
		if (open && !menu?.contains(event.target as Node)) open = false;
	}

	const triggers = {
		button: "gap-1.5 h-[30px] px-[11px] font-medium text-neutral-200 bg-neutral-750 hover:bg-neutral-700 border border-neutral-600 rounded-[7px] max-w-56",
		field: "w-full gap-1.5 h-[30px] pl-2.5 pr-2 text-neutral-200 bg-neutral-750 hover:bg-neutral-700 border border-neutral-700 rounded-[7px]",
		crumb: "gap-1.5 h-[26px] px-[7px] font-medium text-neutral-200 hover:bg-neutral-700 rounded-md max-w-72",
		icon: "justify-center w-7 h-7 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 rounded-md",
	};
</script>

<svelte:window on:click={onWindowClick} on:keydown={onKeydown} on:resize={() => (open = false)} on:scroll|capture={onScroll} />

<div class="relative" class:w-full={variant == "field"} bind:this={root}>
	<button
		class="flex flex-row items-center transition-colors {triggers[variant]}"
		class:bg-neutral-700={open && variant == "crumb"}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-label={label}
		on:click|stopPropagation={toggle}
	>
		<slot name="icon" />
		{#if variant != "icon"}
			<span class="truncate">{current}</span>
			<CaretDown size={variant == "crumb" ? 11 : 12} class="shrink-0 text-neutral-400 {variant == 'field' ? 'ml-auto' : ''}" />
		{/if}
	</button>

	{#if open}
		<div
			use:portal={"body"}
			bind:this={menu}
			role="menu"
			aria-label={label}
			style={place}
			class="fixed w-max max-w-80 overflow-y-auto p-[5px] text-[13px] text-neutral-200 bg-neutral-800 border border-neutral-600 rounded-[10px] shadow-xl shadow-black/50 z-50"
		>
			{#each sections as section, i}
				{#if i > 0 && !section.heading}<div class="my-[5px] mx-1 border-t border-neutral-700"></div>{/if}
				{#if section.heading}
					<div class="flex flex-row items-center gap-1.5 px-[9px] pt-2 pb-1 text-[11.5px] font-medium text-neutral-500">
						{#if section.headingIcon}<svelte:component this={section.headingIcon} size="13" />{/if}
						{section.heading}
					</div>
				{/if}
				{#each section.items as item}
					<button
						role={item.command ? "menuitem" : "menuitemradio"}
						aria-checked={item.command ? undefined : !!item.selected}
						class="flex flex-row items-center gap-[9px] w-full h-[30px] px-[9px] text-left rounded-md hover:bg-neutral-700 focus:bg-neutral-700 outline-none transition-colors"
						class:pl-8={item.indent}
						on:click|stopPropagation={() => choose(item.id)}
					>
						{#if item.command}
							{#if item.icon}<svelte:component this={item.icon} size="14" class="shrink-0 text-neutral-400" />{/if}
						{:else if !item.indent}
							<span class="w-3.5 shrink-0">{#if item.selected}<Check size="14" class="text-neutral-100" />{/if}</span>
						{/if}
						<span class="truncate" class:text-neutral-100={item.selected}>{item.label}</span>
						{#if item.indent && item.selected}<Check size="14" class="ml-auto text-neutral-100" />{/if}
					</button>
				{/each}
			{/each}
		</div>
	{/if}
</div>
