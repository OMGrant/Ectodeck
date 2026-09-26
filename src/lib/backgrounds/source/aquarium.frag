/*{
  "DESCRIPTION": "Looking into a deep reef tank lit from above, with clownfish, tangs, an angelfish, Moorish idols and more. Press a key to feed the fish there; press it twice quickly to tap the glass. Play music and the fish dance to it. Its presets are the time of day, or Automatic to follow your clock.",
  "INPUTS": [
    { "NAME": "time", "TYPE": "long", "LABEL": "Light", "DEFAULT": 0, "VALUES": [-1, 0, 1, 2], "LABELS": ["Automatic", "Day", "Dusk", "Night"], "PRESET": true },
    { "NAME": "dance", "TYPE": "bool", "LABEL": "Dance to music", "DEFAULT": true },
    { "NAME": "energy", "TYPE": "float", "LABEL": "Dance energy", "DEFAULT": 1, "MIN": 0.3, "MAX": 1.6 },
    { "NAME": "disco", "TYPE": "long", "LABEL": "Disco lights", "DEFAULT": 1, "VALUES": [0, 1, 2], "LABELS": ["Off", "At night", "Always"] },
    { "NAME": "speed", "TYPE": "float", "LABEL": "Swim speed", "DEFAULT": 1, "MIN": 0.4, "MAX": 1.8 },
    { "NAME": "fish", "TYPE": "float", "LABEL": "Fish", "DEFAULT": 1, "MIN": 0.3, "MAX": 2 },
    { "NAME": "puffer", "TYPE": "bool", "LABEL": "Pufferfish", "DEFAULT": true },
    { "NAME": "crab", "TYPE": "bool", "LABEL": "Crab", "DEFAULT": true },
    { "NAME": "anemone", "TYPE": "bool", "LABEL": "Sea anemone", "DEFAULT": true },
    { "NAME": "bubbles", "TYPE": "bool", "LABEL": "Bubbles", "DEFAULT": true }
  ],
  "IMPORTED": {
    "reef": { "PATH": "ectodeck-asset:aquarium/reef.webp" },
    "clownfish": { "PATH": "ectodeck-asset:aquarium/clownfish.webp" },
    "idol": { "PATH": "ectodeck-asset:aquarium/idol.webp" },
    "regal": { "PATH": "ectodeck-asset:aquarium/regal.webp" },
    "yellowtang": { "PATH": "ectodeck-asset:aquarium/yellowtang.webp" },
    "angel": { "PATH": "ectodeck-asset:aquarium/angel.webp" },
    "copperband": { "PATH": "ectodeck-asset:aquarium/copperband.webp" },
    "anthias": { "PATH": "ectodeck-asset:aquarium/anthias.webp" },
    "pufferTex": { "PATH": "ectodeck-asset:aquarium/puffer.webp" },
    "puffed": { "PATH": "ectodeck-asset:aquarium/puffed.webp" },
    "ballTex": { "PATH": "ectodeck-asset:aquarium/ball.webp" },
    "anemoneTex": { "PATH": "ectodeck-asset:aquarium/anemone.webp" },
    "crabBody": { "PATH": "ectodeck-asset:aquarium/crab-body.webp" },
    "clawLeft": { "PATH": "ectodeck-asset:aquarium/crab-claw-left.webp" },
    "clawRight": { "PATH": "ectodeck-asset:aquarium/crab-claw-right.webp" },
    "fingerLeft": { "PATH": "ectodeck-asset:aquarium/crab-finger-left.webp" },
    "fingerRight": { "PATH": "ectodeck-asset:aquarium/crab-finger-right.webp" },
    "bubble": { "PATH": "ectodeck-asset:aquarium/bubble.webp" },
    "food": { "PATH": "ectodeck-asset:aquarium/food.webp" }
  },
  "PASSES": [
    { "TARGET": "tank", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/6.672", "HEIGHT": "$HEIGHT/20" },
    { "TARGET": "tank" },
    { "TARGET": "tank" },
    { "TARGET": "tank" },
    {}
  ]
}*/

// Ectodeck's built-in Aquarium, drawn by the deck's own renderer: the three.js
// reef tank moved off the browser, the same tank and the same life in it.
//
// Everything alive is kept in a small texture, "tank", worked out in four
// passes each frame:
//   0. the music (a beat is a bass hit; the tempo comes from the gaps
//      between hits; a drop is the loudness jumping well above its recent
//      level), the light and the disco easing, and the key presses (food at
//      the key; two quick presses tap the glass), and when a bubble rises;
//   1. when the music starts, each fish takes a place of its own to dance on;
//   2. the step: the fish swim as in water, chase food, turn, dance; the crab
//      scuttles, eats and dances; the anemone sways; food sinks and settles;
//      bubbles rise;
//   3. the fish keep apart, the food that was eaten goes, and the fish are
//      put in the order they are drawn in.
// Then the picture: the reef photograph with light rippling over it, the
// anemone, the crab and its shadow, the fish (each a picture on a bending
// strip: the tail beats, the body flexes, a turn folds it round), the food,
// the bubbles, the light rays and the disco.
//
// Coordinates are pixels, y up from the bottom, as the three.js camera had them.

// ---- the tank's texture: where each thing is kept
// row 0: the tank as a whole (M_ texels); row 1: the crab (C_ texels);
// rows 2 to 10: the fish, one column each; row 11: the order the fish are drawn in;
// rows 12 to 15: the food, one column a flake; rows 16 and 17: the bubbles
const int M_LIGHT = 0, M_DISCO = 1, M_LEVEL = 2, M_BEAT = 3, M_TURN = 4, M_NOW = 5, M_PARTS = 6, M_GAPS = 7, M_GAPS2 = 8;
const int M_PRESS = 9, M_TAP = 10, M_SPAWN = 11, M_FOOD_AT = 12, M_ANEMONE = 16, M_FRESH = 17, META_COUNT = 18;
const int ROW_CRAB = 1, ROW_FISH = 2, FISH_TEXELS = 9, ROW_ORDER = 11, ROW_FOOD = 12, ROW_BUBBLE = 16;
const int MAX_FISH = 24, MAX_FOOD = 80, MAX_BUBBLES = 90;
const int PASS_MUSIC = 0, PASS_PLACES = 1, PASS_STEP = 2, PASS_AFTER = 3;

const vec3 WATER = vec3(0.02, 0.09, 0.22);
const float SWING_GAP = 0.25;

vec4 tankAt(int x, int y) { return texelFetch(tank, ivec2(x, y), 0); }
vec4 meta(int i) { return tankAt(i, 0); }
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
// a random number for this frame, one of many told apart by the key
float rnd(float key) { return hash(vec2(key * 1.618 + 3.7, mod(float(iFrame), 4096.0) + fract(iTime) * 13.1)); }
float rnd(float lo, float hi, float key) { return lo + rnd(key) * (hi - lo); }
float frameDt() { return min(0.05, iTimeDelta); }
float W() { return iResolution.x; }
float H() { return iResolution.y; }
float clampedEnergy() { return clamp(energy, 0.3, 1.6); }
float swimSpeed() { return clamp(speed, 0.4, 1.8); }

// ---- the light: day, dusk or night; Automatic follows the sun, estimated from
// the date, daylight saving and a latitude of 35 degrees
int clockLight() {
    float jan = iZone.y, jul = iZone.z, now = iZone.x;
    float lat = (jan > jul ? -35.0 : 35.0) * 0.0174533;
    float noon = 12.0 + (now > min(jan, jul) ? 1.0 : 0.0);
    int y = int(iDate.x), m = int(iDate.y) + 1, d = int(iDate.z);
    int cum[12] = int[12](0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334);
    bool leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    float day = float(cum[m - 1] + d + (leap && m > 2 ? 1 : 0)) - 1.0 + iDate.w / 86400.0;
    float decl = -23.44 * 0.0174533 * cos(6.28318 / 365.0 * (day + 10.0));
    float cosH = (sin(-0.833 * 0.0174533) - sin(lat) * sin(decl)) / (cos(lat) * cos(decl));
    float half_ = acos(clamp(cosH, -1.0, 1.0)) * 12.0 / 3.14159265;
    float hour = floor(iDate.w / 60.0) / 60.0, rise = noon - half_, set = noon + half_;
    if (hour < rise - 0.5 || hour >= set + 0.75) return 2;
    if (hour < rise + 0.75 || hour >= set - 1.0) return 1;
    return 0;
}
int chosenLight() { return time < 0 ? clockLight() : time % 3; }
// the tank's light for each: its colour over everything, and how strong the rays are
vec4 lightGoal(int l) { return l == 0 ? vec4(1.0, 1.0, 1.0, 1.0) : l == 1 ? vec4(0.86, 0.66, 0.56, 0.55) : vec4(0.26, 0.34, 0.6, 0.12); }

// ---- the kinds of fish: length, speed, tail beats, how many, the band of
// heights they swim in, the part of the music they kick to (0 bass, 1 middle, 2 highs)
float spLen(int s) { float v[8] = float[8](90.0, 128.0, 136.0, 120.0, 158.0, 112.0, 82.0, 100.0); return v[s]; }
float spSpeed(int s) { float v[8] = float[8](38.0, 34.0, 50.0, 46.0, 30.0, 28.0, 56.0, 24.0); return v[s]; }
float spBeat(int s) { float v[8] = float[8](9.0, 6.0, 7.0, 7.0, 5.0, 6.0, 10.0, 8.0); return v[s]; }
int spCount(int s) { int v[8] = int[8](2, 1, 2, 2, 1, 1, 2, 1); return v[s]; }
vec2 spBand(int s) { vec2 v[8] = vec2[8](vec2(0.2, 0.6), vec2(0.35, 0.82), vec2(0.3, 0.85), vec2(0.3, 0.85), vec2(0.3, 0.75), vec2(0.25, 0.65), vec2(0.4, 0.9), vec2(0.3, 0.7)); return v[s]; }
int spPart(int s) { int v[8] = int[8](2, 1, 0, 0, 0, 1, 2, 1); return v[s]; }
const int PUFFER = 7;
// how many of a kind: the pufferfish one or none, the rest scaled by the Fish setting
int kindCount(int s) {
    if (s == PUFFER) return puffer ? 1 : 0;
    int c = spCount(s);
    return max(c > 1 ? 1 : 0, int(floor(float(c) * clamp(fish, 0.3, 2.0) + 0.5)));
}
int fishCount() { int n = 0; for (int s = 0; s < 8; s++) n += kindCount(s); return n; }
int kindOf(int i) { int n = 0; for (int s = 0; s < 8; s++) { n += kindCount(s); if (i < n) return s; } return 0; }
float signature() { return floor(clamp(fish, 0.3, 2.0) * 100.0 + 0.5) * 2.0 + (puffer ? 1.0 : 0.0); }
// a fish picture's height for its width
vec4 fishPicture(int s, vec2 uv, float lod) {
    if (s == 0) return textureLod(clownfish, uv, lod);
    if (s == 1) return textureLod(idol, uv, lod);
    if (s == 2) return textureLod(regal, uv, lod);
    if (s == 3) return textureLod(yellowtang, uv, lod);
    if (s == 4) return textureLod(angel, uv, lod);
    if (s == 5) return textureLod(copperband, uv, lod);
    if (s == 6) return textureLod(anthias, uv, lod);
    return textureLod(pufferTex, uv, lod);
}
float aspectOf(int s) {
    vec2 z = s == 0 ? IMG_SIZE(clownfish) : s == 1 ? IMG_SIZE(idol) : s == 2 ? IMG_SIZE(regal) : s == 3 ? IMG_SIZE(yellowtang)
           : s == 4 ? IMG_SIZE(angel) : s == 5 ? IMG_SIZE(copperband) : s == 6 ? IMG_SIZE(anthias) : IMG_SIZE(pufferTex);
    return z.y / z.x;
}

// ---- a fish, as kept
struct Fish {
    vec2 p, v; float dir, from, turnT, sinceTurn; float speed, phase, rush, target;
    float retarget, orbit, pitch, wantY; float kick, pendingTurn, turnTime, ty;
    float puff, puffUntil, nextPuff, push; float avoiding; vec2 place; float ateSlot;
    float depth, len; int kind; float hasPlace; float amp, bulge, swap, spare;
};
Fish fishAt(int i) {
    vec4 a = tankAt(i, ROW_FISH), b = tankAt(i, ROW_FISH + 1), c = tankAt(i, ROW_FISH + 2), d = tankAt(i, ROW_FISH + 3), e = tankAt(i, ROW_FISH + 4);
    vec4 f = tankAt(i, ROW_FISH + 5), g = tankAt(i, ROW_FISH + 6), h = tankAt(i, ROW_FISH + 7), k = tankAt(i, ROW_FISH + 8);
    return Fish(a.xy, a.zw, b.x, b.y, b.z, b.w, c.x, c.y, c.z, c.w, d.x, d.y, d.z, d.w, e.x, e.y, e.z, e.w,
                f.x, f.y, f.z, f.w, g.x, g.yz, g.w, h.x, h.y, int(h.z), h.w, k.x, k.y, k.z, k.w);
}
vec4 fishTexel(Fish f, int row) {
    if (row == 0) return vec4(f.p, f.v);
    if (row == 1) return vec4(f.dir, f.from, f.turnT, f.sinceTurn);
    if (row == 2) return vec4(f.speed, f.phase, f.rush, f.target);
    if (row == 3) return vec4(f.retarget, f.orbit, f.pitch, f.wantY);
    if (row == 4) return vec4(f.kick, f.pendingTurn, f.turnTime, f.ty);
    if (row == 5) return vec4(f.puff, f.puffUntil, f.nextPuff, f.push);
    if (row == 6) return vec4(f.avoiding, f.place, f.ateSlot);
    if (row == 7) return vec4(f.depth, f.len, float(f.kind), f.hasPlace);
    return vec4(f.amp, f.bulge, f.swap, f.spare);
}
float heightOf(Fish f) { return f.len * aspectOf(f.kind); }
bool nearDepth(Fish a, Fish b) { return abs(a.depth - b.depth) < 0.35; }

// ---- food and bubbles, as kept
struct Flake { vec2 p, v; float s, spin, rot, spinRate, flutter, kind, floor_, state, restUntil; };
Flake flakeAt(int k) {
    vec4 a = tankAt(k, ROW_FOOD), b = tankAt(k, ROW_FOOD + 1), c = tankAt(k, ROW_FOOD + 2), d = tankAt(k, ROW_FOOD + 3);
    return Flake(a.xy, a.zw, b.x, b.y, b.z, b.w, c.x, c.y, c.z, c.w, d.x);
}
vec4 flakeTexel(Flake f, int row) {
    if (row == 0) return vec4(f.p, f.v);
    if (row == 1) return vec4(f.s, f.spin, f.rot, f.spinRate);
    if (row == 2) return vec4(f.flutter, f.kind, f.floor_, f.state);
    return vec4(f.restUntil, 0.0, 0.0, 0.0);
}
// state: 0 empty, 1 sinking, 2 settled on the sand

// ---- the music, as kept
struct Music { float level, levelAvg, playing, bassAvg, lastBeat, period, beats, swingDir, dir, turnStep, turnedAt, drop, nextDrop; };
Music musicNow() {
    vec4 l = meta(M_LEVEL), b = meta(M_BEAT), t = meta(M_TURN), n = meta(M_NOW);
    return Music(l.x, l.y, l.z, l.w, b.x, b.y, b.z, b.w, t.x, t.y, t.z, t.w, n.x);
}
bool grooving(Music m) { return dance && m.playing > 0.5 && iTime - m.lastBeat < 1.5; }
float beatPosition(Music m) { return m.beats + min(1.0, (iTime - m.lastBeat) / max(0.25, m.period)); }

float pressedAt(int i) { return iTime - iKeyPresses[i].z; }

// ================================================================ pass 0
vec4 drawMusic(int id) {
    bool first = iFrame == 0;
    float dt = frameDt(), t = iTime;
    if (id >= META_COUNT) return vec4(0.0);
    Music m = musicNow();
    vec4 parts = meta(M_PARTS), gaps = meta(M_GAPS), gaps2 = meta(M_GAPS2), light = meta(M_LIGHT), discoState = meta(M_DISCO);
    vec4 press = meta(M_PRESS), tap = meta(M_TAP), spawn = meta(M_SPAWN);
    if (first) {
        m = Music(0.0, 0.0, 0.0, 0.0, -9.0, 0.5, 0.0, 1.0, rnd(1.0) < 0.5 ? -1.0 : 1.0, 3.0, -99.0, 0.0, 0.0);
        parts = vec4(-9.0, -9.0, -9.0, 0.0); gaps = vec4(0.0); gaps2 = vec4(0.0, 0.0, t, 0.0);
        vec4 g = lightGoal(chosenLight()); light = g; discoState = vec4(0.0);
        press = vec4(-9.0, 0.0, 0.0, 0.0); tap = vec4(0.0); spawn = vec4(0.0, 0.0, -1.0, 0.0);
    }
    // the sound, as Ectodeck's audio events brought it thirty times a second;
    // the smoothing is kept at that pace whatever the frame rate
    float per = dt * 30.0, lvl = iAudioLevel;
    float bass = (iAudioBands[0] + iAudioBands[1] + iAudioBands[2] + iAudioBands[3]) / 4.0;
    m.level += (lvl - m.level) * (1.0 - pow(0.7, per));
    m.levelAvg += (lvl - m.levelAvg) * (1.0 - pow(0.99, per));
    // music counts as playing after a moment of sound, and stops after a second of quiet
    m.playing = lvl > 0.04 ? min(1.0, m.playing + 0.05 * per) : max(0.0, m.playing - 0.03 * per);
    for (int k = 0; k < 3; k++) if (iAudioHits[k] > 0.0) parts[k] = t;
    // a bass hit moves the whole tank: its swing turns over (not more often than
    // SWING_GAP), and every eighth turn the kinds turn in turn
    float beatNow = 0.0, turning = -1.0, dropNow = 0.0;
    if (iAudioHits[0] > 0.0 && t - m.lastBeat > SWING_GAP) {
        float gap = t - m.lastBeat;
        float gs[6] = float[6](gaps.x, gaps.y, gaps.z, gaps.w, gaps2.x, gaps2.y);
        int n = int(parts.w);
        if (gap < 1.5) {
            if (n == 6) { for (int k = 0; k < 5; k++) gs[k] = gs[k + 1]; n = 5; }
            gs[n] = gap; n++;
        }
        // how long the swing takes: the middle of the recent gaps between hits
        if (n > 0) {
            float s[6] = gs;
            for (int a = 0; a < 6; a++) for (int b = 0; b < 5; b++) if (b + 1 < n && s[b] > s[b + 1]) { float x = s[b]; s[b] = s[b + 1]; s[b + 1] = x; }
            m.period = s[n / 2];
        }
        gaps = vec4(gs[0], gs[1], gs[2], gs[3]); gaps2.xy = vec2(gs[4], gs[5]); parts.w = float(n);
        m.lastBeat = t;
        if (dance && m.playing > 0.5) {
            m.beats += 1.0;
            m.swingDir = -m.swingDir;
            // the tank turns every eighth swing, and not more than every 4.5 s:
            // big fish on the first swing, striped on the next, small on the one after
            if (mod(m.beats, 8.0) == 0.0 && t - m.turnedAt > 4.5) { m.dir = -m.dir; m.turnedAt = t; m.turnStep = 0.0; }
            turning = m.turnStep == 0.0 ? 0.0 : m.turnStep == 1.0 ? 1.0 : m.turnStep == 2.0 ? 2.0 : -1.0;
            m.turnStep += 1.0;
            beatNow = 1.0;
        }
    }
    m.bassAvg += (bass - m.bassAvg) * (1.0 - pow(0.92, per));
    // a drop: the music as a whole well above its recent level, and not again for a while
    if (dance && m.playing > 0.8 && m.level > 0.5 && m.level > m.levelAvg * 1.7 && t > m.nextDrop) { m.drop = 4.0; m.nextDrop = t + 25.0; dropNow = 1.0; }
    m.drop = max(0.0, m.drop - dt);
    // the music starting: everyone to a place
    bool dancingNow = dance && m.playing > 0.5 && t - m.lastBeat < 1.5 && m.drop <= 0.0;
    float placesNow = dancingNow && discoState.y < 0.5 ? 1.0 : 0.0;
    // the disco: on at night while the tank dances, fading in and out
    int L = chosenLight();
    bool discoOn = disco > 0 && (disco == 2 || L == 2) && dance && m.playing > 0.25;
    float amount = first ? 0.0 : discoState.x + ((discoOn ? 1.0 : 0.0) - discoState.x) * min(1.0, dt * (discoOn ? 6.0 : 0.8));
    // the tank's light eases toward the time of day's
    vec4 goal = lightGoal(L);
    if (!first) light += (goal - light) * min(1.0, dt * 0.8);
    // key presses, oldest first: food at the key; a second press close by within
    // a third of a second taps the glass instead
    float done = first ? t : gaps2.z;
    float foodCount = 0.0, nextFood = press.w, base = press.w, touched = 0.0;
    vec2 foodAt[4] = vec2[4](vec2(0.0), vec2(0.0), vec2(0.0), vec2(0.0));
    tap.x = 0.0;
    for (int i = 7; i >= 0; i--) {
        vec4 k = iKeyPresses[i];
        if (k.w < 0.0 || first) continue;
        float at = pressedAt(i);
        if (at <= done + 0.01) continue;
        vec2 px = k.xy;
        if (at - press.x < 0.35 && length(px - press.yz) < 60.0) { tap = vec4(1.0, px, tap.w); press.x = -9.0; continue; }
        press.xyz = vec3(at, px);
        if (anemone && length(px - vec2(W() * 0.28, H() * 0.05 + 128.0 * 0.44)) < 140.0) touched = 1.0;
        if (foodCount < 4.0) { foodAt[int(foodCount)] = px; foodCount += 1.0; nextFood = mod(nextFood + 9.0, float(MAX_FOOD)); }
    }
    for (int i = 0; i < 8; i++) if (iKeyPresses[i].w >= 0.0) done = max(done, pressedAt(i));
    gaps2.z = done;
    press.w = nextFood;
    // now and then a bubble drifts up from the reef
    float bubbleSlot = -1.0;
    if (bubbles && !first && rnd(7.0) < dt * 2.2) { bubbleSlot = tap.w; tap.w = mod(tap.w + 1.0, float(MAX_BUBBLES)); }
    if (id == M_LIGHT) return light;
    if (id == M_DISCO) return vec4(amount, dancingNow ? 1.0 : 0.0, placesNow, signature());
    // the fish are hatched again when their number changes (and on the first frame)
    if (id == M_FRESH) return vec4(first || discoState.w != signature() ? 1.0 : 0.0, 0.0, 0.0, 0.0);
    if (id == M_LEVEL) return vec4(m.level, m.levelAvg, m.playing, m.bassAvg);
    if (id == M_BEAT) return vec4(m.lastBeat, m.period, m.beats, m.swingDir);
    if (id == M_TURN) return vec4(m.dir, m.turnStep, m.turnedAt, m.drop);
    if (id == M_NOW) return vec4(m.nextDrop, beatNow, turning, dropNow);
    if (id == M_PARTS) return parts;
    if (id == M_GAPS) return gaps;
    if (id == M_GAPS2) return gaps2;
    if (id == M_PRESS) return press;
    if (id == M_TAP) return tap;
    if (id == M_SPAWN) return vec4(foodCount, base, bubbleSlot, touched);
    if (id >= M_FOOD_AT && id < M_FOOD_AT + 4) return vec4(foodAt[id - M_FOOD_AT], 0.0, 0.0);
    return meta(id);
}

// ================================================================ pass 1
// when the music starts each fish takes a place of its own, near where it is,
// spread so fish at a similar depth keep apart: start from where each fish is,
// then keep parting any two too close, the shorter way, until none are
vec2 takePlace(int me) {
    int n = fishCount();
    float lo = H() * 0.18, hi = H() * 0.88;
    vec2 place[MAX_FISH]; float len[MAX_FISH], ht[MAX_FISH], depth[MAX_FISH];
    for (int i = 0; i < MAX_FISH; i++) {
        if (i >= n) break;
        Fish f = fishAt(i);
        place[i] = vec2(clamp(f.p.x, f.len * 0.7, W() - f.len * 0.7), clamp(f.p.y, lo, hi));
        len[i] = f.len; ht[i] = heightOf(f); depth[i] = f.depth;
    }
    for (int round_ = 0; round_ < 200; round_++) {
        bool moved = false;
        for (int i = 0; i < MAX_FISH; i++) {
            if (i >= n) break;
            for (int j = i + 1; j < MAX_FISH; j++) {
                if (j >= n) break;
                if (abs(depth[i] - depth[j]) >= 0.35) continue;
                vec2 d = place[j] - place[i];
                float needX = (len[i] + len[j]) * 0.62, needY = (ht[i] + ht[j]) * 0.75;
                float gx = needX - abs(d.x), gy = needY - abs(d.y);
                if (gx <= 0.0 || gy <= 0.0) continue;
                moved = true;
                float sy = d.y != 0.0 ? sign(d.y) : (i % 2 == 1 ? 1.0 : -1.0), sx = d.x != 0.0 ? sign(d.x) : (j % 2 == 1 ? 1.0 : -1.0);
                bool byY = gy / needY < gx / needX;
                float roomY = sy > 0.0 ? (hi - place[j].y) + (place[i].y - lo) : (hi - place[i].y) + (place[j].y - lo);
                if (byY && roomY < gy) byY = false;
                if (byY) { place[i].y -= sy * gy * 0.55; place[j].y += sy * gy * 0.55; }
                else { place[i].x -= sx * gx * 0.55; place[j].x += sx * gx * 0.55; }
                place[i] = vec2(clamp(place[i].x, len[i] * 0.6, W() - len[i] * 0.6), clamp(place[i].y, lo, hi));
                place[j] = vec2(clamp(place[j].x, len[j] * 0.6, W() - len[j] * 0.6), clamp(place[j].y, lo, hi));
            }
        }
        if (!moved) break;
    }
    return place[me];
}
vec4 drawPlaces(ivec2 px) {
    vec4 was = tankAt(px.x, px.y);
    if (px.y != ROW_FISH + 6 || px.x >= fishCount() || meta(M_DISCO).z < 0.5) return was;
    return vec4(was.x, takePlace(px.x), was.w);
}

// ================================================================ pass 2: the step
// of a few heights in the fish's band, the one furthest from the fish around it
float roomiestHeight(int me, Fish f) {
    float best = f.p.y, room = -1.0;
    int n = fishCount();
    for (int k = 0; k < 6; k++) {
        vec2 band = spBand(f.kind);
        float y = rnd(band.x, band.y, float(me) * 7.0 + float(k)) * H(), gap = 1e9;
        for (int j = 0; j < MAX_FISH; j++) {
            if (j >= n) break;
            if (j == me) continue;
            Fish o = fishAt(j);
            if (nearDepth(f, o) && abs(o.p.x - f.p.x) < o.len + f.len) gap = min(gap, abs(o.p.y - y));
        }
        if (gap > room) { room = gap; best = y; }
    }
    return best;
}
Fish hatchFish(int i) {
    int s = kindOf(i);
    float key = float(i) * 31.0;
    float depth = sqrt(rnd(key + 1.0)), len = spLen(s) * (0.5 + 0.5 * depth);
    float dir = rnd(key + 2.0) < 0.5 ? -1.0 : 1.0;
    vec2 band = spBand(s);
    vec2 p = vec2(rnd(0.1, 0.9, key + 3.0) * W(), rnd(band.x, band.y, key + 4.0) * H());
    float sp = spSpeed(s) * (0.7 + 0.5 * depth) * rnd(0.85, 1.15, key + 5.0);
    return Fish(p, vec2(dir * sp, 0.0), dir, dir, 1.0, rnd(0.0, 3.0, key + 6.0), sp, rnd(0.0, 6.28, key + 7.0), 0.0, -1.0,
                0.0, 0.0, 0.0, p.y, 0.0, 0.0, 0.9, p.y, 0.0, 0.0, iTime + rnd(25.0, 50.0, key + 8.0), 0.0, 0.0, vec2(0.0), -1.0,
                depth, len, s, 0.0, 1.0, 0.0, 0.0, 0.0);
}

Fish stepFish(int me) {
    Fish f = fishAt(me);
    int n = fishCount();
    float dt = frameDt(), t = iTime;
    Music m = musicNow();
    vec4 now = meta(M_NOW), tap = meta(M_TAP);
    bool danced = meta(M_DISCO).y > 0.5;
    float E = clampedEnergy();
    f.ateSlot = -1.0;
    // a tap on the glass: the fish nearby dart away, the pufferfish puffs up
    if (tap.x > 0.5) {
        float d = length(f.p - tap.yz);
        if (d < 260.0) { f.dir = f.p.x < tap.y ? -1.0 : 1.0; f.rush = 1.2; f.target = -1.0; }
        if (f.kind == PUFFER && d < 320.0) f.puffUntil = t + 4.0;
    }
    // a drop: the school gathers and swirls
    if (now.w > 0.5) { f.orbit = float(me) / float(n) * 6.28318; if (f.kind == PUFFER) f.puffUntil = t + 3.0; }
    // a kind's own part of the music: a kick of the tail
    if (dance && m.playing > 0.5 && iAudioHits[spPart(f.kind)] > 0.0) f.kick = 1.0;
    // a bass beat: the kind whose turn it is turns, and any that were waiting for one
    bool beatTurn = false;
    if (now.y > 0.5) { beatTurn = float(spPart(f.kind)) == now.z || f.pendingTurn > 0.5; f.pendingTurn = 0.0; }
    // find food
    if (f.target >= 0.0) { Flake p = flakeAt(int(f.target)); if (p.state != 1.0) f.target = -1.0; }
    if (f.target < 0.0) {
        float best = 300.0;
        for (int k = 0; k < MAX_FOOD; k++) {
            Flake p = flakeAt(k);
            if (p.state != 1.0) continue;
            float d = length(p.p - f.p);
            if (d < best) { best = d; f.target = float(k); }
        }
    }
    float want = f.dir;
    bool rushing = f.rush > 0.0, hasTarget = f.target >= 0.0;
    bool swirling = dance && m.drop > 0.0 && !hasTarget;
    if (swirling) {
        float ang = f.orbit + t * 1.4;
        vec2 s = vec2(W() * 0.5 + cos(ang) * W() * 0.26, H() * 0.55 + sin(ang) * H() * 0.2);
        if ((s.x - f.p.x) * f.dir < -f.len * 0.3) want = -f.dir;
        f.wantY = s.y;
    }
    float head = f.p.x + f.dir * f.len * 0.45;
    if (hasTarget) {
        Flake p = flakeAt(int(f.target));
        // turn for food only when it is clearly behind the head
        if ((p.p.x - head) * f.dir < -f.len * 0.5) want = -f.dir;
        f.wantY = p.p.y;
        if (length(vec2(p.p.x - head, p.p.y - f.p.y)) < 12.0) { f.ateSlot = f.target; f.target = -1.0; }
    } else if (!swirling) {
        // wander: a new depth every few seconds; turn well before the glass
        f.retarget -= dt;
        if (f.retarget < 0.0) { f.wantY = roomiestHeight(me, f); f.retarget = rnd(3.0, 8.0, float(me) + 50.0); }
        float margin = f.len * 0.9;
        if (f.p.x < margin && f.dir < 0.0) want = 1.0;
        else if (f.p.x > W() - margin && f.dir > 0.0) want = -1.0;
        else if (rnd(float(me) + 70.0) < dt * 0.03 && !(dance && m.playing > 0.5)) want = -f.dir;
    }
    hasTarget = f.target >= 0.0;
    // a turn takes most of a second, and a fish doesn't turn again soon after;
    // dancing, a turn waits for the next beat and takes less than a beat
    f.sinceTurn += dt;
    bool onBeat = dance && m.playing > 0.5 && !rushing && !swirling;
    bool atGlass = !danced && (f.p.x < f.len * 0.4 || f.p.x > W() - f.len * 0.4);
    if (onBeat && beatTurn && f.turnT >= 1.0 && m.dir != f.dir && !atGlass) want = m.dir;
    if (want != f.dir && f.turnT >= 1.0) {
        if (onBeat && !beatTurn && !atGlass) f.pendingTurn = 1.0;
        else if (onBeat || f.sinceTurn > (swirling ? 0.8 : 2.5) || rushing || atGlass) {
            f.from = f.dir; f.dir = want; f.turnT = 0.0; f.sinceTurn = 0.0;
            f.turnTime = rushing ? 0.45 : onBeat ? clamp(m.period * 0.85, 0.3, 0.9) : 0.9;
        }
    }
    if (f.turnT < 1.0) f.turnT = min(1.0, f.turnT + dt / max(f.turnTime, 0.01));
    f.rush = max(0.0, f.rush - dt);
    float turning = f.turnT < 1.0 ? sin(3.14159 * f.turnT) : 0.0;
    // swimming, as in water: the tail thrusts toward the speed the fish wants and
    // the water's drag slows it; up and down, its fins carry it on a soft spring
    float groove = grooving(m) ? m.playing : 0.0;
    f.kick = max(0.0, f.kick - dt * 2.0);
    float cruise = swimSpeed() * f.speed * (hasTarget ? 1.8 : 1.0) * (rushing ? 3.5 : 1.0) * (swirling ? 2.2 : 1.0) * (1.0 - 0.4 * f.avoiding) * (1.0 - 0.75 * f.puff);
    float wanted = cruise * (1.0 + 0.15 * groove) + groove * f.kick * f.len * 1.3 * E;
    float heading = f.turnT < 1.0 ? (f.turnT < 0.5 ? f.from : f.dir) : f.dir;
    float along = f.v.x * heading;
    bool onSpot = danced && f.hasPlace > 0.5 && !hasTarget && !rushing;
    float thrust = f.kick * f.speed * 6.0;
    if (onSpot) {
        // holding its place, as a fish holds station in moving water
        float home = 2.2;
        f.v.x += ((f.place.x - f.p.x) * home * home - f.v.x * 2.0 * home) * dt;
        f.v.x += heading * f.kick * f.len * 2.4 * dt;
        f.ty = f.place.y;
    } else {
        thrust = max(0.0, wanted - along) * (2.2 + 1.8 * f.kick) * (1.0 - 0.8 * turning);
        f.v.x += heading * thrust * dt;
        // drag; moving backwards is stopped fast
        f.v.x *= exp(-(along > 0.0 ? 1.1 : 4.0) * dt);
    }
    // dancing, the height it swims for rises and falls with the beat, one wave for the whole tank
    int part = spPart(f.kind);
    float sway = groove * E * f.len * (part == 0 ? 0.44 : part == 1 ? 0.38 : 0.32) * sin(3.14159 * beatPosition(m));
    float stiff = onSpot ? 5.0 : hasTarget ? 5.0 : swirling ? 4.0 : 1.4;
    f.v.y += ((f.ty + sway - f.p.y) * stiff * stiff - f.v.y * 2.0 * stiff + (onSpot ? 0.0 : f.push)) * dt;
    f.p += f.v * dt;
    if (f.p.x < f.len * 0.3 || f.p.x > W() - f.len * 0.3) { f.p.x = clamp(f.p.x, f.len * 0.3, W() - f.len * 0.3); f.v.x = 0.0; }
    if (f.p.y < H() * 0.12 || f.p.y > H() * 0.93) { f.p.y = clamp(f.p.y, H() * 0.12, H() * 0.93); f.v.y = 0.0; }
    float pitchGoal = clamp(atan(f.v.y, abs(f.v.x) + 25.0), -0.6, 0.6);
    f.pitch += (pitchGoal - f.pitch) * min(1.0, dt * 8.0);
    float spd = max(length(f.v), onSpot ? f.speed * 0.6 : 0.0);
    // the tail works harder while it thrusts
    f.phase = mod(f.phase + dt * spBeat(f.kind) * (0.6 + spd / f.speed * 0.5 + turning * 0.8 + min(1.5, thrust / (f.speed * 6.0))), 6.28318 * 256.0);
    f.amp = 0.6 + 0.4 * min(2.0, spd / f.speed) + 0.5 * f.kick;
    f.bulge = 0.0; f.swap = 0.0;
    if (f.kind == PUFFER) {
        // puffing: quick to swell, slow to go down; now and then on its own
        if (t > f.nextPuff) { f.puffUntil = t + 3.5; f.nextPuff = t + rnd(35.0, 70.0, float(me) + 90.0); }
        float goal = t < f.puffUntil ? 1.0 : 0.0;
        f.puff += (goal - f.puff) * min(1.0, dt * (goal > 0.5 ? 5.0 : 0.9));
        // the calm fish swells round in its own picture until its outline is the
        // balloon's; only then does the balloon picture take over, in one frame,
        // which reads as the spines springing up (a fade shows the tank through him)
        f.swap = step(0.55, f.puff);
        // with music it swells rounder on each beat and relaxes between
        float breath = grooving(m) ? exp(-(t - m.lastBeat) * 5.0) : 0.0;
        f.bulge = 0.85 * smoothstep(0.0, 0.55, f.puff) + 0.7 * E * breath * (1.0 - f.puff);
    }
    if (meta(M_DISCO).z > 0.5) f.hasPlace = 1.0;
    return f;
}

// the crab: body x, facing, walk and pause timers; its step, flight, the flake it
// is after, eating; which claw eats, the flake bitten, how much it dances, the
// flake eaten this frame; its claws; and where it is drawn
struct Crab { float x, dir, walk, pause; float step, flee, food, eating; float eatSide, bite, dance, ate; vec4 claws; vec4 drawn; };
Crab crabNow() {
    vec4 a = tankAt(0, ROW_CRAB), b = tankAt(1, ROW_CRAB), c = tankAt(2, ROW_CRAB);
    return Crab(a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w, c.x, c.y, c.z, c.w, tankAt(3, ROW_CRAB), tankAt(4, ROW_CRAB));
}
vec4 crabTexel(Crab c, int i) {
    if (i == 0) return vec4(c.x, c.dir, c.walk, c.pause);
    if (i == 1) return vec4(c.step, c.flee, c.food, c.eating);
    if (i == 2) return vec4(c.eatSide, c.bite, c.dance, c.ate);
    if (i == 3) return c.claws;
    return c.drawn;
}
const float CRAB_W = 124.0;
float crabY() { return H() * 0.09; }

Crab stepCrab() {
    Crab c = crabNow();
    float dt = frameDt(), t = iTime, E = clampedEnergy();
    Music m = musicNow();
    vec4 tap = meta(M_TAP);
    if (iFrame == 0) return Crab(W() * 0.55, 1.0, 0.0, 1.0, 0.0, 0.0, -1.0, 0.0, 1.0, -1.0, 0.0, -1.0, vec4(0.0), vec4(W() * 0.55, crabY() + CRAB_W * 0.175, 1.0, 0.0));
    c.ate = -1.0;
    if (!crab) c.food = -1.0;
    // a tap on the glass near the crab sends it scurrying off
    if (tap.x > 0.5 && abs(tap.y - c.x) < 150.0 && tap.z < H() * 0.4) { c.flee = 1.1; c.dir = c.x < tap.y ? -1.0 : 1.0; c.pause = 0.0; c.walk = 0.0; c.food = -1.0; }
    // claws: raised while it dances, waving in time, one higher on each beat
    float bp = beatPosition(m), waveIn = fract(bp), upSide = mod(floor(bp), 2.0) == 1.0 ? 1.0 : -1.0;
    for (int k = 0; k < 2; k++) {
        float side = k == 0 ? -1.0 : 1.0;
        float raise = c.claws[k], pinch = c.claws[k + 2];
        float want = c.dance * (0.72 + 0.28 * (side == upSide ? sin(3.14159 * min(1.0, waveIn * 1.4)) : 0.0));
        if (c.eating > 0.0 && side == c.eatSide) want = max(want, 0.55 * sin(3.14159 * (1.0 - c.eating / 0.7)));
        raise += (want - raise) * min(1.0, dt * 7.0);
        // the pincer: dancing it opens between beats and snaps shut on each; reaching
        // for food it opens, and shuts on the flake; otherwise now and then a snap
        float open = 0.0;
        if (c.eating > 0.0 && side == c.eatSide) open = c.eating > 0.35 ? 1.0 : 0.0;
        else if (c.dance > 0.1) open = c.dance * min(1.0, waveIn * 1.8) * (waveIn < 0.92 ? 1.0 : 0.0);
        else if (c.food >= 0.0 && side == (flakeAt(int(c.food)).p.x < c.x ? -1.0 : 1.0)) open = 0.6;
        else if (sin(t * 0.7 + side * 2.1) > 0.985) open = 1.0;
        pinch += (open - pinch) * min(1.0, dt * (open < pinch ? 28.0 : 9.0));
        c.claws[k] = raise; c.claws[k + 2] = pinch;
    }
    bool grooveNow = grooving(m);
    float lo = W() * 0.38, hi = W() * 0.8;
    // food: the crab goes for the flake it can reach soonest, sinking or settled
    if (c.food >= 0.0 && flakeAt(int(c.food)).state == 0.0) c.food = -1.0;
    if (crab && c.flee <= 0.0 && c.food < 0.0) {
        float best = 1e9;
        for (int k = 0; k < MAX_FOOD; k++) {
            Flake p = flakeAt(k);
            if (p.state == 0.0 || p.p.x < lo - 30.0 || p.p.x > hi + 30.0 || (p.state == 1.0 && p.p.y > H() * 0.5)) continue;
            float d = abs(p.p.x - c.x) + (p.state == 2.0 ? 0.0 : (p.p.y - p.floor_) * 0.6);
            if (d < best) { best = d; c.food = float(k); }
        }
    }
    c.eating = max(0.0, c.eating - dt);
    if (c.bite >= 0.0 && c.eating < 0.35) { c.ate = c.bite; c.bite = -1.0; }
    c.dance += ((grooveNow && c.flee <= 0.0 && c.food < 0.0 && c.eating <= 0.0 ? 1.0 : 0.0) - c.dance) * min(1.0, dt * 3.0);
    float baseY = crabY() + CRAB_W * 0.175;
    if (c.food >= 0.0 && c.flee <= 0.0 && c.dance < 0.5) {
        Flake p = flakeAt(int(c.food));
        float target = clamp(p.p.x, lo, hi), gap = target - c.x;
        if (abs(gap) > 6.0 && c.eating <= 0.0) {
            c.dir = gap > 0.0 ? 1.0 : -1.0;
            c.x += c.dir * min(abs(gap), 80.0 * dt); c.step += dt * 22.0;
        } else if ((p.state == 2.0 || p.p.y - p.floor_ < CRAB_W * 0.3) && c.eating <= 0.0) {
            c.eating = 0.7; c.eatSide = p.p.x < c.x ? -1.0 : 1.0; c.bite = c.food;
        }
        if (c.bite >= 0.0 && c.eating < 0.35) { c.ate = c.bite; c.bite = -1.0; }
        c.pause = 0.8; c.walk = 0.0;
        bool walking = abs(gap) > 6.0 && c.eating <= 0.0;
        c.drawn = vec4(c.x, baseY + (walking ? abs(sin(c.step)) * 2.5 : 0.0), walking ? 1.0 + 0.035 * sin(c.step * 2.0) : 1.0, walking ? 0.04 * sin(c.step) : 0.0);
        return c;
    }
    if (c.dance > 0.02) {
        // dancing where it stands: a side-step left on one beat and right on the next, a hop on each
        float inBeat = fract(bp), side = mod(floor(bp), 2.0) == 1.0 ? 1.0 : -1.0;
        float shuffle = side * 13.0 * E * sin(3.14159 * min(1.0, inBeat * 1.6));
        float hop = sin(3.14159 * min(1.0, inBeat * 2.5)) * 7.0 * E;
        c.drawn = vec4(c.x + shuffle * c.dance, baseY + hop * c.dance, 1.0 + 0.04 * sin(3.14159 * min(1.0, inBeat * 2.5)) * c.dance, -side * 0.1 * sin(3.14159 * min(1.0, inBeat * 1.6)) * c.dance);
        if (c.dance > 0.5) return c;
    }
    if (c.flee > 0.0) { c.flee -= dt; c.x += c.dir * 190.0 * dt; c.step += dt * 30.0; }
    else if (c.pause > 0.0) {
        c.pause -= dt;
        if (c.pause <= 0.0) { c.walk = rnd(0.8, 2.5, 301.0); c.dir = c.x < lo + 40.0 ? 1.0 : c.x > hi - 40.0 ? -1.0 : (rnd(302.0) < 0.5 ? -1.0 : 1.0); }
    } else {
        c.walk -= dt; c.x += c.dir * 55.0 * dt; c.step += dt * 18.0;
        if (c.walk <= 0.0) c.pause = rnd(1.5, 4.5, 303.0);
    }
    if (c.x < lo) { c.x = lo; c.dir = 1.0; } else if (c.x > hi) { c.x = hi; c.dir = -1.0; }
    bool moving = c.flee > 0.0 || c.pause <= 0.0;
    c.drawn = vec4(c.x, baseY + (moving ? abs(sin(c.step)) * 2.5 : 0.0), moving ? 1.0 + 0.035 * sin(c.step * 2.0) : 1.0, moving ? 0.04 * sin(c.step) : 0.0);
    return c;
}

vec4 stepFood(int k, int row) {
    Flake p = flakeAt(k);
    float dt = frameDt(), t = iTime;
    vec4 spawn = meta(M_SPAWN);
    // a press drops nine flakes at the key
    float into = mod(float(k) - spawn.y + float(MAX_FOOD), float(MAX_FOOD));
    if (into < spawn.x * 9.0) {
        vec2 at = meta(M_FOOD_AT + int(into / 9.0)).xy;
        float key = float(k) * 17.0 + 400.0;
        p = Flake(at + vec2(rnd(-28.0, 28.0, key), rnd(-10.0, 10.0, key + 1.0)), vec2(rnd(-16.0, 16.0, key + 2.0), rnd(-18.0, -8.0, key + 3.0)),
                  rnd(9.0, 14.0, key + 4.0), rnd(0.0, 6.0, key + 5.0), rnd(0.0, 6.28, key + 6.0), rnd(-2.0, 2.0, key + 7.0), rnd(2.0, 4.0, key + 8.0),
                  floor(rnd(0.0, 4.0, key + 9.0)), H() * rnd(0.085, 0.115, key + 10.0), 1.0, 0.0);
        return flakeTexel(p, row);
    }
    if (p.state == 1.0) {
        // flakes sink slowly, sliding side to side as they flutter, and settle on the sand
        p.v.x *= pow(0.4, dt);
        p.p.x += p.v.x * dt + sin(t * p.flutter + p.spin) * 14.0 * dt;
        p.p.y += p.v.y * dt;
        p.v.y = max(p.v.y - 1.5 * dt, -16.0);
        p.rot += p.spinRate * dt;
        if (p.p.y <= p.floor_) { p.p.y = p.floor_; p.state = 2.0; p.restUntil = t + 14.0; p.flutter = 0.0; p.spin = 0.0; }
    }
    return flakeTexel(p, row);
}

vec4 stepBubble(int k, int row) {
    vec4 a = tankAt(k, ROW_BUBBLE), b = tankAt(k, ROW_BUBBLE + 1);
    float dt = frameDt(), t = iTime;
    if (float(k) == meta(M_SPAWN).z) {
        // mostly small, now and then a larger one
        float key = float(k) * 13.0 + 700.0;
        bool big = rnd(key) < 0.18;
        a = vec4(rnd(0.04, 0.96, key + 1.0) * W(), H() * rnd(0.12, 0.35, key + 2.0), big ? rnd(45.0, 60.0, key + 3.0) : rnd(28.0, 45.0, key + 3.0), big ? rnd(16.0, 26.0, key + 4.0) : rnd(5.0, 11.0, key + 4.0));
        b = vec4(rnd(0.0, 6.0, key + 5.0), rnd(1.5, 3.0, key + 6.0), 1.0, 0.0);
    } else if (b.z > 0.5) {
        a.z = min(a.z + dt * 8.0, 90.0); a.y += a.z * dt; a.x += sin(t * b.y + b.x) * 9.0 * dt; a.w += dt * 0.25;
        if (a.y >= H() * 0.97) b.z = 0.0;
    }
    return row == 0 ? a : b;
}

vec4 drawStep(ivec2 px) {
    int x = px.x, y = px.y;
    if (y == 0) {
        if (x != M_ANEMONE) return tankAt(x, y);
        // the anemone draws in when touched and slowly opens; with music its
        // tentacles swing left and right in time, eased so they never snap
        vec4 a = meta(M_ANEMONE);
        float dt = frameDt();
        Music m = musicNow();
        a.x = max(0.0, a.x - dt * 0.6);
        if (meta(M_SPAWN).w > 0.5) a.x = 1.0;
        a.y += ((grooving(m) ? sin(3.14159 * beatPosition(m)) : 0.0) - a.y) * min(1.0, dt * 6.0);
        return iFrame == 0 ? vec4(0.0) : a;
    }
    if (y == ROW_CRAB) return x < 5 ? crabTexel(stepCrab(), x) : vec4(0.0);
    if (y >= ROW_FISH && y < ROW_FISH + FISH_TEXELS) {
        if (x >= fishCount()) return vec4(0.0);
        bool fresh = meta(M_FRESH).x > 0.5;
        return fishTexel(fresh ? hatchFish(x) : stepFish(x), y - ROW_FISH);
    }
    if (y >= ROW_FOOD && y < ROW_FOOD + 4) return x < MAX_FOOD ? (iFrame == 0 ? vec4(0.0) : stepFood(x, y - ROW_FOOD)) : vec4(0.0);
    if (y >= ROW_BUBBLE && y < ROW_BUBBLE + 2) return x < MAX_BUBBLES ? (iFrame == 0 ? vec4(0.0) : stepBubble(x, y - ROW_BUBBLE)) : vec4(0.0);
    return tankAt(x, y);
}

// ================================================================ pass 3
// Keeping apart the way schools do (Reynolds' separation): each fish near another
// at a similar depth is pushed gently apart, up or down, more the closer they are.
// A fish being pushed lets its own height drift to where it is, and one right
// ahead in its lane makes a fish ease off a little.
Fish separate(int me) {
    Fish f = fishAt(me);
    int n = fishCount();
    float dt = frameDt();
    f.push = 0.0; f.avoiding = 0.0;
    if (meta(M_DISCO).y > 0.5 && f.hasPlace > 0.5 && f.target < 0.0) { f.ty = f.place.y; return f; }
    float hf = heightOf(f);
    for (int j = 0; j < MAX_FISH; j++) {
        if (j >= n) break;
        if (j == me) continue;
        Fish o = fishAt(j);
        if (!nearDepth(f, o)) continue;
        float rx = (f.len + o.len) * 0.75, ry = (hf + heightOf(o)) * 0.95;
        float dx = (o.p.x - f.p.x) / rx, dy = (o.p.y - f.p.y) / ry, d = length(vec2(dx, dy));
        if (d >= 1.0) continue;
        float q = 1.0 - d;
        f.push += (dy > 0.0 ? -1.0 : dy < 0.0 ? 1.0 : (me < j ? 1.0 : -1.0)) * q * q * 1500.0;
        if (dx * f.dir > 0.0 && abs(dy) < 0.6) f.avoiding = max(f.avoiding, q);
    }
    if (f.push != 0.0) f.wantY += (f.p.y - f.wantY) * min(1.0, dt * 0.8);
    f.ty = f.wantY;
    return f;
}
// the order the fish are drawn in: far fish first, as the three.js tank ordered them
float drawKey(int i) { return floor(fishAt(i).depth * 300.0 + 0.5) * 64.0 + float(i); }
vec4 drawAfter(ivec2 px) {
    int x = px.x, y = px.y, n = fishCount();
    if (y >= ROW_FISH && y < ROW_FISH + FISH_TEXELS && x < n) return fishTexel(separate(x), y - ROW_FISH);
    if (y == ROW_ORDER) {
        if (x >= n) return vec4(-1.0);
        // the fish whose place in the order is x
        for (int i = 0; i < MAX_FISH; i++) {
            if (i >= n) break;
            int rank = 0; float k = drawKey(i);
            for (int j = 0; j < MAX_FISH; j++) { if (j >= n) break; if (drawKey(j) < k) rank++; }
            if (rank == x) return vec4(float(i));
        }
        return vec4(-1.0);
    }
    if (y >= ROW_FOOD && y < ROW_FOOD + 4 && x < MAX_FOOD) {
        // the food that was eaten goes, and settled food goes after a while
        vec4 was = tankAt(x, y);
        Flake p = flakeAt(x);
        bool gone = p.state == 2.0 && iTime >= p.restUntil;
        if (tankAt(2, ROW_CRAB).w == float(x)) gone = true;
        for (int i = 0; i < MAX_FISH; i++) { if (i >= n) break; if (tankAt(i, ROW_FISH + 6).w == float(x)) gone = true; }
        if (gone && y == ROW_FOOD + 2) was.w = 0.0;
        return was;
    }
    return tankAt(x, y);
}

// ================================================================ the picture
float dT, dAmount, dPulse, dHue;
vec3 discoPalette(float k) { k = fract(k); return k < 0.25 ? vec3(1.0, 0.25, 0.7) : k < 0.5 ? vec3(0.2, 0.9, 1.0) : k < 0.75 ? vec3(0.65, 0.35, 1.0) : vec3(1.0, 0.8, 0.25); }
// two spotlight beams shining down from above either side of the tank, sweeping
// back and forth across it; returns the light at a point, and the beams' own haze as w
vec4 discoBeams(vec2 px) {
    vec3 col = vec3(0.0); float haze = 0.0;
    vec2 size = iResolution.xy;
    for (int i = 0; i < 2; i++) {
        float fi = float(i), side = fi * 2.0 - 1.0;
        vec2 o = vec2(size.x * (0.5 + side * 0.36), size.y * 1.08);
        vec2 aim = vec2(size.x * (0.5 - side * 0.3 * sin(dT * 0.55 + fi * 1.3)), size.y * 0.06);
        vec2 a = normalize(aim - o), v = px - o;
        float along = dot(v, a), across = length(v - along * a);
        float width = 14.0 + along * 0.2;
        float beam = along > 0.0 ? smoothstep(width, width * 0.45, across) : 0.0;
        col += discoPalette(dHue + fi * 0.5) * beam;
        haze += beam * (0.35 + 0.65 * smoothstep(size.y * 0.3, 0.0, px.y));
    }
    return vec4(col, haze) * dAmount * (0.6 + 0.55 * dPulse);
}
// the coloured disco spots: soft pools of light wandering the tank
vec3 discoPools(vec2 px) {
    vec3 col = vec3(0.0);
    vec2 size = iResolution.xy;
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        vec2 c = vec2(size.x * (0.5 + 0.42 * sin(dT * (0.31 + fi * 0.07) + fi * 1.9)), size.y * (0.42 + 0.36 * sin(dT * (0.23 + fi * 0.05) + fi * 2.7)));
        float r = size.y * (0.2 + 0.05 * sin(fi * 3.1));
        float d = length((px - c) / vec2(1.25, 1.0)) / r;
        col += discoPalette(dHue + fi * 0.25) * smoothstep(1.0, 0.15, d);
    }
    return col * dAmount * (0.55 + 0.6 * dPulse);
}
// sparkles, as from a mirror ball hanging just above the tank, out of sight
vec3 discoSparkle(vec2 px) {
    vec2 size = iResolution.xy;
    vec2 rel = px - vec2(size.x * 0.5, size.y * 1.06); float ang = atan(rel.y, rel.x), rad = length(rel);
    vec2 cell = vec2(floor((ang + dT * 0.35) * 18.0), floor(rad / 26.0));
    float h = hash(cell);
    vec2 inCell = vec2(fract((ang + dT * 0.35) * 18.0), fract(rad / 26.0)) - 0.5;
    float fleck = step(0.74, h) * smoothstep(0.32, 0.0, length(inCell * vec2(1.0, 1.0 + rad / 260.0))) * (0.6 + 0.4 * sin(dT * 9.0 + h * 40.0));
    fleck *= smoothstep(size.y * 0.3, size.y * 0.65, rad);
    return mix(vec3(1.0), discoPalette(dHue + h), 0.5) * fleck * 1.1 * dAmount * (0.55 + 0.6 * dPulse);
}
vec3 discoSpots(vec2 px) { return dAmount < 0.01 ? vec3(0.0) : discoBeams(px).rgb + discoPools(px) * 0.8 + discoSparkle(px); }
// how the tank's light and the disco colour a thing lit in the water
vec3 lit(vec3 col, vec3 tint, vec2 px) { return col * (tint + min(discoSpots(px) * 1.05, vec3(1.3)) + vec3(0.24, 0.22, 0.28) * dAmount); }

float caustic(vec2 scr, float t) {
    vec2 p = scr * vec2(9.0, 5.0);
    float w = sin(p.x * 1.7 + t * 0.9 + sin(p.y * 1.3 + t * 0.7) * 1.6) * sin(p.y * 2.1 - t * 0.8 + sin(p.x * 1.1 - t * 0.5) * 1.4);
    return pow(max(w, 0.0), 6.0) + 0.6 * pow(max(sin((p.x + p.y) * 2.3 + t * 1.2 + sin(p.x * 3.0)), 0.0), 12.0);
}
// lays a colour over what is there, as much as a covers
void over(inout vec3 col, vec3 c, float a) { col = mix(col, c, clamp(a, 0.0, 1.0)); }
// a thing on the sand, lit as the sand around it is: the same rippling light
// plays over it, and the water's blue softens its colours
void floorThing(inout vec3 col, vec4 c, float light, vec3 tint, vec2 px) {
    if (c.a < 0.03) return;
    vec3 k = mix(c.rgb, WATER * 2.2, 0.22) * light;
    k += caustic(px / iResolution.xy, iTime) * (0.18 + 0.4 * dot(c.rgb, vec3(0.3, 0.55, 0.15))) * vec3(0.8, 0.95, 1.0);
    over(col, lit(k, tint, px), c.a);
}
// a 2D placement: rotate by r, scale by s, then move to p; and the way back
vec2 toLocal(vec2 px, vec2 p, float r, vec2 s) { vec2 q = px - p; float c = cos(r), sn = sin(r); q = vec2(c * q.x + sn * q.y, -sn * q.x + c * q.y); return q / s; }
bool inside(vec2 uv) { return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))); }

// ---- a fish: a picture on a bendable strip. The tail sweeps and the body carries
// a softer wave; a turn is a bend, as a real fish turns: the head swings round
// first and the body follows, so from the side the fish folds into a U
float turnU, phaseU, ampU, bulgeU;
float alongU(float u) { return clamp(turnU * 1.9 - u * 0.9, 0.0, 1.0); }
float reach(float u) { float x = 0.0; for (int k = 0; k < 10; k++) x += cos(3.14159 * alongU((float(k) + 0.5) / 10.0 * u)); return x * u / 10.0; }
float stripX(float u) {
    float tail = smoothstep(0.45, 1.0, u), sweep = tail * tail * ampU;
    return reach(u) - reach(0.5) - sweep * 0.09 * (0.5 - 0.5 * cos(phaseU * 2.0));
}
// the strip's top or bottom edge (side +0.5 or -0.5) at a point along it
float stripY(float u, float side) {
    float tail = smoothstep(0.45, 1.0, u), body = u;
    float y = side + (tail * tail * 0.05 + body * 0.012) * ampU * sin(phaseU - u * 3.0);
    float belly = smoothstep(0.08, 0.42, u) * (1.0 - smoothstep(0.62, 0.92, u));
    y *= 1.0 + bulgeU * belly;
    return y + sin(3.14159 * turnU) * 0.05 * sin(3.14159 * u);
}
// draws a strip picture over col; q is the point in the strip's own terms
void drawStrip(inout vec3 col, vec2 q, int kind, bool puffedPic, float alpha, float light, float haze, vec3 tint, vec2 px, float lod) {
    if (abs(q.x) > 0.75 || abs(q.y) > 1.4) return;
    float x0 = stripX(0.0), top0 = stripY(0.0, 0.5), bot0 = stripY(0.0, -0.5), side0 = abs(cos(3.14159 * alongU(0.0)));
    for (int s = 0; s < 32; s++) {
        float u1 = float(s + 1) / 32.0, u0 = float(s) / 32.0;
        float x1 = stripX(u1), top1 = stripY(u1, 0.5), bot1 = stripY(u1, -0.5), side1 = abs(cos(3.14159 * alongU(u1)));
        float lo = min(x0, x1), hi = max(x0, x1);
        if (q.x >= lo && q.x <= hi && hi > lo) {
            float k = (q.x - x0) / (x1 - x0);
            float top = mix(top0, top1, k), bot = mix(bot0, bot1, k);
            float v = (q.y - bot) / (top - bot);
            if (v >= 0.0 && v <= 1.0) {
                vec2 uv = vec2(mix(u0, u1, k), v);
                vec4 c = puffedPic ? textureLod(puffed, uv, lod) : fishPicture(kind, uv, lod);
                if (c.a >= 0.03) {
                    // a part seen edge-on in a turn: a little darker
                    vec3 k2 = c.rgb * (0.7 + 0.3 * mix(side0, side1, k)) * light;
                    over(col, lit(mix(k2, WATER, haze), tint, px), c.a * alpha);
                }
            }
        }
        x0 = x1; top0 = top1; bot0 = bot1; side0 = side1;
    }
}
// The pufferfish blowing up: the calm fish's belly swells round (its head and
// tail keeping their size) until its outline is the balloon's, then the round
// balloon picture takes over in one frame and swells a little
// more. The balloon is drawn at the size that makes its eye the calm fish's eye
// (the eye is about a ninth of the picture's width) and placed so its eye lands
// where the calm fish's eye is, so the face keeps its size and place while the
// body grows round it. In a turn the blown-up fish narrows to its edge and flips.
const vec2 CALM_EYE = vec2(0.125, 0.65), PUFFED_EYE = vec2(0.25, 0.736), BALL_EYE = vec2(0.25, 0.72);
const float PUFFED_GROW = 1.0, BALL_GROW = 0.965;
void drawBlownUp(inout vec3 col, Fish f, vec2 px, float rot, float light, float haze, vec3 tint, float lod, bool ball, float alpha, float swell) {
    if (alpha <= 0.0) return;
    vec2 ps = ball ? IMG_SIZE(ballTex) : IMG_SIZE(puffed);
    vec2 eye = ball ? BALL_EYE : PUFFED_EYE;
    float grow = ball ? BALL_GROW : PUFFED_GROW, aspect = ps.y / ps.x;
    float turnFacing = f.turnT < 1.0 ? f.from * cos(3.14159 * f.turnT) : f.dir;
    float sx = -turnFacing;                     // the picture faces left; going right it is mirrored
    if (abs(sx) < 0.02) return;
    // where the calm fish's eye is, from its middle, in the fish's own terms
    vec2 eyeAt = (CALM_EYE - 0.5) * vec2(f.len, f.len * aspectOf(PUFFER));
    vec2 size = vec2(f.len * grow, f.len * grow * aspect);
    // the picture placed so its eye lands there
    vec2 middle = eyeAt - (eye - 0.5) * size;
    float c = cos(rot), s = sin(rot);
    vec2 centre = f.p + mat2(c, s, -s, c) * (middle * vec2(sx, 1.0));
    vec2 uv = toLocal(px, centre, rot, size * vec2(sx, 1.0)) + 0.5;
    // the body swells out from the face; the face itself stays as it is
    vec2 fromEye = (uv - eye) * vec2(1.0, aspect);
    float body = smoothstep(0.2, 0.5, length(fromEye));
    vec2 src = eye + (uv - eye) / (1.0 + swell * body);
    if (!inside(src)) return;
    vec4 k = ball ? textureLod(ballTex, src, lod) : textureLod(puffed, src, lod);
    if (k.a < 0.03) return;
    over(col, lit(mix(k.rgb * light, WATER, haze), tint, px), k.a * alpha);
}
void drawFish(inout vec3 col, int i, vec2 px, vec3 tint) {
    Fish f = fishAt(i);
    vec2 reachBox = vec2(f.len * 1.6);
    if (any(greaterThan(abs(px - f.p), reachBox))) return;
    float base = f.turnT < 1.0 ? f.from : f.dir;
    float sx = base < 0.0 ? 1.0 : -1.0;           // the picture faces left; going right it is mirrored
    turnU = f.turnT < 1.0 ? f.turnT : 0.0; phaseU = f.phase;
    // lit from above: high in the tank bright, down by the sand dimmer
    float light = 0.62 + 0.5 * (f.p.y / H()), haze = 0.38 * (1.0 - f.depth) + 0.12 * (1.0 - f.p.y / H());
    // the body points along its nose: its tilt goes with the way the nose points,
    // which in a turn swings round with the head, easing through level, so the
    // tilt never snaps when the turn ends (tilting by the old way round, as the
    // three.js tank did, had a climbing fish nose down for the turn's second half)
    float facing = f.turnT < 1.0 ? f.from * cos(3.14159 * f.turnT) : f.dir;
    float rot = f.pitch * facing;
    vec2 scale = vec2(f.len * sx, f.len * aspectOf(f.kind));
    float lod = log2(max(360.0 / f.len, 1.0));
    ampU = f.amp; bulgeU = f.bulge;
    drawStrip(col, toLocal(px, f.p, rot, scale), f.kind, false, 1.0 - f.swap, light, haze, tint, px, lod);
    // the balloon, once it has taken over, swelling a little more to the full puff
    if (f.kind == PUFFER && f.swap > 0.0) drawBlownUp(col, f, px, rot, light, haze, tint, lod, true, f.swap, 0.35 * smoothstep(0.5, 1.0, f.puff));
}

// ---- the crab in its parts: body, and two claws that swing up from the shoulder,
// each with a movable finger
mat3 place2(vec2 p, float r, vec2 s) { float c = cos(r), sn = sin(r); return mat3(c * s.x, sn * s.x, 0.0, -sn * s.y, c * s.y, 0.0, p.x, p.y, 1.0); }
vec2 unplace(mat3 m, vec2 px) { vec3 q = inverse(m) * vec3(px, 1.0); return q.xy + 0.5; }
void drawCrab(inout vec3 col, vec2 px, vec3 tint) {
    Crab c = crabNow();
    float w = CRAB_W;
    if (abs(px.x - c.drawn.x) > w * 1.2 || px.y > c.drawn.y + w * 0.9 || px.y < crabY() - 20.0) return;
    // a soft shadow on the sand under it, smaller as it hops
    float lift = c.drawn.y - (crabY() + w * 0.175);
    vec2 su = (px - vec2(c.drawn.x, crabY() + 3.0)) / vec2(w * (1.05 - lift * 0.02), w * 0.16);
    float sd = length(su * 2.0);
    over(col, vec3(0.0, 0.02, 0.06), (0.45 - lift * 0.03) * smoothstep(1.0, 0.2, sd));
    mat3 G = mat3(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, c.drawn.x, c.drawn.y, 1.0) * mat3(cos(c.drawn.w), sin(c.drawn.w), 0.0, -sin(c.drawn.w), cos(c.drawn.w), 0.0, 0.0, 0.0, 1.0) * mat3(c.drawn.z, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
    vec2 S = vec2(w, w * 0.35);
    float light = 0.62;
    vec2 uv = unplace(G * place2(vec2(0.0), 0.0, S), px);
    if (inside(uv)) floorThing(col, texture(crabBody, uv), light, tint, px);
    float shoulderX = (152.0 - 240.0) / 480.0 * w, shoulderY = (84.0 - 104.0) / 480.0 * w;
    mat3 joints[2]; vec2 rests[2];
    for (int k = 0; k < 2; k++) {
        float side = k == 0 ? -1.0 : 1.0, raise = c.claws[k];
        vec2 rest = vec2(side < 0.0 ? shoulderX : -shoulderX, shoulderY);
        rests[k] = rest;
        joints[k] = G * place2(rest + vec2(side * w * 0.1 * raise, w * 0.2 * raise), -side * 2.5 * raise, vec2(1.0));
        uv = unplace(joints[k] * place2(vec2(-rest.x, -shoulderY), 0.0, S), px);
        if (inside(uv)) floorThing(col, k == 0 ? texture(clawLeft, uv) : texture(clawRight, uv), light, tint, px);
    }
    for (int k = 0; k < 2; k++) {
        float side = k == 0 ? -1.0 : 1.0;
        float hx = (side < 0.0 ? 184.0 - 240.0 : 240.0 - 184.0) / 480.0 * w, hy = (84.0 - 128.0) / 480.0 * w;
        mat3 hinge = joints[k] * place2(vec2(hx - rests[k].x, hy - shoulderY), -side * 0.44 * c.claws[k + 2], vec2(1.0));
        uv = unplace(hinge * place2(vec2(-hx, -hy), 0.0, S), px);
        if (inside(uv)) floorThing(col, k == 0 ? texture(fingerLeft, uv) : texture(fingerRight, uv), light, tint, px);
    }
}

// ---- the anemone: its tentacles sway in slow waves, more toward the tips, and
// draw in (shorter, tighter) when something comes close
void drawAnemone(inout vec3 col, vec2 px, vec3 tint, Music m) {
    float w = 128.0, h = w * 0.876;
    vec2 centre = vec2(W() * 0.28, H() * 0.05 + w * 0.438);
    vec2 q = (px - centre) / vec2(w, h);
    if (abs(q.x) > 0.8 || abs(q.y) > 0.6) return;
    vec4 a = meta(M_ANEMONE);
    float draw = a.x, t = iTime;
    float sway = grooving(m) ? exp(-(t - m.lastBeat) * 4.0) : 0.0, wave = a.y * clampedEnergy();
    float v = (q.y + 0.5) / (1.0 - 0.3 * draw);
    if (v < 0.0 || v > 1.0) return;
    float up = v * v, keep = 1.0 - 0.7 * draw;
    float A = up * (0.05 + 0.04 * sway) * sin(t * 1.3 + v * 3.0) * keep, B = up * 0.025 * keep, C = up * 0.11 * wave * keep;
    float g = q.x / (1.0 - 0.25 * draw * v) - C, x1 = g;
    for (int k = 0; k < 6; k++) x1 = g - B * sin(t * 2.1 + x1 * 9.0);
    vec2 uv = vec2(x1 - A + 0.5, v);
    if (inside(uv)) floorThing(col, texture(anemoneTex, uv), 0.66, tint, px);
}

vec3 drawPicture(vec2 px) {
    vec2 uv = px / iResolution.xy;
    float t = iTime;
    vec4 L = meta(M_LIGHT);
    vec3 tint = L.rgb;
    Music m = musicNow();
    dT = t; dAmount = meta(M_DISCO).x;
    dPulse = t - m.lastBeat < 1.5 ? exp(-(t - m.lastBeat) * 4.0) : 0.3;
    dHue = floor(m.beats / 8.0) * 0.25;
    // the reef photograph: the surface in the top quarter moves, and bright
    // caustics wander low down on the sand and coral
    vec2 ru = uv;
    float top = smoothstep(0.72, 0.95, ru.y);
    ru.x += top * 0.006 * sin(ru.y * 70.0 + t * 1.3) + top * 0.004 * sin(ru.x * 23.0 - t * 0.9);
    ru.y += top * 0.004 * sin(ru.x * 31.0 + t * 1.1);
    vec3 col = texture(reef, ru).rgb;
    float low = 1.0 - smoothstep(0.35, 0.7, uv.y);
    col += caustic(uv, t) * low * (0.10 + 0.25 * dot(col, vec3(0.3, 0.55, 0.15))) * vec3(0.8, 0.95, 1.0);
    col *= tint;
    if (anemone) drawAnemone(col, px, tint, m);
    if (crab) drawCrab(col, px, tint);
    int n = fishCount();
    for (int r = 0; r < MAX_FISH; r++) {
        if (r >= n) break;
        int i = int(tankAt(r, ROW_ORDER).x);
        if (i >= 0) drawFish(col, i, px, tint);
    }
    // the food: flakes spinning and tilting edge-on as they flutter
    for (int k = 0; k < MAX_FOOD; k++) {
        Flake p = flakeAt(k);
        if (p.state == 0.0) continue;
        vec2 d = px - p.p;
        if (abs(d.x) > p.s || abs(d.y) > p.s) continue;
        vec2 q = vec2(d.x, -d.y) / p.s;
        float c = cos(p.rot), s = sin(p.rot), tilt = cos(t * p.flutter + p.spin);
        q = mat2(c, -s, s, c) * q;
        q.x /= max(abs(tilt), 0.15);
        if (abs(q.x) > 0.5 || abs(q.y) > 0.5) continue;
        vec2 cell = vec2(mod(p.kind, 2.0), floor(p.kind / 2.0)) * 0.5;
        vec4 f = texture(food, cell + vec2(q.x + 0.5, 0.5 - q.y) * 0.5);
        if (f.a < 0.1) continue;
        over(col, f.rgb * (0.6 + 0.5 * clamp(p.p.y / H(), 0.0, 1.0)) * tint * (0.7 + 0.3 * abs(tilt)), f.a);
    }
    // bubbles drifting up from the reef, their light added
    if (bubbles) for (int k = 0; k < MAX_BUBBLES; k++) {
        vec4 a = tankAt(k, ROW_BUBBLE);
        if (tankAt(k, ROW_BUBBLE + 1).z < 0.5) continue;
        vec2 d = (px - a.xy) / a.w;
        if (abs(d.x) > 0.5 || abs(d.y) > 0.5) continue;
        col += texture(bubble, d + 0.5).rgb * 1.15 * tint;
    }
    // light rays from the surface, swaying slowly
    float rays = 0.0;
    for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float cx = 0.12 + fi * 0.16 + 0.03 * sin(t * 0.21 + fi * 1.7) + (1.0 - uv.y) * (0.08 * sin(fi * 2.3));
        float wdt = 0.018 + 0.012 * sin(fi * 3.1 + 1.0) + (1.0 - uv.y) * 0.03;
        rays += exp(-pow((uv.x - cx) / wdt, 2.0)) * (0.55 + 0.45 * sin(t * 0.37 + fi * 2.1));
    }
    col += vec3(0.75, 0.92, 1.0) * rays * smoothstep(0.1, 0.95, uv.y) * 0.06 * L.w;
    // the disco: coloured spots, the beams' haze, sparkles landing on rock, coral
    // and sand, and the light above the water they come from
    if (dAmount > 0.01) {
        vec4 b = discoBeams(px);
        vec2 o = 3.0 / iResolution.xy, rr = 9.0 / iResolution.xy;
        float detail = 0.0;
        for (int k = 0; k < 9; k++) {
            vec2 at = k == 8 ? uv : uv + vec2(cos(float(k) * 0.785), sin(float(k) * 0.785)) * rr;
            vec3 c0 = texture(reef, at).rgb;
            vec3 nb = (texture(reef, at + vec2(o.x, 0.0)).rgb + texture(reef, at - vec2(o.x, 0.0)).rgb + texture(reef, at + vec2(0.0, o.y)).rgb + texture(reef, at - vec2(0.0, o.y)).rgb) * 0.25;
            detail = max(detail, length(c0 - nb));
        }
        float solid = max(smoothstep(0.02, 0.06, detail), smoothstep(0.45, 0.65, dot(texture(reef, uv).rgb, vec3(0.3, 0.55, 0.15))));
        vec2 src = vec2(iResolution.x * 0.5, iResolution.y * 1.06), q = (px - src) / iResolution.y;
        float ripple = 0.75 + 0.25 * sin(px.x * 0.045 + t * 1.7) * sin(px.x * 0.021 - t * 1.1 + px.y * 0.03);
        float glow = exp(-dot(q * vec2(0.9, 1.6), q * vec2(0.9, 1.6)) * 7.0) * ripple;
        float ang2 = atan(q.x, -q.y);
        float fan = pow(max(0.0, sin(ang2 * 11.0 + t * 0.35)), 6.0) * exp(-length(q) * 2.6) * smoothstep(0.02, 0.2, length(q));
        vec3 above = mix(vec3(0.9, 0.9, 1.0), discoPalette(dHue + 0.12), 0.35) * (glow * 0.55 + fan * 0.28) * dAmount * (0.7 + 0.45 * dPulse);
        col += min(b.rgb * (0.2 + 0.22 * b.a), vec3(0.45)) + discoPools(px) * 0.5 + discoSparkle(px) * solid + above;
    }
    return col + (hash(px) + hash(px.yx + 71.3) - 1.0) / 255.0;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    ivec2 px = ivec2(fragCoord);
    if (PASSINDEX == PASS_MUSIC) fragColor = px.y == 0 ? drawMusic(px.x) : tankAt(px.x, px.y);
    else if (PASSINDEX == PASS_PLACES) fragColor = drawPlaces(px);
    else if (PASSINDEX == PASS_STEP) fragColor = drawStep(px);
    else if (PASSINDEX == PASS_AFTER) fragColor = drawAfter(px);
    else fragColor = vec4(clamp(drawPicture(fragCoord), 0.0, 1.0), 1.0);
}
