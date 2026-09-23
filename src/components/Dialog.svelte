<script lang="ts">
	// A window over the app for a task that takes a moment, such as managing
	// profiles. It closes from its close button or Escape only: a stray click
	// outside it must never throw away a half-typed name.
	import X from "phosphor-svelte/lib/X";
	import { onDestroy, tick } from "svelte";
	import { t } from "$lib/i18n";
	import { portal } from "$lib/portal";
	import { openLayer } from "$lib/navigation";

	export let show = false;
	export let title: string;
	export let subtitle = "";
	export let width = 580;

	let box: HTMLDivElement;
	let release: (() => void) | null = null;
	$: if (show && !release) release = openLayer(() => (show = false), true);
	$: if (!show && release) {
		release();
		release = null;
	}
	onDestroy(() => release?.());
	let previousFocus: HTMLElement | null = null;
	$: if (show) {
		previousFocus = document.activeElement as HTMLElement | null;
		tick().then(() => {
			if (!box?.contains(document.activeElement)) box?.focus();
		});
	} else if (previousFocus) {
		previousFocus.focus();
		previousFocus = null;
	}
	onDestroy(() => previousFocus?.focus());
</script>

{#if show}
	<div use:portal={"#dialog-host"} class="absolute inset-0 z-40 pointer-events-auto flex items-center justify-center bg-black/50">
		<div
			bind:this={box}
			class="flex flex-col max-h-[calc(100%-2rem)] bg-neutral-800 border border-neutral-600 rounded-xl shadow-2xl shadow-black/60 outline-none overflow-hidden"
			style="width: {width}px; max-width: calc(100% - 2rem);"
			role="dialog"
			aria-label={title}
			tabindex="-1"
		>
			<div class="flex flex-row items-start gap-2.5 px-[18px] pt-4 pb-3">
				<div>
					<h3 class="text-base font-semibold text-neutral-100 tracking-[-0.01em]">{title}</h3>
					{#if subtitle}<div class="text-[12.5px] text-neutral-400">{subtitle}</div>{/if}
				</div>
				<button class="ml-auto flex items-center justify-center w-7 h-7 rounded-md text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100" on:click={() => (show = false)} aria-label={$t("settings.close")}>
					<X size="16" />
				</button>
			</div>
			<div class="flex-1 min-h-0 overflow-auto px-[18px] pb-4">
				<slot />
			</div>
		</div>
	</div>
{/if}
