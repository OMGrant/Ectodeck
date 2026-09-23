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
