// Nebula: domain-warped clouds of violet and magenta drifting slowly.
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) { v += a * noise(p); p = r * p * 2.0; a *= 0.5; }
    return v;
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.03;
    vec2 q = vec2(fbm(uv * 1.6 + t), fbm(uv * 1.6 - t + 4.7));
    vec2 r = vec2(fbm(uv * 1.6 + 3.0 * q + vec2(1.7, 9.2) + t * 1.5), fbm(uv * 1.6 + 3.0 * q + vec2(8.3, 2.8) - t));
    float f = fbm(uv * 1.6 + 3.5 * r);
    vec3 col = mix(vec3(0.015, 0.01, 0.04), vec3(0.22, 0.05, 0.38), smoothstep(0.3, 0.7, f));
    col = mix(col, vec3(0.8, 0.18, 0.56), 0.75 * smoothstep(0.45, 0.85, length(q) * f * 1.6));
    col = mix(col, vec3(0.4, 0.62, 1.0), smoothstep(0.55, 0.9, r.x * f * 1.5) * 0.6);
    col *= 0.25 + 0.65 * smoothstep(0.25, 0.8, f);
    fragColor = vec4(pow(col, vec3(1.1)), 1.0);
}
