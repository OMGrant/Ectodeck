/*{
  "DESCRIPTION": "Ember: a warm glow flowing slowly between three colours. A key press lifts a few sparks off the key. Switch presets in Adjust, or with the Background Preset action.",
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
  ],
  "PRESETS": [
    {
      "NAME": "Ember",
      "VALUES": {
        "colour1": [
          1.0,
          0.54,
          0.11,
          1
        ],
        "colour2": [
          0.96,
          0.25,
          0.49,
          1
        ],
        "colour3": [
          0.52,
          0.22,
          0.82,
          1
        ]
      }
    },
    {
      "NAME": "Ocean",
      "VALUES": {
        "colour1": [
          0.1,
          0.7,
          0.9,
          1
        ],
        "colour2": [
          0.15,
          0.35,
          0.95,
          1
        ],
        "colour3": [
          0.4,
          0.95,
          0.7,
          1
        ]
      }
    },
    {
      "NAME": "Forest",
      "VALUES": {
        "colour1": [
          0.55,
          0.85,
          0.2,
          1
        ],
        "colour2": [
          0.15,
          0.6,
          0.35,
          1
        ],
        "colour3": [
          0.9,
          0.8,
          0.3,
          1
        ]
      }
    },
    {
      "NAME": "Candy",
      "VALUES": {
        "colour1": [
          1.0,
          0.45,
          0.75,
          1
        ],
        "colour2": [
          0.6,
          0.4,
          1.0,
          1
        ],
        "colour3": [
          0.4,
          0.9,
          1.0,
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
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
}

// A press lifts a few sparks off the key. Each drifts upward with its own
// speed and sway, flickers, and dims as it rises.
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
vec3 sparks(vec2 frag, vec3 under) {
    // the colour of the flow here, brought up to full brightness
    vec3 warm = under / max(max(under.r, max(under.g, under.b)), 0.04);
    vec3 hot = mix(warm, vec3(1.0), 0.45);
    vec3 light = vec3(0.0);
    for (int i = 0; i < 8; i++) {
        vec4 p = iKeyPresses[i];
        if (p.w < 0.0 || p.z > 2.2) continue;
        float age = p.z;
        for (int j = 0; j < 9; j++) {
            float seed = p.w * 13.0 + float(j) * 7.3 + floor(p.x + p.y);
            float life = 1.2 + 0.9 * h1(seed);
            if (age > life) continue;
            float k = age / life;
            vec2 at = p.xy + vec2((h1(seed + 1.0) - 0.5) * 70.0, (h1(seed + 2.0) - 0.5) * 40.0);
            at.y += (60.0 + 90.0 * h1(seed + 3.0)) * age;
            at.x += sin(age * (3.0 + 3.0 * h1(seed + 4.0)) + seed) * 14.0 * k;
            float r = length(frag - at);
            float flicker = 0.75 + 0.25 * sin(age * 40.0 + seed * 5.0);
            float fade = (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.08, age);
            light += hot * exp(-r * r / 11.0) * fade * flicker * 1.3;
            light += warm * exp(-r * r / 110.0) * fade * 0.22;
        }
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
    if (react) col += sparks(fragCoord, col);
    fragColor = vec4(col, 1.0);
}
