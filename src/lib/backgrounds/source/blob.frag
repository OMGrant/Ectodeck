/*{
  "DESCRIPTION": "The Ectonomic blob, a living body lit from inside. A key press pokes it: a small dent, and a ripple across the skin like tapping a water balloon.",
  "INPUTS": [
    { "NAME": "mode", "TYPE": "long", "LABEL": "Preset", "PRESET": true, "DEFAULT": 0, "VALUES": [0, 1, 2, 3, 4, 5, 6], "LABELS": ["Deep", "Slime", "Horizon", "Points", "Glass", "Hologram", "Energy"] },
    { "NAME": "glow", "TYPE": "color", "LABEL": "Glow colour", "DEFAULT": [0.784, 0.949, 0.18, 1] },
    { "NAME": "body", "TYPE": "color", "LABEL": "Body colour", "DEFAULT": [0.608, 0.878, 0.071, 1] },
    { "NAME": "scale", "TYPE": "float", "LABEL": "Size", "DEFAULT": 2.3, "MIN": 1, "MAX": 4 },
    { "NAME": "amp", "TYPE": "float", "LABEL": "Wobble", "DEFAULT": 2.2, "MIN": 0, "MAX": 4 },
    { "NAME": "speed", "TYPE": "float", "LABEL": "Speed", "DEFAULT": 0.45, "MIN": 0.05, "MAX": 2 },
    { "NAME": "react", "TYPE": "bool", "LABEL": "React to presses", "DEFAULT": true }
  ]
}*/

// Ectodeck's built-in Blob, drawn by the deck's own renderer: the orb from
// ectonomic.com (orb.js), moved off the browser. orb.js draws a subdivided
// icosphere, bent by a sum of sines in its vertex shader, as a lit body, a
// wireframe or glowing points. Here each pixel finds the same body instead:
// its ray is traced to the bent surface (front and back), and for the wire
// and the points the pixel works out which of the sphere's triangles it is
// on. orb.js subdivides each face of an icosahedron as a flat grid and then
// pushes the grid's points out onto the sphere, so the triangle is found by
// projecting onto the face and reading the grid; its edges and corners are
// then projected to the screen, as the GPU would draw them.

const float FOV = 0.42;
const vec3 BG = vec3(10.0 / 255.0);
const int DEEP_MODE = 0, SLIME = 1, HORIZON = 2, POINTS = 3, GLASS = 4, HOLO = 5, ENERGY = 6;

vec3 LIME, DEEP;
float t, real, aspect, focal;
mat3 rot;
vec2 offset;
vec4 pokes[4];

// ---- the body, as orb.js bends it
float bump(vec3 o) {
    return (sin(o.x * 2.1 + t * 0.6) * cos(o.y * 1.8 + t * 0.5) * sin(o.z * 2.4 + t * 0.7) * 0.09
          + sin(o.x * 4.3 + o.y * 3.7 + t * 0.4) * 0.035) * amp;
}
vec3 surf(vec3 o) { return o * (1.0 + bump(o)); }
// the normal of the bent surface, from two neighbours along it
vec3 skinNormal(vec3 o, float e) {
    vec3 s = surf(o);
    vec3 ta = normalize(cross(o, abs(o.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 tb = cross(o, ta);
    vec3 sa = surf(normalize(o + ta * e)), sb = surf(normalize(o + tb * e));
    return normalize(cross(sa - s, sb - s));
}

// ---- a key press pokes the skin under the key: a dent, and a ripple running out
float pokeHeight(vec2 at) {
    float h = 0.0;
    for (int i = 0; i < 4; i++) {
        if (pokes[i].w <= 0.0) continue;
        float age = pokes[i].z;
        vec2 d = (at - pokes[i].xy) * vec2(aspect, 1.0);
        float r = length(d);
        float dent = -0.5 * exp(-r * r / 0.17) * smoothstep(0.0, 0.6, age) * exp(-age * 0.75);
        float rr = r - 0.25 - age * 0.55;
        float ripple = 0.11 * exp(-rr * rr / 0.04) * exp(-age * 0.4) * smoothstep(0.0, 0.5, age);
        h += (dent + ripple) * pokes[i].w;
    }
    return h;
}
vec3 centre() { return vec3(offset, -4.2); }
// the ray through a point of the screen (in NDC), from the camera at the origin
vec3 rayAt(vec2 ndc) { return normalize(vec3(ndc.x * tan(FOV) * aspect, ndc.y * tan(FOV), -1.0)); }
// where a ray meets a sphere round the body's centre
bool meetsSphere(vec3 d, float r, out float t0, out float t1) {
    vec3 c = centre();
    float b = dot(d, c), disc = b * b - (dot(c, c) - r * r);
    if (disc < 0.0) return false;
    t0 = b - sqrt(disc); t1 = b + sqrt(disc);
    return true;
}
// A press pokes the body under the key; a key off the body pokes the nearest
// part of its edge: the target slides from the key toward the body until it meets it
void findPokes() {
    for (int i = 0; i < 4; i++) pokes[i] = vec4(0.0);
    if (!react) return;
    vec2 middle = vec2(offset.x * focal / aspect / 4.2, offset.y * focal / 4.2);
    int n = 0;
    for (int i = 0; i < 8; i++) {
        vec4 k = iKeyPresses[i];
        if (k.w < 0.0 || k.z >= 7.0 || n >= 4) continue;
        vec2 at = k.xy / iResolution.xy * 2.0 - 1.0;
        float a, b;
        for (int j = 0; j < 40; j++) {
            if (meetsSphere(rayAt(at), scale, a, b)) break;
            at += (middle - at) * 0.06;
        }
        pokes[n] = vec4(at, k.z, 1.0);
        n++;
    }
}

// ---- tracing a ray to the bent surface
vec3 toBody(vec3 x) { return transpose(rot) * (x - centre()) / scale; }
// how far outside the surface a point is, roughly, in scene units
float gap(vec3 x) { vec3 o = toBody(x); return (length(o) - (1.0 + bump(normalize(o)))) * scale; }
// the first crossing of the surface going from t0 to t1 (t1 < t0 goes backward)
bool trace(vec3 d, float t0, float t1, out float hit) {
    float dir = sign(t1 - t0), span = abs(t1 - t0), done = 0.0, last = 0.0;
    float tt = t0;
    for (int i = 0; i < 400; i++) {
        float g = gap(d * tt);
        if (g < 0.0) {
            // the surface lies within the last step: narrow it down
            float lo = tt - dir * last, hi = tt;
            for (int k = 0; k < 10; k++) { float m = 0.5 * (lo + hi); if (gap(d * m) < 0.0) hi = m; else lo = m; }
            hit = hi;
            return true;
        }
        // small steps: the gap is measured along the radius, not to the
        // nearest skin, and a ray grazing a swell would step over it; but
        // never under half a pixel, or a ray running alongside the skin at
        // the outline would run out of steps before it met it
        last = max(g * 0.22, 0.004);
        tt += dir * last; done += last;
        if (done > span) return false;
    }
    return false;
}

// ---- the icosphere's triangles
const float PHI = 1.61803399;
vec3 corner(int i) {
    vec3 v[12] = vec3[12](vec3(-1, PHI, 0), vec3(1, PHI, 0), vec3(-1, -PHI, 0), vec3(1, -PHI, 0),
                          vec3(0, -1, PHI), vec3(0, 1, PHI), vec3(0, -1, -PHI), vec3(0, 1, -PHI),
                          vec3(PHI, 0, -1), vec3(PHI, 0, 1), vec3(-PHI, 0, -1), vec3(-PHI, 0, 1));
    return v[i];
}
ivec3 face(int i) {
    ivec3 f[20] = ivec3[20](ivec3(0, 11, 5), ivec3(0, 5, 1), ivec3(0, 1, 7), ivec3(0, 7, 10), ivec3(0, 10, 11),
                            ivec3(1, 5, 9), ivec3(5, 11, 4), ivec3(11, 10, 2), ivec3(10, 7, 6), ivec3(7, 1, 8),
                            ivec3(3, 9, 4), ivec3(3, 4, 2), ivec3(3, 2, 6), ivec3(3, 6, 8), ivec3(3, 8, 9),
                            ivec3(4, 9, 5), ivec3(2, 4, 11), ivec3(6, 2, 10), ivec3(8, 6, 7), ivec3(9, 8, 1));
    return f[i];
}
// the corners (on the unit sphere) of the triangle a direction falls in, at
// a subdivision of n = 2^levels to each icosahedron edge
void triangleOf(vec3 d, float n, out vec3 A, out vec3 B, out vec3 C) {
    A = B = C = d;
    for (int i = 0; i < 20; i++) {
        ivec3 f = face(i);
        vec3 a = corner(f.x), b = corner(f.y), c = corner(f.z);
        vec3 nf = cross(b - a, c - a);
        if (dot(nf, a) < 0.0) nf = -nf;
        float along = dot(nf, d);
        if (along <= 0.0) continue;
        // the direction's point on the face's plane, in the face's own terms
        vec3 x = d * dot(nf, a) / along - a, e1 = b - a, e2 = c - a;
        float d11 = dot(e1, e1), d12 = dot(e1, e2), d22 = dot(e2, e2), x1 = dot(x, e1), x2 = dot(x, e2);
        float den = d11 * d22 - d12 * d12;
        float u = (d22 * x1 - d12 * x2) / den, v = (d11 * x2 - d12 * x1) / den;
        if (u < -1e-4 || v < -1e-4 || u + v > 1.0001) continue;
        // the grid cell, and which half of it
        vec2 g = vec2(u, v) * n, cell = clamp(floor(g), vec2(0.0), vec2(n - 1.0)), fr = g - cell;
        vec2 g0, g1, g2;
        if (fr.x + fr.y < 1.0 || cell.x + cell.y >= n - 1.0) { g0 = cell; g1 = cell + vec2(1, 0); g2 = cell + vec2(0, 1); }
        else { g0 = cell + vec2(1, 0); g1 = cell + vec2(1, 1); g2 = cell + vec2(0, 1); }
        A = normalize(a + e1 * g0.x / n + e2 * g0.y / n);
        B = normalize(a + e1 * g1.x / n + e2 * g1.y / n);
        C = normalize(a + e1 * g2.x / n + e2 * g2.y / n);
        return;
    }
}

// ---- a corner of the mesh placed as orb.js's vertex shader places it
struct Vertex { vec2 px; vec3 view; float depth; };
Vertex place(vec3 p) {
    vec3 s = surf(p), n = rot * skinNormal(p, 0.02);
    vec3 q = rot * s * scale; q.xy += offset;
    Vertex v; v.view = q;
    q.z -= 4.2;
    vec2 ndc = vec2(q.x * focal / aspect, q.y * focal) / -q.z;
    // the poke pushes the skin, mostly straight back from the viewer
    vec3 push = n * pokeHeight(ndc) * scale, ray = normalize(q), back = ray * dot(push, ray);
    q += back + (push - back) * 0.28;
    v.depth = q.z;
    v.px = (vec2(q.x * focal / aspect, q.y * focal) / -q.z * 0.5 + 0.5) * iResolution.xy;
    return v;
}

// the wire over a surface point: the edges of its triangle, as one-pixel lines
vec4 wire(vec3 o, float n, vec2 px, float alpha, bool scan, bool pulse) {
    vec3 A, B, C;
    triangleOf(o, n, A, B, C);
    Vertex v[3] = Vertex[3](place(A), place(B), place(C));
    vec3 sum = vec3(0.0); float cover = 0.0;
    for (int i = 0; i < 3; i++) {
        Vertex a = v[i], b = v[(i + 1) % 3];
        vec2 ab = b.px - a.px;
        float h = clamp(dot(px - a.px, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        float line = clamp(1.0 - length(px - a.px - ab * h), 0.0, 1.0);
        if (line <= 0.0) continue;
        float depth = mix(a.depth, b.depth, h);
        vec3 vp = mix(a.view, b.view, h);
        float f = clamp((depth + 6.0) / 3.2, 0.0, 1.0);
        float al = alpha * (0.2 + f * 0.8);
        vec3 c = DEEP;
        if (scan) {
            float band = fract(t * 0.12), y = (vp.y / 1.7) * 0.5 + 0.5;
            float s = 1.0 - smoothstep(0.0, 0.06, abs(y - band));
            al += s * 0.6; c = mix(c, LIME, s);
        }
        if (pulse) {
            float w = 0.5 + 0.5 * sin(vp.y * 4.0 - t * 2.2) * sin(vp.x * 3.0 + t * 1.1);
            al *= 0.6 + w * 1.4; c = mix(c, LIME, w * 0.7);
        }
        al *= line;
        sum += c * al; cover += al * al;
    }
    return vec4(sum, cover);
}
// the glowing points at the corners of a surface point's triangle
vec4 dots(vec3 o, float n, vec2 px, float alpha) {
    vec3 A, B, C;
    triangleOf(o, n, A, B, C);
    vec3 p[3] = vec3[3](A, B, C);
    vec3 sum = vec3(0.0); float cover = 0.0;
    for (int i = 0; i < 3; i++) {
        Vertex v = place(p[i]);
        float f = clamp((v.depth + 6.0) / 3.2, 0.0, 1.0);
        float size = (6.0 + 5.0 * f) * (0.65 + 0.35 * sin(t * 1.4 + p[i].y * 5.0 + p[i].x * 3.0));
        float r = length(px - v.px) / (size * 0.5);
        float disc = smoothstep(1.0, 0.15, r);
        if (disc <= 0.0) continue;
        float g = 0.5 + 0.5 * sin(t * 1.4 + v.view.y * 5.0 + v.view.x * 3.0);
        float al = disc * alpha * (0.35 + f * 0.65) * (0.6 + g * 0.6);
        sum += mix(DEEP, LIME, g) * al; cover += al * al;
    }
    return vec4(sum, cover);
}

float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    LIME = glow.rgb; DEEP = body.rgb;
    real = iTime; t = real * speed;
    aspect = iResolution.x / iResolution.y; focal = 1.0 / tan(FOV);
    // a slow yaw and a lazy nod, nothing from the pointer
    float yaw = real * 0.07, pitch = 0.22 + sin(real * 0.19) * 0.10;
    float cy = cos(yaw), sy = sin(yaw), cx = cos(pitch), sx = sin(pitch);
    rot = mat3(cy, sx * sy, -cx * sy, 0.0, cx, sx, sy, -sx * cy, cx * cy);
    offset = mode == DEEP_MODE ? vec2(0.0, 0.15) : mode == HORIZON ? vec2(1.6, -1.9) : vec2(0.0);
    findPokes();

    vec2 ndc = fragCoord / iResolution.xy * 2.0 - 1.0;
    vec3 d = rayAt(ndc);
    // the body lies within this sphere however it bends
    float outer = scale * (1.0 + 0.125 * amp + 0.02), t0, t1;
    bool near = meetsSphere(d, outer, t0, t1);
    float front, back;
    bool hitFront = near && trace(d, t0, t1, front);
    bool hitBack = hitFront && trace(d, t1, t0, back);

    vec3 rgb = vec3(0.0); float cover = 0.0;
    bool solid = mode == DEEP_MODE || mode == HORIZON || mode == SLIME || mode == GLASS;
    if (solid && hitFront) {
        vec3 o = normalize(toBody(d * front));
        vec3 q = d * front;
        if (mode == DEEP_MODE || mode == HORIZON) {
            // The deep slime: a near-black wet body; lime only as rim,
            // highlight and a glow drifting inside. The far side fogs to black
            vec3 n = normalize(rot * skinNormal(o, 0.01));
            vec2 e = 2.0 / iResolution.xy;
            vec2 slope = vec2(pokeHeight(ndc + vec2(e.x, 0.0)) - pokeHeight(ndc - vec2(e.x, 0.0)),
                              pokeHeight(ndc + vec2(0.0, e.y)) - pokeHeight(ndc - vec2(0.0, e.y))) / (2.0 * e);
            n = normalize(n - vec3(slope, 0.0) * 0.4);
            float lift = clamp(pokeHeight(ndc) / 0.45, -1.0, 1.0);
            // the skin pushed by the pokes, mostly straight back
            vec3 push = n * pokeHeight(ndc) * scale;
            q += d * dot(push, d);
            vec3 v = normalize(-q);
            // the light circles slowly, so the wet highlight sweeps across the body
            float la = real * 0.11;
            vec3 L = normalize(vec3(cos(la) * 0.9, 0.95 + sin(real * 0.07) * 0.2, sin(la) * 0.9 + 0.5));
            float fres = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 3.2);
            float diff = max(dot(n, L), 0.0);
            float spec = pow(max(dot(n, normalize(L + v)), 0.0), 110.0);
            // a soft light under the skin, wandering slowly round the point facing the viewer
            vec3 glowAt = vec3(-offset / scale, sqrt(max(scale * scale - dot(offset, offset), 0.0)) / scale);
            vec3 gv = glowAt + vec3(sin(real * 0.13) * 0.45, cos(real * 0.09) * 0.40, sin(real * 0.05) * 0.20);
            vec3 dg = o - transpose(rot) * gv;
            float inner = exp(-dot(dg, dg) * scale * scale * 1.4);
            vec3 c = DEEP * 0.026 + DEEP * diff * 0.09 + LIME * fres * 0.62 + LIME * inner * 0.5 + mix(vec3(1.0), LIME, 0.45) * spec * 0.55;
            c *= 1.0 + lift * 0.24;
            float fog = clamp((q.z + 7.6) / 4.2, 0.0, 1.0);
            c *= fog * fog;
            vec2 uv = fragCoord / iResolution.xy - 0.5;
            c *= max(1.0 - dot(uv, uv) * 1.15, 0.0);
            vec2 hu = uv * vec2(1.0, 0.75);
            c *= 1.0 - (mode == DEEP_MODE ? 0.4 : 0.35) * exp(-dot(hu, hu) * 12.0);
            c += (hash(fragCoord) - 0.5) * (2.0 / 255.0);
            rgb = c; cover = 1.0;
        } else {
            // the lit body, a dark fill lit at the rim; slime is wet, glass is not
            vec3 n = normalize(rot * skinNormal(o, 0.02)), v = normalize(-(q));
            float fres = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 2.4);
            vec3 L = normalize(vec3(0.6, 0.9, 0.8));
            float diff = max(dot(n, L), 0.0);
            vec3 c = DEEP * 0.055 + DEEP * diff * 0.22 + LIME * fres * 0.9;
            if (mode == SLIME) {
                c += mix(vec3(1.0), LIME, 0.37) * pow(max(dot(n, normalize(L + v)), 0.0), 60.0) * 0.9;
                c += DEEP * diff * 0.5;
            }
            float alpha = mode == SLIME ? 0.95 : 0.55;
            rgb = c * alpha; cover = alpha;
        }
    }
    // the wire and the points glow, added over whatever is behind, front and back alike
    bool lines = mode == GLASS || mode == HOLO || mode == ENERGY, points = mode == POINTS || mode == ENERGY;
    if (lines || points) {
        float n = mode == POINTS ? 16.0 : 8.0;
        vec3 sides[2];
        int count = 0;
        if (hitFront) { sides[0] = normalize(toBody(d * front)); count = 1; }
        if (hitBack) { sides[1] = normalize(toBody(d * back)); count = 2; }
        // just outside the outline a point's glow still reaches: use the nearest part of the body
        if (!hitFront && near && points) { sides[0] = normalize(toBody(d * dot(d, centre()))); count = 1; }
        for (int s = 0; s < 2; s++) {
            if (s >= count) break;
            if (lines) {
                vec4 w = wire(sides[s], n, fragCoord, mode == GLASS ? 0.12 : mode == HOLO ? 0.14 : 0.10, mode == HOLO, mode == ENERGY);
                rgb += w.rgb; cover += w.a;
            }
            if (points) {
                vec4 p = dots(sides[s], n, fragCoord, mode == POINTS ? 0.9 : 0.6);
                rgb += p.rgb; cover += p.a;
            }
        }
    }
    // the page behind the canvas is nearly black
    fragColor = vec4(rgb + BG * (1.0 - clamp(cover, 0.0, 1.0)), 1.0);
}
