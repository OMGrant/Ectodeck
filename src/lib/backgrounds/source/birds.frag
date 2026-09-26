/*{
  "DESCRIPTION": "A murmuration of starlings wheeling over a treeline at dusk. Press a key and the birds there burst away from it; the shock runs through the whole flock. Its presets are the time of day, from afternoon to night, or Automatic to follow your clock.",
  "INPUTS": [
    { "NAME": "time", "TYPE": "long", "LABEL": "Light", "DEFAULT": 1, "VALUES": [-1, 0, 1, 2], "LABELS": ["Automatic", "Afternoon", "Dusk", "Night"], "PRESET": true },
    { "NAME": "birds", "TYPE": "float", "LABEL": "Birds", "DEFAULT": 1, "MIN": 0.3, "MAX": 2 }
  ],
  "PASSES": [
    { "TARGET": "flock", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH", "HEIGHT": "$HEIGHT/240" },
    { "TARGET": "stage", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH", "HEIGHT": "$HEIGHT/240" },
    { "TARGET": "stage" }, { "TARGET": "stage" }, { "TARGET": "stage" }, { "TARGET": "stage" }, { "TARGET": "stage" },
    { "TARGET": "flock" },
    { "TARGET": "bins", "FLOAT": true, "WIDTH": "$WIDTH/3.99", "HEIGHT": "$HEIGHT/8" },
    {}
  ]
}*/

// Ectodeck's built-in Birds, drawn by the deck's own renderer: the canvas
// murmuration moved off the browser, the same flock and the same picture.
//
//  1. flock: one texel column per bird, row 0 its place and speed, row 1 its
//     depth, wingbeat and fear. A key press first startles the birds, then
//     the flock moves on a frame. Each bird steers by its neighbours (keep
//     apart, move with them, move toward them), is pulled toward a centre
//     that wanders across the sky, turned back from the edges and the
//     ground, and startled by a key press; fear passes from bird to bird,
//     so the shock runs through the flock as a wave. The last texel keeps
//     the light easing between times of day, and the newest press dealt with.
//     The canvas version moves its birds one at a time, each seeing the birds
//     before it already moved this frame and the rest not yet; that stirs the
//     flock into its loose, streaming shapes (all moved together from the last
//     frame, it stays a tight oval). The graphics card moves them together,
//     so the frame is worked out six times over (stage): each time a bird
//     sees the birds before it as the last time moved them, which settles on
//     the one-at-a-time result.
//  2. bins: for each 8-pixel patch of the screen, the birds whose centres
//     are in it, eight to a patch, so each pixel draws only the birds near it.
//  3. the picture: the sky and the sun's glow, stars at night, the birds
//     (each a pair of beating wings and a body, far ones smaller and paler),
//     and the treeline over them.
//
// Coordinates are the canvas's: x across, y down, from 0 to 1.

const float CELL = 0.05;
const int MAX_BIRDS = 840;
const float PATCH = 8.0;
const int PRESS = 0, STAGE_FIRST = 1, STAGE_LAST = 6, SETTLE = 7, BINS = 8;

int birdCount() { return int(floor(420.0 * clamp(birds, 0.3, 2.0) + 0.5)); }
ivec2 metaTexel() { return ivec2(textureSize(flock, 0).x - 1, 0); }
float rand(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 W_H() { return iResolution.xy; }

// ---- the light: afternoon, dusk (and dawn) or night
// Automatic: by the sun, estimated from the date, daylight saving and a
// latitude of 35 degrees (south of the equator when daylight saving falls in
// January), which lands within about an hour for most places
float clockLight() {
    float jan = iZone.y, jul = iZone.z, now = iZone.x;
    float lat = (jan > jul ? -35.0 : 35.0) * 0.0174533;
    float noon = 12.0 + (now > min(jan, jul) ? 1.0 : 0.0);
    // the day of the year
    int y = int(iDate.x), m = int(iDate.y) + 1, d = int(iDate.z);
    int cum[12] = int[12](0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334);
    bool leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    float day = float(cum[m - 1] + d + (leap && m > 2 ? 1 : 0)) - 1.0 + iDate.w / 86400.0;
    float decl = -23.44 * 0.0174533 * cos(6.28318 / 365.0 * (day + 10.0));
    float cosH = (sin(-0.833 * 0.0174533) - sin(lat) * sin(decl)) / (cos(lat) * cos(decl));
    float half_ = acos(clamp(cosH, -1.0, 1.0)) * 12.0 / 3.14159265;
    float hour = floor(iDate.w / 60.0) / 60.0, rise = noon - half_, set = noon + half_;
    if (hour < rise - 0.5 || hour >= set + 0.75) return 2.0;
    if (hour < rise + 0.75 || hour >= set - 1.0) return 1.0;
    return 0.0;
}
float chosenLight() { return time < 0 ? clockLight() : float(time % 3); }

// sky top, sky at the horizon, the sun's glow, the land, the birds, the sun's height
struct Look { vec3 top, low, sun, land, bird; float sunY; };
Look lookAt(int i) {
    if (i == 0) return Look(vec3(92, 146, 200) / 255.0, vec3(238, 214, 176) / 255.0, vec3(255, 236, 190) / 255.0, vec3(40, 52, 44) / 255.0, vec3(26, 28, 34) / 255.0, 0.52);
    if (i == 1) return Look(vec3(44, 50, 96) / 255.0, vec3(244, 150, 96) / 255.0, vec3(255, 190, 120) / 255.0, vec3(24, 20, 30) / 255.0, vec3(16, 12, 20) / 255.0, 0.8);
    return Look(vec3(8, 12, 30) / 255.0, vec3(40, 46, 84) / 255.0, vec3(160, 170, 220) / 255.0, vec3(6, 8, 14) / 255.0, vec3(4, 6, 12) / 255.0, 1.1);
}
Look look(float lightNow) {
    int i = int(floor(lightNow));
    float t = lightNow - float(i);
    Look a = lookAt(min(i, 2)), b = lookAt(min(i + 1, 2));
    return Look(mix(a.top, b.top, t), mix(a.low, b.low, t), mix(a.sun, b.sun, t), mix(a.land, b.land, t), mix(a.bird, b.bird, t), mix(a.sunY, b.sunY, t));
}

// ---- 1. the flock
struct Bird { vec2 p, v; float z, flap, fear; };
Bird birdAt(int i) {
    vec4 a = texelFetch(flock, ivec2(i, 0), 0), b = texelFetch(flock, ivec2(i, 1), 0);
    return Bird(a.xy, a.zw, b.x, b.y, b.z);
}
// a new bird, somewhere in a loose cloud round the middle
Bird hatch(int i) {
    float fi = float(i), seed = mod(iDate.w, 997.0);
    float a = rand(vec2(fi, seed)) * 6.283, r = rand(vec2(fi + 0.5, seed)) * 0.12;
    return Bird(vec2(0.5 + cos(a) * r * 1.6, 0.4 + sin(a) * r),
                vec2(rand(vec2(fi, seed + 1.0)) * 0.2 - 0.1, rand(vec2(fi, seed + 2.0)) * 0.1 - 0.05),
                rand(vec2(fi, seed + 3.0)), rand(vec2(fi, seed + 4.0)) * 6.283, 0.0);
}
float pressedAt(int i) { return iTime - iKeyPresses[i].z; }

Bird stageAt(int i) {
    vec4 a = texelFetch(stage, ivec2(i, 0), 0), b = texelFetch(stage, ivec2(i, 1), 0);
    return Bird(a.xy, a.zw, b.x, b.y, b.z);
}
vec4 asTexel(Bird b, int row) { return row == 0 ? vec4(b.p, b.v) : vec4(b.z, b.flap, b.fear, 0.0); }

// the press pass: new birds hatch, a key press startles the flock, the light eases
vec4 drawPress(ivec2 px) {
    vec4 meta = texelFetch(flock, metaTexel(), 0);
    bool first = iFrame == 0;
    float dt = min(0.05, iTimeDelta);
    if (px == metaTexel()) {
        // the light eases toward the chosen time of day, half a step a second
        float target = chosenLight();
        float lightNow = first ? target : meta.x + clamp(target - meta.x, -dt * 0.5, dt * 0.5);
        float done = first ? iTime : meta.y;
        for (int i = 0; i < 8; i++) if (iKeyPresses[i].w >= 0.0) done = max(done, pressedAt(i));
        return vec4(lightNow, done, float(birdCount()), 0.0);
    }
    int id = px.x;
    if (id >= birdCount() || px.y > 1) return vec4(0.0);
    // a bird that has just joined (the flock grew, or the first frame) starts fresh
    if (first || float(id) >= meta.z) return asTexel(hatch(id), px.y);
    vec2 WH = W_H(), aspectXY = vec2(WH.x / WH.y, 1.0);
    Bird b = birdAt(id);
    // right at the key a burst, further off a turn away that weakens with distance
    for (int i = 0; i < 8; i++) {
        vec4 k = iKeyPresses[i];
        if (k.w < 0.0 || pressedAt(i) <= meta.y + 0.01) continue;
        vec2 key = vec2(k.x / WH.x, 1.0 - k.y / WH.y);
        vec2 dd = (b.p - key) * aspectXY; float d = max(length(dd), 1e-3);
        float push = d < 0.14 ? 1.1 * (1.0 - d / 0.14) + 0.35 : 0.08 / (1.0 + d * 8.0);
        b.v += vec2(dd.x / d * push * WH.y / WH.x, dd.y / d * push);
        if (d < 0.14) b.fear = 1.0;
    }
    return asTexel(b, px.y);
}

// one working-out of the frame: each bird steers by its neighbours, seeing the
// birds before it as the last stage moved them (the first stage: as they were)
vec4 drawStage(ivec2 px) {
    int id = px.x, n = birdCount();
    if (id >= n || px.y > 1) return vec4(0.0);
    bool fromStage = PASSINDEX > STAGE_FIRST;
    float dt = min(0.05, iTimeDelta), t = iTime;
    vec2 WH = W_H();
    Bird b = birdAt(id);
    vec2 home = vec2(0.5 + 0.22 * sin(t * 0.07) + 0.05 * sin(t * 0.23), 0.38 + 0.12 * sin(t * 0.11 + 1.3));
    vec2 acc = vec2(0.0), c = vec2(0.0), vsum = vec2(0.0);
    float count = 0.0;
    for (int j = 0; j < MAX_BIRDS; j++) {
        if (j >= n) break;
        if (j == id) continue;
        Bird o = fromStage && j < id ? stageAt(j) : birdAt(j);
        vec2 dd = o.p - b.p; float d2 = dot(dd, dd);
        if (d2 > CELL * CELL) continue;
        c += o.p; vsum += o.v; count += 1.0;
        if (d2 < 0.00016) { float d = max(sqrt(d2), 1e-4); acc -= dd / d * 0.9; }
        // fear spreads: a startled neighbour startles this one a moment later
        if (o.fear > 0.55 && b.fear < o.fear - 0.1) { b.fear = o.fear * 0.88; b.v += (b.p - o.p) * 4.0; }
    }
    if (count > 0.0) acc += (c / count - b.p) * 1.4 + (vsum / count - b.v) * 2.6;
    // the pull toward the wandering centre, and away from the ground and the edges
    acc += (home - b.p) * vec2(0.9, 1.0);
    if (b.p.y > 0.72) acc.y -= (b.p.y - 0.72) * 8.0;
    if (b.p.x < 0.14) acc.x += (0.14 - b.p.x) * 5.0;
    if (b.p.x > 0.86) acc.x -= (b.p.x - 0.86) * 5.0;
    if (b.p.y < 0.1) acc.y += (0.1 - b.p.y) * 5.0;
    b.v += acc * dt;
    float sp = length(b.v), top = 0.28 + b.fear * 0.35;
    if (sp > top) b.v *= top / sp;
    if (sp < 0.08) b.v *= 0.08 / max(sp, 1e-5);
    b.p += vec2(b.v.x * WH.y / WH.x * 1.4, b.v.y) * dt;
    b.fear = max(0.0, b.fear - dt * 1.4);
    b.flap = mod(b.flap + dt * (9.0 + b.fear * 14.0 + sp * 10.0), 6.28318 * 64.0);
    return asTexel(b, px.y);
}

// the last stage is the frame's flock (the light and the presses kept as they are)
vec4 drawSettle(ivec2 px) {
    if (px == metaTexel()) return texelFetch(flock, px, 0);
    return px.x < birdCount() && px.y <= 1 ? texelFetch(stage, px, 0) : vec4(0.0);
}

// ---- 2. the bins: which birds are in each patch (eight to a patch, two texels of four)
ivec2 patchCount() { return ivec2(ceil(iResolution.xy / PATCH)); }
vec4 drawBins(ivec2 px) {
    ivec2 cell = ivec2(px.x / 2, px.y);
    int block = px.x % 2, skip = block * 4, found = 0, n = birdCount();
    vec4 out_ = vec4(-1.0);
    for (int j = 0; j < MAX_BIRDS; j++) {
        if (j >= n) break;
        vec2 at = texelFetch(flock, ivec2(j, 0), 0).xy * iResolution.xy;
        if (ivec2(floor(at / PATCH)) != cell) continue;
        if (found >= skip && found < skip + 4) out_[found - skip] = float(j);
        found++;
        if (found >= skip + 4) break;
    }
    return out_;
}

// ---- 3. the picture
// the distance to a quadratic curve (Inigo Quilez's)
float dot2(vec2 v) { return dot(v, v); }
float bezier(vec2 pos, vec2 A, vec2 B, vec2 C) {
    vec2 a = B - A, b = A - 2.0 * B + C, c = a * 2.0, d = A - pos;
    float kk = 1.0 / max(dot(b, b), 1e-8), kx = kk * dot(a, b), ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0, kz = kk * dot(d, a);
    float res, p = ky - kx * kx, p3 = p * p * p, q = kx * (2.0 * kx * kx - 3.0 * ky) + kz, h = q * q + 4.0 * p3;
    if (h >= 0.0) {
        h = sqrt(h);
        vec2 x = (vec2(h, -h) - q) / 2.0, uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
        float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
        res = dot2(d + (c + b * t) * t);
    } else {
        float z = sqrt(-p), v = acos(q / (p * z * 2.0)) / 3.0, m = cos(v), n = sin(v) * 1.732050808;
        vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
        res = min(dot2(d + (c + b * t.x) * t.x), dot2(d + (c + b * t.y) * t.y));
    }
    return sqrt(res);
}
// how much of a pixel a bird covers: two wings, each a curve from its tip to the body, and a small body
float birdCover(vec2 px, Bird b) {
    vec2 at = b.p * iResolution.xy;
    float size = 2.2 + b.z * 3.2;
    vec2 q = px - at;
    if (abs(q.x) > size + 3.0 || abs(q.y) > size * 1.4 + 3.0) return 0.0;
    float wing = sin(b.flap), width = 0.9 + b.z * 0.9;
    vec2 tipL = vec2(-size, -wing * size * 0.8), tipR = vec2(size, -wing * size * 0.8);
    vec2 midL = vec2(-size * 0.4, -wing * size * 0.2 - size * 0.2), midR = vec2(size * 0.4, midL.y);
    float d = min(bezier(q, tipL, midL, vec2(0.0)), bezier(q, vec2(0.0), midR, tipR));
    float stroke = clamp(width * 0.5 + 0.5 - d, 0.0, 1.0);
    float dir = cos(atan(b.v.y, b.v.x * iResolution.x / iResolution.y)) >= 0.0 ? 1.0 : -1.0;
    vec2 e = (q - vec2(dir * size * 0.15, size * 0.05)) / vec2(size * 0.35, size * 0.16);
    float body = clamp((1.0 - length(e)) * size * 0.16 + 0.5, 0.0, 1.0);
    return max(stroke, body);
}

vec3 drawPicture(vec2 frag) {
    vec2 WH = iResolution.xy, px = vec2(frag.x, WH.y - frag.y), uv = px / WH;
    vec4 meta = texelFetch(flock, metaTexel(), 0);
    float lightNow = meta.x, t = iTime;
    Look L = look(lightNow);
    // the sky: overhead to the horizon, three quarters of the way down
    vec3 col = mix(L.top, L.low, clamp(uv.y / 0.75, 0.0, 1.0));
    // the sun's glow, low on the right
    float r = length(px - vec2(WH.x * 0.72, WH.y * L.sunY)) / (WH.x * 0.5);
    float glowA = r < 0.08 ? mix(0.9, 0.45, r / 0.08) : mix(0.45, 0.0, clamp((r - 0.08) / 0.92, 0.0, 1.0));
    col = mix(col, L.sun, glowA);
    // stars, once night falls
    float night = max(0.0, lightNow - 1.0);
    if (night > 0.0) {
        for (int i = 0; i < 120; i++) {
            float fi = float(i);
            vec3 s = vec3(rand(vec2(fi, 11.0)), rand(vec2(fi, 12.0)) * 0.7, rand(vec2(fi, 13.0)));
            vec2 sp = s.xy * WH;
            // a 1.2-pixel square, as much of this pixel as it covers
            vec2 lo = max(floor(px), sp), hi = min(floor(px) + 1.0, sp + 1.2);
            float cover = max(hi.x - lo.x, 0.0) * max(hi.y - lo.y, 0.0);
            if (cover > 0.0) col = mix(col, vec3(1.0), cover * night * (0.3 + 0.5 * s.z) * (0.7 + 0.3 * sin(t * 2.0 + s.z * 20.0)));
        }
    }
    // the birds near this pixel: nearer birds darker, over farther ones
    ivec2 cell = ivec2(floor(px / PATCH)), cells = patchCount();
    float clear = 1.0, bestZ = -1.0; vec3 birdCol = vec3(0.0);
    for (int cy = -1; cy <= 1; cy++)
        for (int cx = -1; cx <= 1; cx++) {
            ivec2 c = cell + ivec2(cx, cy);
            if (c.x < 0 || c.y < 0 || c.x >= cells.x || c.y >= cells.y) continue;
            for (int k = 0; k < 2; k++) {
                vec4 ids = texelFetch(bins, ivec2(c.x * 2 + k, c.y), 0);
                for (int s = 0; s < 4; s++) {
                    if (ids[s] < 0.0) continue;
                    Bird b = birdAt(int(ids[s]));
                    float cover = birdCover(px, b) * 0.95;
                    if (cover <= 0.0) continue;
                    clear *= 1.0 - cover;
                    if (b.z > bestZ) { bestZ = b.z; birdCol = mix(L.low, L.bird, 0.55 + b.z * 0.45); }
                }
            }
        }
    col = mix(col, birdCol, 1.0 - clear);
    // the treeline: a gently rolling ridge of rounded crowns of different sizes, and the ground
    float land = uv.y >= 0.88 ? 1.0 : 0.0;
    float x = -0.02;
    for (int i = 0; i < 90; i++) {
        if (x >= 1.04) break;
        float fi = float(i);
        float cy = 0.86 - 0.03 * sin(x * 7.0 + 1.0) - rand(vec2(fi, 21.0)) * 0.035, cr = 0.012 + rand(vec2(fi, 22.0)) * 0.022;
        vec2 cp = vec2(x, cy) * WH;
        float rx = cr * WH.x, ry = cr * WH.x * 1.25;
        vec2 e = (px - cp) / vec2(rx, ry);
        land = max(land, clamp((1.0 - length(e)) * min(rx, ry) + 0.5, 0.0, 1.0));
        // the trunk of the crown, down to the ground
        if (px.y >= cp.y) land = max(land, clamp(min(px.x - (cp.x - rx), cp.x + rx - px.x) + 0.5, 0.0, 1.0));
        x += 0.012 + rand(vec2(fi, 23.0)) * 0.02;
    }
    col = mix(col, L.land, land);
    return col + (rand(frag) + rand(frag.yx + 71.3) - 1.0) / 255.0;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    if (PASSINDEX == PRESS) fragColor = drawPress(ivec2(fragCoord));
    else if (PASSINDEX <= STAGE_LAST) fragColor = drawStage(ivec2(fragCoord));
    else if (PASSINDEX == SETTLE) fragColor = drawSettle(ivec2(fragCoord));
    else if (PASSINDEX == BINS) fragColor = drawBins(ivec2(fragCoord));
    else fragColor = vec4(drawPicture(fragCoord), 1.0);
}
