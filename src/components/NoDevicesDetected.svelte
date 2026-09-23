<script lang="ts">
	// Shown until a deck connects. Ectodeck hears about new devices as they
	// arrive, so this screen moves on by itself; it only has to explain the one
	// thing people get stuck on, the Linux device rule, and offer to fix it.
	import CaretDown from "phosphor-svelte/lib/CaretDown";
	import CaretRight from "phosphor-svelte/lib/CaretRight";

	import { t } from "$lib/i18n";
	import { PRODUCT_NAME } from "$lib/singletons";

	import { invoke } from "@tauri-apps/api/core";

	let buildInfo: string;
	(async () => (buildInfo = await invoke("get_build_info")))();
	$: linux = buildInfo?.split("</summary>")[0]?.includes("linux");

	let open = false;
	let showRule = false;
	let installing = false;
	let result: "done" | string | null = null;
	async function install() {
		installing = true;
		result = null;
		try {
			await invoke("install_device_rules");
			result = "done";
		} catch (error) {
			result = String(error);
		}
		installing = false;
	}

	const RULE = `SUBSYSTEM=="usb", ATTRS{idVendor}=="5548", ATTRS{idProduct}=="1020", MODE="0660", TAG+="uaccess"
KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="5548", ATTRS{idProduct}=="1020", MODE="0660", TAG+="uaccess"`;
</script>

<div class="flex flex-col items-center justify-center w-full h-full bg-stage">
	<div class="w-[520px] max-w-[calc(100%-2rem)]">
		<div class="relative w-[220px] h-[124px] mx-auto mb-[22px] border-[1.5px] border-dashed border-neutral-600 rounded-xl" aria-hidden="true">
			<div class="absolute top-3.5 bottom-3.5 left-3.5 right-[46px] grid grid-cols-5 gap-[7px]">
				{#each { length: 15 } as _}<span class="rounded ring-[1.2px] ring-inset ring-neutral-700"></span>{/each}
			</div>
			<div class="absolute top-3.5 bottom-3.5 right-3.5 flex flex-col justify-between">
				{#each { length: 3 } as _}<span class="w-[22px] h-[22px] rounded-full ring-[1.2px] ring-inset ring-neutral-700"></span>{/each}
			</div>
		</div>
		<h2 class="mb-1.5 text-center text-lg font-semibold tracking-[-0.015em] text-neutral-100">{$t("no_devices_detected.title")}</h2>
		<p class="mb-[22px] text-center text-neutral-400">{$t("no_devices_detected.watching", { PRODUCT_NAME })}</p>

		<div class="px-4 py-3.5 bg-neutral-800 border border-neutral-700 rounded-[10px]">
			<button class="flex flex-row items-center gap-2 w-full font-medium text-neutral-200" aria-expanded={open} on:click={() => (open = !open)}>
				{#if open}<CaretDown size="12" />{:else}<CaretRight size="12" />{/if}
				{$t("no_devices_detected.stuck")}
			</button>
			{#if open}
				{#if linux}
					<p class="mt-2 mb-3 text-[12.5px] text-neutral-400">{$t("no_devices_detected.rule_why", { PRODUCT_NAME })}</p>
					<div class="flex flex-row items-center gap-3">
						<button class="btn primary" disabled={installing} on:click={install}>{$t("no_devices_detected.install_rule")}</button>
						<span class="text-xs leading-snug text-neutral-400">{$t("no_devices_detected.install_rule.hint")}</span>
					</div>
					{#if result == "done"}
						<p class="mt-3 text-xs text-green-400">{$t("no_devices_detected.install_rule.done")}</p>
					{:else if result}
						<p class="mt-3 text-xs text-red-400">{$t("no_devices_detected.install_rule.failed", { error: result })}</p>
					{:else}
						<p class="mt-3 text-xs text-neutral-500">
							{$t("no_devices_detected.replug")}
							<button class="underline" on:click={() => (showRule = !showRule)}>{$t("no_devices_detected.show_rule")}</button>
						</p>
					{/if}
					{#if showRule}
						<pre class="mt-2 p-2.5 overflow-x-auto font-mono text-[11px] leading-relaxed text-neutral-200 bg-neutral-900 border border-neutral-700 rounded-lg select-text">{RULE}</pre>
						<p class="mt-1.5 text-xs text-neutral-500">{$t("no_devices_detected.rule_path")}</p>
					{/if}
				{:else}
					<p class="mt-2 text-[12.5px] text-neutral-400">{$t("no_devices_detected.check_connection")}</p>
				{/if}
				<div class="flex flex-row items-center justify-between mt-3">
					<span class="text-xs text-neutral-500">{$t("no_devices_detected.install_plugin")}</span>
					<button class="btn quiet" on:click={() => invoke("restart")}>{$t("no_devices_detected.restart", { PRODUCT_NAME })}</button>
				</div>
			{/if}
		</div>
	</div>
</div>
