/*{
  "DESCRIPTION": "Weather: Sky's sea of clouds in the weather you choose, or the live weather in your city, lit for the time of day, with rain, snow, fog, lightning, and at night the stars and the moon in its real phase. A key press does something in the weather there: a cloud puffs up, raindrops splash on the glass, snow gusts out, the fog parts, lightning strikes, or at night a shooting star falls. Weather data by Open-Meteo.com (CC BY 4.0). Clouds after Vanta's (MIT, Teng Bao) and Inigo Quilez's; the moon photographed by NASA's Goddard Space Flight Center.",
  "INPUTS": [
    { "NAME": "place", "TYPE": "place", "LABEL": "City" },
    { "NAME": "weather", "TYPE": "long", "LABEL": "Weather", "DEFAULT": 0, "VALUES": [-1, 0, 1, 2, 3, 6, 4, 7, 5], "LABELS": ["Automatic", "Clear", "Cloudy", "Rain", "Thunderstorm", "Lightning", "Snow", "Blizzard", "Fog"] },
    { "NAME": "time", "TYPE": "long", "LABEL": "Time of day", "DEFAULT": -1, "VALUES": [-1, 0, 1, 2, 3], "LABELS": ["Automatic", "Morning", "Afternoon", "Sunset", "Night"] },
    { "NAME": "speed", "TYPE": "float", "LABEL": "Wind", "DEFAULT": 0.8, "MIN": 0.2, "MAX": 3 }
  ],
  "IMPORTED": { "moon": { "PATH": "ectodeck-asset:weather/moon.webp" } },
  "PASSES": [
    { "TARGET": "state", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/80", "HEIGHT": "$HEIGHT/80" },
    { "TARGET": "clouds", "FLOAT": true, "WIDTH": "$WIDTH/3", "HEIGHT": "$HEIGHT/3" },
    {}
  ]
}*/

// Ectodeck's built-in Weather, drawn by the deck's own renderer. It is the
// Weather page moved off the browser, the same picture and the same logic:
//
//  1. state: a few pixels that remember, from frame to frame, what is shown,
//     what it is changing from and since when (each change eases in over
//     three seconds), and the clouds' clock; and work out where the sun and
//     moon are and where the camera looks.
//  2. clouds: Sky's sea of clouds (Vanta's clouds, after Inigo Quilez's),
//     taught a gradient sky, a sun of its own, air that can be clear, and a
//     view from under the cloud; drawn at a third of the size, which keeps
//     them soft. Between two views both are drawn, one dissolving into the other.
//  3. the picture: the clouds scaled up smoothly, and the weather drawn over
//     them at full size: the sun and moon, stars, rain, snow, fog, lightning
//     and what a key press does.

#define PI 3.14159265
#define RAD 0.0174532925

// ---- the state's layout: each value a float, four to a pixel
// the colours, three floats each
const int SKY_TOP = 0, SKY = 3, HORIZON = 6, GLOW = 9, CLOUD = 12, SHADOW = 15, SUN = 18, GLARE = 21, SUNLIGHT = 24;
// and the numbers
const int SUN_HEIGHT = 27, CLEARING = 28, LOOK_AT = 29, FLIP = 30, LIFT = 31, STRETCH = 32, SWING = 33, PACE = 34;
const int A_CLEAR = 35, A_CLOUDY = 36, A_RAIN = 37, A_SNOW = 38, A_BLIZZARD = 39, A_STORM = 40, A_FOG = 41, NIGHT = 42, DUSK = 43;
const int SUN_X = 44, SUN_Y = 45, MOON_X = 46, MOON_Y = 47, MOON_UP = 48;
const int VALUES = 52;
// pixels: what is shown, what it is changing from, and the rest
const int SHOWN = 0, FROM = 13, META = 26, CLOCK = 27, PINNED = 28, LIGHT = 29;

vec4 stateAt(int i) {
    ivec2 size = textureSize(state, 0);
    return texelFetch(state, ivec2(i % size.x, i / size.x), 0);
}
float stored(int i) { return stateAt(i / 4)[i % 4]; }

// ---- the weather now: the one chosen, or on Automatic the city's, from
// Open-Meteo's weather code (snow in a wind of 56 km/h, 35 mph, is a
// blizzard, as the US National Weather Service counts one); clear before
// the first report
int fromCode(float code, float wind) {
    int c = int(code);
    if (c >= 95) return 3;
    if ((c >= 71 && c <= 77) || c == 85 || c == 86) return wind >= 56.0 ? 7 : 4;
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 2;
    if (c == 45 || c == 48) return 5;
    if (c == 2 || c == 3) return 1;
    return 0;
}
int chosenWeather() {
    if (weather < 0) return iWeather.x < 0.0 ? 0 : fromCode(iWeather.x, iWeather.y);
    return ((weather % 8) + 8) % 8;
}

// ---- days since noon on 1 January 2000 (UTC), kept as a whole number of
// days and a fraction, so the sums stay exact in single floats
int dayNumber(int y, int m, int d) {
    int a = (14 - m) / 12, yy = y + 4800 - a, mm = m + 12 * a - 3;
    return d + (153 * mm + 2) / 5 + 365 * yy + yy / 4 - yy / 100 + yy / 400 - 32045;
}
void daysNow(out float whole, out float part) {
    whole = float(dayNumber(int(iDate.x), int(iDate.y) + 1, int(iDate.z)) - 2451545);
    part = -0.5 + (iDate.w - iTimezone) / 86400.0;
}
// where the deck is: the chosen city, or a guess from the time zone
vec2 here() {
    if (iPlace.w > 0.5 || iPlace.x != 0.0 || iPlace.y != 0.0) return iPlace.xy;
    return vec2(35.0, iTimezone / 240.0);
}

// Where the sun is in the sky: the standard sun position (the formula NOAA's
// calculator uses), and the moon along the same path, as far round from the
// sun as its phase. Seen facing the equator, the whole path, horizon to
// horizon, is spread across the width, and the height above the horizon up
// the screen, with the horizon at the bottom edge.
vec3 skyPlace(float whole, float part, float lat, float lon, float turn) {
    float g = (mod(357.529 + 0.98560028 * whole, 360.0) + 0.98560028 * part) * RAD;
    float q = mod(280.459 + 0.98564736 * whole, 360.0) + 0.98564736 * part;
    float L = (q + 1.915 * sin(g) + 0.020 * sin(2.0 * g) + turn * 360.0) * RAD;
    float e = (23.439 - 0.00000036 * (whole + part)) * RAD;
    float ra = atan(cos(e) * sin(L), cos(L)), dec = asin(sin(e) * sin(L));
    float hours = 18.697374558 + mod(0.06570982441908 * whole, 24.0) + 24.06570982441908 * part;
    float lst = mod(hours, 24.0) * 15.0 + lon;
    float ha = lst * RAD - ra, la = lat * RAD;
    float el = asin(sin(la) * sin(dec) + cos(la) * cos(dec) * cos(ha));
    float az = atan(-sin(ha), tan(dec) * cos(la) - sin(la) * cos(ha)) / RAD;
    float fromFront = mod((lat >= 0.0 ? az - 180.0 : az) + 540.0, 360.0) - 180.0;
    return vec3(0.5 + 0.45 * clamp(fromFront / 115.0, -1.0, 1.0), min(0.82, el / RAD / 62.0), el > 0.0 ? 1.0 : 0.0);
}
// the moon's phase today, 0 new to 0.5 full to 1 new again
float moonPhase() {
    float whole, part;
    daysNow(whole, part);
    return fract((whole - 5.2597) / 29.530588853 + part / 29.530588853);
}

// morning, afternoon, sunset or night, by the sun: the city's real sunrise
// and sunset once the weather report has brought them, an estimate until then
int clockTime() {
    if (iWeather.x >= 0.0) {
        float now = mod(iDate.w - iTimezone + iPlace.z, 86400.0), rise = iWeather.z, set = iWeather.w, noon = (rise + set) * 0.5;
        if (now < rise - 1800.0 || now >= set + 2700.0) return 3;
        if (now < noon - 3600.0) return 0;
        if (now >= set - 4500.0) return 2;
        return 1;
    }
    vec2 at = here();
    int y = int(iDate.x);
    float day = float(dayNumber(y, int(iDate.y) + 1, int(iDate.z)) - dayNumber(y, 1, 0));
    float lat = at.x * RAD, decl = -23.44 * RAD * cos(2.0 * PI / 365.0 * (day + 10.0));
    float cosH = (sin(-0.833 * RAD) - sin(lat) * sin(decl)) / (cos(lat) * cos(decl));
    float half_ = acos(clamp(cosH, -1.0, 1.0)) * 12.0 / PI;
    float noon = 12.0 + iTimezone / 3600.0 - at.y / 15.0, now = iDate.w / 3600.0;
    if (now < noon - half_ - 0.5 || now >= noon + half_ + 0.75) return 3;
    if (now < noon - 1.0) return 0;
    if (now >= noon + half_ - 1.25) return 2;
    return 1;
}
int chosenTime() { return time < 0 ? clockTime() : time % 4; }

// the sun and moon for the moment the sky shows: now, on Automatic; otherwise
// today at a time that stands for it, in the place's own time (morning at
// nine, afternoon at twenty to four, the sunset as the sun meets the
// horizon, night at half past ten)
void skyPositions(int T, out vec3 sun, out vec3 moon) {
    vec2 at = here();
    float whole, part;
    daysNow(whole, part);
    if (time >= 0) {
        float midnight = floor(part + 0.5 + at.y / 360.0) - 0.5 - at.y / 360.0;
        float h = T == 0 ? 9.0 : T == 1 ? 15.0 + 40.0 / 60.0 : T == 3 ? 22.5 : 19.0;
        if (T == 2) {
            for (int i = 0; i < 240; i++) {
                float hh = 14.0 + float(i) / 30.0;
                if (skyPlace(whole, midnight + hh / 24.0, at.x, at.y, 0.0).y < 0.035) { h = hh; break; }
            }
        }
        part = midnight + h / 24.0;
    }
    sun = skyPlace(whole, part, at.x, at.y, 0.0);
    moon = skyPlace(whole, part, at.x, at.y, moonPhase());
}

// ---- the look of each weather at each time of day: its colours are the
// time's, greyed, darkened and cooled
vec3 hex(int h) { return vec3(float((h >> 16) & 255), float((h >> 8) & 255), float(h & 255)) / 255.0; }

void goals(out float g[VALUES]) {
    int W = chosenWeather(), T = chosenTime();
    vec3 c[9];
    float sunHeight;
    // each time of day, as Sky has it: the sky overhead, its colour, the
    // horizon, the glow round the sun, the clouds, their shadows, the sun,
    // its glare and its light
    if (T == 0) { c[0] = hex(0x3d7fd6); c[1] = hex(0x8fc4ee); c[2] = hex(0xdce9f5); c[3] = hex(0x9a8468); c[4] = hex(0xc6d8ee); c[5] = hex(0x5a7394); c[6] = hex(0xfff1d6); c[7] = hex(0xb08a66); c[8] = hex(0xffe8c0); sunHeight = 0.35; }
    else if (T == 1) { c[0] = hex(0x2463c8); c[1] = hex(0x5fa8e6); c[2] = hex(0xc4e2f6); c[3] = hex(0xfff0d0); c[4] = hex(0xadc1de); c[5] = hex(0x183550); c[6] = hex(0xfffaf0); c[7] = hex(0xffd9a0); c[8] = hex(0xffe7c0); sunHeight = 0.75; }
    else if (T == 2) { c[0] = hex(0x1d2a5e); c[1] = hex(0x8c5a92); c[2] = hex(0xff9148); c[3] = hex(0xb8703a); c[4] = hex(0xf0a888); c[5] = hex(0x3b2c5e); c[6] = hex(0xffe8a8); c[7] = hex(0xff7a3a); c[8] = hex(0xff9a58); sunHeight = 0.03; }
    else { c[0] = hex(0x0c1230); c[1] = hex(0x18204a); c[2] = hex(0x2a3566); c[3] = vec3(0.0); c[4] = hex(0x3a4a6a); c[5] = hex(0x05080f); c[6] = vec3(0.0); c[7] = vec3(0.0); c[8] = hex(0x9ab0e0); sunHeight = 0.5; }
    // for each weather: toward what grey, how far, and how dark
    vec3 to = vec3(0.0); float grey = 0.0, dark = 0.0;
    if (W == 1) { to = hex(0x9aa4b0); grey = 0.35; dark = 0.08; }
    else if (W == 2) { to = hex(0x5c6670); grey = 0.6; dark = 0.3; }
    else if (W == 3 || W == 6) { to = hex(0x2a2f3c); grey = 0.72; dark = 0.55; }
    else if (W == 4 || W == 7) { to = hex(0xc4ccd8); grey = 0.55; dark = 0.05; }
    else if (W == 5) { to = hex(0xb8bec6); grey = 0.7; dark = 0.1; }
    for (int k = 0; k < 9; k++) {
        vec3 x = grey > 0.0 ? mix(c[k], to, (k == 6 || k == 7) ? grey * 0.8 : grey) : c[k];
        c[k] = mix(x, vec3(0.0), dark * (T == 3 ? 0.4 : 1.0));
    }
    // snow whitens the clouds and their light; rain and storms grey them
    for (int k = 4; k < 9; k++) {
        if (k == 5) continue;
        if (W == 4 || W == 7) c[k] = mix(mix(c[k], hex(0xcbd3de), 0.6), vec3(0.0), 0.14);
        else if (W == 2 || W == 3 || W == 6) c[k] = mix(mix(c[k], hex(0x8a929c), 0.4), vec3(0.0), 0.35);
    }
    for (int k = 0; k < 9; k++) {
        // a snowy sunset is dusk, about half as far down as night and duskier
        if ((W == 4 || W == 7) && T == 2) c[k] = mix(mix(c[k], hex(0x3a2c48), 0.3), vec3(0.0), 0.2);
        // a snowy night is still night: the whitened colours taken most of the way down
        if ((W == 4 || W == 7) && T == 3) c[k] = mix(mix(c[k], hex(0x1a2238), 0.5), vec3(0.0), 0.35);
        if ((W == 3 || W == 6) && T == 3) c[k] = mix(mix(c[k], hex(0x1c2840), 0.5), vec3(0.0), 0.12);
    }
    // a clear sunset keeps the horizon in view, for the sun to set on
    if (W == 0 && T == 2) { sunHeight = 0.045; c[2] = hex(0xffa644); c[1] = hex(0xe8683a); c[0] = hex(0x4a3868); c[3] = hex(0x8a4418); }
    // a clear morning's sun is up in the sky, not on the edge of the view
    if (W == 0 && T == 0) sunHeight = 0.6;
    // a clear day's sun and its halo are drawn over the clouds; Sky's own
    // glow lies in a band along the horizon and would stretch it sideways
    if (W == 0 && T < 2) c[3] = vec3(0.0);
    for (int k = 0; k < 9; k++) { g[k * 3] = c[k].r; g[k * 3 + 1] = c[k].g; g[k * 3 + 2] = c[k].b; }
    g[SUN_HEIGHT] = sunHeight;
    // Clear looks up into open sky; Cloudy looks down on the sea of cloud;
    // rain, snow and storms are seen from under their clouds, all from the
    // same place there, so changing between them only reshapes and recolours
    // the cloud; fog is inside the cloud
    float clearing = 0.0, lookAt = -1.0, flip = -1.0, lift = 0.9, stretch = 1.0, swing = 1.0;
    if (W == 0) { clearing = 5.0; lookAt = 3.35; flip = 1.0; lift = 0.0; swing = 0.0; }
    else if (W == 1) { flip = 1.0; lift = 0.0; }
    else if (W == 2) clearing = -0.3;
    else if (W == 3 || W == 6) { clearing = -0.4; stretch = 0.68; }
    else if (W == 4) clearing = -0.2;
    else if (W == 5) { clearing = -1.2; flip = 1.0; lift = 0.0; }
    else clearing = -0.5;
    g[CLEARING] = clearing; g[LOOK_AT] = lookAt; g[FLIP] = flip; g[LIFT] = lift; g[STRETCH] = stretch; g[SWING] = swing;
    // how fast the clouds go (felt squared, as Sky's clock runs at it); seen
    // from under the cloud they are nearer, so they go slower
    float pace[8] = float[8](1.0, 1.0, 0.62, 0.55, 0.6, 1.0, 0.55, 1.25);
    g[PACE] = speed * pace[W];
    // how much of each thing is in the air
    g[A_CLEAR] = W == 0 ? 1.0 : 0.0; g[A_CLOUDY] = W == 1 ? 1.0 : 0.0; g[A_RAIN] = W == 2 ? 1.0 : W == 3 ? 1.3 : 0.0;
    g[A_SNOW] = W == 4 ? 1.0 : 0.0; g[A_BLIZZARD] = W == 7 ? 1.0 : 0.0; g[A_STORM] = (W == 3 || W == 6) ? 1.0 : 0.0; g[A_FOG] = W == 5 ? 1.0 : 0.0;
    g[NIGHT] = T == 3 ? 1.0 : 0.0; g[DUSK] = T == 2 ? 1.0 : 0.0;
    vec3 sun, moon;
    skyPositions(T, sun, moon);
    g[SUN_X] = sun.x; g[SUN_Y] = sun.y; g[MOON_X] = moon.x; g[MOON_Y] = moon.y; g[MOON_UP] = moon.z;
    g[49] = 0.0; g[50] = 0.0; g[51] = 0.0;
}

// ---- Sky's camera, from its own sums: it looks from a point on a circle
// round the cloud, swinging slowly side to side (unless swing is 0), toward
// a height of lookAt; lift raises it
struct Camera { vec3 ro, side, up, w; };
Camera skyCamera(float lookAt, float lift, float swing, float clock) {
    float my = 0.5 * 0.33 + 0.28;
    float mx = 0.5 * 0.25 + mix(0.137, sin(clock * 0.1 + 3.1415) * 0.25 + 0.25, swing);
    vec3 ro = 4.0 * normalize(vec3(sin(3.0 * mx), 0.4 * my, cos(3.0 * mx)));
    ro.y += lift;
    vec3 w = normalize(vec3(0.0, lookAt, 0.0) - ro);
    vec3 side = normalize(cross(w, vec3(0.0, 1.0, 0.0)));
    return Camera(ro, side, normalize(cross(side, w)), w);
}
// the direction in the sky of a place on a clear sky's screen
vec3 skyDirection(vec2 at) {
    Camera a = skyCamera(3.35, 0.0, 0.0, 0.0);
    float aspect = iResolution.x / iResolution.y;
    return normalize(((2.0 * at.x - 1.0) * aspect) * a.side + (2.0 * at.y - 1.0) * a.up + 1.5 * a.w);
}
// The sun and moon are placed on the screen of a clear sky; as the camera
// tilts down onto the cloud tops they are kept where they are in the sky
vec2 pinned(vec2 at, float lookAt, float lift, float swing, float flip, float clock) {
    if (flip < 0.0 || (abs(lookAt - 3.35) < 1e-4 && abs(lift) < 1e-4 && abs(swing) < 1e-4)) return at;
    Camera b = skyCamera(lookAt, lift, swing, clock);
    vec3 d = skyDirection(at);
    float z = dot(d, b.w), aspect = iResolution.x / iResolution.y;
    if (z <= 0.01) return vec2(at.x, 9.0);
    return vec2((1.5 * dot(d, b.side) / z / aspect + 1.0) * 0.5, (1.5 * dot(d, b.up) / z + 1.0) * 0.5);
}

// ---- 1. the state
float ease(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
bool viewOf(int i) { return i >= CLEARING && i <= SWING; }

vec4 drawState(ivec2 px) {
    int id = px.x + px.y * int(RENDERSIZE.x);
    float g[VALUES];
    goals(g);
    int W = chosenWeather(), T = chosenTime();
    vec4 meta = stateAt(META), clockPx = stateAt(CLOCK);
    bool first = iFrame == 0;
    // a new weather or time of day: it eases in from what is shown now
    bool changed = first || int(meta.x) != W || int(meta.y) != T;
    float start = changed ? (first ? -10.0 : iTime) : meta.z;
    // clear and cloudy are one sky seen two ways, so the camera tilts between
    // them (the sun and moon pinned to the sky as it does); any other new view
    // is cross-faded in place, never flown to, and so is a new cloud shape
    float dissolving = meta.w;
    if (changed && !first) {
        int was = int(meta.x);
        bool builds = (was == 0 || was == 1) && (W == 0 || W == 1);
        bool moves = false;
        for (int i = LOOK_AT; i <= SWING; i++) if (abs(stored(SHOWN * 4 + i) - g[i]) > 1e-4) moves = true;
        if (abs(stored(SHOWN * 4 + STRETCH) - g[STRETCH]) > 1e-4) moves = true;
        dissolving = moves && !builds ? 1.0 : 0.0;
    }
    if (first) dissolving = 0.0;
    float raw = clamp((iTime - start) / 3.0, 0.0, 1.0), e = ease(raw);
    bool dissolveNow = dissolving > 0.5 && raw < 1.0;
    // every value: from what it was to where it is going
    float from[VALUES], shown[VALUES];
    for (int i = 0; i < VALUES; i++) {
        from[i] = first ? g[i] : changed ? stored(SHOWN * 4 + i) : stored(FROM * 4 + i);
        shown[i] = viewOf(i) && dissolveNow ? g[i] : mix(from[i], g[i], e);
    }
    if (id < FROM) {
        int b = id * 4;
        return vec4(shown[b], shown[b + 1], shown[b + 2], shown[b + 3]);
    }
    if (id < META) {
        int b = (id - FROM) * 4;
        return vec4(from[b], from[b + 1], from[b + 2], from[b + 3]);
    }
    if (id == META) return vec4(float(W), float(T), start, dissolving);
    // Sky's clock: the clouds' pace (squared, as Sky's own clock ran at the
    // pace and moved the clouds by it again) added up over time, so changing
    // the pace never moves a cloud
    float clock = (first ? 0.0 : clockPx.x) + shown[PACE] * shown[PACE] * iTimeDelta;
    if (id == CLOCK) return vec4(clock, dissolveNow ? 1.0 : 0.0, e, 0.0);
    if (id == PINNED) {
        vec2 s = pinned(vec2(shown[SUN_X], shown[SUN_Y]), shown[LOOK_AT], shown[LIFT], shown[SWING], shown[FLIP], clock);
        vec2 m = pinned(vec2(shown[MOON_X], shown[MOON_Y]), shown[LOOK_AT], shown[LIFT], shown[SWING], shown[FLIP], clock);
        return vec4(s, m);
    }
    if (id == LIGHT) {
        // Sky's sun is where the sun (at night the moon) drawn in the sky is, so
        // there is one sun whichever way the camera looks, and it lights the clouds
        vec3 light = mix(skyDirection(vec2(shown[SUN_X], shown[SUN_Y])), skyDirection(vec2(shown[MOON_X], shown[MOON_Y])), shown[NIGHT]);
        light.y = max(light.y, 0.03);
        return vec4(normalize(light), 0.0);
    }
    // the view it is changing from, for a dissolve
    if (id == LIGHT + 1) return vec4(from[CLEARING], from[LOOK_AT], from[FLIP], from[LIFT]);
    if (id == LIGHT + 2) return vec4(from[STRETCH], from[SWING], 0.0, 0.0);
    return vec4(0.0);
}

// ---- 2. Sky's clouds
vec3 sundir;
float clearing, flip, stretch;
vec3 skyTopColor, skyColor, skyHorizonColor, skyGlowColor, cloudColor, cloudShadowColor, sunColor, sunGlareColor, sunlightColor;
float cloudClock;

float hash1(float p) { p = fract(p * 0.011); p *= (p + 7.5); p *= (p + p); return fract(p); }
float noise3(vec3 x) {
    vec3 p = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n = p.x + p.y * 57.0 + 113.0 * p.z;
    return mix(mix(mix(hash1(n + 0.0), hash1(n + 1.0), f.x), mix(hash1(n + 57.0), hash1(n + 58.0), f.x), f.y),
               mix(mix(hash1(n + 113.0), hash1(n + 114.0), f.x), mix(hash1(n + 170.0), hash1(n + 171.0), f.x), f.y), f.z);
}
const float constantTime = 1000.0;
float mapCloud(vec3 p, int octaves) {
    vec3 speed1 = vec3(0.5, 0.01, 1.0) * 0.5;
    vec3 q = p * vec3(stretch, 1.0, stretch) - speed1 * (cloudClock + constantTime);
    float f = 0.5 * noise3(q); q = q * 2.02;
    f += 0.25 * noise3(q); q = q * 2.03;
    if (octaves > 2) { f += 0.125 * noise3(q); q = q * 2.01; }
    if (octaves > 3) { f += 0.0625 * noise3(q); q = q * 2.02; }
    if (octaves > 4) f += 0.03125 * noise3(q);
    return clamp(1.5 - p.y - 2.0 + 1.75 * f - clearing, 0.0, 1.0);
}
vec4 integrate(vec4 sum, float dif, float den, vec3 bgcol, float t) {
    vec3 lin = cloudColor * 1.4 + sunlightColor * dif;
    vec4 col = vec4(mix(mix(vec3(1.0, 0.95, 0.8), vec3(0.86, 0.9, 0.98), step(flip, 0.0)), cloudShadowColor, den), den);
    col.xyz *= lin;
    col.xyz = mix(col.xyz, bgcol, 1.0 - exp(-0.003 * t * t));
    col.a *= 0.4;
    col.rgb *= col.a;
    return sum + col * (1.0 - sum.a);
}
vec4 raymarch(vec3 ro, vec3 rd, vec3 bgcol) {
    vec4 sum = vec4(0.0);
    float t = 0.0;
    // four stretches, the nearer drawn in more detail
    for (int s = 0; s < 4; s++) {
        int steps = s == 0 ? 20 : s == 1 ? 25 : s == 2 ? 30 : 40, octaves = 5 - s;
        for (int i = 0; i < 40; i++) {
            if (i >= steps) break;
            vec3 pos = ro + t * rd;
            if (pos.y < -3.0 || pos.y > 2.0 || sum.a > 0.99) break;
            float den = mapCloud(pos, octaves);
            if (den > 0.01) {
                float dif = clamp((den - mapCloud(pos + 0.3 * sundir, octaves)) / 0.6, 0.0, 1.0);
                sum = integrate(sum, dif, den, bgcol, t);
            }
            t += max(0.075, 0.02 * t);
        }
    }
    return clamp(sum, 0.0, 1.0);
}
vec3 skyRender(vec3 ro, vec3 rd) {
    float sun = clamp(dot(sundir, rd), 0.0, 1.0);
    float up = rd.y * flip;
    vec3 col = mix(skyHorizonColor, skyColor, smoothstep(-0.03, 0.22, up));
    col = mix(col, skyTopColor, smoothstep(0.2, 0.75, up));
    col = mix(col, skyHorizonColor * 0.6 + skyTopColor * 0.25, smoothstep(0.0, -0.45, up));
    col += skyGlowColor * (0.3 * pow(sun, 16.0) + 0.14 * pow(sun, 4.0)) * (1.0 - smoothstep(0.0, 0.35, abs(up - sundir.y)));
    float ownSun = (1.0 - pow(clamp(clearing / 5.0, 0.0, 1.0), 3.0)) * step(0.0, flip);
    col += (0.3 * sunColor * pow(sun, 120.0) + 0.12 * sunGlareColor * pow(sun, 14.0)) * ownSun;
    vec4 res = raymarch(ro, rd, col);
    col = col * (1.0 - res.w) + res.xyz;
    col += (0.08 * sunGlareColor * pow(sun, 30.0) + (sunColor * 1.6 * smoothstep(0.99955, 0.9998, sun) + sunColor * 0.45 * pow(sun, 400.0)) * (1.0 - res.w)) * ownSun;
    return col;
}
vec3 skyView(vec2 frag, float clear_, float lookAt, float flip_, float lift, float stretch_, float swing) {
    clearing = clear_; flip = flip_; stretch = stretch_;
    vec2 p = (-RENDERSIZE + 2.0 * frag) / RENDERSIZE.y;
    p.y *= flip;
    Camera c = skyCamera(lookAt, lift, swing, cloudClock);
    vec3 rd = normalize(p.x * c.side + p.y * c.up + 1.5 * c.w);
    return skyRender(c.ro, rd);
}
vec3 shownColour(int i) { return vec3(stored(i), stored(i + 1), stored(i + 2)); }

vec4 drawClouds(vec2 frag) {
    skyTopColor = shownColour(SKY_TOP); skyColor = shownColour(SKY); skyHorizonColor = shownColour(HORIZON); skyGlowColor = shownColour(GLOW);
    cloudColor = shownColour(CLOUD); cloudShadowColor = shownColour(SHADOW); sunColor = shownColour(SUN); sunGlareColor = shownColour(GLARE); sunlightColor = shownColour(SUNLIGHT);
    sundir = stateAt(LIGHT).xyz;
    vec4 clockPx = stateAt(CLOCK);
    cloudClock = clockPx.x;
    vec3 now = skyView(frag, stored(CLEARING), stored(LOOK_AT), stored(FLIP), stored(LIFT), stored(STRETCH), stored(SWING));
    if (clockPx.y < 0.5) return vec4(now, 1.0);
    // a dissolve: the view it is changing from, fading away over the new one
    vec4 a = stateAt(LIGHT + 1), b = stateAt(LIGHT + 2);
    vec3 was = skyView(frag, a.x, a.y, a.z, a.w, b.x, b.y);
    return vec4(mix(was, now, clockPx.z), 1.0);
}

// ---- 3. the picture: the clouds scaled up, the weather over them
// the clouds scaled up with a cubic B-spline, sixteen reads, which leaves no grid
vec3 softClouds(vec2 frag) {
    vec2 size = vec2(textureSize(clouds, 0));
    vec2 st = frag / iResolution.xy * size - 0.5, i = floor(st), f = st - i;
    vec4 wx = vec4((1.0 - f.x) * (1.0 - f.x) * (1.0 - f.x), 4.0 - 6.0 * f.x * f.x + 3.0 * f.x * f.x * f.x, 0.0, f.x * f.x * f.x) / 6.0;
    wx.z = 1.0 - wx.x - wx.y - wx.w;
    vec4 wy = vec4((1.0 - f.y) * (1.0 - f.y) * (1.0 - f.y), 4.0 - 6.0 * f.y * f.y + 3.0 * f.y * f.y * f.y, 0.0, f.y * f.y * f.y) / 6.0;
    wy.z = 1.0 - wy.x - wy.y - wy.w;
    ivec2 top = ivec2(size) - 1;
    vec3 c = vec3(0.0);
    for (int y = 0; y < 4; y++)
        for (int x = 0; x < 4; x++)
            c += texelFetch(clouds, clamp(ivec2(i) + ivec2(x - 1, y - 1), ivec2(0), top), 0).rgb * wx[x] * wy[y];
    return c;
}

// Dave Hoskins' hash: no sin() and no huge multiplier, so every graphics
// card gives a corner of the noise's grid one value
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
// lays a colour over what the layer holds so far, as much as a covers
void put(inout vec4 acc, vec3 c, float a) { acc = vec4(c * a, a) + acc * (1.0 - a); }

vec3 drawPicture(vec2 frag) {
    int W = int(stateAt(META).x);
    float night = stored(NIGHT), dusk = stored(DUSK);
    float aClear = stored(A_CLEAR), aCloudy = stored(A_CLOUDY), aRain = stored(A_RAIN), aSnow = stored(A_SNOW), aBlizzard = stored(A_BLIZZARD), aStorm = stored(A_STORM), aFog = stored(A_FOG);
    vec3 cloudLight = shownColour(CLOUD);
    vec4 pin = stateAt(PINNED);
    vec2 sunPos = pin.xy, moonPos = pin.zw;
    float moonUp = stored(MOON_UP), phase = moonPhase(), wind = speed, t = iTime;
    vec2 size = iResolution.xy;

    vec2 uv = frag / size; float aspect = size.x / size.y; vec2 p = vec2(uv.x * aspect, uv.y);
    vec3 add = vec3(0.0); vec4 acc = vec4(0.0);
    float dim = 1.0 - 0.7 * night;
    // a clear sky's sun, drawn sharp at full size where Sky's camera sees it;
    // it fades with the clear sky, faster than the cloud forms, so it is
    // never drawn over cloud
    float sunW = aClear * aClear * aClear * (1.0 - night);
    if (sunW > 0.003) {
        vec2 q = (uv * 2.0 - 1.0) * vec2(aspect, 1.0);
        float up = uv.y * 0.9;
        vec2 sp = (sunPos * 2.0 - 1.0) * vec2(aspect, 1.0);
        vec2 dv = q - sp; float d = length(dv), px = 2.0 / size.y;
        vec4 acc0 = acc; vec3 add0 = add;
        if (dusk < 0.999) {
            // by day: a big white-hot disc in a bright glow that fades wide into the sky
            float r = 0.24, k = 0.6;
            float disc = smoothstep(r + px * 2.0, r - px * 2.0, d);
            float halo = exp(-max(d - r, 0.0) * 17.0 * k) * 0.5;
            put(acc, vec3(1.0, 0.86, 0.5), halo * (1.0 - disc));
            put(acc, mix(vec3(1.0, 0.99, 0.9), vec3(1.0, 0.94, 0.68), pow(clamp(d / r, 0.0, 1.0), 9.0)), disc);
            add += vec3(1.0, 0.9, 0.5) * disc * 0.08;
            add += vec3(1.0, 0.84, 0.46) * (exp(-max(d - r, 0.0) * 3.0 * k) * 0.2 + exp(-max(d - r, 0.0) * 12.0 * k) * 0.18);
            add += vec3(1.0, 0.88, 0.62) * (exp(-d * 1.4) * 0.12 + exp(-d * 0.6) * 0.05) * (1.0 - disc);
        }
        vec4 accDay = acc; vec3 addDay = add; acc = acc0; add = add0;
        if (dusk > 0.001) {
            // at sunset: a big bright disc, pale gold, resting on the horizon, warm
            // light spread along the horizon, streaks of cloud lit gold and orange
            float r = 0.3;
            float land = 0.0, sky = 1.0;
            vec2 w = vec2(p.x * 0.8 - t * 0.005 * wind, uv.y * 8.5);
            float warp = fbm(w * vec2(0.45, 1.0) + vec2(3.0, t * 0.01));
            float n = fbm(w + vec2(warp * 1.6, 0.0));
            float below = fbm(w + vec2(warp * 1.6, -0.22));
            float streak = smoothstep(0.47, 0.68, n) * smoothstep(0.3, 0.5, uv.y) * (1.0 - smoothstep(0.85, 1.0, uv.y));
            vec3 lit = mix(vec3(1.0, 0.72, 0.36), vec3(0.95, 0.5, 0.42), smoothstep(0.35, 0.8, uv.y));
            lit += vec3(1.0, 0.7, 0.35) * exp(-d * 2.2) * 0.3;
            vec3 sc = mix(lit, vec3(0.42, 0.24, 0.3), smoothstep(0.0, 0.18, below - n) * 0.75);
            put(acc, sc, streak * 0.8);
            add += vec3(1.0, 0.62, 0.28) * exp(-abs(up) * 60.0) * exp(-abs(dv.x) * 0.9) * 0.3 * mix(1.0, sky, 0.6);
            float disc = smoothstep(r + px * 3.5, r - px * 3.5, d);
            add += vec3(1.0, 0.72, 0.36) * exp(-max(d - r, 0.0) * 13.0) * 0.32 * (1.0 - disc) * (1.0 - land);
            put(acc, vec3(1.0, 0.92, 0.6), disc);
            add += vec3(1.0, 0.92, 0.6) * disc * 0.25 * (1.0 - land);
        }
        acc = mix(accDay, acc, dusk); add = mix(addDay, add, dusk);
        acc = mix(acc0, acc, sunW); add = mix(add0, add, sunW);
    }
    // night: a navy sky full of fine stars, faint wisps drifting through it,
    // and the moon, photographed, glowing softly, in today's phase; the moon
    // and stars come out once the sky has darkened
    float nightW = smoothstep(0.35, 1.0, night) * aClear;
    if (nightW > 0.003) {
        vec4 accN0 = acc; vec3 addN0 = add;
        float clearSky = aClear / max(aClear + aCloudy, 1e-3);
        float open = mix(smoothstep(0.88, 0.95, uv.y), smoothstep(0.0, 0.25, uv.y), clearSky);
        vec2 mc = vec2(moonPos.x * aspect, moonPos.y); float mr = 0.13;
        float moonW = aClear * moonUp;
        float behind = mix(1.0, smoothstep(mr * 0.98, mr * 1.02, length(p - mc)), moonW);
        for (int l = 0; l < 3; l++) {
            float fl = float(l), sc = 60.0 + fl * 55.0; vec2 g = p * sc; vec2 cell = floor(g); float r = hash(cell + fl * 13.0);
            vec2 o = vec2(hash(cell + 3.1), hash(cell + 7.7)) * 0.7 + 0.15;
            float tw = 0.7 + 0.3 * sin(t * (0.8 + r * 2.5) + r * 40.0);
            float starSize = 0.06 + 0.07 * hash(cell + 2.4) * (1.0 - fl * 0.3);
            add += mix(vec3(1.0, 0.92, 0.84), vec3(0.82, 0.88, 1.0), hash(cell + 5.5)) * step(0.88, r) * smoothstep(starSize, 0.0, length(fract(g) - o)) * tw * (0.3 + 0.7 * pow(hash(cell + 1.3), 2.0)) * open * behind;
        }
        if (clearSky > 0.01) {
            vec2 w = vec2(p.x * 0.8 - t * 0.004 * wind, uv.y * 3.2);
            float n = fbm(w + vec2(fbm(w * vec2(0.4, 1.0) + 7.0) * 1.8, 0.0));
            put(acc, vec3(0.3, 0.32, 0.52), smoothstep(0.5, 0.75, n) * smoothstep(0.2, 0.5, uv.y) * 0.2 * clearSky);
        }
        vec2 m = (p - mc) / mr; float md = length(p - mc);
        float full = 0.35 + 0.65 * sin(phase * 3.14159);
        float outside = smoothstep(mr * 0.85, mr * 1.0, md);
        // the glow comes from the lit part: all round at full, from the bright edge of a crescent
        float sunSide = sin(phase * 6.28318);
        float glowSide = mix(1.0, smoothstep(-0.7, 0.9, dot((p - mc) / max(md, 1e-4), vec2(sunSide > 0.0 ? 1.0 : -1.0, 0.0))), abs(sunSide));
        add += vec3(0.6, 0.68, 0.95) * (exp(-max(md - mr, 0.0) * 14.0) * 0.22 + exp(-max(md - mr, 0.0) * 3.5) * 0.08 + exp(-md * 1.2) * 0.04) * full * outside * glowSide * moonW;
        if (dot(m, m) < 1.1 && moonW > 0.003) {
            float px = 1.5 / (mr * size.y);
            float edge = smoothstep(1.0 + px * 1.5, 1.0 - px * 1.5, length(m));
            vec3 photo = texture(moon, m * 0.47 + 0.5).rgb;
            vec3 nrm = vec3(m, sqrt(max(1.0 - dot(m, m), 0.0)));
            float a = phase * 6.28318;
            float lit = smoothstep(-0.06, 0.08, dot(nrm, vec3(sin(a), 0.0, -cos(a))));
            // seen through the air: its light added to the sky, the sky's blue
            // showing across it; only the stars behind it are hidden
            float luma = dot(photo, vec3(0.3, 0.59, 0.11));
            vec3 face = mix(photo, vec3(luma), 0.15) * vec3(0.9, 0.94, 1.04) * lit * 1.05 * (1.0 + 0.12 * smoothstep(0.75, 1.0, length(m)));
            // the dark part still faintly there in earthshine
            vec3 darkSide = mix(photo, vec3(luma), 0.4) * vec3(0.55, 0.62, 0.85) * 0.09 * (1.0 - lit);
            add += (face + darkSide) * edge * moonW;
            put(acc, vec3(0.0), edge * 0.3 * smoothstep(1.0, 0.8, length(m)) * moonW);
        }
        acc = mix(accN0, acc, nightW); add = mix(addN0, add, nightW);
    }
    // cloudy: high wisps drifting over, in the strip of sky above the cloud
    if (aCloudy > 0.003) {
        float w = fbm(vec2(p.x * 2.2 + t * 0.03 * wind, p.y * 7.0 + t * 0.01)) * fbm(vec2(p.x * 5.0 - t * 0.02 * wind, p.y * 12.0));
        float wisp = smoothstep(0.18, 0.42, w) * smoothstep(0.45, 0.8, uv.y);
        put(acc, vec3(0.95, 0.96, 1.0) * dim, wisp * 0.55 * aCloudy);
    }
    // rain: soft slanting streaks of every length, falling past at three depths
    float lum = 0.35 + 0.65 * dot(cloudLight, vec3(0.33));
    if (aRain > 0.003) {
        for (int l = 0; l < 3; l++) {
            float fl = float(l);
            float slant = 0.12 + 0.12 * wind;
            vec2 rq = vec2((p.x + uv.y * slant) * (70.0 - fl * 18.0), uv.y * (7.0 - fl * 1.8) + t * (13.0 - fl * 3.0));
            vec2 cell = floor(rq); float r = hash(cell + fl * 11.0);
            float y0 = hash(cell + 5.0 + fl) * 0.5, len = 0.22 + 0.3 * hash(cell + 2.2);
            float fy = fract(rq.y) - y0;
            float xoff = fract(rq.x) - 0.5 - (hash(cell + 9.0) - 0.5) * 0.7;
            float streak = step(1.0 - 0.3 * aRain, r) * smoothstep(0.12 + fl * 0.04, 0.0, abs(xoff)) * smoothstep(0.0, len * 0.6, fy) * smoothstep(len, len * 0.7, fy);
            add += vec3(0.85, 0.9, 1.0) * streak * (0.07 + 0.06 * fl) * (0.6 + 0.4 * hash(cell + 4.4)) * lum * min(aRain, 1.0);
        }
    }
    // snow: flakes drifting down, the near ones big and soft
    if (aSnow > 0.003) {
        for (int l = 0; l < 4; l++) {
            float fl = float(l), sc = 26.0 - fl * 5.0;
            vec2 sq = vec2(p.x * sc + sin(t * 0.4 + fl * 2.0 + uv.y * 3.0) * 0.8 * wind - t * 0.3 * wind, uv.y * sc + t * (0.9 + fl * 0.45));
            vec2 cell = floor(sq), f = fract(sq) - 0.5; float r = hash(cell + fl * 7.0);
            vec2 o = vec2(hash(cell + 1.7) - 0.5, hash(cell + 2.9) - 0.5) * 0.5 + vec2(sin(t * 1.1 + r * 30.0), cos(t * 0.9 + r * 20.0)) * 0.12;
            float rad = 0.05 + fl * 0.03, soft = 0.25 + fl * 0.22;
            add += vec3(1.0) * step(0.7 + fl * 0.06, r) * smoothstep(rad, rad * (1.0 - soft) * 0.4, length(f - o)) * (0.75 - fl * 0.12) * lum * aSnow;
        }
    }
    // storms: lightning glowing inside the clouds, now and then, flickering as it dies
    float glow = 0.0;
    if (aStorm > 0.003) {
        float n = floor(t / 3.7), at = fract(t / 3.7) * 3.7;
        if (hash(vec2(n, 3.0)) > 0.3) {
            float a = at - hash(vec2(n, 4.0)) * 1.5;
            if (a > 0.0) {
                float f = exp(-a * 5.0) * (0.55 + 0.45 * step(0.5, fract(a * 11.0))) + 0.6 * exp(-max(a - 0.18, 0.0) * 9.0) * step(0.18, a);
                vec2 c = vec2((0.15 + 0.7 * hash(vec2(n, 1.0))) * aspect, 0.5 + 0.35 * hash(vec2(n, 2.0)));
                float billow = smoothstep(0.25, 0.75, fbm(vec2(p.x * 3.0 + n * 7.0, uv.y * 5.0)));
                glow += f * (exp(-length((p - c) * vec2(0.8, 1.6)) * 2.2) * (0.5 + 1.2 * billow) + 0.12) * aStorm;
            }
        }
    }
    // ---- presses: each key's centre, how long ago, and a number of its own
    float part = 0.0;
    for (int i = 0; i < 8; i++) {
        vec4 key = iKeyPresses[i];
        if (key.w < 0.0) continue;
        float age = key.z;
        float seed = hash(vec2(key.w * 7.31, floor((iTime - age) * 4.0 + 0.5))) * 100.0;
        vec4 k = vec4(key.x / size.x, key.y / size.y, age, seed);
        vec2 kp = vec2(k.x * aspect, k.y); vec2 d = p - kp;
        // a storm: lightning flares in the cloud at the key, and a bolt strikes down to it
        if ((W == 3 || W == 6) && age < 0.9) {
            float flick = 0.55 + 0.45 * step(0.5, fract(age * 16.0));
            float billow = smoothstep(0.2, 0.75, fbm(vec2(p.x * 3.2 + k.w, uv.y * 5.5 - age)));
            glow += (1.0 - smoothstep(0.0, 0.9, age)) * flick * (exp(-length(d * vec2(0.6, 1.3)) * 3.2) * (0.4 + 1.5 * billow) + 0.12);
            if (uv.y > kp.y && age < 0.35) {
                float jag = kp.x + (noise(vec2(uv.y * 9.0, k.w)) - 0.5) * 0.12 + (noise(vec2(uv.y * 40.0, k.w + 3.0)) - 0.5) * 0.03;
                float dx = abs(p.x - jag), life = (1.0 - age / 0.35) * (0.6 + 0.4 * step(0.5, fract(age * 18.0)));
                add += vec3(0.88, 0.92, 1.0) * (exp(-dx * 500.0) * 1.6 + exp(-dx * 40.0) * 0.25) * life;
            }
        }
        // clear and cloudy days: a soft cloud puffs up at the key, rises and thins away
        if ((W == 0 || W == 1) && night < 0.5 && age < 5.0) {
            float grow = 1.0 - exp(-age * 2.5), rad = 0.1 + 0.14 * grow;
            vec2 c = kp + vec2(age * 0.015 * wind, age * 0.018);
            vec2 r = (p - c) / rad; r.y *= 1.35;
            float lumps = fbm(r * 1.3 + k.w + vec2(t * 0.15, 0.0));
            float body = smoothstep(1.15, 0.55, length(r) + (0.5 - lumps) * 0.9);
            float fade = smoothstep(0.0, 0.3, age) * (1.0 - smoothstep(2.0, 5.0, age));
            float thin = smoothstep(0.35 + 0.4 * smoothstep(2.0, 5.0, age), 0.8, lumps + body * 0.4);
            float a = body * thin * fade * 0.95;
            vec3 pc = mix(mix(cloudLight * 0.7, vec3(0.55, 0.47, 0.66), dusk), mix(vec3(1.0, 0.99, 0.97), vec3(1.0, 0.76, 0.7), dusk), smoothstep(-0.8, 0.9, r.y + lumps * 0.8));
            put(acc, pc, a);
        }
        // night: a shooting star streaks in from out of frame, high on the far
        // side, and lands on the key, flashing where it hits
        if ((W == 0 || W == 1) && night > 0.5 && age < 1.6) {
            float side = kp.x < aspect * 0.5 ? 1.0 : -1.0;
            vec2 dir = normalize(vec2(-side, -0.5 - 0.25 * fract(k.w * 7.0)));
            vec2 start = kp - dir * 1.6;
            float fly = 0.5, e = clamp(age / fly, 0.0, 1.0);
            vec2 head = mix(start, kp, e * e * (3.0 - 2.0 * e) * 0.35 + e * 0.65);
            vec2 r = p - head; float along = dot(r, -dir), across = abs(dot(r, vec2(-dir.y, dir.x)));
            float trail = step(0.0, along) * exp(-along * 5.0) * exp(-across * 650.0) * step(0.0, dot(p - kp, -dir) + 0.002);
            float streak = (1.0 - smoothstep(fly, fly + 0.6, age));
            float hit = smoothstep(fly - 0.05, fly, age) * (1.0 - smoothstep(fly, fly + 0.9, age));
            float dd = length(p - kp);
            add += vec3(0.95, 0.97, 1.0) * (trail * 1.5 + exp(-length(r) * 90.0) * 1.3 * (1.0 - hit)) * streak;
            add += vec3(0.9, 0.94, 1.0) * (exp(-dd * 60.0) * 1.2 + exp(-dd * 14.0) * 0.25) * hit;
        }
        // rain: drops splash onto the glass at the key, bead up catching the
        // light, then run down the glass one by one, leaving wet trails
        if (W == 2 && age < 6.0) {
            for (int j = 0; j < 18; j++) {
                float fj = float(j), h1 = hash(vec2(k.w, fj)), h2 = hash(vec2(fj, k.w + 5.0)), h3 = hash(vec2(fj + 9.0, k.w));
                vec2 start = kp + (vec2(h1, h2) - 0.5) * vec2(0.26, 0.2);
                float rad = 0.014 + 0.032 * h3 * h3;
                float wait = 0.25 + 1.6 * h2, run = max(age - wait, 0.0);
                vec2 c = start - vec2(sin(run * 3.0 + fj) * 0.004, run * run * (0.03 + 0.07 * h3));
                float life = smoothstep(0.0, 0.07, age) * (1.0 - smoothstep(4.0, 6.0, age));
                vec2 dq = (p - c) / vec2(1.0, 1.0 + 0.25 * smoothstep(0.0, 0.4, run));
                float dd = length(dq);
                float body = smoothstep(rad, rad * 0.82, dd);
                float rim = body - smoothstep(rad * 0.86, rad * 0.55, dd);
                float shine = exp(-length(dq - vec2(-0.32, 0.36) * rad) / (rad * 0.16));
                float trail = step(c.y, p.y) * step(p.y, start.y) * smoothstep(rad * 0.45, rad * 0.1, abs(p.x - c.x - sin((p.y - start.y) * 60.0 + fj) * 0.003)) * smoothstep(0.0, 0.3, run);
                float crescent = body * smoothstep(0.1, 0.85, -dq.y / rad) * smoothstep(1.0, 0.6, dd / rad);
                float edgeTop = rim * smoothstep(-0.3, 0.6, dq.y / rad);
                put(acc, vec3(0.0), edgeTop * 0.3 * life);
                add += (cloudLight * crescent * 0.35 + vec3(1.0) * shine * 0.8 * body + cloudLight * body * 0.05 + cloudLight * trail * 0.08) * life * lum;
            }
        }
        // snow: a gust sweeping out of the key with the wind, each flake at its
        // own speed and height, so it scatters rather than rings
        if ((W == 4 || W == 7) && age < 2.2) {
            for (int j = 0; j < 22; j++) {
                float fj = float(j), h1 = hash(vec2(k.w, fj)), h2 = hash(vec2(fj, k.w + 2.0)), h3 = hash(vec2(fj + 5.0, k.w));
                float a = (h1 - 0.5) * 1.6 + 0.15, v = 0.08 + 0.28 * h2, go = age * (1.0 - 0.25 * age / 2.2);
                vec2 at = kp + vec2((h3 - 0.5) * 0.06, (h1 - 0.5) * 0.08) + vec2(cos(a), sin(a) * 0.6) * v * go + vec2(sin(age * 3.0 + fj) * 0.01, -age * age * 0.04);
                add += vec3(0.95, 0.97, 1.0) * smoothstep(0.011, 0.002, length(p - at)) * 0.85 * smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(1.2, 2.2, age)) * (0.5 + 0.5 * h3) * lum;
            }
        }
        // fog: it parts around the key, then closes again
        if (W == 5 && age < 6.0) {
            float open = smoothstep(0.0, 0.8, age) * (1.0 - smoothstep(2.5, 6.0, age));
            float rr = 0.16 + 0.22 * smoothstep(0.0, 2.0, age);
            part = max(part, open * smoothstep(rr, rr * 0.3, length(d * vec2(1.0, 1.4)) + (fbm(p * 7.0 + k.w) - 0.5) * 0.08));
        }
    }
    // fog: inside the cloud, everything softened into haze that moves, thinner where a key parted it
    if (aFog > 0.003) {
        float h = 0.55 + 0.3 * fbm(vec2(p.x * 1.4 + t * 0.04 * wind, uv.y * 2.5 + t * 0.02));
        put(acc, mix(vec3(0.9, 0.92, 0.95), vec3(0.2, 0.22, 0.28), night), h * 0.85 * (1.0 - part) * aFog);
    }
    // blizzard: snow driven almost sideways by the wind, in gusts, the near
    // flakes drawn out into streaks, and veils of blown snow racing across.
    // How far the wind has carried the snow is its gusting strength,
    // 0.75 + 0.25 sin(0.6t) sin(0.23t + 1), added up over time (worked out
    // exactly), so the snow only ever goes forward
    if (aBlizzard > 0.003) {
        vec2 dir = normalize(vec2(-1.0, 0.3)), across = vec2(-dir.y, dir.x);
        float blown = t * 0.75 + 0.125 * (sin(0.37 * t - 1.0) / 0.37 - sin(0.83 * t + 1.0) / 0.83);
        for (int l = 0; l < 6; l++) {
            float fl = float(l), sc = 44.0 - fl * 7.0;
            vec2 bq = vec2(dot(p, dir) * sc * (0.45 - fl * 0.06) + blown * (4.0 + fl * 1.6) * wind, dot(p, across) * sc + sin(t * 0.9 + fl * 1.7 + dot(p, dir) * 3.0) * 0.35);
            vec2 cell = floor(bq), f = fract(bq) - 0.5; float r = hash(cell + fl * 13.0);
            vec2 e = f - vec2((hash(cell + 1.3) - 0.5) * 0.4, (hash(cell + 3.1) - 0.5) * 0.6);
            float rad = 0.045 + fl * 0.018;
            add += vec3(0.95, 0.97, 1.0) * step(0.45 + fl * 0.08, r) * smoothstep(rad, 0.0, length(e * vec2(1.0, 1.5))) * (0.75 - fl * 0.1) * lum * aBlizzard;
        }
        float veil = fbm(vec2(p.x * 1.3 - blown * 0.7 * wind, uv.y * 2.6 + t * 0.12)) * 0.65 + fbm(vec2(p.x * 3.5 - blown * 1.6 * wind, uv.y * 6.0)) * 0.35;
        put(acc, mix(mix(vec3(0.9, 0.92, 0.96), vec3(0.6, 0.55, 0.64), dusk), vec3(0.3, 0.33, 0.42), night), smoothstep(0.3, 0.8, veil) * mix(0.7, 0.45, night) * (1.0 - part) * aBlizzard);
    }
    vec3 light = vec3(0.8, 0.85, 1.0) * glow;
    // the weather laid over the clouds: its own light added, its cover veiling them
    vec3 sky = softClouds(frag);
    vec3 col = sky * (1.0 - acc.a) + acc.rgb + add + light;
    // a grain of up to one shade either way (two random values, the usual
    // way), which hides the steps between shades in a smooth sky
    return clamp(col, 0.0, 1.0) + (hash(frag) + hash(frag.yx + 71.3) - 1.0) / 255.0;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    if (PASSINDEX == 0) fragColor = drawState(ivec2(fragCoord));
    else if (PASSINDEX == 1) fragColor = drawClouds(fragCoord);
    else fragColor = vec4(drawPicture(fragCoord), 1.0);
}
