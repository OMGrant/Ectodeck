/*{
  "DESCRIPTION": "Warp: drifting through deep space. Press a key and jump to hyperspace from it: the stars stretch into streaks racing out from the key, you ride the blue tunnel for a moment, then drop back out among the stars. The Background look action changes the colour of hyperspace.",
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "LABEL": "Cruising speed", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0 },
    { "NAME": "tunnel", "TYPE": "color", "LABEL": "Hyperspace", "DEFAULT": [0.35, 0.55, 1.0, 1] },
    { "NAME": "density", "TYPE": "float", "LABEL": "Stars", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0 }
  ]
}*/

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// the jump, from the newest press: stretch, tunnel, drop out
const float STRETCH = 0.7;   // seconds for the stars to pull into streaks
const float DROP = 3.0;      // when the jump ends

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    // the Background look action: your colour, then red, green and gold
    int n = int(mod(floor(iLook + 0.5), 4.0));
    vec3 hyper = n == 0 ? tunnel.rgb : n == 1 ? vec3(1.0, 0.3, 0.25) : n == 2 ? vec3(0.35, 1.0, 0.45) : vec3(1.0, 0.8, 0.35);
    vec2 centre = 0.5 * iResolution.xy;
    vec4 p = iKeyPresses[0];
    bool jumping = p.w >= 0.0 && p.z < DROP + 0.6;
    float z = jumping ? p.z : 1e6;
    float stretch = smoothstep(0.0, STRETCH, z) * (1.0 - smoothstep(DROP - 0.05, DROP + 0.05, z));
    float inTunnel = smoothstep(STRETCH - 0.1, STRETCH + 0.3, z) * (1.0 - smoothstep(DROP - 0.4, DROP, z));
    float flash = z > DROP ? exp(-(z - DROP) * 7.0) : exp(-z * 12.0) * 0.6;

    // the stars race out from the pressed key
    vec2 vp = jumping ? mix(centre, p.xy, smoothstep(0.0, 0.15, z)) : centre;
    vec2 d = fragCoord - vp;
    float r = length(d) / iResolution.y;
    float a = atan(d.y, d.x) / 6.2831853 + 0.5;

    // how far we have travelled: cruising, plus the distance of every jump
    float travel = iTime * 0.04 * speed;
    for (int i = 0; i < 8; i++) {
        vec4 k = iKeyPresses[i];
        if (k.w < 0.0) continue;
        travel += 0.9 * clamp(k.z - STRETCH, 0.0, DROP - STRETCH) + 0.25 * clamp(k.z, 0.0, STRETCH) * clamp(k.z, 0.0, STRETCH);
    }

    vec3 col = vec3(0.0, 0.004, 0.012);
    // a faint nebula far behind, only when cruising
    col += hyper * 0.06 * noise(fragCoord / 140.0 + iTime * 0.01) * (1.0 - inTunnel);

    // stars in three layers of radial sectors; each sector holds at most one
    // star, moving outward, drawn as a streak whose length is the jump's stretch
    for (int layer = 0; layer < 3; layer++) {
        float fl = float(layer);
        float N = 220.0 + fl * 180.0;
        float sector = floor(a * N);
        float seed = hash(vec2(sector, fl * 13.0));
        if (seed > 0.5 * density) continue;
        float pace = 0.5 + seed * 1.5;
        float s = fract(seed * 37.0 + travel * pace);
        float rad = s * s * 1.4;                                    // accelerates outward, like perspective
        float len = 0.004 + stretch * (0.12 + 0.8 * rad) + inTunnel * 0.4 * rad;
        // across the sector: the star's thickness in pixels
        float across = abs(fract(a * N) - 0.5) * 6.2831853 * r / N * iResolution.y;
        float thick = 0.6 + 1.4 * s + stretch * 0.6;
        float body = exp(-across * across / (thick * thick));
        float along = (rad - r) / max(len, 1e-4);                   // 0 at the head, 1 at the tail
        float streak = step(0.0, along) * step(along, 1.0) * mix(1.0, 1.0 - along, stretch * 0.7);
        float head = exp(-pow((r - rad) * iResolution.y / thick, 2.0));
        float bright = (streak * (0.55 + 0.45 * stretch) + head) * body * smoothstep(0.0, mix(0.35, 0.08, stretch), rad);
        vec3 tint = mix(vec3(0.85, 0.9, 1.0), mix(vec3(1.0), hyper, 0.55), inTunnel);
        col += tint * bright * (0.6 + 0.4 * seed);
    }

    // inside the hyper: a blue glow and slow swirling light around you
    if (inTunnel > 0.0) {
        float swirl = noise(vec2(a * 40.0 + z * 0.8, log(r + 0.02) * 3.0 - z * 4.0));
        col += hyper * inTunnel * (0.12 + 0.35 * swirl * smoothstep(0.02, 0.4, r));
        col += vec3(0.9, 0.95, 1.0) * inTunnel * 0.25 * exp(-r * 12.0);
    }
    // the flash of entering and leaving
    col += vec3(0.8, 0.9, 1.0) * flash * 0.6;
    fragColor = vec4(col, 1.0);
}
