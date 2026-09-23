/*{
  "DESCRIPTION": "Ember: a warm glow flowing slowly between three colours.",
  "INPUTS": [
    {
      "NAME": "colour1",
      "TYPE": "color",
      "LABEL": "First colour",
      "DEFAULT": [
        1.0,
        0.54,
        0.11,
        1
      ]
    },
    {
      "NAME": "colour2",
      "TYPE": "color",
      "LABEL": "Second colour",
      "DEFAULT": [
        0.96,
        0.25,
        0.49,
        1
      ]
    },
    {
      "NAME": "colour3",
      "TYPE": "color",
      "LABEL": "Third colour",
      "DEFAULT": [
        0.52,
        0.22,
        0.82,
        1
      ]
    },
    {
      "NAME": "brightness",
      "TYPE": "float",
      "LABEL": "Brightness",
      "DEFAULT": 1.0,
      "MIN": 0.2,
      "MAX": 2.0
    },
    {
      "NAME": "speed",
      "TYPE": "float",
      "LABEL": "Speed",
      "DEFAULT": 1.0,
      "MIN": 0.0,
      "MAX": 4.0
    },
    {
      "NAME": "react",
      "TYPE": "bool",
      "LABEL": "React to presses",
      "DEFAULT": true
    }
  ]
}*/
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
}

// Light where keys are pressed: a soft bloom and a ring spreading out from
// the key, fading over a second or so. iKeyPresses is filled by Ectodeck.
float pressLight(vec2 fragCoord) {
    float light = 0.0;
    for (int i = 0; i < 8; i++) {
        vec4 p = iKeyPresses[i];
        if (p.w < 0.0) continue;
        float age = p.z;
        float r = length(fragCoord - p.xy);
        float ring = exp(-pow((r - age * 380.0) / 26.0, 2.0)) * exp(-age * 2.0);
        float bloom = exp(-r * r / 7000.0) * exp(-age * 2.8);
        light += ring * 0.55 + bloom * 0.9;
    }
    return light;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.06 * speed;
    float warp = fbm(p * 1.3 + vec2(t, -t * 0.7));
    float g = fbm(p * 1.1 + 2.0 * warp + vec2(-t * 0.5, t));
    vec3 a = colour1.rgb, b = colour2.rgb, c = colour3.rgb;
    float h = g + (uv.x - 0.5) * 0.35;
    vec3 col = mix(a, b, smoothstep(0.42, 0.62, h));
    col = mix(col, c, smoothstep(0.58, 0.8, h + (0.5 - uv.y) * 0.2));
    float glow = smoothstep(0.2, 0.75, g);
    col *= (0.1 + 0.75 * glow * glow) * brightness;
    if (react) col += mix(a, b, 0.5) * pressLight(fragCoord) * 0.7;
    fragColor = vec4(col, 1.0);
}
