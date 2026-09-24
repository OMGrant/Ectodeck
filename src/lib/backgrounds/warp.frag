/*{
  "DESCRIPTION": "Warp: drifting through deep space. Press a key and jump to hyperspace: the view turns toward the key, the stars stretch into streaks around a soft glowing light, you rush down the swirling hyperspace tunnel, then drop back out among the stars. Switch presets in Adjust, or with the Background Preset action.",
  "INPUTS": [
    {
      "NAME": "speed",
      "TYPE": "float",
      "LABEL": "Cruising speed",
      "DEFAULT": 1.0,
      "MIN": 0.1,
      "MAX": 4.0
    },
    {
      "NAME": "tunnel",
      "TYPE": "color",
      "LABEL": "Hyperspace",
      "DEFAULT": [
        0.35,
        0.55,
        1.0,
        1
      ]
    },
    {
      "NAME": "density",
      "TYPE": "float",
      "LABEL": "Stars",
      "DEFAULT": 1.0,
      "MIN": 0.3,
      "MAX": 2.0
    }
  ],
  "PRESETS": [
    {
      "NAME": "Blue",
      "VALUES": {
        "tunnel": [
          0.35,
          0.55,
          1.0,
          1
        ]
      }
    },
    {
      "NAME": "Red",
      "VALUES": {
        "tunnel": [
          1.0,
          0.3,
          0.25,
          1
        ]
      }
    },
    {
      "NAME": "Green",
      "VALUES": {
        "tunnel": [
          0.35,
          1.0,
          0.45,
          1
        ]
      }
    },
    {
      "NAME": "Gold",
      "VALUES": {
        "tunnel": [
          1.0,
          0.8,
          0.35,
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

// the jump, from the newest press: the ship turns toward the key and the stars
// stretch into streaks, it enters the hyperspace tunnel, then drops back out
const float STRETCH = 0.9;   // seconds for the stars to pull into streaks
const float ENTER = 1.05;    // when the tunnel takes over
const float DROP = 3.4;      // when the jump ends

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec3 hyper = tunnel.rgb;
    vec2 centre = 0.5 * iResolution.xy;
    vec4 p = iKeyPresses[0];
    bool jumping = p.w >= 0.0 && p.z < DROP + 1.2;
    float z = jumping ? p.z : 1e6;
    // the stretch builds slowly and then races, as a jump to lightspeed does
    float build = smoothstep(0.0, STRETCH, z);
    float stretch = build * build * (1.0 - smoothstep(DROP - 0.05, DROP + 0.25, z));
    float inTunnel = smoothstep(ENTER - 0.2, ENTER + 0.25, z) * (1.0 - smoothstep(DROP - 0.35, DROP, z));
    float flash = z > DROP ? exp(-(z - DROP) * 6.0) * 0.6 : smoothstep(ENTER - 0.25, ENTER, z) * exp(-max(z - ENTER, 0.0) * 5.0) * 0.25;

    // the camera: it turns a third of the way toward the pressed key as the
    // jump begins, banking a little, holds there, and glides back afterwards
    float turn = smoothstep(0.0, 0.9, z) * (1.0 - smoothstep(DROP, DROP + 1.2, z));
    vec2 aim = jumping ? (p.xy - centre) * 0.35 : vec2(0.0);
    vec2 vp = centre + aim * turn;
    float bank = -aim.x / iResolution.x * 0.25 * turn;
    vec2 d = fragCoord - vp;
    d = mat2(cos(bank), -sin(bank), sin(bank), cos(bank)) * d;
    float r = length(d) / iResolution.y;
    float a = atan(d.y, d.x) / 6.2831853 + 0.5;

    // how far we have travelled: cruising, plus the distance of every jump
    float travel = iTime * 0.04 * speed;
    for (int i = 0; i < 8; i++) {
        vec4 k = iKeyPresses[i];
        if (k.w < 0.0) continue;
        float kb = clamp(k.z / STRETCH, 0.0, 1.0);
        travel += 0.2 * kb * kb * kb * STRETCH + 0.9 * clamp(k.z - STRETCH, 0.0, DROP - STRETCH);
    }

    vec3 col = vec3(0.0, 0.004, 0.012);
    // a faint nebula far behind, only when cruising
    col += hyper * 0.06 * noise(fragCoord / 140.0 + iTime * 0.01) * (1.0 - inTunnel);

    // stars in three layers of radial sectors; each sector holds at most one
    // star, moving outward, drawn as a streak whose length is the jump's stretch
    float starsShown = 1.0 - 0.85 * inTunnel;
    for (int layer = 0; layer < 3; layer++) {
        float fl = float(layer);
        float N = 220.0 + fl * 180.0;
        float sector = floor(a * N);
        float seed = hash(vec2(sector, fl * 13.0));
        if (seed > 0.5 * density) continue;
        float pace = 0.5 + seed * 1.5;
        float s = fract(seed * 37.0 + travel * pace);
        float rad = s * s * 1.4;                                    // accelerates outward, like perspective
        float len = 0.004 + stretch * (0.12 + 0.8 * rad);
        // across the sector: the star's thickness in pixels
        float across = abs(fract(a * N) - 0.5) * 6.2831853 * r / N * iResolution.y;
        float thick = 0.6 + 1.4 * s + stretch * 0.6;
        float body = exp(-across * across / (thick * thick));
        float along = (rad - r) / max(len, 1e-4);                   // 0 at the head, 1 at the tail
        float streak = step(0.0, along) * step(along, 1.0) * mix(1.0, 1.0 - along, stretch * 0.7);
        float head = exp(-pow((r - rad) * iResolution.y / thick, 2.0));
        float bright = (streak * (0.55 + 0.45 * stretch) + head) * body * smoothstep(0.0, mix(0.35, 0.08, stretch), rad);
        vec3 tint = mix(vec3(0.85, 0.9, 1.0), mix(vec3(1.0), hyper, 0.4), stretch);
        col += tint * bright * (0.6 + 0.4 * seed) * starsShown;
    }

    // the tunnel: a tube of light rushing past, seen down its length. Depth
    // comes from the distance to the centre (near the edges is close by);
    // streaks run along it and the whole tube turns slowly
    if (inTunnel > 0.0) {
        float depth = 0.16 / (r + 0.015);
        float ang = a + z * 0.06 + depth * 0.07;                  // the streaks spiral round the tube
        float rush = depth * 1.2 - z * 7.0;
        float streaks = noise(vec2(ang * 90.0, rush)) * 0.65 + noise(vec2(ang * 220.0, rush * 1.6 + 3.0)) * 0.35;
        streaks = pow(streaks, 2.6) * 2.4;
        // the walls: brighter toward the middle distance, fading into the core
        float wall = smoothstep(0.02, 0.12, r) * (0.55 + 0.45 * smoothstep(0.9, 0.2, r));
        // blue walls with bright streaks, and soft bands of light rushing at you
        float bands = 0.5 + 0.5 * sin(rush * 1.3 + ang * 12.566);
        vec3 tube = (mix(hyper * 0.8, vec3(0.9, 0.96, 1.0), clamp(streaks * 0.45, 0.0, 1.0)) * streaks + hyper * 0.35 * bands) * wall;
        col = mix(col, col * 0.3, inTunnel) + (tube + hyper * 0.1 * wall) * inTunnel;
    }

    // the light at the end: a soft glow where you are headed, growing as the
    // stars stretch and brightest in the tunnel
    float glowing = stretch * 0.6 + inTunnel * 0.9;
    col += mix(vec3(0.85, 0.92, 1.0), hyper, 0.25) * glowing * (exp(-r * r * 180.0) * 0.9 + exp(-r * 6.0) * 0.22);

    // the flash of entering and leaving
    col += vec3(0.8, 0.9, 1.0) * flash;
    fragColor = vec4(col, 1.0);
}
