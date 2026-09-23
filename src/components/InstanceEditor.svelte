<script lang="ts">
	import type { ActionInstance } from "$lib/ActionInstance";

	import { t } from "$lib/i18n";
	import { resizeImage } from "$lib/rendererHelper";

	import { invoke } from "@tauri-apps/api/core";
	import { onMount } from "svelte";
	import ChoiceMenu, { type ChoiceSection } from "./ChoiceMenu.svelte";
	import TextB from "phosphor-svelte/lib/TextB";
	import TextItalic from "phosphor-svelte/lib/TextItalic";
	import TextUnderline from "phosphor-svelte/lib/TextUnderline";
	import ImageIcon from "phosphor-svelte/lib/Image";

	export let instance: ActionInstance | null;

	let state: number = 0;
	let bold: boolean;
	let italic: boolean;

	let fonts: string[] = [];
	onMount(async () => {
		fonts = await invoke("get_fonts");
	});

	let fileInput: HTMLInputElement;

	function handleDrop(event: DragEvent) {
		event.preventDefault();

		const file = event.dataTransfer?.files?.[0];
		if (!file || !file.type.startsWith("image/")) return;
		const reader = new FileReader();

		reader.onload = async () => {
			let result = reader.result?.toString();
			if (result && instance) {
				let resized = await resizeImage(result);
				if (resized) instance.states[state].image = resized;
				else instance.states[state].image = result;
			}
		};

		reader.readAsDataURL(file);
	}

	function update(instance: ActionInstance | null) {
		if (!instance) return;
		bold = instance.states[state].style.includes("Bold");
		italic = instance.states[state].style.includes("Italic");
	}
	$: update(instance);
	$: if (instance) invoke("set_state", { context: instance.context, index: state, state: instance.states[state] });

	const BUILTIN_FONTS = ["Liberation Sans", "Archivo Black", "Comic Neue", "Courier Prime", "Tinos", "Anton", "Liberation Serif", "Open Sans", "Fira Sans"];
	$: family = instance?.states[state].family;
	$: fontSections = [
		{ items: BUILTIN_FONTS.map((f) => ({ id: f, label: f, selected: family == f })) },
		...(fonts.length ? [{ heading: $t("instance_editor.font.system"), items: fonts.filter((f) => !BUILTIN_FONTS.includes(f)).map((f) => ({ id: f, label: f, selected: family == f })) }] : []),
	] as ChoiceSection[];

	function setStyle() {
		if (!instance) return;
		instance.states[state].style = bold && italic ? "Bold Italic" : bold ? "Bold" : italic ? "Italic" : "Regular";
	}

	function solidColour(event: Event) {
		if (!instance) return;
		const value = (event.target as HTMLInputElement).value;
		const canvas = document.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		const context = canvas.getContext("2d");
		if (!context) return;
		context.fillStyle = value;
		context.fillRect(0, 0, 1, 1);
		instance.states[state].image = canvas.toDataURL("image/png");
	}

	const positions = [
		{ value: "top", label: "instance_editor.alignment.top" },
		{ value: "middle", label: "instance_editor.alignment.middle" },
		{ value: "bottom", label: "instance_editor.alignment.bottom" },
	] as const;
</script>

{#if instance}
<div class="flex flex-col pt-0.5" on:dragover={(event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; }} on:drop={handleDrop}>
	{#if instance.states.length > 1}
		<div class="seg mb-2" role="radiogroup" aria-label={$t("instance_editor.state")}>
			{#each instance.states as _, i}
				<button role="radio" aria-checked={state == i} class:on={state == i} on:click={() => (state = i)}>{$t("instance_editor.state.n", { n: i + 1 })}</button>
			{/each}
		</div>
	{/if}

	<section class="insp-sect">
		<h4 class="flex flex-row items-center">
			{$t("instance_editor.title")}
			<label class="ml-auto flex flex-row items-center gap-2 font-normal text-neutral-400">
				{$t("instance_editor.show")}
				<input type="checkbox" role="switch" class="switch" bind:checked={instance.states[state].show} />
			</label>
		</h4>
		<div class="insp-row">
			<label for="editor-text" class="lb">{$t("instance_editor.text")}</label>
			<input id="editor-text" class="field flex-1" bind:value={instance.states[state].text} placeholder={instance.action.states[state]?.text || instance.action.name} />
		</div>
		<div class="insp-row">
			<span class="lb">{$t("instance_editor.alignment")}</span>
			<div class="mini" role="radiogroup" aria-label={$t("instance_editor.alignment")}>
				{#each positions as p}
					<button role="radio" aria-checked={instance.states[state].alignment == p.value} class:on={instance.states[state].alignment == p.value} on:click={() => (instance.states[state].alignment = p.value)}>{$t(p.label)}</button>
				{/each}
			</div>
		</div>
		<div class="insp-row">
			<span class="lb">{$t("instance_editor.font")}</span>
			<div class="flex-1 min-w-0"><ChoiceMenu variant="field" label={$t("instance_editor.font")} current={instance.states[state].family || "Liberation Sans"} sections={fontSections} on:choose={(e) => (instance.states[state].family = e.detail)} /></div>
			<input type="number" min="4" max="96" class="field w-12 text-center no-spinner" bind:value={instance.states[state].size} aria-label={$t("instance_editor.font.size")} />
		</div>
		<div class="insp-row">
			<span class="lb">{$t("instance_editor.style")}</span>
			<div class="mini">
				<button aria-pressed={bold} class:on={bold} on:click={() => { bold = !bold; setStyle(); }} aria-label="Bold"><TextB size="14" weight="bold" /></button>
				<button aria-pressed={italic} class:on={italic} on:click={() => { italic = !italic; setStyle(); }} aria-label="Italic"><TextItalic size="14" /></button>
				<button aria-pressed={instance.states[state].underline} class:on={instance.states[state].underline} on:click={() => (instance.states[state].underline = !instance.states[state].underline)} aria-label="Underline"><TextUnderline size="14" /></button>
			</div>
		</div>
		<div class="insp-row">
			<span class="lb">{$t("instance_editor.colour")}</span>
			<label class="swatch" style="background: {instance.states[state].colour}" title={$t("instance_editor.colour")}><input type="color" bind:value={instance.states[state].colour} /></label>
			<span class="ml-2.5 text-neutral-400">{$t("instance_editor.outline")}</span>
			<label class="swatch" style="background: {instance.states[state].stroke_colour}" title={$t("instance_editor.stroke")}><input type="color" bind:value={instance.states[state].stroke_colour} /></label>
			<input type="number" min="0" max="20" class="field w-11 text-center no-spinner" bind:value={instance.states[state].stroke_size} aria-label={$t("instance_editor.outline")} />
		</div>
	</section>

	<section class="insp-sect">
		<h4>{$t("instance_editor.picture")}</h4>
		<div class="insp-row">
			<span class="lb">{$t("instance_editor.image")}</span>
			<button class="btn" on:click={() => fileInput.click()}><ImageIcon size="14" />{$t("instance_editor.image.choose")}</button>
			<button class="btn quiet" on:click={() => (instance.states[state].image = instance.action.states[state]?.image ?? instance.action.icon)}>{$t("instance_editor.image.default")}</button>
		</div>
		<div class="insp-row">
			<span class="lb">{$t("instance_editor.image.size")}</span>
			<input type="range" min="10" max="200" step="5" class="range flex-1" bind:value={instance.states[state].image_scale} aria-label={$t("instance_editor.image.size")} />
			<span class="w-10 text-right tabular-nums text-neutral-200">{instance.states[state].image_scale || 100}%</span>
		</div>
		<div class="insp-row">
			<span class="lb">{$t("instance_editor.background")}</span>
			<label class="swatch" style="background: {instance.states[state].background_colour}" title={$t("instance_editor.background")}><input type="color" bind:value={instance.states[state].background_colour} /></label>
			<label class="btn quiet relative">{$t("instance_editor.solid_colour")}<input type="color" class="absolute inset-0 opacity-0 cursor-pointer" value="#FFFFFE" on:change={solidColour} /></label>
		</div>
		<p class="mt-1 text-xs text-neutral-500">{$t("instance_editor.image.hint")}</p>
	</section>

	<input
		bind:this={fileInput}
		type="file"
		class="hidden"
		accept="image/*"
		on:change={async () => {
			if (!fileInput.files || fileInput.files.length == 0 || !instance) return;
			const reader = new FileReader();
			reader.onload = async () => {
				let result = reader.result?.toString();
				if (result && instance) {
					let resized = await resizeImage(result);
					instance.states[state].image = resized || result;
				}
			};
			reader.readAsDataURL(fileInput.files[0]);
			fileInput.value = "";
		}}
	/>
</div>
{/if}
