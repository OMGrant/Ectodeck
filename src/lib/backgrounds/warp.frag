/*{
  "DESCRIPTION": "Warp: flying through a field of stars past a faint nebula. A key press jumps to hyperspace for a moment: the stars stretch into streaks and the view flashes blue. The first dial sets the cruising speed.",
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "LABEL": "Speed", "DEFAULT": 1.0, "MIN": 0.1, "MAX": 4.0 },
    { "NAME": "tint", "TYPE": "color", "LABEL": "Nebula", "DEFAULT": [0.25, 0.35, 0.9, 1] },
    { "NAME": "density", "TYPE": "float", "LABEL": "Stars", "DEFAULT": 1.0, "MIN": 0.3, "MAX": 2.0 }
  ]
}*/

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    // hyperspace: how far into a jump we are, from the newest press
    float jump = 0.0;
    vec4 p = iKeyPresses[0];
    if (p.w >= 0.0 && p.z < 2.2) jump = smoothstep(0.0, 0.35, p.z) * smoothstep(2.2, 1.2, p.z);
    float cruise = speed * max(0.2, 1.0 + iDials.x * 0.12);
    float travel = iTime * cruise * 0.35;

    // a faint nebula, drifting
    float n = noise(uv * 2.5 + vec2(travel * 0.05, 0.0)) * noise(uv * 5.0 - travel * 0.03);
    vec3 col = tint.rgb * n * 0.35 + vec3(0.005, 0.005, 0.02);

    // stars in layers: each layer's stars sit on a grid of directions and
    // come toward the viewer, streaking longer the faster we go
    float stretch = 0.02 * cruise + jump * 0.9;
    for (int layer = 0; layer < 5; layer++) {
        float fl = float(layer);
        float z = fract(travel * 0.25 + fl / 5.0);          // 0 far, 1 at the viewer
        float scale = mix(28.0, 0.8, z);
        vec2 q = uv * scale;
        vec2 cell = floor(q);
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
            vec2 c = cell + vec2(dx, dy);
            float h = hash(c + fl * 17.0);
            if (h > 0.18 * density) continue;
            vec2 star = (c + vec2(hash(c + 3.1), hash(c + 7.7))) / scale;  // its position on screen
            // the streak runs from the star back toward the centre
            vec2 dir = normalize(star + 1e-4);
            vec2 d = uv - star;
            float along = dot(d, -dir), across = abs(dot(d, vec2(-dir.y, dir.x)));
            float len = stretch * length(star) * (0.4 + z);
            float streak = smoothstep(len + 0.002, 0.0, along) * step(-0.003, along);
            float size = 0.0012 + 0.003 * z;
            float glow = exp(-across / size) * max(streak, exp(-length(d) / size));
            float fade = smoothstep(0.0, 0.25, z) * smoothstep(1.0, 0.85, z);
            vec3 tintStar = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.9, 0.8), hash(c + 2.2));
            col += tintStar * glow * fade * (0.8 + jump * 1.5);
        }
    }
    // the jump's flash and tunnel
    col += vec3(0.3, 0.5, 1.0) * jump * 0.35 * smoothstep(0.9, 0.0, length(uv));
    col += vec3(0.6, 0.8, 1.0) * exp(-p.z * 8.0) * step(0.0, p.w) * 0.5;
    fragColor = vec4(col, 1.0);
}
