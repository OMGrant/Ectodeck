<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { t } from "$lib/i18n";
	import type { AnimatedBackground, DeviceInfo, KeyStyle } from "$lib/DeviceInfo";
	import ChoiceMenu, { type ChoiceSection } from "./ChoiceMenu.svelte";
	import ParameterControls from "./ParameterControls.svelte";
	import { type IsfInput, pageInputs, shaderInputs } from "$lib/isf";
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
	import blob from "$lib/backgrounds/blob.html?raw";
	const builtinShaders = [
		{ id: "aurora", name: "Aurora", source: aurora },
		{ id: "nebula", name: "Nebula", source: nebula },
		{ id: "ember", name: "Ember", source: ember },
	];
	// Built-in web pages, written to the configuration directory when chosen,
	// since the page renderer opens files rather than the app's own assets.
	const builtinPages = [{ id: "blob", name: "Blob", file: "blob.html", html: blob }];

	// A built-in page's address carries a fingerprint of its contents, so a
	// newer version of the page is a different address: the renderer loads
	// it afresh instead of keeping the copy written when it was first chosen.
	function fingerprint(text: string): string {
		let h = 2166136261;
		for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
		return (h >>> 0).toString(36);
	}
	async function writeBuiltinPage(page: (typeof builtinPages)[number]): Promise<string> {
		const path = await invoke<string>("save_background_page", { name: page.file, contents: page.html });
		return path + "#" + fingerprint(page.html);
	}
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
		{ items: [{ id: "none", label: $t("device_view.animation.none"), selected: !animated && !background }] },
		{
			heading: $t("device_view.picture"),
			items: [
				...(background ? [{ id: "picture:current", label: $t("device_view.picture.current"), selected: !animated }] : []),
				{ id: "picture:choose", label: $t("device_view.picture.choose") },
			],
		},
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

	let adjusting = false;
	$: if (!inputs.length) adjusting = false;
	$: builtin = isBuiltin(animated);
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
			if (shader) await setAnimated({ kind: "shader", name: shader.name, source: shader.source, params: {} });
		} else if (id.startsWith("page:")) {
			const page = builtinPages.find((p) => "page:" + p.id == id);
			if (!page) return;
			try {
				await setAnimated({ kind: "web", name: page.name, url: await writeBuiltinPage(page), params: {} });
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
		// bring a built-in chosen under an older version up to date: a page
		const current = animated;
		const page = current?.kind == "web" ? builtinPages.find((p) => p.name == current.name) : undefined;
		if (current?.kind == "web" && page && !current.url.endsWith("#" + fingerprint(page.html))) {
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
	<section class="insp-sect">
		<h4>{$t("device_view.background")}</h4>
		<div class="flex flex-row items-center gap-3">
			<div class="relative shrink-0 w-32 aspect-[854/480] rounded-lg overflow-hidden bg-neutral-950 ring-1 ring-neutral-700">
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
					{#if animated && inputs.length}
						<button class="btn quiet h-[26px]! px-2!" class:bg-neutral-750={adjusting} aria-pressed={adjusting} on:click={() => (adjusting = !adjusting)}>{$t("parameters.adjust_short")}</button>
					{/if}
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
		{#if adjusting && animated}
			<div class="mt-2.5">
				<ParameterControls {inputs} values={animated.params ?? {}} on:change={(e) => changeParams(e.detail)} />
			</div>
		{/if}
		<input type="file" accept="image/*" class="hidden" bind:this={fileInput} on:change={choose} />
		<input type="file" accept=".html,.htm,text/html" class="hidden" bind:this={pageInput} on:change={choosePage} />
		<input type="file" accept=".frag,.glsl,.fs,.txt" class="hidden" bind:this={shaderInput} on:change={chooseShader} />
	</section>

	<section class="insp-sect">
		<h4>{$t("device_view.key_background")}</h4>
		<div class="mini w-fit" role="radiogroup" aria-label={$t("device_view.key_background")}>
			{#each backdropOptions as { value, label }}
				<button role="radio" aria-checked={keyStyle.backdrop === value} class:on={keyStyle.backdrop === value} on:click={() => setStyle({ backdrop: value })}>{$t(label)}</button>
			{/each}
		</div>
		<p class="mt-1.5 text-xs text-neutral-500">{$t("device_view.key_background.hint")}</p>
	</section>
{/if}
