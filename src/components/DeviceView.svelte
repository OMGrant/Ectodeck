<script lang="ts">
	import type { ActionInstance } from "$lib/ActionInstance";
	import type { Context } from "$lib/Context";
	import type { AnimatedBackground, DeviceInfo, KeyStyle } from "$lib/DeviceInfo";
	import { listen } from "@tauri-apps/api/event";
	import { onDestroy } from "svelte";
	import type { Profile } from "$lib/Profile";
	import type { CopiedItem } from "$lib/propertyInspector";

	import Key from "./Key.svelte";

	import { t } from "$lib/i18n";
	import { deviceLooks, devicePreviews } from "$lib/deviceLook";
	import { inspectedInstance, inspectedParentAction, placeAction } from "$lib/propertyInspector";

	import { invoke } from "@tauri-apps/api/core";

	export let device: DeviceInfo;
	export let profile: Profile;

	export let selectedDevice: string;
	// The room the stage gives the deck; it is drawn at whatever scale fits.
	export let availWidth = 0;
	export let availHeight = 0;
	let naturalWidth = 0;
	let naturalHeight = 0;
	// the deck's size before scaling; a transform leaves the layout box alone
	function measure(node: HTMLElement) {
		const update = () => {
			naturalWidth = node.offsetWidth;
			naturalHeight = node.offsetHeight;
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}
	$: fit = naturalWidth && naturalHeight && availWidth > 0 && availHeight > 0 ? Math.min(1.25, availWidth / naturalWidth, availHeight / naturalHeight) : 1;

	function handleDragStart({ dataTransfer }: DragEvent, controller: string, position: number) {
		if (!dataTransfer) return;
		dataTransfer.effectAllowed = "move";
		dataTransfer.setData("controller", controller);
		dataTransfer.setData("position", position.toString());
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		if (!event.dataTransfer) return;
		if (event.dataTransfer.types.includes("action")) event.dataTransfer.dropEffect = "copy";
		else if (event.dataTransfer.types.includes("controller")) event.dataTransfer.dropEffect = "move";
	}

	async function handleDrop({ dataTransfer }: DragEvent, controller: string, position: number) {
		let context = { device: device.id, profile: profile.id, controller, position };
		let array = controller == "Encoder" ? profile.sliders : controller == "Infobar" ? profile.infobars : profile.keys;
		if (dataTransfer?.getData("action")) {
			let action = JSON.parse(dataTransfer?.getData("action"));
			if (array[position]) {
				return;
			}
			array[position] = await invoke("create_instance", { context, action });
			profile = profile;
			selectPlaced(context, array[position]);
		} else if (dataTransfer?.getData("controller")) {
			let oldController = dataTransfer?.getData("controller");
			let oldArray = oldController == "Encoder" ? profile.sliders : oldController == "Infobar" ? profile.infobars : profile.keys;
			let oldPosition = parseInt(dataTransfer?.getData("position"));
			let response: ActionInstance = await invoke("move_instance", {
				source: { device: device.id, profile: profile.id, controller: oldController, position: oldPosition },
				destination: context,
				retain: false,
			});
			if (response) {
				array[position] = response;
				oldArray[oldPosition] = null;
				profile = profile;
				selectPlaced(context, response);
			}
		}
	}

	async function handlePaste(item: CopiedItem, destination: Context) {
		let array = destination.controller == "Encoder" ? profile.sliders : destination.controller == "Infobar" ? profile.infobars : profile.keys;

		if (item.type == "action") {
			if (array[destination.position]) return;
			array[destination.position] = await invoke("create_instance", { context: destination, action: item.action });
			profile = profile;
			return;
		}

		let response: ActionInstance = await invoke("move_instance", { source: item.source, destination, retain: true });
		if (response) {
			array[destination.position] = response;
			profile = profile;
		}
	}


	// Whatever was just put on a key is what you want to set up next.
	function selectPlaced(context: Context, instance: ActionInstance | null) {
		if (!instance) return;
		if (instance.action.uuid == "opendeck.multiaction" || instance.action.uuid == "opendeck.toggleaction") {
			$inspectedInstance = null;
			$inspectedParentAction = context;
		} else {
			$inspectedParentAction = null;
			$inspectedInstance = instance.context;
		}
	}

	$: if ($placeAction && selectedDevice == device.id && !$inspectedParentAction) {
		let target = $inspectedInstance;
		// with no empty key selected, the action goes on the first empty key
		if (!target || typeof target == "string" || target.device != device.id) {
			const free = profile.keys.findIndex((k, i) => !k && i < device.rows * device.columns);
			target = free == -1 ? null : { device: device.id, profile: profile.id, controller: "Keypad", position: free };
		}
		if (target && typeof target == "object" && target.device == device.id) {
			const action = $placeAction;
			$placeAction = null;
			const destination = target;
			handlePaste({ type: "action", action }, destination).then(() => {
				const array = destination.controller == "Encoder" ? profile.sliders : profile.keys;
				selectPlaced(destination, array[destination.position]);
			});
		}
	}

	// Grid navigation: track focused cell and compute row lengths for arrow key movement.
	let focusedRow = 0;
	let focusedCol = 0;

	$: gridRowLengths = [
		...Array(device.rows).fill(device.columns),
		...(device.encoders > 0 ? [device.encoders] : []),
		...(device.touchpoints > 0 || device.infobars > 0 ? [device.touchpoints + device.infobars] : []),
	];
	$: encoderRowIndex = device.rows;
	$: touchpointRowIndex = device.rows + (device.encoders > 0 ? 1 : 0);
	$: keypadRowWidth = device.columns * 132;
	$: keypadColHeight = device.rows * 132;
	// Devices whose dials run down the side, rather than along the lower edge as
	// on a Stream Deck Plus. Drawing them underneath misrepresents the hardware.
	$: look = $deviceLooks[device.id];
	$: background = look?.background ?? null;
	$: keyStyle = look?.keyStyle ?? ({ backdrop: true } as KeyStyle);
	$: animated = (look?.animated ?? null) as AnimatedBackground | null;

	// The live background is previewed from frames the plugin sends, a few a
	// second, while this view is visible. The window cannot run the animation
	// itself: WebGL in its web engine crashes on NVIDIA drivers.
	let preview: string | null = null;
	let previewOn: string | null = null;
	let visible = typeof document == "undefined" || document.visibilityState == "visible";
	function setPreview(deviceId: string | null) {
		if (previewOn == deviceId) return;
		if (previewOn) invoke("set_background_preview", { device: previewOn, on: false });
		previewOn = deviceId;
		preview = null;
		if (deviceId) invoke("set_background_preview", { device: deviceId, on: true });
	}
	$: setPreview(device.has_background && animated && visible ? device.id : null);
	const unlisten = listen<{ device: string; image: string }>("background_preview", ({ payload }) => {
		if (payload.device == previewOn) {
			preview = payload.image;
			devicePreviews.update((p) => ({ ...p, [payload.device]: payload.image }));
		}
	});
	onDestroy(() => {
		setPreview(null);
		unlisten.then((f) => f());
	});

	// Map the panel onto the rendered key grid by pitch and centre: the rendered
	// grid is device.columns keys across, so its pitch is its width over the
	// column count, and the first rendered key is centred half a pitch in. Scale
	// the panel so its pitch matches, then shift it so the first key's window
	// centre lands on the first rendered key's centre. Every other key's centre
	// then lands exactly, whatever fraction of the pitch each side draws its keys
	// at, and the rest of the panel extends beyond the grid as on the hardware.
	// When a device declares a panel, the panel is the fixed thing: it is drawn
	// at one scale, sized to the width the key grid would otherwise take, and the
	// keys are placed on it from the declared geometry. Their spacing follows the
	// declared pitch, so adjusting a margin moves the keys, not the picture.
	$: panelLayout = (() => {
		const p = device.panel;
		if (!p || !p.width || !p.height || !p.pitch_x || !p.pitch_y) return null;
		const scale = (device.columns * 132) / p.width;
		const keyPx = p.key_size * scale;
		return {
			scale,
			width: p.width * scale,
			height: p.height * scale,
			keyPx,
			// OpenDeck draws a key at 118 px inside a 132 px box; scale the drawing so
			// it comes out at the window's size, and centre the box on the window
			keyScale: keyPx / 118,
			// top edge of the first row and bottom edge of the last, as drawn
			gridTop: p.keys_y * scale,
			gridBottom: (p.keys_y + (device.rows - 1) * p.pitch_y + p.key_size) * scale,
			keyAt: (r: number, c: number) => ({
				left: (p.keys_x + c * p.pitch_x) * scale + keyPx / 2 - 66,
				top: (p.keys_y + r * p.pitch_y) * scale + keyPx / 2 - 66,
			}),
		};
	})();

	$: sideEncoders = device.encoder_placement === "right" && device.encoders > 0;
	// Beside a panel the dials are drawn a little smaller than the keys and
	// held off the screen's edge, as they sit on the hardware.
	$: sideDials = sideEncoders && !!panelLayout;
	const DIAL_BOX = 96;
	const DIAL_GAP = 20;

	function flatIndexFromRowCol(row: number, col: number): number {
		let index = 0;
		for (let r = 0; r < row; r++) index += gridRowLengths[r];
		return index + col;
	}

	function rowColFromFlatIndex(flatIndex: number): [number, number] {
		let remaining = flatIndex;
		for (let r = 0; r < gridRowLengths.length; r++) {
			if (remaining < gridRowLengths[r]) return [r, remaining];
			remaining -= gridRowLengths[r];
		}
		return [0, 0];
	}

	function handleGridKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement;
		if (target.getAttribute("role") !== "gridcell") return;
		if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

		event.preventDefault();
		event.stopPropagation();

		let newRow = focusedRow;
		let newCol = focusedCol;

		switch (event.key) {
			case "ArrowRight":
				newCol = Math.min(focusedCol + 1, gridRowLengths[focusedRow] - 1);
				break;
			case "ArrowLeft":
				newCol = Math.max(focusedCol - 1, 0);
				break;
			case "ArrowDown":
				newRow = Math.min(focusedRow + 1, gridRowLengths.length - 1);
				newCol = Math.min(focusedCol, gridRowLengths[newRow] - 1);
				break;
			case "ArrowUp":
				newRow = Math.max(focusedRow - 1, 0);
				newCol = Math.min(focusedCol, gridRowLengths[newRow] - 1);
				break;
			case "Home":
				newCol = 0;
				break;
			case "End":
				newCol = gridRowLengths[focusedRow] - 1;
				break;
		}

		if (newRow === focusedRow && newCol === focusedCol) return;

		focusedRow = newRow;
		focusedCol = newCol;

		const grid = event.currentTarget as HTMLElement;
		const cells = grid.querySelectorAll("[role='gridcell']");
		(cells[flatIndexFromRowCol(newRow, newCol)] as HTMLElement)?.focus();
	}

	function handleGridFocusin(event: FocusEvent) {
		const grid = event.currentTarget as HTMLElement;
		const cells = Array.from(grid.querySelectorAll("[role='gridcell']"));
		const index = cells.indexOf(event.target as Element);
		if (index === -1) return;
		[focusedRow, focusedCol] = rowColFromFlatIndex(index);
	}
</script>

<svelte:document on:visibilitychange={() => (visible = document.visibilityState == "visible")} />

{#key device}
	<span id="grid-description" class="sr-only">{$t("device_view.grid_description")}</span>
	<div class="relative shrink-0" class:hidden={selectedDevice != device.id} style="width: {naturalWidth * fit}px; height: {naturalHeight * fit}px;">
	<div
		class="absolute left-0 top-0 flex flex-col w-max origin-top-left"
		style="transform: scale({fit});"
		use:measure
		role="grid"
		aria-label={device.name}
		aria-describedby="grid-description"
		tabindex="-1"
		on:keydown|capture={handleGridKeydown}
		on:focusin={handleGridFocusin}
	>
		<div class="flex" class:flex-row={sideEncoders} class:items-center={sideEncoders} class:flex-col={!sideEncoders}>
		{#if panelLayout}
			<!-- The panel, at fixed scale, with the keys placed on it by geometry. -->
			<div class="relative" style="width:{panelLayout.width}px;height:{panelLayout.height}px;">
				{#if device.has_background && animated}
					<!-- The live background, as the plugin renders it for the deck. -->
					{#if preview}
						<img src={preview} alt="" aria-hidden="true" class="absolute inset-0 w-full h-full object-fill rounded-xl pointer-events-none" style="filter: brightness({keyStyle.background_brightness ?? 1})" />
					{:else}
						<div class="absolute inset-0 rounded-xl bg-neutral-900 pointer-events-none" aria-hidden="true"></div>
					{/if}
				{:else if device.has_background && background}
					<img src={background} alt="" aria-hidden="true" class="absolute inset-0 w-full h-full object-fill rounded-xl pointer-events-none" style="filter: brightness({keyStyle.background_brightness ?? 1})" />
				{/if}
				<div role="rowgroup" class="contents">
					{#each { length: device.rows } as _, r}
						<div class="contents" role="row">
							{#each { length: device.columns } as _, c}
								<div class="absolute" style="left:{panelLayout.keyAt(r, c).left}px;top:{panelLayout.keyAt(r, c).top}px;width:132px;height:132px;">
									<Key
										context={{ device: device.id, profile: profile.id, controller: "Keypad", position: r * device.columns + c }}
										bind:inslot={profile.keys[r * device.columns + c]}
										on:dragover={handleDragOver}
										on:drop={(event) => handleDrop(event, "Keypad", r * device.columns + c)}
										on:dragstart={(event) => handleDragStart(event, "Keypad", r * device.columns + c)}
										{handlePaste}
										size={144}
										scale={panelLayout.keyScale}
										{keyStyle}
										label="{$t('device_view.key')} {String.fromCharCode(65 + r)}{c + 1}"
										tabindex={focusedRow === r && focusedCol === c ? 0 : -1}
									/>
								</div>
							{/each}
						</div>
					{/each}
				</div>
			</div>
		{:else}
		<div class="relative">
			{#if device.has_background && background}
				<!-- The display behind the keys, drawn where it physically is. -->
				<img
					src={background}
					alt=""
					aria-hidden="true"
					class="absolute inset-1 w-[calc(100%-0.5rem)] h-[calc(100%-0.5rem)] object-cover rounded-xl pointer-events-none"
				/>
			{/if}
		<div class="relative flex flex-col" role="rowgroup">
			{#each { length: device.rows } as _, r}
				<div class="flex flex-row" role="row">
					{#each { length: device.columns } as _, c}
						<Key
							context={{ device: device.id, profile: profile.id, controller: "Keypad", position: r * device.columns + c }}
							bind:inslot={profile.keys[r * device.columns + c]}
							on:dragover={handleDragOver}
							on:drop={(event) => handleDrop(event, "Keypad", r * device.columns + c)}
							on:dragstart={(event) => handleDragStart(event, "Keypad", r * device.columns + c)}
							{handlePaste}
							size={device.id.startsWith("sd-") && device.rows == 4 && device.columns == 8 ? 192 : 144}
							label="{$t('device_view.key')} {String.fromCharCode(65 + r)}{c + 1}"
							tabindex={focusedRow === r && focusedCol === c ? 0 : -1}
						/>
					{/each}
				</div>
			{/each}
		</div>
		</div>
		{/if}


		<div
			class="flex"
			class:flex-col={sideEncoders}
			class:justify-center={sideEncoders && !sideDials}
			class:flex-row={!sideEncoders}
			class:justify-between={!sideEncoders || sideDials}
			role="row"
			style={sideEncoders
				? sideDials && panelLayout
					? `height: ${panelLayout.height}px; margin-left: ${DIAL_GAP}px; padding-top: ${panelLayout.gridTop}px; padding-bottom: ${panelLayout.height - panelLayout.gridBottom}px;`
					: `height: ${panelLayout ? panelLayout.height : keypadColHeight}px;`
				: `width: ${keypadRowWidth}px;`}
		>
			{#each { length: device.encoders } as _, i}
				{#if sideDials}
				<!-- A dial beside the panel, drawn smaller than a key. OpenDeck draws a
				     key at 118 px inside a 132 px box, so scaling by DIAL/118 makes the
				     drawing exactly DIAL across, and the box is sized to the drawing so
				     the first and last dials' edges line up with the grid's. -->
				<div class="relative" style="width:{DIAL_BOX}px;height:{DIAL_BOX}px;">
					<div class="absolute" style="left:{(DIAL_BOX - 132) / 2}px;top:{(DIAL_BOX - 132) / 2}px;width:132px;height:132px;">
						<Key
							context={{ device: device.id, profile: profile.id, controller: "Encoder", position: i }}
							bind:inslot={profile.sliders[i]}
							on:dragover={handleDragOver}
							on:drop={(event) => handleDrop(event, "Encoder", i)}
							on:dragstart={(event) => handleDragStart(event, "Encoder", i)}
							{handlePaste}
							size={144}
							scale={DIAL_BOX / 118}
							label="{$t('device_view.encoder')} {i + 1}"
							tabindex={focusedRow === encoderRowIndex && focusedCol === i ? 0 : -1}
						/>
					</div>
				</div>
				{:else}
				<Key
					context={{ device: device.id, profile: profile.id, controller: "Encoder", position: i }}
					bind:inslot={profile.sliders[i]}
					on:dragover={handleDragOver}
					on:drop={(event) => handleDrop(event, "Encoder", i)}
					on:dragstart={(event) => handleDragStart(event, "Encoder", i)}
					{handlePaste}
					size={device.id.startsWith("sd-") && device.rows == 4 && device.columns == 8 ? 192 : 144}
					label="{$t('device_view.encoder')} {i + 1}"
					tabindex={focusedRow === encoderRowIndex && focusedCol === i ? 0 : -1}
				/>
				{/if}
			{/each}
		</div>

		</div>

		<div class="flex flex-row items-center" role="row">
			{#each { length: device.touchpoints } as _, i}
				<!-- On the Stream Deck Neo, the infobar display sits physically between the two touchpoints. -->
				{#if device.infobars > 0 && i === 1}
					{#each { length: device.infobars } as _, j}
						<div class="px-3.5 py-[3.5px]">
							<Key
								context={{ device: device.id, profile: profile.id, controller: "Infobar", position: j }}
								bind:inslot={profile.infobars[j]}
								on:dragover={handleDragOver}
								on:drop={(event) => handleDrop(event, "Infobar", j)}
								on:dragstart={(event) => handleDragStart(event, "Infobar", j)}
								{handlePaste}
								size={device.id.startsWith("sd-") && device.rows == 4 && device.columns == 8 ? 192 : 144}
								width={248}
								height={58}
							/>
						</div>
					{/each}
				{/if}
				<Key
					context={{ device: device.id, profile: profile.id, controller: "Keypad", position: device.rows * device.columns + i }}
					bind:inslot={profile.keys[device.rows * device.columns + i]}
					on:dragover={handleDragOver}
					on:drop={(event) => handleDrop(event, "Keypad", device.rows * device.columns + i)}
					on:dragstart={(event) => handleDragStart(event, "Keypad", device.rows * device.columns + i)}
					{handlePaste}
					size={device.id.startsWith("sd-") && device.rows == 4 && device.columns == 8 ? 192 : 144}
					isTouchPoint
					label="{$t('device_view.touchpoint')} {i + 1}"
					tabindex={focusedRow === touchpointRowIndex && focusedCol === i ? 0 : -1}
				/>
			{/each}
		</div>
	</div>
	</div>
{/key}
