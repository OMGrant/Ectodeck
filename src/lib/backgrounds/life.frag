/*{
  "DESCRIPTION": "Life: Conway's Game of Life, glowing. Newborn cells shine, old ones cool, and the dead leave a fading trail. A key press plants a burst of new life at the key; small seeds land on their own now and then, so it never dies out.",
  "INPUTS": [
    { "NAME": "young", "TYPE": "color", "LABEL": "Newborn", "DEFAULT": [0.4, 1.0, 0.85, 1] },
    { "NAME": "old", "TYPE": "color", "LABEL": "Old", "DEFAULT": [0.55, 0.3, 1.0, 1] },
    { "NAME": "pace", "TYPE": "long", "LABEL": "Pace", "DEFAULT": 3, "VALUES": [1, 2, 3, 5, 8], "LABELS": ["Frantic", "Fast", "Steady", "Calm", "Slow"] },
    { "NAME": "trails", "TYPE": "float", "LABEL": "Trails", "DEFAULT": 0.9, "MIN": 0.0, "MAX": 0.98 }
  ],
  "PASSES": [
    { "TARGET": "cells", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/5", "HEIGHT": "$HEIGHT/5" },
    {}
  ]
}*/

// cells, one texel each: x alive (0 or 1), y how long it has lived, z the trail
const float CELL = 5.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec4 cellAt(vec2 c, vec2 size) {
    // wrap around the edges, like a torus
    c = mod(c, size);
    return texture(cells, (c + 0.5) / size);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    if (PASSINDEX == 0) {
        vec2 size = RENDERSIZE;
        vec2 c = floor(fragCoord);
        vec4 me = cellAt(c, size);
        if (iFrame < 2) {
            float alive = step(0.72, hash(c * 1.37));
            fragColor = vec4(alive, 0.0, alive, 1.0);
            return;
        }
        vec4 next = me;
        // the rules run every few frames; between steps the trail still fades
        if (iFrame % pace == 0) {
            float n = 0.0;
            for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) if (x != 0 || y != 0) n += cellAt(c + vec2(x, y), size).x;
            float alive = me.x > 0.5 ? ((n == 2.0 || n == 3.0) ? 1.0 : 0.0) : (n == 3.0 ? 1.0 : 0.0);
            next = vec4(alive, alive > 0.5 ? me.y + 1.0 : 0.0, alive > 0.5 ? 1.0 : me.z * trails, 1.0);
        } else {
            next.z = next.x > 0.5 ? 1.0 : me.z * mix(1.0, trails, 0.35);
        }
        // a burst of life around each fresh key press
        for (int i = 0; i < 8; i++) {
            vec4 p = iKeyPresses[i];
            if (p.w < 0.0 || p.z > 0.12) continue;
            vec2 key = p.xy / CELL;
            vec2 d = c - key;
            if (dot(d, d) < 49.0 && hash(c + p.w * 13.1 + floor(iTime)) > 0.55) next = vec4(1.0, 0.0, 1.0, 1.0);
        }
        // small seeds on their own every few seconds, somewhere random
        float slot = floor(iTime / 3.0);
        vec2 spot = vec2(hash(vec2(slot, 1.0)), hash(vec2(slot, 2.0))) * size;
        if (fract(iTime / 3.0) < 0.04 && length(c - spot) < 4.0 && hash(c + slot) > 0.5) next = vec4(1.0, 0.0, 1.0, 1.0);
        fragColor = next;
        return;
    }

    // shown: each cell a soft rounded square, coloured by its age, over the glow of the trails
    vec2 size = iResolution.xy / CELL;
    vec2 q = fragCoord / CELL;
    vec2 c = floor(q);
    vec4 s = texture(cells, (c + 0.5) / size);
    vec2 f = fract(q) - 0.5;
    float shape = smoothstep(0.5, 0.36, max(abs(f.x), abs(f.y)));
    float youth = exp(-s.y * 0.12);
    vec3 cellColour = mix(old.rgb, young.rgb, youth) * (0.75 + 0.6 * youth);
    // the trail, blurred a little by sampling between cells
    float glow = texture(cells, q / size).z;
    vec3 col = vec3(0.01, 0.008, 0.03) + old.rgb * 0.35 * glow * glow;
    col += cellColour * s.x * shape;
    col += cellColour * s.x * 0.15;
    fragColor = vec4(col, 1.0);
}
