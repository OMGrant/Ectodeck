/*{
  "DESCRIPTION": "Nebula: clouds of colour drifting slowly through each other, as a fluid. A key press stirs a broad puff of turbulence into the smoke around the key. Switch presets in Adjust, or with the Background preset action.",
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
  ],
  "PASSES": [
    {
      "TARGET": "curl",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "flow",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "pressure",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "flow",
      "PERSISTENT": true,
      "FLOAT": true,
      "WIDTH": "$WIDTH/4",
      "HEIGHT": "$HEIGHT/4"
    },
    {
      "TARGET": "smoke",
      "PERSISTENT": true,
      "FLOAT": true
    },
    {}
  ],
  "PRESETS": [
    {
      "NAME": "Orchid",
      "VALUES": {
        "colour1": [
          0.22,
          0.05,
          0.38,
          1
        ],
        "colour2": [
          0.8,
          0.18,
          0.56,
          1
        ],
        "colour3": [
          0.4,
          0.62,
          1.0,
          1
        ]
      }
    },
    {
      "NAME": "Deep sea",
      "VALUES": {
        "colour1": [
          0.02,
          0.1,
          0.25,
          1
        ],
        "colour2": [
          0.1,
          0.5,
          0.7,
          1
        ],
        "colour3": [
          0.5,
          0.95,
          0.85,
          1
        ]
      }
    },
    {
      "NAME": "Supernova",
      "VALUES": {
        "colour1": [
          0.3,
          0.05,
          0.02,
          1
        ],
        "colour2": [
          1.0,
          0.45,
          0.1,
          1
        ],
        "colour3": [
          1.0,
          0.9,
          0.5,
          1
        ]
      }
    },
    {
      "NAME": "Emerald",
      "VALUES": {
        "colour1": [
          0.02,
          0.18,
          0.1,
          1
        ],
        "colour2": [
          0.2,
          0.75,
          0.4,
          1
        ],
        "colour3": [
          0.8,
          1.0,
          0.5,
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
    mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) { v += a * noise(p); p = r * p * 2.0; a *= 0.5; }
    return v;
}

// The nebula's own look, drifting slowly: the smoke relaxes toward this.
vec3 nebula(vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.03 * speed;
    vec2 q = vec2(fbm(uv * zoom + t), fbm(uv * zoom - t + 4.7));
    vec2 r = vec2(fbm(uv * zoom + 3.0 * q + vec2(1.7, 9.2) + t * 1.5), fbm(uv * zoom + 3.0 * q + vec2(8.3, 2.8) - t));
    float f = fbm(uv * zoom + 3.5 * r);
    vec3 col = mix(vec3(0.015, 0.01, 0.04), colour1.rgb, smoothstep(0.3, 0.7, f));
    col = mix(col, colour2.rgb, 0.75 * smoothstep(0.45, 0.85, length(q) * f * 1.6));
    col = mix(col, colour3.rgb, smoothstep(0.55, 0.9, r.x * f * 1.5) * 0.6);
    col *= (0.25 + 0.65 * smoothstep(0.25, 0.8, f)) * brightness;
    return pow(col, vec3(1.1));
}

// A small fluid simulation in the standard stable-fluids shape. The flow
// runs on a grid a quarter of the picture's size, where the pressure solve
// can reach across a key's width each frame; the smoke it carries is drawn
// at full size, so it stays sharp. Passes (see PASSES):
//
//   0       curl       how much the flow swirls at each point
//   1       flow       the flow carried along by itself, key-press jets
//                      added, and vorticity confinement, which feeds the
//                      swirls back in so eddies stay alive instead of blurring
//   2-21    pressure   twenty relaxation steps toward the pressure that makes
//                      the flow incompressible, kept between frames
//   22      flow       the pressure's push applied, so nothing is compressed:
//                      that is what makes a jet curl into rolling eddies
//   23      smoke      the nebula's colours, carried by the flow, relaxing
//                      slowly back toward the nebula's own drifting pattern
//   24      shown      the smoke
//
// Velocity is in grid cells per frame. A press stirs one broad turbulent puff
// into the flow around the key, and the smoke billows in swirls of several
// sizes, spreading and settling.
const float SIM = 4.0;   // the flow grid is the picture's size over this

vec4 at(sampler2D image, vec2 uv) { return texture(image, uv); }

// The stream function of a press's puff, in flow-grid cells: broad noise,
// faded out over about two keys around the key. Its curl is the
// puff's velocity, swirling and free of compression by construction.
float stream(vec2 c, vec2 key, float seed) {
    vec2 d = c - key;
    float fade = exp(-dot(d, d) / (2.0 * 17.0 * 17.0));
    float n = noise(c / 14.0 + seed) - 0.5;
    return n * fade * 20.0;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / RENDERSIZE;
    vec2 dx = vec2(1.0 / RENDERSIZE.x, 0.0), dy = vec2(0.0, 1.0 / RENDERSIZE.y);
    int last = 24;

    if (PASSINDEX == 0) {
        float c = 0.5 * ((at(flow, uv + dx).y - at(flow, uv - dx).y) - (at(flow, uv + dy).x - at(flow, uv - dy).x));
        fragColor = vec4(c, 0.0, 0.0, 1.0);
    } else if (PASSINDEX == 1) {
        if (iFrame < 2) { fragColor = vec4(0.0); return; }
        vec2 v = at(flow, uv - at(flow, uv).xy / RENDERSIZE).xy;
        // vorticity confinement: push along the swirl, toward stronger swirl
        float cL = abs(at(curl, uv - dx).x), cR = abs(at(curl, uv + dx).x);
        float cB = abs(at(curl, uv - dy).x), cT = abs(at(curl, uv + dy).x);
        vec2 g = vec2(cR - cL, cT - cB);
        g /= length(g) + 1e-5;
        v += vec2(g.y, -g.x) * at(curl, uv).x * 0.3;
        if (react) {
            for (int i = 0; i < 8; i++) {
                vec4 p = iKeyPresses[i];
                if (p.w < 0.0 || p.z > 0.3) continue;
                vec2 key = p.xy / SIM;
                // one broad turbulent puff around the key: a few large swirls,
                // made as pure rotation (the curl of a stream
                // function), which a liquid keeps whole rather than cancelling
                float seed = p.w * 3.1 + floor(p.x * 0.05);
                float strength = 1.0 - p.z / 0.3;
                vec2 ex = vec2(1.0, 0.0), ey = vec2(0.0, 1.0);
                float sN = stream(fragCoord + ey, key, seed), sS = stream(fragCoord - ey, key, seed);
                float sE = stream(fragCoord + ex, key, seed), sW = stream(fragCoord - ex, key, seed);
                v += vec2(sN - sS, sW - sE) * 0.5 * strength;
            }
        }
        v *= 0.995;
        float s = length(v);
        if (s > 3.0) v *= 3.0 / s;
        fragColor = vec4(v, 0.0, 1.0);
    } else if (PASSINDEX < last - 2) {
        float divergence = 0.5 * ((at(flow, uv + dx).x - at(flow, uv - dx).x) + (at(flow, uv + dy).y - at(flow, uv - dy).y));
        float p = (at(pressure, uv - dx).x + at(pressure, uv + dx).x + at(pressure, uv - dy).x + at(pressure, uv + dy).x - divergence) * 0.25;
        fragColor = vec4(p * (PASSINDEX == 2 ? 0.98 : 1.0), 0.0, 0.0, 1.0);
    } else if (PASSINDEX == last - 2) {
        vec2 v = at(flow, uv).xy - 0.5 * vec2(at(pressure, uv + dx).x - at(pressure, uv - dx).x, at(pressure, uv + dy).x - at(pressure, uv - dy).x);
        fragColor = vec4(v, 0.0, 1.0);
    } else if (PASSINDEX == last - 1) {
        vec3 base = nebula(fragCoord);
        if (iFrame < 3) { fragColor = vec4(base, 1.0); return; }
        // the flow's cells are SIM pixels across
        vec3 carried = at(smoke, uv - at(flow, uv).xy * SIM / RENDERSIZE).rgb;
        fragColor = vec4(mix(carried, base, 0.008), 1.0);
    } else {
        fragColor = vec4(at(smoke, uv).rgb, 1.0);
    }
}
