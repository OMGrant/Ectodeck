<script lang="ts">
	import pluginCompatibility from "$lib/pluginCompatibility.json";
	import ArrowClockwise from "phosphor-svelte/lib/ArrowClockwise";
	import PuzzlePiece from "phosphor-svelte/lib/PuzzlePiece";
	import ArrowSquareOut from "phosphor-svelte/lib/ArrowSquareOut";
	import CloudArrowDown from "phosphor-svelte/lib/CloudArrowDown";
	import FileArrowUp from "phosphor-svelte/lib/FileArrowUp";
	import Gear from "phosphor-svelte/lib/Gear";
	import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";
	import Trash from "phosphor-svelte/lib/Trash";
	import WarningCircle from "phosphor-svelte/lib/WarningCircle";
	import Dialog from "./Dialog.svelte";
	import DotsThree from "phosphor-svelte/lib/DotsThree";
	import Warning from "phosphor-svelte/lib/Warning";
	import Scroll from "phosphor-svelte/lib/Scroll";
	import ChoiceMenu, { type ChoiceSection } from "./ChoiceMenu.svelte";
	import PluginDetails from "./PluginDetails.svelte";
	import Popup from "./Popup.svelte";

	import { t } from "$lib/i18n";
	import { getWebserverUrl } from "$lib/ports";
	import { localisations, settings } from "$lib/settings";
	import { actionList, deviceSelector, PRODUCT_NAME } from "$lib/singletons";

	import { invoke } from "@tauri-apps/api/core";
	import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
	import { ask, message, open } from "@tauri-apps/plugin-dialog";

	// @ts-expect-error
	const fetch = window.fetchNative ?? window.fetch;

	let showPopup: boolean;
	setInterval(async () => {
		if (showPopup) installed = await invoke("list_plugins");
	}, 1e3);

	async function installPlugin(name: string, url: string | null, file: string | null, fallback_id: string | null) {
		if (
			!file &&
			!(await ask($t("plugin_manager.install.prompt"), {
				title: $t("plugin_manager.install.title", { name }),
				okLabel: $t("dialog.yes"),
				cancelLabel: $t("dialog.no"),
			}))
		)
			return;
		try {
			await invoke("install_plugin", { url, file, fallback_id });
			message($t("plugin_manager.install.success", { name }), {
				title: $t("plugin_manager.install.success.title", { name }),
				buttons: { ok: $t("dialog.ok") },
			});
			$actionList?.reload();
			installed = await invoke("list_plugins");
		} catch (error: any) {
			message(error, { title: $t("plugin_manager.install.error", { name }), buttons: { ok: $t("dialog.ok") } });
		}
	}

	let choices: any[] | undefined;
	let choice: number;
	let finishChoice = (_: unknown) => {};
	let cancelChoice = () => {};
	async function chooseAsset(assets: any[]): Promise<any> {
		choices = assets;
		try {
			await new Promise((resolve, reject) => {
				finishChoice = resolve;
				cancelChoice = reject;
			});
		} catch (e) {
			throw e;
		} finally {
			choices = undefined;
			finishChoice = (_: unknown) => {};
			cancelChoice = () => {};
		}
		return assets[choice];
	}

	let openDetailsView: string | null = null;
	type GitHubPlugin = {
		name: string;
		author: string;
		repository: string;
		download_url: string | undefined;
		description?: string;
	};
	async function installPluginGitHub(id: string, plugin: GitHubPlugin) {
		if (plugin.download_url) {
			await installPlugin(plugin.name, plugin.download_url, null, id);
			return;
		}

		let endpoint = new URL(plugin.repository);
		endpoint.hostname = "api." + endpoint.hostname;
		endpoint.pathname = "/repos" + endpoint.pathname + "/releases";

		let res;
		try {
			res = await (await fetch(endpoint)).json();
		} catch (error: any) {
			message(error, { title: $t("plugin_manager.install.error", { name: plugin.name }), buttons: { ok: $t("dialog.ok") } });
			return;
		}

		let release = res[0];
		if (release.prerelease && res.find((r: any) => !r.prerelease)) release = res.find((r: any) => !r.prerelease);

		let assets = [];
		for (const asset of release.assets) {
			if (asset.name.toLowerCase().endsWith(".streamdeckplugin") || asset.name.toLowerCase().endsWith(".zip")) {
				assets.push(asset);
			}
		}
		let selected;
		if (assets.length == 1) selected = assets[0];
		else {
			try {
				selected = await chooseAsset(assets);
			} catch {
				return;
			}
		}

		await installPlugin(plugin.name, selected.browser_download_url, null, id);
	}

	async function installPluginElgato(plugin: any) {
		await installPlugin(plugin.name, `https://plugins.amankhanna.me/rezipped/${plugin.id}.zip`, null, plugin.id);
	}

	async function installPluginFile() {
		const path = await open({ multiple: false, directory: false });
		if (!path) return;
		await installPlugin(path.split(/[\/\\]/).at(-1) ?? path, null, path, null);
	}

	async function removePlugin(plugin: any) {
		if (
			!(await ask($t("plugin_manager.remove.prompt", { name: plugin.name }), {
				title: $t("plugin_manager.remove.title", { name: plugin.name }),
				okLabel: $t("dialog.yes"),
				cancelLabel: $t("dialog.no"),
			}))
		)
			return;
		try {
			await invoke("remove_plugin", { id: plugin.id });
			message($t("plugin_manager.remove.success", { name: plugin.name }), {
				title: $t("plugin_manager.remove.success.title", { name: plugin.name }),
				buttons: { ok: $t("dialog.ok") },
			});
			$actionList?.reload();
			$deviceSelector?.reloadProfiles();
			installed = await invoke("list_plugins");
		} catch (error: any) {
			message(error, { title: $t("plugin_manager.remove.error", { name: plugin.name }), buttons: { ok: $t("dialog.ok") } });
		}
	}

	async function isUpdateAvailable(plugin: any): Promise<string | false> {
		const id = plugin.id.endsWith(".sdPlugin") ? plugin.id.slice(0, -9) : plugin.id;
		const cataloguePlugin = plugins[id];
		if (!cataloguePlugin || cataloguePlugin.download_url) return false;

		try {
			const endpoint = new URL(cataloguePlugin.repository);
			endpoint.hostname = "api." + endpoint.hostname;
			endpoint.pathname = "/repos" + endpoint.pathname + "/releases/latest";

			const res = await fetch(endpoint);
			if (!res.ok) return false;
			const release = await res.json();

			const normalizeVersion = (v: string) => v.replace(/^v/, "").replace(/^(\d+\.\d+\.\d+)\.\d+$/, "$1");
			if (normalizeVersion(release.tag_name) != normalizeVersion(plugin.version)) {
				return release.tag_name.replace(/^v/, "");
			} else {
				return false;
			}
		} catch (error) {
			console.warn("Failed to check for plugin update:", error);
			return false;
		}
	}

	let installed: any[] = [];
	(async () => (installed = await invoke("list_plugins")))();

	let plugins: { [id: string]: GitHubPlugin };

	// How each store plugin runs on Linux, recorded by scripts/plugin_compatibility.py.
	const compatibility: { [id: string]: string } = pluginCompatibility;
	// Store plugins for devices Ectodeck already drives; installing one would put two plugins on the same device.
	const BUILT_IN_DEVICE_PLUGINS = ["com.coreparadox.opendeck.magtran-m3"];
	const COMPATIBILITY_ORDER: { [verdict: string]: number } = { wine: 1, none: 2 };
	function storeEntries(catalogue: { [id: string]: GitHubPlugin }) {
		return Object.entries(catalogue)
			.filter(([id]) => !BUILT_IN_DEVICE_PLUGINS.includes(id))
			.sort(([a], [b]) => (COMPATIBILITY_ORDER[compatibility[a]] ?? 0) - (COMPATIBILITY_ORDER[compatibility[b]] ?? 0));
	}
	(async () => (plugins = await (await fetch("https://openactionapi.github.io/plugins/catalogue.json")).json()))();

	export function openStore() {
		showPopup = true;
		tab = "store";
	}
	let tab: "installed" | "store" = "store";

	let showArchive: boolean = false;
	let archivePlugins: any[] | null = null;

	let availableUpdates: { [id: string]: string | false } = {};
	let checkedPlugins = new Set<string>();
	$: if (showPopup) {
		for (const plugin of installed) {
			if (!checkedPlugins.has(plugin.id)) {
				checkedPlugins.add(plugin.id);
				isUpdateAvailable(plugin).then((version) => (availableUpdates = { ...availableUpdates, [plugin.id]: version }));
			}
		}
	}

	let pluginVersions: { [id: string]: string } = {};
	$: for (const plugin of installed) {
		if (pluginVersions[plugin.id] != plugin.version) {
			checkedPlugins.delete(plugin.id);
			delete availableUpdates[plugin.id];
			availableUpdates = availableUpdates;
			pluginVersions[plugin.id] = plugin.version;
		}
	}

	let query: string = "";

	// A shelf of plugins that are native on Linux and cover what the M3's own
	// app, VSD Craft, does out of the box.
	const SUGGESTED = ["me.amankhanna.oampris", "fr.jourdois.pipewire", "me.amankhanna.oadesktopentry", "dev.theca11.multiobs", "me.amankhanna.oadiscord", "me.amankhanna.oasystem"];
	const installedIds = (list: any[]) => new Set(list.map((p) => (p.id.endsWith(".sdPlugin") ? p.id.slice(0, -9) : p.id)));
	$: installedSet = installedIds(installed);
	const matches = (plugin: GitHubPlugin & { description?: string }) => {
		const q = query.toLowerCase().trim();
		return !q || plugin.name.toLowerCase().includes(q) || plugin.author.toLowerCase().includes(q) || (plugin.description ?? "").toLowerCase().includes(q);
	};
	$: storeList = plugins ? storeEntries(plugins).filter(([_, plugin]) => matches(plugin)) : [];
	$: storeCount = plugins ? storeEntries(plugins).length : 0;

	function rowMenu(plugin: any): ChoiceSection[] {
		return [
			{
				items: [
					{ id: "reload", label: $t("plugin_manager.reload"), command: true, icon: ArrowClockwise },
					...(!plugin.builtin ? [{ id: "remove", label: $t("plugin_manager.remove"), command: true, icon: Trash }] : []),
				],
			},
		];
	}
	function rowCommand(plugin: any, id: string) {
		if (id == "reload") invoke("reload_plugin", { id: plugin.id });
		else if (id == "remove") removePlugin(plugin);
	}

	onOpenUrl((urls: string[]) => {
		if (!urls[0].includes("installPlugin/")) return;
		let id = urls[0].split("installPlugin/")[1];
		if (!plugins[id]) return;
		installPluginGitHub(id, plugins[id]);
	});
</script>

<button
	class="flex flex-row items-center gap-1.5 h-[26px] px-[9px] rounded-md text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 transition-colors"
	class:bg-neutral-700={showPopup}
	on:click={() => (showPopup = true)}
>
	<PuzzlePiece size="15" class="text-neutral-400" />
	{$t("plugin_manager.button")}
</button>

<svelte:window
	on:keydown={(event) => {
		if (event.key == "Escape") {
			if (choices) cancelChoice();
			else if (openDetailsView) openDetailsView = null;
			else showPopup = false;
		}
	}}
/>

<Popup bind:show={showPopup} label={$t("plugin_manager.title")}>
	<div slot="header" class="flex flex-row gap-0.5 px-[18px] border-b border-neutral-700" role="tablist">
		<button role="tab" aria-selected={tab == "installed"} class="tab" class:on={tab == "installed"} on:click={() => (tab = "installed")}>
			{$t("plugin_manager.installed")}<span class="ml-1 text-neutral-500">{installed.length}</span>
		</button>
		<button role="tab" aria-selected={tab == "store"} class="tab" class:on={tab == "store"} on:click={() => (tab = "store")}>{$t("plugin_manager.store")}</button>
	</div>

	{#if tab == "installed"}
		<div class="px-[18px] pt-2.5 pb-6" role="list">
			<!-- prettier-ignore -->
			{#each installed.slice().sort((a, b) =>
				(a.builtin && !b.builtin) ? -1 : (b.builtin && !a.builtin) ? 1 : a.name.localeCompare(b.name)
			) as plugin (plugin.id)}
				<div class="group flex flex-row items-center gap-2.5 h-16 px-2.5 rounded-[7px] hover:bg-neutral-750" role="listitem">
					<img src={getWebserverUrl(plugin.icon)} alt="" class="w-10 h-10 shrink-0 rounded-[9px] bg-neutral-900" class:opacity-60={!plugin.registered} />
					<div class="min-w-0">
						<div class="truncate font-medium text-neutral-200">
							{($localisations && $localisations[plugin.id] && $localisations[plugin.id].Name) ? $localisations[plugin.id].Name : plugin.name}
						</div>
						<div class="flex flex-row items-center gap-1 text-xs text-neutral-400">
							{plugin.version} ·
							{#if plugin.registered}<span class="text-green-400">●</span>{$t("plugin_manager.running")}{:else}<span class="text-amber-300">●</span>{$t("plugin_manager.not_running")}{/if}
							{#if plugin.builtin}· {$t("plugin_manager.builtin")}{/if}
							{#if availableUpdates[plugin.id]}
								· <button class="text-amber-300 underline" on:click={() => (openDetailsView = plugin.id.endsWith(".sdPlugin") ? plugin.id.slice(0, -9) : plugin.id)}>
									{$t("plugin_manager.update", { version: availableUpdates[plugin.id] })}
								</button>
							{/if}
						</div>
					</div>
					<div class="ml-auto flex flex-row items-center gap-0.5 text-xs text-neutral-400">
						{#if plugin.has_settings_interface}
							<button class="row-act" on:click={() => invoke("show_settings_interface", { plugin: plugin.id })}><Gear size="13" />{$t("plugin_manager.plugin_settings")}</button>
						{/if}
						{#if !plugin.registered}
							<button class="row-act" on:click={() => invoke("open_log_directory")}><Scroll size="13" />{$t("plugin_manager.view_logs")}</button>
							<button class="row-act" on:click={() => invoke("reload_plugin", { id: plugin.id })}><ArrowClockwise size="13" />{$t("plugin_manager.try_again")}</button>
						{/if}
						<div>
							<ChoiceMenu variant="icon" label={$t("inspector.more")} current="" sections={rowMenu(plugin)} on:choose={(e) => rowCommand(plugin, e.detail)}>
								<DotsThree slot="icon" size="16" />
							</ChoiceMenu>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="px-[18px] pt-3 pb-6">
			<div class="flex flex-row items-center gap-2">
				<label class="flex flex-row items-center gap-[7px] w-80 h-[30px] px-[9px] bg-neutral-900 border border-neutral-700 rounded-[7px] focus-within:border-blue-500">
					<MagnifyingGlass size="13" class="shrink-0 text-neutral-500" />
					<input bind:value={query} class="w-full min-w-0 bg-transparent text-neutral-200 placeholder:text-neutral-500 outline-none" placeholder={$t("plugin_manager.search_count", { n: storeCount })} type="search" spellcheck="false" />
				</label>
				<button class="btn quiet ml-auto" on:click={installPluginFile}><FileArrowUp size="14" />{$t("plugin_manager.install_from_file")}</button>
			</div>

			{#if !plugins}
				<p class="mt-5 text-neutral-400">{$t("plugin_manager.loading.open_source")}</p>
			{:else}
				{#if !query.trim()}
					<div class="flex flex-row items-baseline gap-2 mt-3.5 mb-2">
						<b class="font-semibold text-neutral-200">{$t("plugin_manager.suggested")}</b>
						<span class="text-xs text-neutral-500">{$t("plugin_manager.suggested.hint")}</span>
					</div>
					<div class="grid grid-cols-3 gap-2">
						{#each SUGGESTED.filter((id) => plugins[id]) as id}
							{@const plugin = plugins[id]}
							<button class="plugin-card" on:click={() => (openDetailsView = id)}>
								<img src="https://openactionapi.github.io/plugins/icons/{id}.png" alt=""  />
								<div class="min-w-0">
									<div class="nm">{plugin.name}</div>
									<div class="by">{plugin.author}{#if installedSet.has(id)} · {$t("plugin_manager.installed_one")}{/if}</div>
									{#if plugin.description}<div class="ds">{plugin.description}</div>{/if}
								</div>
							</button>
						{/each}
					</div>
				{/if}

				<div class="flex flex-row items-baseline gap-2 mt-3.5 mb-2">
					<b class="font-semibold text-neutral-200">{query.trim() ? $t("plugin_manager.results", { n: storeList.length }) : $t("plugin_manager.all")}</b>
					<span class="text-xs text-neutral-500">{$t("plugin_manager.all.hint")}</span>
				</div>
				<div class="grid grid-cols-3 gap-2">
					{#each storeList as [id, plugin] (id)}
						<button class="plugin-card" on:click={() => (openDetailsView = id)}>
							<img src="https://openactionapi.github.io/plugins/icons/{id}.png" alt="" loading="lazy" />
							<div class="min-w-0">
								<div class="nm">{plugin.name}</div>
								<div class="by">{plugin.author}{#if installedSet.has(id)} · {$t("plugin_manager.installed_one")}{/if}</div>
								{#if plugin.description}<div class="ds">{plugin.description}</div>{/if}
								{#if compatibility[id] == "wine"}
									<div class="flex flex-row items-center gap-[5px] mt-1 text-[11.5px] text-amber-300"><Warning size="12" />{$t("plugin_manager.compatibility.wine")}</div>
								{:else if compatibility[id] == "none"}
									<div class="mt-1 text-[11.5px] text-neutral-500">{$t("plugin_manager.compatibility.none")}</div>
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{/if}

			<div class="flex flex-row items-baseline gap-2 mt-6 mb-2">
				<b class="font-semibold text-neutral-200">{$t("plugin_manager.elgato")}</b>
				<span class="text-xs text-neutral-500">{$t("plugin_manager.elgato.tooltip")}</span>
			</div>
			{#if !showArchive}
				<button
					class="btn"
					on:click={async () => {
						showArchive = true;
						archivePlugins = await (await fetch("https://plugins.amankhanna.me/catalogue.json")).json();
					}}
				>
					<CloudArrowDown size="14" />{$t("plugin_manager.elgato.load")}
				</button>
			{:else if !archivePlugins}
				<p class="text-neutral-400">{$t("plugin_manager.loading.elgato")}</p>
			{:else}
				<div class="grid grid-cols-3 gap-2">
					{#each archivePlugins.filter((plugin) => matches(plugin)) as plugin}
						<button class="plugin-card" on:click={() => installPluginElgato(plugin)}>
							<img src="https://plugins.amankhanna.me/icons/{plugin.id}.png" alt="" loading="lazy" />
							<div class="min-w-0">
								<div class="nm">{plugin.name}</div>
								<div class="by">{plugin.author}</div>
								<div class="flex flex-row items-center gap-[5px] mt-1 text-[11.5px] text-amber-300"><Warning size="12" />{$t("plugin_manager.compatibility.wine")}</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}

			<p class="flex flex-row items-start gap-2 mt-6 max-w-[70ch] text-xs text-neutral-500">
				<WarningCircle size="14" class="shrink-0 mt-px" />{$t("plugin_manager.warning", { PRODUCT_NAME })}
			</p>
		</div>
	{/if}
</Popup>

{#if openDetailsView && plugins?.[openDetailsView]}
	<PluginDetails
		id={openDetailsView}
		details={plugins[openDetailsView]}
		install={() => {
			// @ts-expect-error
			installPluginGitHub(openDetailsView, plugins[openDetailsView]);
		}}
		close={() => (openDetailsView = null)}
	/>
{/if}

<Dialog show={!!choices} title={$t("plugin_manager.choose_asset")} width={440}>
	<p class="mb-2 text-xs text-neutral-400">{$t("plugin_manager.choose_asset.hint")}</p>
	{#each choices ?? [] as asset, i}
		<button
			class="flex flex-row items-center w-full h-9 px-2.5 rounded-[7px] text-left font-mono text-xs text-neutral-200 hover:bg-neutral-750"
			on:click={() => {
				choice = i;
				finishChoice(null);
			}}
		>
			{asset.name}
		</button>
	{/each}
</Dialog>
