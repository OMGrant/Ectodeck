/*{
  "DESCRIPTION": "Nebula: clouds of colour drifting slowly through each other. A key press is a drop falling into them, spreading and billowing out.",
  "INPUTS": [
    {
      "NAME": "colour1",
      "TYPE": "color",
      "LABEL": "Cloud colour",
      "DEFAULT": [
        0.22,
        0.05,
        0.38,
        1
      ]
    },
    {
      "NAME": "colour2",
      "TYPE": "color",
      "LABEL": "Glow colour",
      "DEFAULT": [
        0.8,
        0.18,
        0.56,
        1
      ]
    },
    {
      "NAME": "colour3",
      "TYPE": "color",
      "LABEL": "Highlight colour",
      "DEFAULT": [
        0.4,
        0.62,
        1.0,
        1
      ]
    },
    {
      "NAME": "zoom",
      "TYPE": "float",
      "LABEL": "Zoom",
      "DEFAULT": 1.6,
      "MIN": 0.5,
      "MAX": 4.0
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
    mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) { v += a * noise(p); p = r * p * 2.0; a *= 0.5; }
    return v;
}

// A press is a drop falling into smoky liquid. The disturbance swells out
// from nothing at the key (no point at its centre), spreads, and slows; its
// front billows, warped by the smoke's own texture, and it shoulders the
// smoke aside rather than rippling it like glass.
vec2 drop(vec2 uv, out float stir) {
    stir = 0.0;
    vec2 at = uv;
    for (int i = 0; i < 8; i++) {
        vec4 p = iKeyPresses[i];
        if (p.w < 0.0 || p.z > 4.0) continue;
        float age = p.z;
        vec2 c = (p.xy - 0.5 * iResolution.xy) / iResolution.y;
        vec2 d = uv - c;
        // spreads fast at first, then slows, like a drop settling
        float reach = 0.06 + 0.32 * (1.0 - exp(-age * 1.6));
        // the smoke's texture makes the front uneven
        float billow = 1.0 + 0.45 * (fbm(uv * 3.5 + vec2(age * 0.4, -age * 0.3)) - 0.5);
        float x = length(d) * billow / reach;
        float strength = 0.11 * smoothstep(0.0, 0.25, age) * exp(-age * 0.9);
        float shape = exp(-x * x);
        // d / reach is smooth through the centre, so nothing pinches there
        at -= d / reach * strength * shape;
        stir += strength * shape * x;
    }
    return at;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.03 * speed;
    float stir = 0.0;
    if (react) uv = drop(uv, stir);
    vec2 q = vec2(fbm(uv * zoom + t), fbm(uv * zoom - t + 4.7));
    vec2 r = vec2(fbm(uv * zoom + 3.0 * q + vec2(1.7, 9.2) + t * 1.5), fbm(uv * zoom + 3.0 * q + vec2(8.3, 2.8) - t));
    float f = fbm(uv * zoom + 3.5 * r);
    vec3 col = mix(vec3(0.015, 0.01, 0.04), colour1.rgb, smoothstep(0.3, 0.7, f));
    col = mix(col, colour2.rgb, 0.75 * smoothstep(0.45, 0.85, length(q) * f * 1.6));
    col = mix(col, colour3.rgb, smoothstep(0.55, 0.9, r.x * f * 1.5) * 0.6);
    col *= (0.25 + 0.65 * smoothstep(0.25, 0.8, f)) * brightness;
    col += colour2.rgb * stir * 1.2 * brightness;
    fragColor = vec4(pow(col, vec3(1.1)), 1.0);
}
