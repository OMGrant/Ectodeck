/*{
  "DESCRIPTION": "Warp: drifting through deep space. Press a key and jump to hyperspace: the stars stretch into streaks around a soft glowing light, you rush down the hyperspace tunnel, then drop back out among the stars. Switch presets in Adjust, or with the Background Preset action.",
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

// the jump, from the newest press: the stars stretch into streaks, it enters the hyperspace tunnel, then drops back out
const float STRETCH = 1.0;   // seconds for the stars to pull into full-length streaks
const float ENTER = 1.45;    // when the tunnel takes over, after the streaks have held at full length
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
    float inTunnel = smoothstep(ENTER - 0.1, ENTER + 0.25, z) * (1.0 - smoothstep(DROP - 0.35, DROP, z));
    float flash = z > DROP ? exp(-(z - DROP) * 6.0) * 0.6 : smoothstep(ENTER - 0.25, ENTER, z) * exp(-max(z - ENTER, 0.0) * 5.0) * 0.25;

    // straight ahead, always toward the middle of the picture
    vec2 d = fragCoord - centre;
    float r = length(d) / iResolution.y;
    float a = atan(d.y, d.x) / 6.2831853 + 0.5;

    // how far we have travelled: cruising, plus the distance of every jump
    float travel = iTime * 0.012 * speed;
    for (int i = 0; i < 8; i++) {
        vec4 k = iKeyPresses[i];
        if (k.w < 0.0) continue;
        float kb = clamp(k.z / STRETCH, 0.0, 1.0);
        travel += 0.12 * kb * kb * kb * STRETCH + 0.5 * clamp(k.z - STRETCH, 0.0, DROP - STRETCH);
    }

    vec3 col = vec3(0.0, 0.004, 0.012);
    // a faint nebula far behind, only when cruising
    col += hyper * 0.06 * noise(fragCoord / 140.0 + iTime * 0.01) * (1.0 - inTunnel);

    // A starfield in true 3D: each star is a point in space coming toward you;
    // its place on the screen is its position divided by its distance, so far
    // stars sit close to the middle and creep, near ones spread out and race
    // past. On a jump each draws a streak from where it is back to where it
    // was a moment before.
    vec2 uv = d / iResolution.y;
    float starsShown = 1.0 - 0.85 * inTunnel;
    float trailBack = stretch * 0.5;               // at full stretch the streaks reach well back toward the middle             // how far back in its path the streak reaches
    const int STARS = 480;
    for (int i = 0; i < STARS; i++) {
        float fi = float(i);
        float h1 = hash(vec2(fi, 1.7)), h2 = hash(vec2(fi, 8.3)), h3 = hash(vec2(fi, 4.1));
        if (h3 > 0.6 * density + 0.2) continue;
        // where it sits across the view: spread so that, far off, the stars
        // cover the picture evenly rather than bunching in the middle
        float h4 = hash(vec2(fi, 2.3));
        vec2 pos = (vec2(h1, h2) - 0.5) * vec2(1.78, 1.0) * 12.0 * (0.12 + 0.88 * h4);
        float prog = fract(h3 * 7.1 + travel * (0.8 + 0.4 * h1));
        float zNow = mix(6.0, 0.12, prog);                // distance from you
        float zThen = zNow + trailBack * (6.0 - 0.12);
        vec2 now = pos / zNow * 0.5, then = pos / zThen * 0.5;
        // distance from this pixel to the streak between then and now
        vec2 seg = now - then + vec2(1e-6), rel = uv - then;
        float t = clamp(dot(rel, seg) / max(dot(seg, seg), 1e-7), 0.0, 1.0);
        float dist = length(rel - seg * t) * iResolution.y;
        float size = 0.45 + 1.3 / zNow;                   // pixels: nearer is bigger
        float glow = exp(-dist * dist / (size * size));
        // brighter as it nears; the streak fades toward its tail
        float bright = smoothstep(0.0, 0.25, prog) * (0.35 + 0.65 * smoothstep(0.2, 1.0, prog)) * mix(1.0, 0.25 + 0.75 * t, stretch);
        vec3 tint = mix(vec3(0.85, 0.9, 1.0), mix(vec3(1.0), hyper, 0.4), stretch);
        col += tint * glow * bright * starsShown;
    }

    // the tunnel: a tube of light rushing past, seen down its length. Depth
    // comes from the distance to the centre (near the edges is close by);
    // streaks run along it and the whole tube turns slowly
    if (inTunnel > 0.0) {
        // a wide tube: its walls well out from the middle
        float depth = 0.34 / (r + 0.03);
        float ang = a;                                            // streaks run straight at you, no twist
        float rush = depth * 0.8 - z * 6.0;
        // the streak pattern round the circle, blended across the point where
        // the angle wraps so no seam shows
        float wrapA = fract(ang + 0.5);
        float sA = noise(vec2(ang * 90.0, rush)) * 0.65 + noise(vec2(ang * 220.0, rush * 1.6 + 3.0)) * 0.35;
        float sB = noise(vec2(wrapA * 90.0 + 17.0, rush)) * 0.65 + noise(vec2(wrapA * 220.0 + 41.0, rush * 1.6 + 3.0)) * 0.35;
        float streaks = mix(sA, sB, smoothstep(0.35, 0.5, abs(ang - 0.5)));
        streaks = pow(streaks, 2.6) * 2.4;
        // the walls: brighter toward the middle distance, fading into the core
        float wall = smoothstep(0.05, 0.3, r) * (0.6 + 0.4 * smoothstep(1.1, 0.4, r));
        // blue walls with bright streaks, and soft bands of light rushing at you
        float bands = 0.5 + 0.5 * sin(rush * 1.3);
        vec3 tube = (mix(hyper * 0.8, vec3(0.9, 0.96, 1.0), clamp(streaks * 0.45, 0.0, 1.0)) * streaks + hyper * 0.35 * bands) * wall;
        col = mix(col, col * 0.3, inTunnel) + (tube + hyper * 0.1 * wall) * inTunnel;
    }

    // the light at the end: a soft glow where you are headed, growing as the
    // stars stretch and brightest in the tunnel
    float glowing = stretch * 0.6 + inTunnel * 0.9;
    // in the tunnel the light ahead is a large, bright opening, white at its
    // heart and blooming into the blue, as in Star Wars; smaller while the
    // stars stretch
    float core = exp(-r * r * mix(60.0, 14.0, inTunnel));
    float bloom = exp(-r * mix(4.0, 2.2, inTunnel));
    col += mix(vec3(0.85, 0.92, 1.0), hyper, 0.25) * glowing * (core * 0.6 + bloom * 0.18);
    col += vec3(1.0) * inTunnel * exp(-r * r * 90.0) * 0.5;

    // the flash of entering and leaving
    col += vec3(0.8, 0.9, 1.0) * flash;
    fragColor = vec4(col, 1.0);
}
