/*{
  "DESCRIPTION": "Spectrum: glowing bars that dance to whatever your computer is playing, bass on the left and treble on the right, with the beat pulsing through the background. A key press flashes the bars under it. The Background look action turns its colours round the colour wheel.",
  "INPUTS": [
    { "NAME": "low", "TYPE": "color", "LABEL": "Bass", "DEFAULT": [1.0, 0.25, 0.55, 1] },
    { "NAME": "high", "TYPE": "color", "LABEL": "Treble", "DEFAULT": [0.25, 0.8, 1.0, 1] },
    { "NAME": "style", "TYPE": "long", "LABEL": "Style", "DEFAULT": 0, "VALUES": [0, 1], "LABELS": ["From the floor", "From the middle"] },
    { "NAME": "gain", "TYPE": "float", "LABEL": "Height", "DEFAULT": 1.0, "MIN": 0.4, "MAX": 2.0 }
  ]
}*/

// the Background look action turns the colours a quarter of the way round
// the colour wheel per step, keeping their brightness
vec3 lookTurn(vec3 c) {
    float a = iLook * 1.5707963;
    const vec3 k = vec3(0.57735);
    float cosA = cos(a);
    return c * cosA + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cosA);
}


const int BARS = 32;

float band(int i) {
    return clamp(iAudioBands[i] * gain, 0.0, 1.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float beat = iAudioLevel;
    vec3 tint = mix(low.rgb, high.rgb, uv.x);

    // the room: dark, breathing with the beat
    vec3 col = vec3(0.012, 0.01, 0.03) + tint * 0.08 * beat * (1.0 - abs(uv.y - 0.5));

    float slot = uv.x * float(BARS);
    int i = int(clamp(floor(slot), 0.0, float(BARS - 1)));
    float within = fract(slot);
    float h = band(i) * 0.9 + 0.012;

    // flash the bars under a fresh press
    float flash = 0.0;
    for (int k = 0; k < 8; k++) {
        vec4 p = iKeyPresses[k];
        if (p.w < 0.0 || p.z > 0.8) continue;
        flash += exp(-pow((uv.x - p.x / iResolution.x) * 9.0, 2.0)) * (1.0 - p.z / 0.8);
    }

    float y = style == 1 ? abs(uv.y - 0.5) * 2.0 : uv.y;
    float gap = smoothstep(0.1, 0.16, within) * smoothstep(0.9, 0.84, within);
    float bar = step(y, h) * gap;
    // brighter toward the bar's tip
    vec3 barColour = tint * (0.45 + 0.9 * y / max(h, 0.02)) * (1.0 + flash * 1.5);
    col += barColour * bar;
    // a cap floating just above the bar, and the bar's glow
    col += tint * gap * exp(-abs(y - h - 0.02) * 120.0) * 0.9;
    col += tint * 0.25 * gap * exp(-max(y - h, 0.0) * 14.0) * step(h, y);
    // on the floor style, a dim reflection
    if (style == 0) col += tint * 0.12 * gap * step(uv.y, 0.02 + h * 0.08) * (0.6 - uv.y * 10.0);
    fragColor = vec4(max(lookTurn(col), 0.0), 1.0);
}
