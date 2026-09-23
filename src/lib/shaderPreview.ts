// A Shadertoy-format fragment shader running on a canvas, for previewing a
// live background in the device view. The plugin renders the same shader
// natively for the hardware; this mirrors its prelude so both look alike.

const VERTEX = `#version 300 es
void main() {
	vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const PRELUDE = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform vec4 iMouse;
uniform vec4 iDate;
out vec4 ectodeckFragColor;
`;

const EPILOGUE = `
void main() {
	vec4 color = vec4(0.0, 0.0, 0.0, 1.0);
	mainImage(color, gl_FragCoord.xy);
	ectodeckFragColor = vec4(color.rgb, 1.0);
}`;

// Svelte action: `<canvas use:shaderCanvas={source} width="854" height="480">`
export function shaderCanvas(canvas: HTMLCanvasElement, source: string) {
	let frame = 0;
	let stop = () => {};

	function start(code: string) {
		stop();
		const gl = canvas.getContext("webgl2");
		if (!gl) return;
		const compile = (type: number, text: string) => {
			const s = gl.createShader(type)!;
			gl.shaderSource(s, text);
			gl.compileShader(s);
			if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
			return s;
		};
		const program = gl.createProgram()!;
		gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, PRELUDE + code + EPILOGUE));
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			console.error(gl.getProgramInfoLog(program));
			return;
		}
		const vao = gl.createVertexArray();
		const u = (name: string) => gl.getUniformLocation(program, name);
		const begin = performance.now();
		let last = begin;
		let count = 0;
		let running = true;
		const draw = (now: number) => {
			if (!running) return;
			const time = (now - begin) / 1000;
			gl.viewport(0, 0, canvas.width, canvas.height);
			gl.useProgram(program);
			gl.uniform3f(u("iResolution"), canvas.width, canvas.height, 1);
			gl.uniform1f(u("iTime"), time);
			gl.uniform1f(u("iTimeDelta"), (now - last) / 1000);
			gl.uniform1i(u("iFrame"), count++);
			gl.uniform4f(u("iMouse"), 0, 0, 0, 0);
			const d = new Date();
			gl.uniform4f(u("iDate"), 0, 0, 0, d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds());
			gl.bindVertexArray(vao);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			last = now;
			frame = requestAnimationFrame(draw);
		};
		frame = requestAnimationFrame(draw);
		stop = () => {
			running = false;
			cancelAnimationFrame(frame);
			gl.deleteProgram(program);
			gl.deleteVertexArray(vao);
		};
	}

	start(source);
	return {
		update: (next: string) => start(next),
		destroy: () => stop(),
	};
}
