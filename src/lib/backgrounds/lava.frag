/*{
  "DESCRIPTION": "Lava Lamp: warm wax rising, merging and splitting in a glowing glass. A key press releases a hot blob that climbs from the key. Switch presets in Adjust, or with the Background Preset action.",
  "INPUTS": [
    {
      "NAME": "wax",
      "TYPE": "color",
      "LABEL": "Wax",
      "DEFAULT": [
        1.0,
        0.36,
        0.12,
        1
      ]
    },
    {
      "NAME": "glass",
      "TYPE": "color",
      "LABEL": "Liquid",
      "DEFAULT": [
        0.35,
        0.05,
        0.3,
        1
      ]
    },
    {
      "NAME": "speed",
      "TYPE": "float",
      "LABEL": "Speed",
      "DEFAULT": 1.0,
      "MIN": 0.2,
      "MAX": 3.0
    },
    {
      "NAME": "amount",
      "TYPE": "float",
      "LABEL": "Wax",
      "DEFAULT": 1.0,
      "MIN": 0.5,
      "MAX": 1.6
    }
  ],
  "PRESETS": [
    {
      "NAME": "Classic",
      "VALUES": {
        "wax": [
          1.0,
          0.36,
          0.12,
          1
        ],
        "glass": [
          0.35,
          0.05,
          0.3,
          1
        ]
      }
    },
    {
      "NAME": "Blue",
      "VALUES": {
        "wax": [
          0.2,
          0.6,
          1.0,
          1
        ],
        "glass": [
          0.05,
          0.08,
          0.3,
          1
        ]
      }
    },
    {
      "NAME": "Green",
      "VALUES": {
        "wax": [
          0.5,
          1.0,
          0.25,
          1
        ],
        "glass": [
          0.25,
          0.2,
          0.05,
          1
        ]
      }
    },
    {
      "NAME": "Pink",
      "VALUES": {
        "wax": [
          1.0,
          0.4,
          0.7,
          1
        ],
        "glass": [
          0.12,
          0.05,
          0.35,
          1
        ]
      }
    },
    {
      "NAME": "Gold",
      "VALUES": {
        "wax": [
          1.0,
          0.78,
          0.2,
          1
        ],
        "glass": [
          0.3,
          0.08,
          0.08,
          1
        ]
      }
    }
  ]
}*/



float hash(float n) { return fract(sin(n) * 43758.5453); }

// the wax as a field: every blob adds a soft bump; the surface is where the
// sum crosses a threshold, so blobs flow together and pinch apart smoothly
float field(vec2 p, float t) {
    float f = 0.0;
    for (int i = 0; i < 11; i++) {
        float fi = float(i);
        float period = 18.0 + hash(fi * 3.1) * 16.0;
        float phase = fract(t / period + hash(fi * 7.7));
        // each blob rises slowly, cools at the top and sinks again
        float y = 0.5 - 0.62 * cos(phase * 6.2831);
        float x = 0.12 + 0.76 * hash(fi * 1.3) + 0.06 * sin(t * 0.21 + fi * 2.0);
        float r = (0.055 + 0.06 * hash(fi * 5.9)) * amount;
        vec2 d = p - vec2(x * iResolution.x / iResolution.y, y);
        f += r * r / (dot(d, d) + 1e-4);
    }
    // wax pooled at the bottom and hanging from the top, like a real lamp
    f += 0.018 * amount / max(p.y + 0.03, 0.01);
    f += 0.012 * amount / max(1.03 - p.y, 0.01);
    // hot blobs from key presses, climbing from the key
    for (int i = 0; i < 8; i++) {
        vec4 k = iKeyPresses[i];
        if (k.w < 0.0 || k.z > 14.0) continue;
        vec2 c = vec2(k.x, k.y) / iResolution.y + vec2(0.02 * sin(k.z * 1.3), k.z * 0.06 * speed);
        float r = 0.085 * amount * smoothstep(0.0, 0.6, k.z) * smoothstep(14.0, 9.0, k.z);
        vec2 d = p - c;
        f += r * r / (dot(d, d) + 1e-4);
    }
    return f;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 p = fragCoord / iResolution.y;
    float t = iTime * speed;
    float f = field(p, t);
    // the wax's height: rising from the surface and levelling off inside, so
    // the blobs light as smooth domes rather than spiking at their centres
    float e = 0.004;
    float h = sqrt(clamp(1.0 - 1.0 / f, 0.0, 1.0));
    float hx = sqrt(clamp(1.0 - 1.0 / field(p + vec2(e, 0.0), t), 0.0, 1.0));
    float hy = sqrt(clamp(1.0 - 1.0 / field(p + vec2(0.0, e), t), 0.0, 1.0));
    vec3 n = normalize(vec3(-(hx - h) / e * 0.08, -(hy - h) / e * 0.08, 1.0));

    // the liquid: lit from below, darker at the top and the sides
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = glass.rgb * (0.35 + 0.9 * (1.0 - uv.y)) * (0.6 + 0.4 * sin(uv.x * 3.1416));
    col += wax.rgb * 0.12 * exp(-uv.y * 3.0);

    float edge = smoothstep(1.0, 1.08, f);
    if (edge > 0.0) {
        vec3 light = normalize(vec3(0.3, -0.8, 0.6));
        float diffuse = clamp(dot(n, light), 0.0, 1.0);
        float rim = pow(1.0 - n.z, 2.0);
        vec3 w = wax.rgb * (0.55 + 0.6 * diffuse) + vec3(1.0, 0.85, 0.5) * rim * 0.6;
        // hotter near the lamp's bulb at the bottom
        w = mix(w, w * vec3(1.15, 1.05, 0.8) + 0.08, 1.0 - uv.y);
        w += vec3(1.0, 0.9, 0.7) * pow(clamp(dot(reflect(-light, n), vec3(0, 0, 1)), 0.0, 1.0), 24.0) * 0.5;
        col = mix(col, w, edge);
    }
    // the glow the wax casts into the liquid
    col += wax.rgb * 0.18 * smoothstep(0.5, 1.0, f) * (1.0 - edge);
    fragColor = vec4(col, 1.0);
}
