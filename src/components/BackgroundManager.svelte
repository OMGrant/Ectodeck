<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { t } from "$lib/i18n";
	import type { AnimatedBackground, DeviceInfo, KeyStyle } from "$lib/DeviceInfo";
	import ChoiceMenu, { type ChoiceSection } from "./ChoiceMenu.svelte";
	import ParameterControls from "./ParameterControls.svelte";
	import { type IsfInput, pageInputs, shaderInputs } from "$lib/isf";
	import { getWebserverUrl } from "$lib/ports";

	export let device: DeviceInfo;
	export let background: string | null = null;
	export let keyStyle: KeyStyle = { backdrop: true };
	export let animated: AnimatedBackground | null = null;

	let fileInput: HTMLInputElement;
	let pageInput: HTMLInputElement;
	let shaderInput: HTMLInputElement;

	// Shaders that ship with Ectodeck, built into the interface so choosing one
	// needs nothing loaded at the time.
	import aurora from "$lib/backgrounds/aurora.frag?raw";
	import nebula from "$lib/backgrounds/nebula.frag?raw";
	import ember from "$lib/backgrounds/ember.frag?raw";
	import blob from "$lib/backgrounds/blob.html?raw";
	const builtinShaders = [
		{ id: "aurora", name: "Aurora", source: aurora },
		{ id: "nebula", name: "Nebula", source: nebula },
		{ id: "ember", name: "Ember", source: ember },
	];
	// Built-in web pages, written to the configuration directory when chosen,
	// since the page renderer opens files rather than the app's own assets.
	const builtinPages = [{ id: "blob", name: "Blob", file: "blob.html", html: blob }];
	const isBuiltin = (a: AnimatedBackground | null) =>
		!!a &&
		((a.kind == "shader" && builtinShaders.some((s) => s.name == a.name)) || (a.kind == "web" && builtinPages.some((p) => p.name == a.name)));

	// The current animation's adjustable parameters, from its ISF inputs.
	let inputs: IsfInput[] = [];
	async function readInputs(a: AnimatedBackground | null) {
		if (!a) return [];
		if (a.kind == "shader") return shaderInputs(a.source);
		const page = builtinPages.find((p) => p.name == a.name);
		if (page) return pageInputs(page.html);
		// a page kept on disk can be read back through the local file server
		if (a.url.startsWith("/")) {
			try {
				return pageInputs(await (await fetch(getWebserverUrl(a.url.slice(1)))).text());
			} catch {
				return [];
			}
		}
		return [];
	}
	$: readInputs(animated).then((i) => (inputs = i));

	// Parameter changes go out after a short pause: at once for a shader, which
	// updates live, and after a longer one for a page, which reloads.
	let paramTimer: ReturnType<typeof setTimeout> | undefined;
	function changeParams(values: Record<string, unknown>) {
		if (!animated) return;
		const next = { ...animated, params: values } as AnimatedBackground;
		animated = next;
		clearTimeout(paramTimer);
		paramTimer = setTimeout(() => setAnimated(next), next.kind == "shader" ? 40 : 450);
	}

	// A choice that failed, shown beside the menu rather than lost.
	let animationError = "";

	// The animation menu: nothing, a built-in shader, or one of your own.
	$: animationSections = [
		{ items: [{ id: "none", label: $t("device_view.animation.none"), selected: !animated }] },
		{
			heading: $t("device_view.animation.builtin"),
			items: [
				...builtinPages.map((p) => ({ id: "page:" + p.id, label: p.name, selected: animated?.kind == "web" && animated.name == p.name })),
				...builtinShaders.map((s) => ({
					id: "builtin:" + s.id,
					label: s.name,
					selected: animated?.kind == "shader" && animated.name == s.name,
				})),
			],
		},
		{
			heading: $t("device_view.animation.custom"),
			items: [
				...(animated && !isBuiltin(animated) ? [{ id: "current", label: animated.name, selected: true }] : []),
				{ id: "url", label: $t("device_view.animation.url") },
				{ id: "page", label: $t("device_view.animation.page") },
				{ id: "shader", label: $t("device_view.animation.shader") },
			],
		},
	] as ChoiceSection[];
	$: animationLabel = animated ? animated.name : $t("device_view.animation.none");

	let enteringUrl = false;
	let url = "";

	async function setAnimated(value: AnimatedBackground | null) {
		const previous = animated;
		animated = value;
		enteringUrl = false;
		animationError = "";
		try {
			await invoke("set_device_animated_background", { device: device.id, background: value });
		} catch (error) {
			animated = previous;
			animationError = String(error);
			console.error(error);
		}
	}

	async function chooseAnimation(id: string) {
		if (id == "none") await setAnimated(null);
		else if (id.startsWith("builtin:")) {
			const shader = builtinShaders.find((s) => "builtin:" + s.id == id);
			if (shader) await setAnimated({ kind: "shader", name: shader.name, source: shader.source, params: {} });
		} else if (id.startsWith("page:")) {
			const page = builtinPages.find((p) => "page:" + p.id == id);
			if (!page) return;
			try {
				const path = await invoke<string>("save_background_page", { name: page.file, contents: page.html });
				await setAnimated({ kind: "web", name: page.name, url: path, params: {} });
			} catch (error) {
				animationError = String(error);
			}
		} else if (id == "url") {
			url = animated?.kind == "web" && !animated.url.startsWith("/") ? animated.url : "";
			enteringUrl = true;
		} else if (id == "page") pageInput.click();
		else if (id == "shader") shaderInput.click();
	}

	function readText(event: Event): Promise<{ name: string; text: string } | null> {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return Promise.resolve(null);
		return file.text().then((text) => ({ name: file.name, text }));
	}

	async function choosePage(event: Event) {
		const file = await readText(event);
		if (!file) return;
		const path = await invoke<string>("save_background_page", { name: file.name, contents: file.text });
		await setAnimated({ kind: "web", name: file.name, url: path });
	}

	async function chooseShader(event: Event) {
		const file = await readText(event);
		if (!file) return;
		await setAnimated({ kind: "shader", name: file.name, source: file.text });
	}

	async function applyUrl() {
		const value = url.trim();
		if (!value) return;
		const full = /^[a-z]+:\/\//i.test(value) ? value : "https://" + value;
		await setAnimated({ kind: "web", name: full, url: full });
	}

	async function load(device: DeviceInfo) {
		if (!device.has_background) return;
		background = await invoke<string | null>("get_device_background", { device: device.id });
		keyStyle = await invoke<KeyStyle>("get_device_key_style", { device: device.id });
		animated = await invoke<AnimatedBackground | null>("get_device_animated_background", { device: device.id });
	}

	const backdropOptions = [
		{ value: true, label: "device_view.key_background.show" },
		{ value: false, label: "device_view.key_background.hide" },
	];

	async function setStyle(change: Partial<KeyStyle>) {
		keyStyle = { ...keyStyle, ...change };
		await invoke("set_device_key_style", { device: device.id, style: keyStyle });
	}
	$: load(device);

	async function apply(image: string | null) {
		background = image;
		await invoke("set_device_background", { device: device.id, image });
	}

	// Fit the picked image to the panel here, before it is stored or sent. A
	// photo straight from disk is a multi-megabyte data URL, which is far more
	// than the store, the IPC or the plugin's socket should carry, and far
	// more than the panel can show.
	function fitToPanel(source: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const p = device.panel;
			const width = p?.width ?? 854;
			const height = p?.height ?? 480;
			const img = new Image();
			img.onerror = () => reject(new Error("not a usable image"));
			img.onload = () => {
				const canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = height;
				const c = canvas.getContext("2d");
				if (!c) return reject(new Error("no canvas"));
				const scale = Math.max(width / img.width, height / img.height);
				const w = img.width * scale;
				const h = img.height * scale;
				c.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
				resolve(canvas.toDataURL("image/jpeg", 0.9));
			};
			img.src = source;
		});
	}

	function choose(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file || !file.type.startsWith("image/")) return;
		const reader = new FileReader();
		reader.onload = async () => {
			const result = reader.result?.toString();
			if (!result) return;
			try {
				apply(await fitToPanel(result));
			} catch (e) {
				console.error(e);
			}
		};
		reader.readAsDataURL(file);
		(event.target as HTMLInputElement).value = "";
	}
</script>

{#if device.has_background}
	<div class="flex flex-row items-center gap-2 text-sm">
		<span class="text-neutral-400">{$t("device_view.background")}</span>

		<button
			class="px-2 py-0.5 text-neutral-300 bg-neutral-700 hover:bg-neutral-600 transition-colors border border-neutral-600 rounded-lg"
			title={$t("device_view.background.hint")}
			on:click={() => fileInput.click()}
		>
			{background ? $t("device_view.background.change") : $t("device_view.background.choose")}
		</button>

		{#if background}
			<button
				class="px-2 py-0.5 text-neutral-400 hover:text-neutral-200 transition-colors"
				on:click={() => apply(null)}
			>
				{$t("device_view.background.clear")}
			</button>
		{/if}

		<input type="file" accept="image/*" class="hidden" bind:this={fileInput} on:change={choose} />

		<span class="ml-4 text-neutral-400">{$t("device_view.animation")}</span>
		<ChoiceMenu label={$t("device_view.animation")} current={animationLabel} sections={animationSections} on:choose={(e) => chooseAnimation(e.detail)} />
		{#if animationError}
			<span class="text-red-400" role="alert">{$t("device_view.animation.failed", { error: animationError })}</span>
		{/if}
		{#if enteringUrl}
			<form class="flex flex-row items-center gap-1" on:submit|preventDefault={applyUrl}>
				<!-- svelte-ignore a11y-autofocus -->
				<input
					bind:value={url}
					autofocus
					placeholder="https://example.com"
					class="w-56 px-2 py-0.5 text-neutral-200 bg-neutral-800 border border-neutral-600 rounded-lg outline-none focus:border-blue-500"
				/>
				<button type="submit" class="px-2 py-0.5 text-neutral-300 bg-neutral-700 hover:bg-neutral-600 transition-colors border border-neutral-600 rounded-lg">
					{$t("device_view.animation.apply")}
				</button>
				<button type="button" class="px-2 py-0.5 text-neutral-400 hover:text-neutral-200 transition-colors" on:click={() => (enteringUrl = false)}>
					{$t("device_view.animation.cancel")}
				</button>
			</form>
		{/if}
		<input type="file" accept=".html,.htm,text/html" class="hidden" bind:this={pageInput} on:change={choosePage} />
		<input type="file" accept=".frag,.glsl,.fs,.txt" class="hidden" bind:this={shaderInput} on:change={chooseShader} />

		<span class="ml-4 text-neutral-400">{$t("device_view.key_background")}</span>
		<div class="flex flex-row border border-neutral-600 rounded-lg overflow-hidden" role="radiogroup" aria-label={$t("device_view.key_background")}>
			{#each backdropOptions as { value, label }}
				<button
					class="px-2 py-0.5 transition-colors"
					class:bg-neutral-600={keyStyle.backdrop === value}
					class:text-neutral-100={keyStyle.backdrop === value}
					class:bg-neutral-800={keyStyle.backdrop !== value}
					class:text-neutral-400={keyStyle.backdrop !== value}
					class:hover:bg-neutral-700={keyStyle.backdrop !== value}
					role="radio"
					aria-checked={keyStyle.backdrop === value}
					on:click={() => setStyle({ backdrop: value })}
				>
					{$t(label)}
				</button>
			{/each}
		</div>
	</div>
	{#if animated && inputs.length}
		<div class="mt-2 flex flex-row items-start gap-3 text-sm">
			<span class="text-neutral-400 whitespace-nowrap">{$t("parameters.adjust", { name: animated.name })}</span>
			<ParameterControls {inputs} values={animated.params ?? {}} on:change={(e) => changeParams(e.detail)} />
		</div>
	{/if}
{/if}
