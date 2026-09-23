/*{
  "DESCRIPTION": "Synthwave: a striped sun setting behind neon mountains over an endless grid. A key press sends a shooting star down onto the key; where it hits, the key lights up and shines down onto the grid beneath it. Switch presets in Adjust, or with the Background Preset action.",
  "INPUTS": [
    {
      "NAME": "sky",
      "TYPE": "color",
      "LABEL": "Sky",
      "DEFAULT": [
        0.42,
        0.1,
        0.55,
        1
      ]
    },
    {
      "NAME": "sun",
      "TYPE": "color",
      "LABEL": "Sun",
      "DEFAULT": [
        1.0,
        0.82,
        0.25,
        1
      ]
    },
    {
      "NAME": "grid",
      "TYPE": "color",
      "LABEL": "Grid",
      "DEFAULT": [
        1.0,
        0.2,
        0.75,
        1
      ]
    },
    {
      "NAME": "speed",
      "TYPE": "float",
      "LABEL": "Speed",
      "DEFAULT": 1.0,
      "MIN": 0.0,
      "MAX": 3.0
    },
    {
      "NAME": "stars",
      "TYPE": "bool",
      "LABEL": "Stars",
      "DEFAULT": true
    }
  ],
  "PRESETS": [
    {
      "NAME": "Sunset",
      "VALUES": {
        "sky": [
          0.42,
          0.1,
          0.55,
          1
        ],
        "sun": [
          1.0,
          0.82,
          0.25,
          1
        ],
        "grid": [
          1.0,
          0.2,
          0.75,
          1
        ]
      }
    },
    {
      "NAME": "Ocean",
      "VALUES": {
        "sky": [
          0.05,
          0.22,
          0.5,
          1
        ],
        "sun": [
          0.5,
          1.0,
          0.95,
          1
        ],
        "grid": [
          0.2,
          0.7,
          1.0,
          1
        ]
      }
    },
    {
      "NAME": "Jungle",
      "VALUES": {
        "sky": [
          0.05,
          0.3,
          0.2,
          1
        ],
        "sun": [
          0.85,
          1.0,
          0.35,
          1
        ],
        "grid": [
          0.3,
          1.0,
          0.5,
          1
        ]
      }
    },
    {
      "NAME": "Blood moon",
      "VALUES": {
        "sky": [
          0.35,
          0.02,
          0.06,
          1
        ],
        "sun": [
          1.0,
          0.35,
          0.15,
          1
        ],
        "grid": [
          1.0,
          0.15,
          0.1,
          1
        ]
      }
    }
  ]
}*/

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(float x) { float i = floor(x), f = fract(x); return mix(hash(vec2(i, 0.0)), hash(vec2(i + 1.0, 0.0)), f * f * (3.0 - 2.0 * f)); }

const float HORIZON = 0.42; // as a fraction of the height, from the bottom
const float FLIGHT = 0.55; // seconds from a press to the star landing
const float KEY_HALF = 52.0; // half a key's width on the panel, in pixels
const float GLOW = 1.4;     // seconds the light takes to fade

// the ridge line of the mountains, in picture heights above the horizon
float ridge(float x) {
    float h = 0.0, a = 0.09, f = 3.0;
    for (int i = 0; i < 4; i++) { h += a * noise(x * f + float(i) * 7.3); a *= 0.5; f *= 2.1; }
    // lower in the middle, where the sun sits
    return h * (0.35 + 0.65 * smoothstep(0.05, 0.42, abs(x - 0.5)));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec3 skyC = sky.rgb, sunC = sun.rgb, gridC = grid.rgb;
    vec2 uv = fragCoord / iResolution.xy;
    float aspect = iResolution.x / iResolution.y;
    float ride = iTime * speed;
    vec3 col;

    if (uv.y > HORIZON) {
        // the skyC, darkening upward, warm at the horizon
        float h = (uv.y - HORIZON) / (1.0 - HORIZON);
        col = mix(vec3(1.0, 0.35, 0.45) * 0.9, skyC, smoothstep(0.0, 0.55, h));
        col = mix(col, skyC * 0.18, smoothstep(0.45, 1.0, h));
        if (stars) {
            vec2 cell = floor(fragCoord / 3.0);
            float s = step(0.996, hash(cell)) * smoothstep(0.25, 0.8, h);
            col += s * (0.5 + 0.5 * sin(iTime * 3.0 + hash(cell + 1.0) * 30.0));
        }
        // the sunC: a disc with stripes cut into its lower half, and a glow
        vec2 sp = vec2((uv.x - 0.5) * aspect, uv.y - HORIZON - 0.17);
        float r = length(sp), R = 0.25;
        col += sunC * vec3(1.0, 0.45, 0.6) * 0.35 * exp(-max(r - R, 0.0) * 6.0);
        if (r < R) {
            float band = (sp.y + R) / (2.0 * R);
            vec3 face = mix(vec3(1.0, 0.25, 0.55), sunC, band);
            float gap = band < 0.55 ? step(0.5 + 0.5 * (0.55 - band) * 1.4, fract((sp.y - iTime * 0.02) * 26.0)) : 0.0;
            col = mix(col, face, (1.0 - gap) * smoothstep(R, R - 0.004, r));
        }
        // mountains, dark with a neon edge
        float m = HORIZON + ridge(uv.x);
        if (uv.y < m) {
            col = mix(vec3(0.05, 0.01, 0.1), vec3(0.12, 0.02, 0.18), (uv.y - HORIZON) / max(m - HORIZON, 1e-3));
            col += gridC * 0.9 * exp(-(m - uv.y) * 260.0);
        }
    } else {
        // the gridC, in perspective, sliding toward the viewer
        float depth = (HORIZON - uv.y) / HORIZON;           // 0 at the horizon, 1 at the bottom
        float z = 1.0 / max(depth, 0.001);
        vec2 g = vec2((uv.x - 0.5) * aspect * z * 2.2, z * 1.2 + ride * 2.0);
        vec2 f = abs(fract(g) - 0.5);
        vec2 width = fwidth(g) * 1.2;
        float line = max(smoothstep(0.5 - width.x, 0.5, f.x), smoothstep(0.5 - width.y, 0.5, f.y));
        col = vec3(0.04, 0.0, 0.08) + vec3(0.12, 0.02, 0.16) * depth;
        float fog = smoothstep(0.0, 0.35, depth);
        col += gridC * line * fog * 1.2;
        // a soft glow over the lines near the viewer
        col += gridC * 0.06 * fog;
        // the sunC's reflection on the floor
        col += sunC * vec3(1.0, 0.4, 0.6) * 0.25 * exp(-abs(uv.x - 0.5) * 9.0) * (1.0 - depth);

        // where a star has hit, the key shines down onto the grid beneath it: the
        // lines in a lane as wide as the key light up, brightest just below it
        for (int i = 0; i < 8; i++) {
            vec4 p = iKeyPresses[i];
            float since = p.z - FLIGHT;
            if (p.w < 0.0 || since < 0.0 || since > GLOW) continue;
            float lane = 1.0 - smoothstep(KEY_HALF - 12.0, KEY_HALF + 10.0, abs(fragCoord.x - p.x));
            float below = fragCoord.y < p.y ? exp(-(p.y - fragCoord.y) / (iResolution.y * 0.55)) : 0.0;
            float fade = exp(-since * 2.4) * (1.0 - since / GLOW);
            col += mix(gridC, vec3(1.0), 0.35) * lane * below * fade * (line * fog * 5.0 + 0.4);
        }
    }

    // shooting stars: each falls from high up onto its key; where it hits, a
    // flash, and the key lights up
    for (int i = 0; i < 8; i++) {
        vec4 p = iKeyPresses[i];
        if (p.w < 0.0 || p.z > FLIGHT + GLOW) continue;
        vec2 land = vec2(p.x / iResolution.x * aspect, p.y / iResolution.y);
        vec2 start = land + vec2(0.35 + hash(vec2(p.w, 3.0)) * 0.15, 0.62);
        vec2 dir = normalize(land - start);
        float k = clamp(p.z / FLIGHT, 0.0, 1.0);
        vec2 head = mix(start, land, k * k);                  // speeding up as it falls
        vec2 q = vec2(uv.x * aspect, uv.y) - head;
        if (p.z < FLIGHT) {
            float along = dot(q, -dir), across = abs(dot(q, vec2(-dir.y, dir.x)));
            float trail = step(0.0, along) * exp(-along * 6.0) * exp(-across * 450.0);
            col += vec3(1.0, 0.9, 1.0) * (trail + exp(-length(q) * 90.0));
        }
        float since = p.z - FLIGHT;
        if (since > 0.0) {
            vec2 d = vec2(uv.x * aspect, uv.y) - land;
            // the hit: a white-hot flash at the key, fading fast
            col += mix(sunC, vec3(1.0), 0.6) * exp(-since * 5.0) * exp(-length(d) * 20.0) * 2.2;
            // the key itself lights up: a soft square the size of the key
            vec2 k2 = abs(fragCoord - p.xy) - vec2(KEY_HALF - 14.0);
            float box = length(max(k2, 0.0)) + min(max(k2.x, k2.y), 0.0) - 14.0;   // a rounded square
            float fade = exp(-since * 2.4) * (1.0 - since / GLOW);
            col += mix(gridC, vec3(1.0), 0.3) * fade * (0.45 * (1.0 - smoothstep(-6.0, 10.0, box)) + 0.9 * exp(-abs(box) * 0.18));
        }
    }

    fragColor = vec4(col, 1.0);
}
