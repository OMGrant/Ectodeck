<script lang="ts">
	// A town or city, found by searching: as you type, the places whose names
	// match drop down in a menu, from Open-Meteo's free geocoding (no account
	// needed), and you pick one. The menu is ChoiceMenu's, drawn above the whole
	// app and anchored to the field, so nothing can cut it off.
	import Check from "phosphor-svelte/lib/Check";
	import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";
	import { createEventDispatcher, onDestroy, tick } from "svelte";
	import { portal } from "$lib/portal";
	import { openLayer } from "$lib/navigation";
	import { t } from "$lib/i18n";

	export let label: string;
	// the place chosen, as shown: "Tampa, Florida, United States"
	export let value: string;

	type Place = { name: string; region: string; at: [number, number] };
	const dispatch = createEventDispatcher<{ choose: { name: string; at: [number, number] } }>();

	let root: HTMLDivElement;
	let input: HTMLInputElement;
	let menu: HTMLDivElement;
	let text = value;
	// the field shows the place chosen, except while it is being typed in
	$: follow(value);
	function follow(v: string) {
		if (document.activeElement !== input) text = v;
	}
	let open = false;
	let places: Place[] = [];
	let note = "";
	let active = 0;
	const listId = "places-" + Math.random().toString(36).slice(2, 8);

	let release: (() => void) | null = null;
	$: if (open && !release) release = openLayer(() => close());
	$: if (!open && release) {
		release();
		release = null;
	}
	onDestroy(() => {
		release?.();
		clearTimeout(timer);
	});
	let place = "";
	function position() {
		const r = root.getBoundingClientRect();
		const below = innerHeight - r.bottom - 12;
		const over = r.top - 12;
		const above = below < 240 && over > below;
		const maxHeight = Math.min(320, above ? over : below);
		const vertical = above ? `bottom: ${innerHeight - r.top + 4}px;` : `top: ${r.bottom + 4}px;`;
		// as wide as the field or a little wider, and always inside the window
		const width = Math.min(Math.max(r.width, 300), innerWidth - 16);
		place = `${vertical} left: ${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px; width: ${width}px; max-height: ${maxHeight}px;`;
	}

	// a quarter of a second after the typing stops, the places matching it
	let timer: ReturnType<typeof setTimeout> | undefined;
	let asked = 0;
	function typed() {
		clearTimeout(timer);
		const query = text.trim();
		if (query.length < 2) {
			open = false;
			return;
		}
		timer = setTimeout(() => search(query), 250);
	}
	async function search(query: string) {
		const mine = ++asked;
		note = $t("parameters.place.finding");
		places = [];
		active = 0;
		position();
		open = true;
		try {
			const answer = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&format=json&name=${encodeURIComponent(query)}`)).json();
			if (mine != asked) return;
			type Found = { name: string; admin1?: string; admin2?: string; country?: string; latitude: number; longitude: number };
			const found: Found[] = answer?.results ?? [];
			const regionOf = (r: Found, county: boolean) =>
				[county ? r.admin2 : undefined, r.admin1, r.country].filter((part, i, all) => part && part != r.name && all.indexOf(part) == i).join(", ");
			// two places that would read the same are told apart by their county
			const plain = found.map((r) => r.name + ", " + regionOf(r, false));
			places = found.map((r, i) => ({
				name: r.name,
				region: regionOf(r, plain.indexOf(plain[i]) != plain.lastIndexOf(plain[i])),
				at: [+r.latitude.toFixed(3), +r.longitude.toFixed(3)] as [number, number],
			}));
			note = places.length ? "" : $t("parameters.place.none", { name: query });
		} catch {
			if (mine == asked) note = $t("parameters.place.offline");
		}
	}
	const shown = (p: Place) => (p.region ? `${p.name}, ${p.region}` : p.name);

	function choose(p: Place) {
		const name = shown(p);
		open = false;
		text = name;
		dispatch("choose", { name, at: p.at });
		input?.blur();
	}
	function close() {
		open = false;
		asked++;
		text = value;
	}
	async function onKeydown(event: KeyboardEvent) {
		if (event.key == "Escape") {
			event.stopPropagation();
			close();
			input.blur();
		} else if (event.key == "ArrowDown" && places.length) {
			active = (active + 1) % places.length;
		} else if (event.key == "ArrowUp" && places.length) {
			active = (active - 1 + places.length) % places.length;
		} else if (event.key == "Enter") {
			if (places[active]) choose(places[active]);
		} else return;
		event.preventDefault();
		await tick();
		menu?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
	}
	function onWindowClick(event: MouseEvent) {
		if (open && !root.contains(event.target as Node) && !menu?.contains(event.target as Node)) close();
	}
	// the menu stays with its field; if the page moves under it, it closes
	function onScroll(event: Event) {
		if (open && !menu?.contains(event.target as Node)) close();
	}
</script>

<svelte:window on:click={onWindowClick} on:resize={close} on:scroll|capture={onScroll} />

<div class="relative w-full" bind:this={root}>
	<label class="flex flex-row items-center gap-[7px] h-[30px] px-[9px] bg-neutral-900 border border-neutral-700 rounded-[7px] focus-within:border-blue-500">
		<MagnifyingGlass size="13" class="shrink-0 text-neutral-500" />
		<input
			bind:this={input}
			bind:value={text}
			class="w-full min-w-0 bg-transparent text-neutral-200 placeholder:text-neutral-500 outline-none"
			placeholder={$t("parameters.place.placeholder")}
			aria-label={label}
			role="combobox"
			aria-expanded={open}
			aria-controls={listId}
			aria-autocomplete="list"
			spellcheck="false"
			autocomplete="off"
			on:focus={() => requestAnimationFrame(() => input.select())}
			on:mouseup|preventDefault
			on:blur={close}
			on:input={typed}
			on:keydown={onKeydown}
		/>
	</label>

	{#if open}
		<div
			use:portal={"body"}
			bind:this={menu}
			role="listbox"
			id={listId}
			aria-label={label}
			style={place}
			class="fixed overflow-y-auto p-[5px] text-[13px] text-neutral-200 bg-neutral-800 border border-neutral-600 rounded-[10px] shadow-xl shadow-black/50 z-50"
		>
			{#if note}
				<div class="px-[9px] py-[7px] text-neutral-400">{note}</div>
			{/if}
			{#each places as p, i}
				<button
					role="option"
					aria-selected={i == active}
					data-index={i}
					class="flex flex-row items-center gap-[9px] w-full h-[30px] px-[9px] text-left rounded-md hover:bg-neutral-700 outline-none transition-colors"
					class:bg-neutral-700={i == active}
					on:mousemove={() => (active = i)}
					on:mousedown|preventDefault
					on:click|stopPropagation={() => choose(p)}
				>
					<span class="w-3.5 shrink-0">{#if shown(p) == value}<Check size="14" class="text-neutral-100" />{/if}</span>
					<span class="truncate"><span class="text-neutral-100">{p.name}</span>{#if p.region}<span class="text-neutral-400">, {p.region}</span>{/if}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
