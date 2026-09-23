// Aurora: slow ribbons of green and teal light over a night sky.
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
    return v;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float t = iTime * 0.05;
    vec3 col = mix(vec3(0.01, 0.015, 0.035), vec3(0.02, 0.04, 0.07), uv.y);
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float wave = 0.42 + 0.13 * fi + 0.18 * (fbm(vec2(uv.x * 2.0 + t * (1.0 + fi * 0.4), fi * 3.1 + t)) - 0.5);
        float band = exp(-pow((uv.y - wave) * (9.0 - fi * 2.0), 2.0));
        float curtain = fbm(vec2(uv.x * 12.0 + fi * 5.0, uv.y * 2.0 - t * 4.0));
        vec3 hue = mix(vec3(0.1, 0.9, 0.55), vec3(0.15, 0.55, 0.9), fi / 2.0);
        col += hue * band * (0.35 + 0.65 * curtain) * 0.55;
    }
    col += pow(hash(floor(fragCoord)), 900.0) * 0.6 * uv.y; // stars
    fragColor = vec4(col, 1.0);
}
