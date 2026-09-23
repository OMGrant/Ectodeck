<script lang="ts">
	import ArrowSquareOut from "phosphor-svelte/lib/ArrowSquareOut";
	import DownloadSimple from "phosphor-svelte/lib/DownloadSimple";
	import Check from "phosphor-svelte/lib/Check";

	import { t } from "$lib/i18n.ts";
	import "$lib/shims.ts";

	import { invoke } from "@tauri-apps/api/core";
	import DOMPurify from "dompurify";
	import { marked } from "marked";
	import markedAlert from "marked-alert";
	import { baseUrl } from "marked-base-url";
	import { onMount } from "svelte";

	export let id: string;
	export let details: { repository: string; name: string; author: string; download_url: string | undefined };
	let readme = `<strong>${$t("plugin_details.loading")}</strong>`;
	let downloadCount = 0;

	export let install: () => void;
	export let installed = false;

	// @ts-expect-error
	const fetch = window.fetchNative ?? window.fetch;

	async function getReadme(repo: string): Promise<string> {
		const renderer = new marked.Renderer();
		renderer.link = function (token) {
			const rendered = marked.Renderer.prototype.link.call(this, token);
			return rendered.replace("<a", `<a target="_blank" `);
		};
		marked.use({ renderer });
		const urls = [
			"https://raw.githubusercontent.com/" + repo + "/main/README.md",
			"https://raw.githubusercontent.com/" + repo + "/main/readme.md",
			"https://raw.githubusercontent.com/" + repo + "/master/README.md",
			"https://raw.githubusercontent.com/" + repo + "/master/readme.md",
		];
		for (const url of urls) {
			const response = await fetch(url);
			if (response.ok) {
				marked.use(markedAlert());
				marked.use(baseUrl(url));
				return await marked.parse(DOMPurify.sanitize(await response.text()).replace(/<a/g, '<a target="_blank" '));
			}
		}
		return await marked.parse($t("plugin_details.readme.not_found", { repo }));
	}

	function handleReadmeClick(event: MouseEvent | KeyboardEvent) {
		const link = (event.target as HTMLElement).closest("a");
		if (link && link.href) {
			event.preventDefault();
			window.open(link.href);
		}
	}

	onMount(async () => {
		const repo = details.repository.split("/")[3] + "/" + details.repository.split("/")[4];

		readme = await getReadme(repo);

		const releasesResponse = await fetch("https://api.github.com/repos/" + repo + "/releases");
		const releases = await releasesResponse.json();
		for (const release of releases) {
			for (const asset of release.assets) {
				downloadCount += asset.download_count;
			}
		}
	});
</script>

	<div class="px-[18px] pb-6 min-w-0">
	<div class="flex flex-row items-start gap-6">
		<img src={"https://openactionapi.github.io/plugins/icons/" + id + ".png"} alt={details.name} class="size-28 rounded-2xl bg-neutral-900" />
		<div class="flex flex-col justify-center min-h-28">
			<div class="text-2xl font-semibold tracking-[-0.02em] text-neutral-100">{details.name}</div>
			<div class="flex items-center mt-1.5 text-neutral-400">
				<span class="mr-2">{$t("plugin_details.by")}</span>
				<img src={"https://avatars.githubusercontent.com/" + details.repository.split("/")[3]} alt="" class="size-5 mr-1.5 rounded-full" />
				<button on:click={() => invoke("open_url", { url: "https://github.com/" + details.repository.split("/")[3] })} class="underline">
					{details.author}
					{#if details.repository.split("/")[3] != details.author}
						({details.repository.split("/")[3]})
					{/if}
				</button>
			</div>
			<div class="flex flex-row items-center gap-2 mt-4">
				{#if installed}
					<span class="btn pointer-events-none opacity-70"><Check size={14} />{$t("plugin_details.installed")}</span>
				{:else}
					<button on:click={install} class="btn primary">{$t("plugin_details.install")}</button>
				{/if}
				<button on:click={() => invoke("open_url", { url: details.download_url ?? details.repository + "/releases/latest" })} class="btn quiet">
					<ArrowSquareOut size={14} />{$t("plugin_details.download_latest")}
				</button>
				{#if downloadCount}
					<span class="flex flex-row items-center gap-1 ml-2 text-xs text-neutral-400"><DownloadSimple size={14} />{downloadCount}</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
	<div
		class="mt-5 p-6 max-w-full overflow-x-auto plugin-readme text-neutral-300 bg-neutral-900 border border-neutral-700 rounded-xl"
		on:click={handleReadmeClick}
		on:keyup={handleReadmeClick}
		role="region"
	>
		{@html readme}
	</div>
	</div>

