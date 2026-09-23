/*{
  "DESCRIPTION": "Aurora: slow ribbons of light over a night sky. A key press sends a surge along the curtain and a ray up to the key. Switch presets in Adjust, or with the Background Preset action.",
  "INPUTS": [
    {
      "NAME": "colour1",
      "TYPE": "color",
      "LABEL": "Low colour",
      "DEFAULT": [
        0.1,
        0.9,
        0.55,
        1
      ]
    },
    {
      "NAME": "colour2",
      "TYPE": "color",
      "LABEL": "High colour",
      "DEFAULT": [
        0.15,
        0.55,
        0.9,
        1
      ]
    },
    {
      "NAME": "height",
      "TYPE": "float",
      "LABEL": "Height",
      "DEFAULT": 0.42,
      "MIN": 0.1,
      "MAX": 0.8
    },
    {
      "NAME": "stars",
      "TYPE": "bool",
      "LABEL": "Stars",
      "DEFAULT": true
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
  ],
  "PRESETS": [
    {
      "NAME": "Northern lights",
      "VALUES": {
        "colour1": [
          0.1,
          0.9,
          0.55,
          1
        ],
        "colour2": [
          0.15,
          0.55,
          0.9,
          1
        ]
      }
    },
    {
      "NAME": "Rose",
      "VALUES": {
        "colour1": [
          1.0,
          0.35,
          0.55,
          1
        ],
        "colour2": [
          0.55,
          0.25,
          0.9,
          1
        ]
      }
    },
    {
      "NAME": "Violet",
      "VALUES": {
        "colour1": [
          0.55,
          0.3,
          1.0,
          1
        ],
        "colour2": [
          0.2,
          0.8,
          0.95,
          1
        ]
      }
    },
    {
      "NAME": "Ember sky",
      "VALUES": {
        "colour1": [
          1.0,
          0.55,
          0.15,
          1
        ],
        "colour2": [
          0.9,
          0.2,
          0.35,
          1
        ]
      }
    },
    {
      "NAME": "Ice",
      "VALUES": {
        "colour1": [
          0.75,
          0.95,
          1.0,
          1
        ],
        "colour2": [
          0.3,
          0.5,
          0.95,
          1
        ]
      }
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
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
    return v;
}

// A press sends a surge along the curtain: the aurora brightens at the key
// and the brightening rolls away sideways in both directions, fading as it
// goes, the way real auroras pulse.
float surge(vec2 uv, float band) {
    float s = 0.0;
    for (int i = 0; i < 8; i++) {
        vec4 p = iKeyPresses[i];
        if (p.w < 0.0 || p.z > 3.0) continue;
        float x = p.x / iResolution.x, age = p.z;
        float spread = age * 0.32;
        // only a key near the curtain sets it off; others get just their ray
        float near = exp(-pow((p.y / iResolution.y - band) / 0.12, 2.0));
        float fade = exp(-age * 1.3) * smoothstep(0.0, 0.25, age) * near;
        s += (exp(-pow((uv.x - x - spread) / 0.09, 2.0)) + exp(-pow((uv.x - x + spread) / 0.09, 2.0))) * fade;
    }
    return s;
}

// A press also lights a ray at the key: a short shimmering streak, the
// kind real auroras throw out, centred on the key itself, so the light is
// where the key is and nowhere else. The curtain itself does not move.
float ray(vec2 uv) {
    float light = 0.0;
    for (int i = 0; i < 8; i++) {
        vec4 p = iKeyPresses[i];
        if (p.w < 0.0 || p.z > 3.0) continue;
        vec2 k = p.xy / iResolution.xy;
        float dx = uv.x - k.x, dy = uv.y - k.y;
        float streaks = 0.6 + 0.4 * noise(vec2(uv.x * 90.0, p.z * 3.0 + uv.y * 2.0));
        float fade = smoothstep(0.0, 0.35, p.z) * exp(-p.z * 1.2);
        light += exp(-dx * dx / 0.0018) * exp(-dy * dy / 0.03) * streaks * fade;
    }
    return light;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float t = iTime * 0.05 * speed;
    vec3 col = mix(vec3(0.01, 0.015, 0.035), vec3(0.02, 0.04, 0.07), uv.y);
    float lift = react ? surge(uv, height + 0.13) : 0.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float wave = height + 0.13 * fi + 0.18 * (fbm(vec2(uv.x * 2.0 + t * (1.0 + fi * 0.4), fi * 3.1 + t)) - 0.5);
        float band = exp(-pow((uv.y - wave) * (9.0 - fi * 2.0), 2.0));
        float curtain = fbm(vec2(uv.x * 12.0 + fi * 5.0, uv.y * 2.0 - t * 4.0));
        vec3 hue = mix(colour1.rgb, colour2.rgb, fi / 2.0);
        col += hue * band * (0.35 + 0.65 * curtain) * 0.55 * brightness * (1.0 + lift * 0.6);
    }
    if (react) col += mix(colour1.rgb, colour2.rgb, smoothstep(height, height + 0.4, uv.y)) * ray(uv) * 0.8 * brightness;
    if (stars) col += pow(hash(floor(fragCoord)), 900.0) * 0.6 * uv.y;
    fragColor = vec4(col, 1.0);
}
