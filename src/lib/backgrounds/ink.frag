/*{
 "DESCRIPTION": "Glowing ink in water, after Pavel Dobryakov's WebGL fluid simulation (MIT). Each key press throws a burst of ink from that key; slow splashes keep it moving between presses.",
 "INPUTS": [
  {
   "NAME": "palette",
   "TYPE": "long",
   "LABEL": "Colours",
   "DEFAULT": 0,
   "VALUES": [
    0,
    1,
    2,
    3
   ],
   "LABELS": [
    "Rainbow",
    "Ember",
    "Ocean",
    "Ectonomic"
   ],
   "PRESET": true
  },
  {
   "NAME": "fade",
   "TYPE": "float",
   "LABEL": "Fade",
   "DEFAULT": 1,
   "MIN": 0.2,
   "MAX": 3
  },
  {
   "NAME": "swirl",
   "TYPE": "float",
   "LABEL": "Swirl",
   "DEFAULT": 30,
   "MIN": 0,
   "MAX": 60
  },
  {
   "NAME": "drift",
   "TYPE": "bool",
   "LABEL": "Drift between presses",
   "DEFAULT": true
  },
  {
   "NAME": "glow",
   "TYPE": "bool",
   "LABEL": "Glow",
   "DEFAULT": true
  }
 ],
 "IMPORTED": {
  "dither": {
   "PATH": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAbkklEQVR4nD3bZdhVVRMG4KVY2Ah2t2Jid3diYRd2d7fYYAvYIAaCCioo2I2BYHd3d+f43XNd870/99l7rYknZu1z3rbmmmvGb7/9FmPHjo077rgjlltuuejbt2/stttucfbZZ8fxxx8fq622Whx00EExfvz4mHXWWeONN96Iyy+/PPbZZ5/4888/Y7PNNsv7Pv744+jQoUNstdVW8cUXX8TAgQNjscUWix9//DEOPPDAWGihheKkk06KnXfeOZ5++umYd95547PPPov77rsv/v3333juuefi0ksvjammmiq23XbbOOuss+LXX3+NJ554ImN7//33Y+WVV46ddtopzjjjjBgyZEh069YtRo0aFX369Mm9V1pppbjxxhszzmeffTamnHLKjOfxxx+PiSaaKAYMGJD3W8O6bejQofnwTDPNFKecckom6k9wL774Ymy++ebxyCOPxJ133hnnn39+3HzzzTHFFFPEuuuuG6effnrcfffduZnAl1hiiXjooYfCmmuttVYmIrlNNtkkWmu54XXXXZefXXLJJXHrrbfGvvvum4kKfPfdd8/1Pv/88xg0aFAcccQRMc8888SGG24YE044YXz77bd5/f77749JJpkkfvrpp3jzzTdjzjnnzHjE+fPPP2fxrC++33//Pff54IMPcq+vvvoqpp9++nzuqKOOivb1119nFT101VVXZRctNs0008RNN92UDyjOkksuGT169IhjjjkmA3nsscdihx12yEDeeeedrPp+++0XXbp0yQIee+yxGcRLL70Up512Wmy33XZhL5svs8wy8csvv0SnTp0yuWuvvTb3mHTSSePkk0+ORRZZJNZYY4148MEHM9Bdd901Tj311JhxxhkTJYsvvngcdthhcfHFF8c222wTe++9d3zyyScZG5Ttv//+8e6772ah5QatimRtz3puxRVXjMknnzyajqnMK6+8khDq2rVrdkonXNfZCSaYIN577734+++/Y5VVVsmu6CR4q/iqq64azz//fJx55pmx/fbbx5NPPhnzzz9/rLDCCpno7LPPHsOGDctADj/88Ezs5ZdfTsSNGDEiC/r6669nUUEeCmeZZZb4/vvvE01LL710NgeNtthii/jjjz9ittlmy/vFM3z48Ljiiiuic+fOGQe6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"
  }
 },
 "PASSES": [
  {
   "TARGET": "velocity",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH/3.75",
   "HEIGHT": "$HEIGHT/3.75"
  },
  {
   "TARGET": "dye",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH*2.1333",
   "HEIGHT": "$HEIGHT*2.1333"
  },
  {
   "TARGET": "seen",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH/100",
   "HEIGHT": "$HEIGHT/100"
  },
  {
   "TARGET": "scratch",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH/3.75",
   "HEIGHT": "$HEIGHT/3.75"
  },
  {
   "TARGET": "velocity",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "scratch",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH/3.75",
   "HEIGHT": "$HEIGHT/3.75"
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "pressure",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "velocity",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "velocity",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "dye",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "bloom",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH/1.875",
   "HEIGHT": "$HEIGHT/1.875"
  },
  {
   "TARGET": "b1",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH/3.75",
   "HEIGHT": "$HEIGHT/3.75"
  },
  {
   "TARGET": "b2",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH/7.5",
   "HEIGHT": "$HEIGHT/7.5"
  },
  {
   "TARGET": "b3",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH/15",
   "HEIGHT": "$HEIGHT/15"
  },
  {
   "TARGET": "b4",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH/30",
   "HEIGHT": "$HEIGHT/30"
  },
  {
   "TARGET": "b5",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH/60",
   "HEIGHT": "$HEIGHT/60"
  },
  {
   "TARGET": "b6",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH/120",
   "HEIGHT": "$HEIGHT/120"
  },
  {
   "TARGET": "b7",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH/240",
   "HEIGHT": "$HEIGHT/240"
  },
  {
   "TARGET": "b6",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "b5",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "b4",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "b3",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "b2",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "b1",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "bloom",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "mask",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH*2.1333",
   "HEIGHT": "$HEIGHT*2.1333"
  },
  {
   "TARGET": "rays",
   "PERSISTENT": true,
   "FLOAT": true,
   "WIDTH": "$WIDTH/2.449",
   "HEIGHT": "$HEIGHT/2.449"
  },
  {
   "TARGET": "rays",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {
   "TARGET": "rays",
   "PERSISTENT": true,
   "FLOAT": true
  },
  {}
 ]
}*/

// Ectodeck's built-in Ink, drawn by the deck's own renderer: Pavel
// Dobryakov's WebGL fluid simulation (MIT) moved off the browser, the same
// simulation step for step, with its bloom and sun rays.
//
// Each frame: the splats (a key press throws a burst of four; slow drift
// splats keep it moving), then the fluid step: curl, vorticity, divergence,
// twenty rounds of pressure, the pressure's gradient taken away, and the
// velocity and the dye carried along by the velocity. Then the glow: the
// bright ink blurred down seven sizes and back up (bloom), and light rays
// from the middle that the ink shadows (sun rays). Then the picture.

// the passes, in order
const int SPLAT_VELOCITY = 0, SPLAT_DYE = 1, SEEN = 2, CURL = 3, VORTICITY = 4, DIVERGENCE = 5, PRESSURE_CLEAR = 6;
const int PRESSURE_FIRST = 7, PRESSURE_LAST = 26, GRADIENT = 27, ADVECT_VELOCITY = 28, ADVECT_DYE = 29;
const int PREFILTER = 30, DOWN_FIRST = 31, DOWN_LAST = 37, UP_FIRST = 38, UP_LAST = 43, BLOOM_FINAL = 44;
const int RAYS_MASK = 45, RAYS = 46, RAYS_BLUR_X = 47, RAYS_BLUR_Y = 48;

const float VELOCITY_DISSIPATION = 0.2, PRESSURE = 0.8;
const float SPLAT_RADIUS = 0.3;
const float BLOOM_THRESHOLD = 0.6, BLOOM_KNEE = 0.7, BLOOM_INTENSITY = 0.8, RAYS_WEIGHT = 1.0;

float dt() { return min(iTimeDelta, 0.016666); }
vec2 texel(sampler2D s) { return 1.0 / vec2(textureSize(s, 0)); }
float rand(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

vec3 hsv(float h, float s, float v) {
    vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return v * mix(vec3(1.0), k, s);
}
// a hue from the chosen colours, or any hue
float hue(float r1, float r2) {
    if (palette == 1) { float p[4] = float[4](0.0, 0.05, 0.1, 0.13); return p[int(r1 * 4.0) % 4]; }
    if (palette == 2) { float p[5] = float[5](0.5, 0.55, 0.6, 0.65, 0.45); return p[int(r1 * 5.0) % 5]; }
    if (palette == 3) { float p[5] = float[5](0.2, 0.22, 0.25, 0.3, 0.15); return p[int(r1 * 5.0) % 5]; }
    return r2;
}
vec3 colour(float h, float strength) { return hsv(fract(h + 1.0), 1.0, 1.0) * strength; }

// one splat: a soft round dab of velocity and of colour
void splat(vec2 uv, vec2 at, vec2 force, vec3 c, inout vec2 vel, inout vec3 ink) {
    float aspect = iResolution.x / iResolution.y;
    float radius = SPLAT_RADIUS / 100.0 * max(aspect, 1.0);
    vec2 p = uv - at; p.x *= aspect;
    float f = exp(-dot(p, p) / radius);
    vel += f * force; ink += f * c;
}
// a burst: four splats flung out from a point, one colour
void burst(vec2 uv, vec2 at, float strength, float seed, inout vec2 vel, inout vec3 ink) {
    float base = rand(vec2(seed, 1.0)) * 6.283, h = hue(rand(vec2(seed, 2.0)), rand(vec2(seed, 3.0)));
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float a = base + fi / 4.0 * 6.283 + (rand(vec2(seed, 4.0 + fi)) - 0.5) * 0.6;
        float f = 900.0 + rand(vec2(seed, 9.0 + fi)) * 900.0;
        splat(uv, at, vec2(cos(a), sin(a)) * f, colour(h + (rand(vec2(seed, 14.0 + fi)) - 0.5) * 0.03, strength), vel, ink);
    }
}
// when a key was pressed, in the renderer's time
float pressedAt(int i) { return iTime - iKeyPresses[i].z; }

// everything thrown in this frame
void splats(vec2 uv, inout vec2 vel, inout vec3 ink) {
    float seed0 = mod(iDate.w + iDate.z * 86400.0, 10000.0);
    if (iFrame == 0) {
        // the simulation starts with a handful of random splats, and a burst in the middle
        int n = 5 + int(rand(vec2(seed0, 0.5)) * 20.0);
        for (int i = 0; i < 25; i++) {
            if (i >= n) break;
            float fi = float(i);
            vec2 at = vec2(rand(vec2(seed0, fi + 0.1)), rand(vec2(seed0, fi + 0.2)));
            vec2 force = 1000.0 * (vec2(rand(vec2(seed0, fi + 0.3)), rand(vec2(seed0, fi + 0.4))) - 0.5);
            splat(uv, at, force, hsv(rand(vec2(seed0, fi + 0.5)), 1.0, 1.0) * 0.15 * 10.0, vel, ink);
        }
        burst(uv, vec2(0.5), 0.7, seed0 + 7.0, vel, ink);
        return;
    }
    // a key press throws a burst of ink from that key, once
    float done = texelFetch(seen, ivec2(0), 0).x;
    for (int i = 0; i < 8; i++) {
        vec4 k = iKeyPresses[i];
        if (k.w < 0.0) continue;
        float at = pressedAt(i);
        if (at <= done + 0.01) continue;
        burst(uv, k.xy / iResolution.xy, 0.8, mod(at * 13.7, 1000.0) + k.w, vel, ink);
    }
    // slow splashes between presses, one every two to four seconds
    if (drift) {
        float from = iTime - iTimeDelta;
        for (int j = 0; j < 3; j++) {
            float slot = floor(from / 3.1) + float(j);
            float when = slot * 3.1 + rand(vec2(slot, 0.7)) * 2.6 - 1.3;
            if (when > from && when <= iTime) {
                vec2 at = vec2(rand(vec2(slot, 1.1)), rand(vec2(slot, 1.2)));
                vec2 force = (vec2(rand(vec2(slot, 1.3)), rand(vec2(slot, 1.4))) - 0.5) * 600.0;
                splat(uv, at, force, colour(hue(rand(vec2(slot, 1.5)), rand(vec2(slot, 1.6))), 0.45), vel, ink);
            }
        }
    }
}

vec4 simulate(vec2 uv) {
    vec2 t = texel(velocity);
    vec2 L = uv - vec2(t.x, 0.0), R = uv + vec2(t.x, 0.0), T = uv + vec2(0.0, t.y), B = uv - vec2(0.0, t.y);
    if (PASSINDEX == SPLAT_VELOCITY) {
        vec2 vel = texture(velocity, uv).xy; vec3 d = vec3(0.0);
        splats(uv, vel, d);
        return vec4(vel, 0.0, 1.0);
    }
    if (PASSINDEX == SPLAT_DYE) {
        vec2 v = vec2(0.0); vec3 d = texture(dye, uv).rgb;
        splats(uv, v, d);
        return vec4(d, 1.0);
    }
    if (PASSINDEX == SEEN) {
        // the newest press dealt with, so none is thrown twice
        float done = texelFetch(seen, ivec2(0), 0).x;
        for (int i = 0; i < 8; i++) if (iKeyPresses[i].w >= 0.0) done = max(done, pressedAt(i));
        return vec4(iFrame == 0 ? iTime : done);
    }
    if (PASSINDEX == CURL) {
        float vorticity = texture(velocity, R).y - texture(velocity, L).y - texture(velocity, T).x + texture(velocity, B).x;
        return vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
    }
    if (PASSINDEX == VORTICITY) {
        float l = texture(scratch, L).x, r = texture(scratch, R).x, tp = texture(scratch, T).x, b = texture(scratch, B).x, c = texture(scratch, uv).x;
        vec2 force = 0.5 * vec2(abs(tp) - abs(b), abs(r) - abs(l));
        force /= length(force) + 0.0001;
        force *= swirl * c;
        force.y *= -1.0;
        vec2 vel = texture(velocity, uv).xy + force * dt();
        return vec4(clamp(vel, -1000.0, 1000.0), 0.0, 1.0);
    }
    if (PASSINDEX == DIVERGENCE) {
        float l = texture(velocity, L).x, r = texture(velocity, R).x, tp = texture(velocity, T).y, b = texture(velocity, B).y;
        vec2 c = texture(velocity, uv).xy;
        if (L.x < 0.0) l = -c.x;
        if (R.x > 1.0) r = -c.x;
        if (T.y > 1.0) tp = -c.y;
        if (B.y < 0.0) b = -c.y;
        return vec4(0.5 * (r - l + tp - b), 0.0, 0.0, 1.0);
    }
    if (PASSINDEX == PRESSURE_CLEAR) return PRESSURE * texture(pressure, uv);
    if (PASSINDEX >= PRESSURE_FIRST && PASSINDEX <= PRESSURE_LAST) {
        float p = (texture(pressure, L).x + texture(pressure, R).x + texture(pressure, B).x + texture(pressure, T).x - texture(scratch, uv).x) * 0.25;
        return vec4(p, 0.0, 0.0, 1.0);
    }
    if (PASSINDEX == GRADIENT) {
        vec2 vel = texture(velocity, uv).xy - vec2(texture(pressure, R).x - texture(pressure, L).x, texture(pressure, T).x - texture(pressure, B).x);
        return vec4(vel, 0.0, 1.0);
    }
    if (PASSINDEX == ADVECT_VELOCITY) {
        vec2 coord = uv - dt() * texture(velocity, uv).xy * t;
        return texture(velocity, coord) / (1.0 + VELOCITY_DISSIPATION * dt());
    }
    // ADVECT_DYE
    vec2 coord = uv - dt() * texture(velocity, uv).xy * t;
    return texture(dye, coord) / (1.0 + fade * dt());
}

// the average of four reads a texel of the source away
vec4 four(sampler2D s, vec2 uv) {
    vec2 t = texel(s);
    return 0.25 * (texture(s, uv - vec2(t.x, 0.0)) + texture(s, uv + vec2(t.x, 0.0)) + texture(s, uv + vec2(0.0, t.y)) + texture(s, uv - vec2(0.0, t.y)));
}
vec4 bloomLevel(int i, vec2 uv) {
    if (i == 1) return four(b1, uv);
    if (i == 2) return four(b2, uv);
    if (i == 3) return four(b3, uv);
    if (i == 4) return four(b4, uv);
    if (i == 5) return four(b5, uv);
    if (i == 6) return four(b6, uv);
    return four(b7, uv);
}
vec4 bloomOwn(int i, vec2 uv) {
    if (i == 1) return texture(b1, uv);
    if (i == 2) return texture(b2, uv);
    if (i == 3) return texture(b3, uv);
    if (i == 4) return texture(b4, uv);
    if (i == 5) return texture(b5, uv);
    return texture(b6, uv);
}

vec4 glowPass(vec2 uv) {
    if (PASSINDEX == PREFILTER) {
        // only what is bright enough glows, with a soft knee
        float knee = BLOOM_THRESHOLD * BLOOM_KNEE + 0.0001;
        vec3 curve = vec3(BLOOM_THRESHOLD - knee, knee * 2.0, 0.25 / knee);
        vec3 c = texture(dye, uv).rgb;
        float br = max(c.r, max(c.g, c.b));
        float rq = clamp(br - curve.x, 0.0, curve.y);
        rq = curve.z * rq * rq;
        return vec4(c * max(rq, br - BLOOM_THRESHOLD) / max(br, 0.0001), 0.0);
    }
    if (PASSINDEX >= DOWN_FIRST && PASSINDEX <= DOWN_LAST) {
        // each level a blurred half of the one above
        int i = PASSINDEX - DOWN_FIRST;
        return i == 0 ? four(bloom, uv) : bloomLevel(i, uv);
    }
    if (PASSINDEX >= UP_FIRST && PASSINDEX <= UP_LAST) {
        // and back up, each level adding the blurred one below it
        int level = 6 - (PASSINDEX - UP_FIRST);
        return bloomOwn(level, uv) + bloomLevel(level + 1, uv);
    }
    if (PASSINDEX == BLOOM_FINAL) return four(b1, uv) * BLOOM_INTENSITY;
    if (PASSINDEX == RAYS_MASK) {
        vec4 c = texture(dye, uv);
        float br = max(c.r, max(c.g, c.b));
        c.a = 1.0 - min(max(br * 20.0, 0.0), 0.8);
        return c;
    }
    if (PASSINDEX == RAYS) {
        // light from the middle, shadowed by the ink on its way out
        vec2 coord = uv, dir = (uv - 0.5) * (1.0 / 16.0 * 0.3);
        float decay = 1.0, c = texture(mask, uv).a;
        for (int i = 0; i < 16; i++) { coord -= dir; c += texture(mask, coord).a * decay * RAYS_WEIGHT; decay *= 0.95; }
        return vec4(c * 0.7, 0.0, 0.0, 1.0);
    }
    // the rays blurred a little, across then down
    vec2 t = texel(rays) * (PASSINDEX == RAYS_BLUR_X ? vec2(1.0, 0.0) : vec2(0.0, 1.0)) * 1.33333333;
    return texture(rays, uv) * 0.29411764 + texture(rays, uv - t) * 0.35294117 + texture(rays, uv + t) * 0.35294117;
}

vec3 linearToGamma(vec3 c) { c = max(c, vec3(0.0)); return max(1.055 * pow(c, vec3(0.416666667)) - 0.055, vec3(0.0)); }

vec3 picture(vec2 frag) {
    vec2 uv = frag / iResolution.xy, t = 1.0 / iResolution.xy;
    vec3 c = texture(dye, uv).rgb;
    // shaded as if lit from the front, the ink's thickness its relief
    float dx = length(texture(dye, uv + vec2(t.x, 0.0)).rgb) - length(texture(dye, uv - vec2(t.x, 0.0)).rgb);
    float dy = length(texture(dye, uv + vec2(0.0, t.y)).rgb) - length(texture(dye, uv - vec2(0.0, t.y)).rgb);
    vec3 n = normalize(vec3(dx, dy, length(t)));
    c *= clamp(dot(n, vec3(0.0, 0.0, 1.0)) + 0.7, 0.7, 1.0);
    if (glow) {
        vec3 b = texture(bloom, uv).rgb;
        float r = texture(rays, uv).r;
        c *= r; b *= r;
        // the dither texture, repeated across the picture
        ivec2 size = textureSize(dither, 0);
        float noise = texelFetch(dither, ivec2(frag) % size, 0).r * 2.0 - 1.0;
        c += linearToGamma(b + noise / 255.0);
    }
    return c;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / RENDERSIZE;
    if (PASSINDEX <= ADVECT_DYE) fragColor = simulate(uv);
    else if (PASSINDEX <= RAYS_BLUR_Y) fragColor = glowPass(uv);
    else fragColor = vec4(clamp(picture(fragCoord), 0.0, 1.0), 1.0);
}
