import type { ActionState } from "./ActionState.ts";
import type { Context } from "./Context.ts";

import { getWebserverUrl } from "./ports.ts";

import { invoke } from "@tauri-apps/api/core";

// OpenDeck's own icons are vector now. Profiles saved before still name the
// old raster files, so those names resolve to the vector versions.
const VECTOR_ICONS: { [png: string]: string } = {
	"opendeck/multi-action.png": "opendeck/multi-action.svg",
	"opendeck/toggle-action.png": "opendeck/toggle-action.svg",
};

export function getImage(image: string | undefined, fallback: string | undefined): string {
	if (!image) return fallback ? getImage(fallback, undefined) : "/alert.svg";
	image = VECTOR_ICONS[image] ?? image;
	if (image.startsWith("opendeck/")) return image.replace("opendeck", "");
	if (!image.startsWith("data:")) return getWebserverUrl(image);
	const svgxmlre = /^data:image\/svg\+xml(?!.*?;base64.*?)(?:;[\w=]*)*,(.+)/;
	const base64re = /^data:image\/(apng|avif|gif|jpeg|png|svg\+xml|webp|bmp|x-icon|tiff);base64,([A-Za-z0-9+/]+={0,2})?/;
	if (svgxmlre.test(image)) {
		let svg = (svgxmlre.exec(image) as RegExpExecArray)[1].replace(/\;$/, "");
		try {
			svg = decodeURIComponent(svg);
		} finally {
			image = "data:image/svg+xml," + encodeURIComponent(svg);
		}
	}
	if (base64re.test(image)) {
		const exec = base64re.exec(image)!;
		if (!exec[2]) return fallback ? getImage(fallback, undefined) : "/alert.svg";
		else image = exec[0];
	}
	return image;
}

// Devices that draw their keys onto a display of their own (they declare
// `has_background`) get key images with transparency kept, so the plugin can
// show that display through them. Everything else gets JPEG as before, which
// is all the other device plugins accept.
export const transparentKeyDevices = new Set<string>();

// Corner radius of keys on those devices, as a fraction of the key's size.
// Matches the corners the plugin paints on the hardware.
export const KEY_CORNER = 0.09;

// Remove a flat background painted into an icon, for keys drawn with no
// backdrop. Many icons are a glyph on a solid square; that square hides the
// display the user chose to show through. If all four corners share one
// opaque colour, every pixel of that colour is made transparent, inside
// outlined glyphs too, and the antialiased pixels around it are rebuilt
// from the glyph's own colour, so the edge stays smooth without a fringe of
// the old colour. Icons without such a border pass
// through untouched.
export function stripFlatBackground(image: HTMLImageElement): HTMLCanvasElement | HTMLImageElement {
	const w = image.naturalWidth, h = image.naturalHeight;
	if (!w || !h) return image;
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) return image;
	context.drawImage(image, 0, 0);
	const data = context.getImageData(0, 0, w, h);
	const px = data.data;
	const at = (x: number, y: number) => (y * w + x) * 4;
	const seed = at(0, 0);
	if (px[seed + 3] < 250) return image;
	const distance = (i: number) => Math.max(Math.abs(px[i] - px[seed]), Math.abs(px[i + 1] - px[seed + 1]), Math.abs(px[i + 2] - px[seed + 2]));
	for (const [x, y] of [[w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
		const i = at(x, y);
		if (px[i + 3] < 250 || distance(i) > 8) return image;
	}
	const SAME = 24;
	// the background colour goes everywhere, including inside outlined glyphs
	const removed = new Uint8Array(w * h);
	for (let p = 0; p < w * h; p++) if (distance(p * 4) <= SAME) removed[p] = 1;
	// Pixels near it are a blend of background and glyph. Fading them alone
	// leaves the background's colour in them as a fringe. Instead each takes
	// the colour of the most glyph-like pixel beside it, and as much opacity
	// as its own colour lies of the way from the background to that one. The
	// solid core of a stroke is its own most glyph-like neighbour, so it stays
	// fully opaque; only the blended edge becomes partly transparent.
	const BAND = 2;
	const near = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (!removed[y * w + x]) continue;
			for (let dy = -BAND; dy <= BAND; dy++) {
				for (let dx = -BAND; dx <= BAND; dx++) {
					const nx = x + dx, ny = y + dy;
					if (nx >= 0 && ny >= 0 && nx < w && ny < h) near[ny * w + nx] = 1;
				}
			}
		}
	}
	const source = new Uint8ClampedArray(px);
	const from = (i: number) => Math.max(Math.abs(source[i] - source[seed]), Math.abs(source[i + 1] - source[seed + 1]), Math.abs(source[i + 2] - source[seed + 2]));
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const p = y * w + x, i = p * 4;
			if (removed[p]) {
				px[i + 3] = 0;
				continue;
			}
			if (!near[p]) continue;
			let best = i, bestDistance = from(i);
			for (let dy = -BAND; dy <= BAND; dy++) {
				for (let dx = -BAND; dx <= BAND; dx++) {
					const nx = x + dx, ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
					const j = (ny * w + nx) * 4;
					const d = from(j);
					if (d > bestDistance) (best = j), (bestDistance = d);
				}
			}
			let dot = 0, length = 0;
			for (let c = 0; c < 3; c++) {
				const f = source[best + c] - source[seed + c];
				dot += f * (source[i + c] - source[seed + c]);
				length += f * f;
			}
			const alpha = length ? Math.min(1, Math.max(0, dot / length)) : 0;
			px[i] = source[best];
			px[i + 1] = source[best + 1];
			px[i + 2] = source[best + 2];
			px[i + 3] = Math.round(source[i + 3] * alpha);
		}
	}
	context.putImageData(data, 0, 0);
	return canvas;
}

// Whether an icon's solid background square should be removed.
//
// Icons shipped as files, by plugins and by MagDeck itself, are always
// cleaned: many plugins paint a grey or coloured square behind their glyph,
// which clashes with the key background and with OpenDeck's own icons, drawn
// without one. Pictures that arrive as data (ones the user chose, or ones a
// plugin draws live, such as album art) are cleaned only when the key's
// background is hidden, so a chosen logo keeps its white. SVG is never
// cleaned: it rarely has a square, and cleaning rasterises it.
export function shouldStripIcon(source: string, keyBackgroundHidden: boolean): boolean {
	if (/^data:image\/svg/i.test(source) || /\.svg(\?|#|$)/i.test(source)) return false;
	return !source.startsWith("data:") || keyBackgroundHidden;
}

// For plain <img> elements showing a plugin's icon, such as the action list:
// replaces the image with its cleaned version once loaded.
const strippedIcons = new Map<string, Promise<string>>();
export function strippedIcon(node: HTMLImageElement, source: string) {
	let current = "";
	const apply = (src: string) => {
		current = src;
		node.src = src;
		if (!shouldStripIcon(src, false)) return;
		let job = strippedIcons.get(src);
		if (!job) {
			job = new Promise<string>((resolve) => {
				const image = new Image();
				image.crossOrigin = "anonymous";
				image.onload = () => {
					try {
						const cleaned = stripFlatBackground(image);
						resolve(cleaned instanceof HTMLCanvasElement ? cleaned.toDataURL("image/png") : src);
					} catch {
						resolve(src);
					}
				};
				image.onerror = () => resolve(src);
				image.src = src;
			});
			strippedIcons.set(src, job);
		}
		job.then((cleaned) => {
			if (current == src) node.src = cleaned;
		});
	};
	apply(source);
	return { update: apply };
}

export class CanvasLock {
	currentLock = Promise.resolve();
	async lock() {
		let unlockNext: () => void;
		const willLock = new Promise<void>((resolve) => (unlockNext = resolve));
		const previousLock = this.currentLock;
		this.currentLock = willLock;
		await previousLock;
		return unlockNext!;
	}
}

export async function renderImage(
	canvas: HTMLCanvasElement | null,
	slotContext: Context | null,
	state: ActionState,
	fallback: string | undefined,
	showOk: boolean,
	showAlert: boolean,
	processImage: boolean,
	active: boolean,
	pressed: boolean,
	rotation?: number,
	stripBackground = false,
) {
	// Create canvas
	let scale = 1;
	if (!canvas) {
		canvas = document.createElement("canvas");
		canvas.width = 144;
		canvas.height = 144;
	} else {
		// Use height for scale to handle rectangular infobar canvases
		scale = canvas.height / 144;
	}

	const context = canvas.getContext("2d");
	if (!context) return;

	context.save();
	if (rotation) {
		context.translate(canvas.width / 2, canvas.height / 2);
		context.rotate((rotation * Math.PI) / 180);
		context.translate(-canvas.width / 2, -canvas.height / 2);
	}

	try {
		// Load image
		const image = document.createElement("img");
		image.crossOrigin = "anonymous";
		image.src = processImage ? getImage(state.image, fallback) : state.image;
		const strip = shouldStripIcon(image.src, stripBackground);
		if (image.src == undefined) return;
		await new Promise((resolve, reject) => {
			image.onload = resolve;
			image.onerror = reject;
		});

		context.clearRect(0, 0, canvas.width, canvas.height);

		// Draw background color
		if (!state.background_colour.startsWith("#000000")) {
			context.fillStyle = state.background_colour;
			context.fillRect(0, 0, canvas.width, canvas.height);
		}

		// Draw image
		context.imageSmoothingQuality = "high";
		const imageScale = Math.max(10, state.image_scale || 100) / 100;
		const xScaled = canvas.width * imageScale;
		const yScaled = canvas.height * imageScale;
		const xOffset = (canvas.width - xScaled) / 2;
		const yOffset = (canvas.height - yScaled) / 2;
		context.drawImage(strip ? stripFlatBackground(image) : image, xOffset, yOffset, xScaled, yScaled);
	} catch (error: any) {
		if (!(error instanceof Event)) console.error(error);
		context.clearRect(0, 0, canvas.width, canvas.height);
		showAlert = true;
	}

	// Draw text
	if (state.show) {
		const size = state.size * 2 * scale;
		context.textAlign = "center";
		context.font =
			(state.style.includes("Bold") ? "bold " : "") + (state.style.includes("Italic") ? "italic " : "") + `${size}px "${state.family}", sans-serif`;
		context.fillStyle = state.colour;
		context.strokeStyle = state.stroke_colour;
		context.lineWidth = state.stroke_size * scale;
		context.textBaseline = "top";
		const x = canvas.width / 2;
		let y = canvas.height / 2 - size * state.text.split("\n").length * 0.5;
		switch (state.alignment) {
			case "top":
				y = context.lineWidth;
				break;
			case "bottom":
				y = canvas.height - size * state.text.split("\n").length - context.lineWidth;
				break;
		}
		for (const [index, line] of Object.entries(state.text.split("\n"))) {
			context.strokeText(line, x, y + size * parseInt(index));
			context.fillText(line, x, y + size * parseInt(index));
			if (state.underline) {
				const width = context.measureText(line).width;
				// Set to black for the outline, since it uses the same fill style info as the text colour.
				context.fillStyle = "black";
				context.fillRect(x - width / 2 - 3, y + size * parseInt(index) + size, width + 6, 9);
				// Reset to the user's choice of text colour.
				context.fillStyle = state.colour;
				context.fillRect(x - width / 2, y + size * parseInt(index) + size + 4, width, 3);
			}
		}
	}

	if (showOk) {
		const okImage = document.createElement("img");
		okImage.crossOrigin = "anonymous";
		okImage.src = "/ok.svg";
		await new Promise((resolve) => {
			okImage.onload = resolve;
		});
		context.drawImage(okImage, 0, 0, canvas.width, canvas.height);
	}

	if (showAlert) {
		const alertImage = document.createElement("img");
		alertImage.crossOrigin = "anonymous";
		alertImage.src = "/alert.svg";
		await new Promise((resolve) => {
			alertImage.onload = resolve;
		});
		context.drawImage(alertImage, 0, 0, canvas.width, canvas.height);
	}

	// On devices that draw keys onto their own display, round the key's
	// corners here as well as in the plugin: the plugin rounds the key's
	// square, but a pressed key is drawn smaller inside it, and its corners
	// need rounding at that smaller size too. Doing it before the shrink
	// below carries the rounding down with the image.
	if (slotContext && slotContext.controller == "Keypad" && transparentKeyDevices.has(slotContext.device)) {
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.globalCompositeOperation = "destination-in";
		context.beginPath();
		context.roundRect(0, 0, canvas.width, canvas.height, canvas.width * KEY_CORNER);
		context.fill();
		context.restore();
	}

	// Make the image smaller while the button is pressed.
	if (pressed) {
		const smallCanvas = document.createElement("canvas");
		smallCanvas.width = canvas.width;
		smallCanvas.height = canvas.height;
		const newContext = smallCanvas.getContext("2d");
		const margin = 0.1;
		if (newContext) {
			newContext.drawImage(canvas, canvas.width * margin, canvas.height * margin, canvas.width * (1 - margin * 2), canvas.height * (1 - margin * 2));
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(smallCanvas, 0, 0);
		}
	}

	context.restore();

	if (active && slotContext) {
		const format = slotContext.controller == "Keypad" && transparentKeyDevices.has(slotContext.device) ? "image/png" : "image/jpeg";
		setTimeout(async () => await invoke("update_image", { context: slotContext, image: canvas.toDataURL(format) }), 10);
	}
}

export async function resizeImage(source: string): Promise<string | undefined> {
	const canvas = document.createElement("canvas");
	canvas.width = 288;
	canvas.height = 288;
	const context = canvas.getContext("2d");
	if (!context) return;

	const image = document.createElement("img");
	image.crossOrigin = "anonymous";
	image.src = source;
	await new Promise((resolve) => (image.onload = resolve));

	let xOffset = 0,
		yOffset = 0;
	let xScaled = canvas.width,
		yScaled = canvas.height;
	if (image.width > image.height) {
		const ratio = image.height / image.width;
		yScaled = canvas.height * ratio;
		yOffset = (canvas.height - yScaled) / 2;
	} else if (image.width < image.height) {
		const ratio = image.width / image.height;
		xScaled = canvas.width * ratio;
		xOffset = (canvas.width - xScaled) / 2;
	}

	context.imageSmoothingQuality = "high";
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.drawImage(image, xOffset, yOffset, xScaled, yScaled);

	return canvas.toDataURL();
}
