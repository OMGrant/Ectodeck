<script lang="ts">
	import Gear from "phosphor-svelte/lib/Gear";
	import Popup from "./Popup.svelte";
	import ChoiceMenu, { type ChoiceSection } from "./ChoiceMenu.svelte";
	import DownloadSimple from "phosphor-svelte/lib/DownloadSimple";
	import UploadSimple from "phosphor-svelte/lib/UploadSimple";

	import { t } from "$lib/i18n";
	import { settings } from "$lib/settings";
	import { PRODUCT_NAME } from "$lib/singletons";

	import { invoke } from "@tauri-apps/api/core";
	import { listen } from "@tauri-apps/api/event";
	import { message } from "@tauri-apps/plugin-dialog";

	let showPopup: boolean;
	let buildInfo: string;
	(async () => (buildInfo = await invoke("get_build_info")))();

	listen("device_brightness", ({ payload }: { payload: { action: string; value: number } }) => {
		if (!$settings) return;
		let value = $settings.brightness;
		switch (payload.action) {
			case "increase":
				value += payload.value;
				break;
			case "decrease":
				value -= payload.value;
				break;
			default:
				value = payload.value;
				break;
		}
		$settings.brightness = Math.max(0, Math.min(100, value));
	});

	async function backupConfig() {
		await message($t("settings.backup_config.prompt"), { title: $t("settings.backup_config.title"), buttons: { ok: $t("dialog.ok") } });
		if (await invoke("backup_config_directory")) {
			await message($t("settings.backup_config.success.prompt"), { title: $t("settings.backup_config.success.title"), buttons: { ok: $t("dialog.ok") } });
		}
	}

	const LANGUAGES: [string, string][] = [
		["de", "Deutsch"],
		["en", "English"],
		["es", "Español"],
		["fr", "Français"],
		["pt_BR", "Português (Brasil)"],
		["sv", "Svenska"],
		["uk", "Українська"],
		["zh_CN", "中文"],
		["ja", "日本語"],
		["ko", "한국어"],
	];
	$: languageSections = [{ items: LANGUAGES.map(([id, label]) => ({ id, label, selected: $settings?.language == id })) }] as ChoiceSection[];
	$: isWindows = buildInfo?.split("</summary>")[0]?.includes("windows");

	async function restoreConfig() {
		await message($t("settings.restore_config.prompt"), { title: $t("settings.restore_config.title"), buttons: { ok: $t("dialog.ok") } });
		await invoke("restore_config_directory");
	}
</script>

<button
	class="flex flex-row items-center gap-1.5 h-[26px] px-[9px] rounded-md text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 transition-colors"
	class:bg-neutral-700={showPopup}
	on:click={() => (showPopup = true)}
>
	<Gear size="15" class="text-neutral-400" />
	{$t("settings.button")}
</button>

<svelte:window
	on:keydown={(event) => {
		if (event.key == "Escape") showPopup = false;
	}}
/>

<Popup bind:show={showPopup} label={$t("settings.button")}>
	{#if $settings}
		<div class="grid grid-cols-2 gap-x-11 px-7 pt-1 pb-4">
			<div>
				<section class="insp-sect">
					<h4>{$t("settings.general")}</h4>
					<div class="insp-row">
						<span class="w-[130px] shrink-0 text-neutral-300">{$t("settings.language")}</span>
						<div class="w-[170px]">
							<ChoiceMenu variant="field" label={$t("settings.language")} current={LANGUAGES.find(([id]) => id == $settings?.language)?.[1] ?? $settings.language} sections={languageSections} on:choose={(e) => $settings && ($settings.language = e.detail)} />
						</div>
					</div>
					<p class="setting-desc">{$t("settings.language.tooltip", { PRODUCT_NAME })}</p>
					<label class="setting-row"><span>{$t("settings.autolaunch")}</span><input type="checkbox" role="switch" class="switch" bind:checked={$settings.autolaunch} /></label>
					<p class="setting-desc">{$t("settings.autolaunch.tooltip.1", { PRODUCT_NAME })}</p>
					<label class="setting-row"><span>{$t("settings.background")}</span><input type="checkbox" role="switch" class="switch" bind:checked={$settings.background} /></label>
					<p class="setting-desc">{$t("settings.background.tooltip", { PRODUCT_NAME })}</p>
				</section>
				<section class="insp-sect">
					<h4>{$t("settings.updates")}</h4>
					<label class="setting-row"><span>{$t("settings.updatecheck")}</span><input type="checkbox" role="switch" class="switch" bind:checked={$settings.updatecheck} /></label>
					<p class="setting-desc">{$t("settings.updatecheck.hint", { version: $settings.version, PRODUCT_NAME })}</p>
				</section>
			</div>
			<div>
				<section class="insp-sect">
					<h4>{$t("settings.devices_plugins")}</h4>
					<label class="setting-row">
						<span>{$t("settings.drive_elgato")}</span>
						<input type="checkbox" role="switch" class="switch" checked={!$settings.disableelgato} on:change={(e) => $settings && ($settings.disableelgato = !e.currentTarget.checked)} />
					</label>
					<p class="setting-desc">{$t("settings.disableelgato.tooltip")}</p>
					{#if !isWindows}
						<label class="setting-row"><span>{$t("settings.separatewine")}</span><input type="checkbox" role="switch" class="switch" bind:checked={$settings.separatewine} /></label>
						<p class="setting-desc">{$t("settings.separatewine.tooltip", { PRODUCT_NAME })}</p>
					{/if}
					<label class="setting-row"><span>{$t("settings.developer")}</span><input type="checkbox" role="switch" class="switch" bind:checked={$settings.developer} /></label>
					<p class="setting-desc">{$t("settings.developer.tooltip")}</p>
				</section>
				<section class="insp-sect">
					<h4>{$t("settings.your_setup")}</h4>
					<div class="flex flex-row flex-wrap gap-1.5">
						<button class="btn" on:click={() => backupConfig()}><DownloadSimple size="14" />{$t("settings.backup_config.button")}</button>
						<button class="btn" on:click={() => restoreConfig()}><UploadSimple size="14" />{$t("settings.restore_config.button")}</button>
						<button class="btn quiet" on:click={() => invoke("open_config_directory")}>{$t("settings.open_config")}</button>
						<button class="btn quiet" on:click={() => invoke("open_log_directory")}>{$t("settings.open_logs")}</button>
					</div>
				</section>
			</div>
		</div>
	{/if}

	<svelte:fragment slot="footer">
		<div class="flex flex-row items-center gap-4 px-7 py-3 border-t border-neutral-750 text-xs text-neutral-500">
			<span>
				{$t("settings.credit.1", { PRODUCT_NAME })}
				<button on:click={() => invoke("open_url", { url: "https://github.com/nekename/OpenDeck" })} class="underline">{$t("settings.credit.2")}</button>.
			</span>
			<span class="ml-auto build-info">{@html buildInfo}</span>
		</div>
	</svelte:fragment>
</Popup>
