<script lang="ts">
	// A full sheet over the deck for the other places: Plugins and Settings.
	// The title bar stays, and its path says where you are. The close button
	// goes home; a back button, when given, goes up one level.
	import ArrowLeft from "phosphor-svelte/lib/ArrowLeft";
	import X from "phosphor-svelte/lib/X";
	import { onDestroy, tick } from "svelte";
	import { t } from "$lib/i18n";
	import { portal } from "$lib/portal";

	export let show = false;
	export let label = "";
	export let onClose: () => void;
	export let back: { label: string; go: () => void } | null = null;

	let popupEl: HTMLDivElement;
	let previousFocus: HTMLElement | null = null;

	$: if (show) {
		previousFocus = document.activeElement as HTMLElement | null;
		tick().then(() => popupEl?.focus());
	} else if (previousFocus) {
		previousFocus.focus();
		previousFocus = null;
	}

	onDestroy(() => previousFocus?.focus());
</script>

{#if show}
	<div use:portal bind:this={popupEl} class="absolute inset-0 flex flex-col bg-neutral-800 z-30 outline-none" role="dialog" tabindex="-1" aria-label={label}>
		<div class="flex flex-row items-center gap-2 shrink-0 px-[18px] pt-4 pb-3">
			{#if back}
				<button class="btn quiet -ml-2.5 px-2!" on:click={back.go}><ArrowLeft size="15" />{back.label}</button>
				<span class="text-neutral-600" aria-hidden="true">/</span>
			{/if}
			<h3 class="text-base font-semibold text-neutral-100 tracking-[-0.01em]">{label}</h3>
			<button
				class="ml-auto flex items-center justify-center w-7 h-7 rounded-md text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100"
				on:click={onClose}
				aria-label={$t("navigation.close_to_deck")}
				title={$t("navigation.close_to_deck")}
			>
				<X size="16" />
			</button>
		</div>
		<slot name="header" />
		<div class="flex-1 min-h-0 overflow-auto">
			<slot />
		</div>
		<slot name="footer" />
	</div>
{/if}
