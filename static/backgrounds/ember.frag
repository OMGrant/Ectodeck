// Ember: a warm glow that flows slowly from orange through pink to violet.
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.06;
    float warp = fbm(p * 1.3 + vec2(t, -t * 0.7));
    float g = fbm(p * 1.1 + 2.0 * warp + vec2(-t * 0.5, t));
    vec3 a = vec3(1.0, 0.54, 0.11), b = vec3(0.96, 0.25, 0.49), c = vec3(0.52, 0.22, 0.82);
    float h = g + (uv.x - 0.5) * 0.35;
    vec3 col = mix(a, b, smoothstep(0.42, 0.62, h));
    col = mix(col, c, smoothstep(0.58, 0.8, h + (0.5 - uv.y) * 0.2));
    float glow = smoothstep(0.2, 0.75, g);
    col *= 0.1 + 0.75 * glow * glow;
    fragColor = vec4(col, 1.0);
}
