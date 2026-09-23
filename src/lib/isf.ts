// Adjustable parameters in the ISF (Interactive Shader Format) style: a list
// of INPUTS, each with a NAME, TYPE, DEFAULT and, by type, MIN/MAX or
// VALUES/LABELS. A shader carries them in a JSON comment at the top of its
// source; a web page in <script type="application/json" id="ectodeck-inputs">.

export type IsfInput = {
	NAME: string;
	TYPE: "float" | "color" | "bool" | "long" | "point2D";
	LABEL?: string;
	DEFAULT?: unknown;
	MIN?: number | number[];
	MAX?: number | number[];
	VALUES?: number[];
	LABELS?: string[];
};

const KNOWN = ["float", "color", "bool", "long", "point2D"];

function clean(header: unknown): IsfInput[] {
	const inputs = (header as { INPUTS?: unknown[] })?.INPUTS;
	if (!Array.isArray(inputs)) return [];
	return inputs.filter((i): i is IsfInput => {
		const x = i as IsfInput;
		return typeof x?.NAME == "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(x.NAME) && KNOWN.includes(x.TYPE);
	});
}

export function shaderInputs(source: string): IsfInput[] {
	const match = /^\s*\/\*([\s\S]*?)\*\//.exec(source);
	if (!match) return [];
	try {
		return clean(JSON.parse(match[1]));
	} catch {
		return [];
	}
}

export function pageInputs(html: string): IsfInput[] {
	const match = /<script[^>]*id=["']ectodeck-inputs["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
	if (!match) return [];
	try {
		return clean(JSON.parse(match[1]));
	} catch {
		return [];
	}
}

export function defaultValue(input: IsfInput): unknown {
	if (input.DEFAULT !== undefined) return input.DEFAULT;
	switch (input.TYPE) {
		case "float":
			return typeof input.MIN == "number" ? input.MIN : 0;
		case "color":
			return [1, 1, 1, 1];
		case "bool":
			return false;
		case "long":
			return input.VALUES?.[0] ?? 0;
		case "point2D":
			return [0, 0];
	}
}

export function toHex(rgba: unknown): string {
	const c = Array.isArray(rgba) ? rgba : [1, 1, 1];
	return "#" + [0, 1, 2].map((i) => Math.round(Math.min(1, Math.max(0, Number(c[i] ?? 0))) * 255).toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string, alpha = 1): number[] {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha].map((x) => Math.round(x * 1000) / 1000);
}

// Presets: named sets of settings a background offers, switched from the
// Preset menu or the Background Preset action. A header lists them as
// PRESETS: [{ NAME, VALUES: { input: value } }], or marks one "long" input
// with PRESET: true, whose choices then are the presets.
export type Preset = { name: string; values: Record<string, unknown> };

function header(source: string, kind: "shader" | "web"): unknown {
	const match = kind == "shader" ? /^\s*\/\*([\s\S]*?)\*\//.exec(source) : /<script[^>]*id=["']ectodeck-inputs["'][^>]*>([\s\S]*?)<\/script>/i.exec(source);
	if (!match) return null;
	try {
		return JSON.parse(match[1]);
	} catch {
		return null;
	}
}

export function presetsOf(source: string, kind: "shader" | "web"): Preset[] {
	const h = header(source, kind) as { PRESETS?: { NAME?: string; VALUES?: Record<string, unknown> }[]; INPUTS?: (IsfInput & { PRESET?: boolean })[] } | null;
	if (!h) return [];
	if (Array.isArray(h.PRESETS)) {
		return h.PRESETS.filter((p) => typeof p?.NAME == "string" && p.VALUES && typeof p.VALUES == "object").map((p) => ({ name: p.NAME!, values: p.VALUES! }));
	}
	const input = h.INPUTS?.find((i) => i?.PRESET && i.TYPE == "long");
	if (!input) return [];
	return (input.VALUES ?? []).map((v, i) => ({ name: input.LABELS?.[i] ?? String(v), values: { [input.NAME]: v } }));
}

// Which preset the settings match, if any; values not set count as their defaults.
export function currentPreset(presets: Preset[], params: Record<string, unknown>, inputs: IsfInput[]): number {
	const valueOf = (name: string) => {
		if (name in params) return params[name];
		const input = inputs.find((i) => i.NAME == name);
		return input ? defaultValue(input) : undefined;
	};
	const same = (a: unknown, b: unknown) => JSON.stringify(a) == JSON.stringify(b) || (typeof a == "number" && typeof b == "number" && Math.abs(a - b) < 1e-6) || (Array.isArray(a) && Array.isArray(b) && a.length >= 3 && a.slice(0, 3).every((x, i) => Math.abs(Number(x) - Number(b[i])) < 1e-3));
	return presets.findIndex((p) => Object.entries(p.values).every(([k, v]) => same(valueOf(k), v)));
}
