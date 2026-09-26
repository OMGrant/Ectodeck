<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { t } from "$lib/i18n";
	import type { AnimatedBackground, DeviceInfo, KeyStyle } from "$lib/DeviceInfo";
	import ChoiceMenu, { type ChoiceSection } from "./ChoiceMenu.svelte";
	import ParameterControls from "./ParameterControls.svelte";
	import CaretDown from "phosphor-svelte/lib/CaretDown";
	import CaretRight from "phosphor-svelte/lib/CaretRight";
	import { currentPreset, defaultValue, type IsfInput, pageInputs, type Preset, presetsOf, shaderInputs } from "$lib/isf";
	import { listen } from "@tauri-apps/api/event";
	import { onDestroy } from "svelte";
	import { getWebserverUrl } from "$lib/ports";
	import { devicePreviews } from "$lib/deviceLook";
	import Sparkle from "phosphor-svelte/lib/Sparkle";
	import ImageIcon from "phosphor-svelte/lib/Image";

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
	import synthwave from "$lib/backgrounds/synthwave.frag?raw";
	import lava from "$lib/backgrounds/lava.frag?raw";
	import warp from "$lib/backgrounds/warp.frag?raw";
	import spectrum from "$lib/backgrounds/spectrum.frag?raw";
	import weather from "$lib/backgrounds/weather.frag?raw";
	import ink from "$lib/backgrounds/ink.frag?raw";
	import blob from "$lib/backgrounds/blob.frag?raw";
	type Group = "scenes" | "abstract" | "music";
	const builtinShaders: { id: string; name: string; source: string; group: Group }[] = [
		{ id: "synthwave", name: "Synthwave", source: synthwave, group: "scenes" },
		{ id: "warp", name: "Warp", source: warp, group: "scenes" },
		{ id: "weather", name: "Weather", source: weather, group: "scenes" },
		{ id: "aurora", name: "Aurora", source: aurora, group: "abstract" },
		{ id: "nebula", name: "Nebula", source: nebula, group: "abstract" },
		{ id: "ink", name: "Ink", source: ink, group: "abstract" },
		{ id: "blob", name: "Blob", source: blob, group: "abstract" },
		{ id: "ember", name: "Ember", source: ember, group: "abstract" },
		{ id: "lava", name: "Lava Lamp", source: lava, group: "abstract" },
		{ id: "spectrum", name: "Spectrum", source: spectrum, group: "music" },
	];
	// Built-in web pages, written to the configuration directory when chosen,
	// since the page renderer opens files rather than the app's own assets.
	// Some carry whole libraries, so each is loaded only when it is needed.
	const pageSources = import.meta.glob("$lib/backgrounds/*.html", { query: "?raw", import: "default" }) as Record<string, () => Promise<string>>;
	const page = (file: string) => pageSources[`/src/lib/backgrounds/${file}`];
	const builtinPages: { id: string; name: string; file: string; group: Group; load: () => Promise<string> }[] = [
		{ id: "aquarium", name: "Aquarium", file: "aquarium.html", group: "scenes", load: page("aquarium.html") },
		{ id: "birds", name: "Birds", file: "birds.html", group: "scenes", load: page("birds.html") },
		{ id: "milkdrop", name: "Milkdrop", file: "milkdrop.html", group: "music", load: page("milkdrop.html") },
	];

	// A built-in page's address carries a fingerprint of its contents, so a
	// newer version of the page is a different address: the renderer loads
	// it afresh instead of keeping the copy written when it was first chosen.
	function fingerprint(text: string): string {
		let h = 2166136261;
		for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
		return (h >>> 0).toString(36);
	}
	async function writeBuiltinPage(page: (typeof builtinPages)[number]): Promise<string> {
		const html = await page.load();
		const path = await invoke<string>("save_background_page", { name: page.file, contents: html });
		return path + "#" + fingerprint(html);
	}
	const isBuiltin = (a: AnimatedBackground | null) =>
		!!a &&
		((a.kind == "shader" && builtinShaders.some((s) => s.name == a.name)) || (a.kind == "web" && builtinPages.some((p) => p.name == a.name)));

	// The current animation's adjustable parameters, from its ISF inputs.
	let inputs: IsfInput[] = [];
	let presets: Preset[] = [];
	// the background's own source, where its settings and presets are declared
	async function readSource(a: AnimatedBackground | null): Promise<string> {
		if (!a) return "";
		if (a.kind == "shader") return a.source;
		const builtin = builtinPages.find((p) => p.name == a.name);
		if (builtin) return await builtin.load();
		// a page kept on disk can be read back through the local file server
		if (a.url.startsWith("/")) {
			try {
				return await (await fetch(getWebserverUrl(a.url.slice(1)))).text();
			} catch {
				return "";
			}
		}
		return "";
	}
	let readFor = "";
	$: {
		const a = animated;
		const key = a ? a.name + ":" + (a.kind == "shader" ? a.source.length : a.url) : "";
		if (key != readFor) {
			readFor = key;
			lastPreset = -1;
			readSource(a).then((text) => {
				if (!a) {
					inputs = [];
					presets = [];
					return;
				}
				inputs = a.kind == "shader" ? shaderInputs(text) : pageInputs(text);
				presets = presetsOf(text, a.kind);
			});
		}
	}

	// Presets: the menu, and the Background Preset action from a key or dial.
	$: presetIndex = animated && presets.length ? currentPreset(presets, animated.params ?? {}, inputs) : -1;
	$: presetSections = [{ items: presets.map((p, i) => ({ id: String(i), label: p.name, selected: i == presetIndex })) }] as ChoiceSection[];
	// the preset last in effect, which Adjust's reset goes back to
	let lastPreset = -1;
	$: if (presets && presetIndex >= 0) lastPreset = presetIndex;
	// back to the preset, or to the defaults when there are no presets; the
	// frame rate is the deck's, not the look's, so it stays
	function resetAdjustments() {
		if (!animated) return;
		const fps = animated.params?.fps;
		const values = lastPreset >= 0 && presets[lastPreset] ? presets[lastPreset].values : {};
		setAnimated({ ...animated, params: { ...(fps ? { fps } : {}), ...values } } as AnimatedBackground);
	}
	// whether any setting under Adjust differs from what the reset gives back
	$: adjusted =
		!!animated &&
		adjustInputs.some((input) => {
			const params = animated?.params ?? {};
			const base = lastPreset >= 0 && presets[lastPreset] ? presets[lastPreset].values : {};
			const now = input.NAME in params ? params[input.NAME] : defaultValue(input);
			const then = input.NAME in base ? base[input.NAME] : defaultValue(input);
			return JSON.stringify(now) != JSON.stringify(then);
		});
	function applyPreset(index: number) {
		if (!animated || !presets[index]) return;
		const next = { ...animated, params: { ...(animated.params ?? {}), ...presets[index].values } } as AnimatedBackground;
		setAnimated(next);
	}
	function stepPreset(steps: number) {
		if (!presets.length || !steps) return;
		const n = presets.length;
		// from settings that match no preset, the first step lands on the first or last
		const from = presetIndex == -1 ? (steps > 0 ? -1 : 0) : presetIndex;
		applyPreset((((from + steps) % n) + n) % n);
	}
	const unlistenPreset = listen<{ device: string; steps: number }>("background_preset", ({ payload }) => {
		if (payload.device == device.id) stepPreset(payload.steps);
	});
	onDestroy(() => unlistenPreset.then((f) => f()));

	// Parameter changes go out after a short pause: at once for a shader, which
	// updates live, and after a longer one for a page, which reloads.
	let paramTimer: ReturnType<typeof setTimeout> | undefined;
	function changeParams(values: Record<string, unknown>) {
		if (!animated) return;
		const fps = animated.params?.fps;
		const next = { ...animated, params: fps ? { ...values, fps } : values } as AnimatedBackground;
		animated = next;
		clearTimeout(paramTimer);
		paramTimer = setTimeout(() => setAnimated(next), next.kind == "shader" ? 40 : 450);
	}

	// A choice that failed, shown beside the menu rather than lost.
	let animationError = "";

	// The animation menu: nothing, a built-in shader, or one of your own.
	$: animationSections = [
		{ items: [{ id: "none", label: $t("device_view.animation.none"), selected: !animated && !background }] },
		{
			heading: $t("device_view.picture"),
			items: [
				...(background ? [{ id: "picture:current", label: $t("device_view.picture.current"), selected: !animated }] : []),
				{ id: "picture:choose", label: $t("device_view.picture.choose") },
			],
		},
		...(["scenes", "abstract", "music"] as Group[]).map((group) => ({
			heading: $t("device_view.animation.group." + group),
			items: [
				...builtinPages.filter((p) => p.group == group).map((p) => ({ id: "page:" + p.id, label: p.name, selected: animated?.kind == "web" && animated.name == p.name })),
				...builtinShaders.filter((s) => s.group == group).map((s) => ({ id: "builtin:" + s.id, label: s.name, selected: animated?.kind == "shader" && animated.name == s.name })),
			].sort((a, b) => a.label.localeCompare(b.label)),
		})),
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

	let adjusting = false;
	// frames a second on the deck, kept with the background's settings
	$: fpsNow = Number(animated?.params?.fps ?? 30);
	function setFps(rate: number) {
		if (!animated) return;
		const next = { ...animated, params: { ...(animated.params ?? {}), fps: rate } } as AnimatedBackground;
		setAnimated(next);
	}
	// the input whose choices are the presets is the Preset menu itself, so
	// Adjust holds only what can be tuned under a preset
	$: adjustInputs = inputs.filter((input) => !(input as IsfInput & { PRESET?: boolean }).PRESET);
	$: if (!adjustInputs.length) adjusting = false;
	$: builtin = isBuiltin(animated);
	let enteringUrl = false;
	let url = "";

	// a background chosen again comes back with the settings it was left with
	async function remembered(name: string): Promise<Record<string, unknown>> {
		try {
			return (await invoke<Record<string, unknown> | null>("get_device_background_settings", { device: device.id, name })) ?? {};
		} catch {
			return {};
		}
	}

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
		if (id == "picture:choose") return fileInput.click();
		if (id == "picture:current") return setAnimated(null);
		if (id == "none") {
			await setAnimated(null);
			if (background) await apply(null);
			return;
		}
		if (id == "none") await setAnimated(null);
		else if (id.startsWith("builtin:")) {
			const shader = builtinShaders.find((s) => "builtin:" + s.id == id);
			if (shader) await setAnimated({ kind: "shader", name: shader.name, source: shader.source, params: await remembered(shader.name) });
		} else if (id.startsWith("page:")) {
			const page = builtinPages.find((p) => "page:" + p.id == id);
			if (!page) return;
			try {
				await setAnimated({ kind: "web", name: page.name, url: await writeBuiltinPage(page), params: await remembered(page.name) });
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
		// Weather took Sky's place: a deck on Sky moves to Weather's cloudy sea,
		// which is Sky's clouds, keeping its time of day and wind. And the
		// built-ins that were web pages and are now drawn by the deck's own
		// renderer: a deck on the page moves to the shader, keeping its settings
		const nowNative: Record<string, string> = { Sky: "Weather", Weather: "Weather", Ink: "Ink", Blob: "Blob" };
		if (animated?.kind == "web" && nowNative[animated.name]) {
			const shader = builtinShaders.find((b) => b.name == nowNative[animated!.name])!;
			const params = { ...(animated.params ?? {}), ...(animated.name == "Sky" ? { weather: 1 } : {}) };
			await setAnimated({ kind: "shader", name: shader.name, source: shader.source, params });
		}
		// bring a built-in chosen under an older version up to date: a page
		const current = animated;
		const page = current?.kind == "web" ? builtinPages.find((p) => p.name == current.name) : undefined;
		if (current?.kind == "web" && page && !current.url.endsWith("#" + fingerprint(await page.load()))) {
			await setAnimated({ ...current, url: await writeBuiltinPage(page) });
		}
		// and a built-in shader saved with older code
		const shader = current?.kind == "shader" ? builtinShaders.find((b) => b.name == current.name) : undefined;
		if (current?.kind == "shader" && shader && current.source != shader.source) {
			await setAnimated({ ...current, source: shader.source });
		}
	}

	const backdropOptions = [
		{ value: true, label: "device_view.key_background.show" },
		{ value: false, label: "device_view.key_background.hide" },
	];

	// dims the background behind the keys; sent after a short pause while dragging
	let brightTimer: ReturnType<typeof setTimeout> | undefined;
	function brighten(value: number) {
		keyStyle = { ...keyStyle, background_brightness: value };
		clearTimeout(brightTimer);
		brightTimer = setTimeout(() => setStyle({}), 60);
	}

	async function setStyle(change: Partial<KeyStyle>) {
		keyStyle = { ...keyStyle, ...change };
		await invoke("set_device_key_style", { device: device.id, style: keyStyle });
	}
	$: load(device);

	async function apply(image: string | null) {
		// choosing a picture means showing it, so it replaces an animation
		if (image && animated) await setAnimated(null);
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
	<!-- key tiles first: on the deck they sit above the background -->
	<section class="insp-sect">
		<h4>{$t("device_view.key_background")}</h4>
		<div class="mini w-fit" role="radiogroup" aria-label={$t("device_view.key_background")}>
			{#each backdropOptions as { value, label }}
				<button role="radio" aria-checked={keyStyle.backdrop === value} class:on={keyStyle.backdrop === value} on:click={() => setStyle({ backdrop: value })}>{$t(label)}</button>
			{/each}
		</div>
		<p class="mt-1.5 text-xs text-neutral-500">{$t("device_view.key_background.hint")}</p>
	</section>

	<section class="insp-sect">
		<h4>{$t("device_view.background")}</h4>
		<div class="flex flex-row items-center gap-3">
			<div class="relative shrink-0 w-32 aspect-[854/480] rounded-lg overflow-hidden bg-neutral-950">
				{#if animated && $devicePreviews[device.id]}
					<img src={$devicePreviews[device.id]} alt="" class="absolute inset-0 w-full h-full object-cover" />
				{:else if !animated && background}
					<img src={background} alt="" class="absolute inset-0 w-full h-full object-cover" />
				{/if}
			</div>
			<div class="min-w-0">
				<div class="truncate font-semibold text-neutral-100">{animated ? animated.name : background ? $t("device_view.picture") : $t("device_view.animation.none")}</div>
				<div class="flex flex-row items-center gap-[5px] mb-2 text-xs text-neutral-400">
					{#if animated}<Sparkle size="12" />{animated.kind == "shader" || builtin ? $t("device_view.animated.reacts") : $t("device_view.animated")}
					{:else if background}<ImageIcon size="12" />{$t("device_view.picture.still")}
					{:else}{$t("device_view.background.empty")}{/if}
				</div>
				<div class="flex flex-row gap-1.5">
					<ChoiceMenu label={$t("device_view.background.change")} current={$t("device_view.background.change")} sections={animationSections} on:choose={(e) => chooseAnimation(e.detail)} />
				</div>
			</div>
		</div>
		{#if animationError}
			<p class="mt-2 text-xs text-red-400" role="alert">{$t("device_view.animation.failed", { error: animationError })}</p>
		{/if}
		{#if enteringUrl}
			<form class="flex flex-row items-center gap-1.5 mt-2" on:submit|preventDefault={applyUrl}>
				<!-- svelte-ignore a11y-autofocus -->
				<input bind:value={url} autofocus placeholder="https://example.com" class="field flex-1" />
				<button type="submit" class="btn">{$t("device_view.animation.apply")}</button>
				<button type="button" class="btn quiet" on:click={() => (enteringUrl = false)}>{$t("device_view.animation.cancel")}</button>
			</form>
		{/if}
		{#if animated && presets.length}
			<div class="insp-row mt-2">
				<span class="lb">{$t("device_view.preset")}</span>
				<div class="flex-1 min-w-0">
					<ChoiceMenu variant="field" label={$t("device_view.preset")} current={presetIndex == -1 ? $t("device_view.preset.custom") : presets[presetIndex].name} sections={presetSections} on:choose={(e) => applyPreset(Number(e.detail))} />
				</div>
			</div>
		{/if}
		{#if animated && adjustInputs.length}
			<!-- Adjust unfolds under the preset: the fine-tuning of the look it sets -->
			<div class:mt-2={!presets.length}>
				<button class="insp-row w-full text-neutral-300 hover:text-neutral-100 transition-colors" aria-expanded={adjusting} on:click={() => (adjusting = !adjusting)}>
					<span class="flex flex-row items-center gap-1.5">
						{#if adjusting}<CaretDown size="12" />{:else}<CaretRight size="12" />{/if}
						{$t("parameters.adjust_short")}
					</span>
				</button>
				{#if adjusting}
					<div class="ml-[5px] pl-3 pb-1 border-l border-neutral-700">
						<ParameterControls inputs={adjustInputs} values={animated.params ?? {}} labelWidth="w-[74px]!" on:change={(e) => changeParams(e.detail)} />
						{#if adjusted}
							<button class="mt-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors" on:click={resetAdjustments}>
								{lastPreset >= 0 && presets[lastPreset] ? $t("parameters.reset_to", { name: presets[lastPreset].name }) : $t("parameters.reset")}
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
		{#if animated || background}
			<div class="insp-row" class:mt-2={!(animated && (presets.length || adjustInputs.length))}>
				<label class="lb" for="bg-brightness">{$t("device_view.bg_brightness")}</label>
				<input
					id="bg-brightness"
					type="range"
					min="10"
					max="100"
					step="5"
					class="range flex-1"
					value={Math.round((keyStyle.background_brightness ?? 1) * 100)}
					on:input={(e) => brighten(Number(e.currentTarget.value) / 100)}
				/>
				<span class="w-10 text-right tabular-nums text-neutral-200">{Math.round((keyStyle.background_brightness ?? 1) * 100)}%</span>
			</div>
		{/if}
		{#if animated}
			<div class="insp-row">
				<span class="lb">{$t("device_view.fps")}</span>
				<div class="mini" role="radiogroup" aria-label={$t("device_view.fps")}>
					{#each [15, 30, 45, 60] as rate}
						<button role="radio" aria-checked={fpsNow == rate} class:on={fpsNow == rate} on:click={() => setFps(rate)}>{rate}</button>
					{/each}
				</div>
			</div>
			<p class="text-xs text-neutral-500">{$t("device_view.fps.hint")}</p>
		{/if}
		<input type="file" accept="image/*" class="hidden" bind:this={fileInput} on:change={choose} />
		<input type="file" accept=".html,.htm,text/html" class="hidden" bind:this={pageInput} on:change={choosePage} />
		<input type="file" accept=".frag,.glsl,.fs,.txt" class="hidden" bind:this={shaderInput} on:change={chooseShader} />
	</section>
{/if}
