<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { t } from "$lib/i18n";
	import type { AnimatedBackground, DeviceInfo, KeyStyle } from "$lib/DeviceInfo";

	export let device: DeviceInfo;
	export let background: string | null = null;
	export let keyStyle: KeyStyle = { backdrop: true };
	export let animated: AnimatedBackground | null = null;

	let fileInput: HTMLInputElement;
	let pageInput: HTMLInputElement;
	let shaderInput: HTMLInputElement;

	// Shaders that ship with Ectodeck, in static/backgrounds.
	const builtinShaders = [
		{ id: "aurora", name: "Aurora" },
		{ id: "nebula", name: "Nebula" },
		{ id: "ember", name: "Ember" },
	];

	// What the animation menu shows as chosen.
	$: animationChoice = !animated
		? "none"
		: animated.kind == "shader" && builtinShaders.some((s) => s.name == animated?.name)
			? "builtin:" + animated.name
			: "custom";

	let enteringUrl = false;
	let url = "";

	async function setAnimated(value: AnimatedBackground | null) {
		animated = value;
		enteringUrl = false;
		await invoke("set_device_animated_background", { device: device.id, background: value });
	}

	async function chooseAnimation(event: Event) {
		const select = event.target as HTMLSelectElement;
		const value = select.value;
		// the menu holds commands as well as choices; show the real choice again
		select.value = animationChoice;
		if (value == "none") await setAnimated(null);
		else if (value.startsWith("builtin:")) {
			const shader = builtinShaders.find((s) => "builtin:" + s.name == value);
			if (!shader) return;
			const source = await (await fetch(`/backgrounds/${shader.id}.frag`)).text();
			await setAnimated({ kind: "shader", name: shader.name, source });
		} else if (value == "url") {
			url = animated?.kind == "web" && !animated.url.startsWith("/") ? animated.url : "";
			enteringUrl = true;
		} else if (value == "page") pageInput.click();
		else if (value == "shader") shaderInput.click();
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
		<select
			class="px-2 py-0.5 text-neutral-300 bg-neutral-700 hover:bg-neutral-600 transition-colors border border-neutral-600 rounded-lg"
			value={animationChoice}
			on:change={chooseAnimation}
		>
			<option value="none">{$t("device_view.animation.none")}</option>
			<optgroup label={$t("device_view.animation.builtin")}>
				{#each builtinShaders as shader}
					<option value={"builtin:" + shader.name}>{shader.name}</option>
				{/each}
			</optgroup>
			{#if animationChoice == "custom" && animated}
				<option value="custom">{animated.name}</option>
			{/if}
			<optgroup label={$t("device_view.animation.custom")}>
				<option value="url">{$t("device_view.animation.url")}</option>
				<option value="page">{$t("device_view.animation.page")}</option>
				<option value="shader">{$t("device_view.animation.shader")}</option>
			</optgroup>
		</select>
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
{/if}
