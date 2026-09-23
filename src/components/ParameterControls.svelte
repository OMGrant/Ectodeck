<script lang="ts">
	// Controls for a live background's parameters, drawn from its ISF inputs.
	import type { IsfInput } from "$lib/isf";
	import { defaultValue, fromHex, toHex } from "$lib/isf";
	import { t } from "$lib/i18n";
	import ChoiceMenu from "./ChoiceMenu.svelte";
	import { createEventDispatcher } from "svelte";

	export let inputs: IsfInput[];
	export let values: Record<string, unknown>;

	const dispatch = createEventDispatcher<{ change: Record<string, unknown> }>();

	// reactive, so the controls follow `values` when it changes from outside
	$: value = (input: IsfInput) => (input.NAME in values ? values[input.NAME] : defaultValue(input));
	function set(name: string, v: unknown) {
		values = { ...values, [name]: v };
		dispatch("change", values);
	}
	function reset() {
		values = {};
		dispatch("change", values);
	}
	$: point = (input: IsfInput): number[] => {
		const v = value(input);
		return Array.isArray(v) ? v.map(Number) : [0, 0];
	};
	function setAxis(input: IsfInput, axis: number, v: number) {
		const p = [...point(input)];
		p[axis] = v;
		set(input.NAME, p);
	}
	const label = (input: IsfInput) => input.LABEL ?? input.NAME;
	const range = (input: IsfInput, i = 0): [number, number] => {
		const pick = (x: number | number[] | undefined, d: number) => (Array.isArray(x) ? (x[i] ?? d) : (x ?? d));
		return [pick(input.MIN, 0), pick(input.MAX, 1)];
	};
	// about 200 positions across the range, rounded to a tidy 1, 2 or 5 step
	const step = (input: IsfInput, i = 0) => {
		const [lo, hi] = range(input, i);
		const raw = (hi - lo) / 200;
		const power = Math.pow(10, Math.floor(Math.log10(raw)));
		const unit = [1, 2, 5, 10].find((u) => u * power >= raw) ?? 10;
		return unit * power;
	};
	const format = (v: unknown) => (typeof v == "number" ? (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2)) : "");
</script>

<div class="flex flex-row flex-wrap items-center gap-x-5 gap-y-2 text-sm">
	{#each inputs as input (input.NAME)}
		<div class="flex flex-row items-center gap-2">
			<span class="text-neutral-400">{label(input)}</span>
			{#if input.TYPE == "float"}
				<input
					type="range"
					class="w-28 accent-neutral-300"
					min={range(input)[0]}
					max={range(input)[1]}
					step={step(input)}
					value={value(input)}
					aria-label={label(input)}
					on:input={(e) => set(input.NAME, parseFloat(e.currentTarget.value))}
				/>
				<span class="w-9 text-neutral-300 tabular-nums">{format(value(input))}</span>
			{:else if input.TYPE == "color"}
				<input
					type="color"
					class="w-8 h-6 p-0 bg-transparent border border-neutral-600 rounded cursor-pointer"
					value={toHex(value(input))}
					aria-label={label(input)}
					on:input={(e) => set(input.NAME, fromHex(e.currentTarget.value))}
				/>
			{:else if input.TYPE == "bool"}
				<div class="flex flex-row border border-neutral-600 rounded-lg overflow-hidden" role="radiogroup" aria-label={label(input)}>
					{#each [true, false] as option}
						<button
							class="px-2 py-0.5 transition-colors"
							class:bg-neutral-600={value(input) === option}
							class:text-neutral-100={value(input) === option}
							class:bg-neutral-800={value(input) !== option}
							class:text-neutral-400={value(input) !== option}
							role="radio"
							aria-checked={value(input) === option}
							on:click={() => set(input.NAME, option)}
						>
							{option ? $t("parameters.on") : $t("parameters.off")}
						</button>
					{/each}
				</div>
			{:else if input.TYPE == "long"}
				<ChoiceMenu
					label={label(input)}
					current={input.LABELS?.[(input.VALUES ?? []).indexOf(Number(value(input)))] ?? String(value(input))}
					sections={[
						{
							items: (input.VALUES ?? []).map((v, i) => ({ id: String(v), label: input.LABELS?.[i] ?? String(v), selected: Number(value(input)) == v })),
						},
					]}
					on:choose={(e) => set(input.NAME, Number(e.detail))}
				/>
			{:else if input.TYPE == "point2D"}
				{#each [0, 1] as axis}
					<input
						type="range"
						class="w-20 accent-neutral-300"
						min={range(input, axis)[0]}
						max={range(input, axis)[1]}
						step={step(input, axis)}
						value={point(input)[axis]}
						aria-label="{label(input)} {axis == 0 ? 'x' : 'y'}"
						on:input={(e) => setAxis(input, axis, parseFloat(e.currentTarget.value))}
					/>
				{/each}
			{/if}
		</div>
	{/each}
	{#if Object.keys(values).length}
		<button class="px-2 py-0.5 text-neutral-400 hover:text-neutral-200 transition-colors" on:click={reset}>{$t("parameters.reset")}</button>
	{/if}
</div>
