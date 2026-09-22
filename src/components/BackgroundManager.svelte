<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { t } from "$lib/i18n";
	import type { DeviceInfo } from "$lib/DeviceInfo";

	export let device: DeviceInfo;
	export let background: string | null = null;

	let fileInput: HTMLInputElement;

	async function load(device: DeviceInfo) {
		if (!device.has_background) return;
		background = await invoke<string | null>("get_device_background", { device: device.id });
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
	</div>
{/if}
