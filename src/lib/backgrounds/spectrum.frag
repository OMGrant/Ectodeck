/*{
  "DESCRIPTION": "Spectrum: glowing bars that dance to whatever your computer is playing, bass on the left and treble on the right, with the beat pulsing through the background. A key press flashes the bars under it. Switch presets in Adjust, or with the Background Preset action.",
  "INPUTS": [
    {
      "NAME": "low",
      "TYPE": "color",
      "LABEL": "Bass",
      "DEFAULT": [
        1.0,
        0.25,
        0.55,
        1
      ]
    },
    {
      "NAME": "high",
      "TYPE": "color",
      "LABEL": "Treble",
      "DEFAULT": [
        0.25,
        0.8,
        1.0,
        1
      ]
    },
    {
      "NAME": "style",
      "TYPE": "long",
      "LABEL": "Style",
      "DEFAULT": 0,
      "VALUES": [
        0,
        1,
        2,
        3,
        4,
        5
      ],
      "LABELS": [
        "From the floor",
        "From the middle",
        "LED meter",
        "Mirror",
        "Ring",
        "Wave"
      ],
      "PRESET": true
    },
    {
      "NAME": "gain",
      "TYPE": "float",
      "LABEL": "Height",
      "DEFAULT": 1.0,
      "MIN": 0.4,
      "MAX": 2.0
    }
  ]
}*/

const int BARS = 32;
const float TAU = 6.2831853;

float band(int i) {
    return clamp(iAudioBands[clamp(i, 0, BARS - 1)] * gain, 0.0, 1.0);
}
// the spectrum as a smooth curve, for the wave
float smoothBand(float x) {
    float s = clamp(x, 0.0, 1.0) * float(BARS - 1);
    int i = int(floor(s));
    float t = fract(s);
    return mix(band(i), band(i + 1), t * t * (3.0 - 2.0 * t));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float aspect = iResolution.x / iResolution.y;
    float beat = iAudioLevel;
    int look = style;

    // flash under a fresh press, by how close it is across the picture
    float flashAt = 0.0;
    for (int k = 0; k < 8; k++) {
        vec4 p = iKeyPresses[k];
        if (p.w < 0.0 || p.z > 0.8) continue;
        flashAt += exp(-pow((uv.x - p.x / iResolution.x) * 9.0, 2.0)) * (1.0 - p.z / 0.8);
    }

    vec3 tint = mix(low.rgb, high.rgb, uv.x);
    vec3 col = vec3(0.012, 0.01, 0.03) + tint * 0.08 * beat * (1.0 - abs(uv.y - 0.5));

    if (look <= 3) {
        float slot = uv.x * float(BARS);
        int i = int(clamp(floor(slot), 0.0, float(BARS - 1)));
        float within = fract(slot);
        float h = band(i) * 0.9 + 0.012;
        float gap = smoothstep(0.1, 0.16, within) * smoothstep(0.9, 0.84, within);
        float y = (look == 1 || look == 3) ? abs(uv.y - 0.5) * 2.0 : uv.y;
        if (look == 2) {
            // LED meter: stacked segments, green to amber to red up the column,
            // with the unlit segments faintly visible
            float segs = 16.0;
            float seg = floor(y * segs), inSeg = fract(y * segs);
            float lit = step(seg + 0.5, h * segs);
            float cell = gap * smoothstep(0.08, 0.18, inSeg) * smoothstep(0.92, 0.82, inSeg);
            vec3 led = mix(mix(vec3(0.2, 1.0, 0.4), vec3(1.0, 0.8, 0.2), smoothstep(0.45, 0.7, y)), vec3(1.0, 0.25, 0.2), smoothstep(0.75, 0.9, y));
            led = mix(led, tint, 0.3) * (1.0 + flashAt);
            col += cell * (lit * led * 1.1 + (1.0 - lit) * led * 0.07);
        } else {
            float bar = step(y, h) * gap;
            col += tint * (0.45 + 0.9 * y / max(h, 0.02)) * (1.0 + flashAt * 1.5) * bar;
            col += tint * gap * exp(-abs(y - h - 0.02) * 120.0) * 0.9;
            col += tint * 0.25 * gap * exp(-max(y - h, 0.0) * 14.0) * step(h, y);
            if (look == 0) col += tint * 0.12 * gap * step(uv.y, 0.02 + h * 0.08) * (0.6 - uv.y * 10.0);
            // mirror: the lower half a dimmer reflection, under a bright centre line
            if (look == 3) {
                col *= uv.y < 0.5 ? 0.4 : 1.0;
                col += tint * 0.7 * exp(-abs(uv.y - 0.5) * 300.0);
            }
        }
    } else if (look == 4) {
        // ring: bars standing out from a circle, bass at the top, mirrored left and right
        vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
        float r = length(p);
        float a = fract(atan(p.x, p.y) / TAU + 1.0);
        float side = a < 0.5 ? a * 2.0 : (1.0 - a) * 2.0;
        float slot = side * float(BARS);
        float within = fract(slot);
        float h = band(int(floor(slot))) * 0.24;
        float base = 0.2 + beat * 0.03;
        float gap = smoothstep(0.12, 0.2, within) * smoothstep(0.88, 0.8, within);
        vec3 ringTint = mix(low.rgb, high.rgb, side);
        float bar = step(base, r) * step(r, base + h + 0.004) * gap;
        col = vec3(0.012, 0.01, 0.03) + ringTint * 0.12 * beat * exp(-r * 3.0);
        col += ringTint * bar * (0.5 + 1.2 * (r - base) / max(h, 0.02)) * (1.0 + flashAt);
        col += ringTint * 0.8 * exp(-abs(r - base) * 260.0);
    } else {
        // wave: the spectrum as one glowing line over a soft filled glow
        float h = 0.12 + smoothBand(uv.x) * 0.7;
        float d = uv.y - h;
        col += tint * 0.35 * step(d, 0.0) * (0.3 + 0.7 * uv.y / max(h, 0.01));
        col += tint * (exp(-abs(d) * iResolution.y * 0.35) * 1.4 + exp(-abs(d) * 40.0) * 0.3) * (1.0 + flashAt);
    }
    fragColor = vec4(col, 1.0);
}
