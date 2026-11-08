// Post-processing and particle shaders.

const passVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// 1-bit ordered (Bayer 8x8) dither in the Obra Dinn style. uAmount 1 gives full monochrome, 0 gives untouched colour.
// Chroma-preserving: saturated pixels (amber lane B, cyan report) keep their hue, dithered between ink and that hue,
// so in the sim only what the scorer counts is in colour. uChroma 0 restores pure 1-bit.
export const DitherShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 1 },
    uRes: { value: [1, 1] },
    uPixel: { value: 2 },
    uChroma: { value: 1 },
  },
  vertexShader: passVert,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform vec2 uRes; uniform float uPixel; uniform float uChroma;
    varying vec2 vUv;
    float bayer2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
    float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    float bayer8(vec2 a){ return bayer4(0.5 * a) * 0.25 + bayer2(a); }
    void main(){
      vec4 src = texture2D(tDiffuse, vUv);
      if (uAmount <= 0.001) { gl_FragColor = src; return; }
      vec2 px = floor(vUv * uRes / uPixel);
      // average the block (4 taps) so thin features survive the quantisation
      vec2 o = uPixel / uRes;
      vec2 b0 = px * o;
      vec3 c = 0.25 * (texture2D(tDiffuse, b0 + o * vec2(0.25, 0.25)).rgb + texture2D(tDiffuse, b0 + o * vec2(0.75, 0.25)).rgb
                     + texture2D(tDiffuse, b0 + o * vec2(0.25, 0.75)).rgb + texture2D(tDiffuse, b0 + o * vec2(0.75, 0.75)).rgb);
      c = max(c, 0.6 * texture2D(tDiffuse, b0 + o * 0.5).rgb);
      c = max(c, vec3(0.0));
      float th = bayer8(px);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      l = clamp((l - 0.04) * 1.15, 0.0, 1.0);
      float bit = step(th + 0.001, l);
      vec3 ink = vec3(0.035, 0.035, 0.045), paper = vec3(0.93, 0.92, 0.89);
      vec3 mono = mix(ink, paper, bit);
      // chroma: how coloured is this block? (HSV saturation, ignoring near-black noise)
      float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
      float sat = (mx - mn) / max(mx, 1e-3);
      float w = uChroma * smoothstep(0.17, 0.30, sat) * smoothstep(0.05, 0.14, mx);
      // pure hue, lifted a touch toward paper so it reads as light, not neon noise
      vec3 hue = clamp((c - mn) / max(mx - mn, 1e-3), 0.0, 1.0);
      hue = mix(hue, paper, 0.1) * 1.04;
      float v = clamp((mx - 0.05) * 1.12, 0.0, 1.0);
      float cbit = step(th + 0.001, v);
      vec3 chroma = mix(ink, hue, cbit);
      // dithered hand-off between mono and chroma (second Bayer phase so the edge doesn't alias with the tone)
      float pick = step(bayer8(px + vec2(3.0, 5.0)) + 0.001, w);
      vec3 outc = mix(mono, chroma, pick);
      gl_FragColor = vec4(mix(src.rgb, outc, uAmount), 1.0);
    }
  `,
};

// Monitor glitch (VHS-style): line tearing, RGB split, scanlines, grain, plus a constant vignette.
export const GlitchShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0 },
    uTime: { value: 0 },
    uRes: { value: [1, 1] },
    uFade: { value: 0 },
  },
  vertexShader: passVert,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uTime; uniform vec2 uRes; uniform float uFade;
    varying vec2 vUv;
    float rnd(float x){ return fract(sin(x * 12.9898) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      float line = floor(uv.y * 48.0);
      float tick = floor(uTime * 14.0);
      float j = step(1.0 - uAmount * 0.4, rnd(line + tick * 1.7));
      uv.x += (rnd(line * 3.1 + tick) - 0.5) * 0.09 * j * uAmount;
      float s = 0.007 * uAmount;
      vec3 c;
      c.r = texture2D(tDiffuse, uv + vec2(s, 0.0)).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - vec2(s, 0.0)).b;
      c *= 1.0 - 0.18 * uAmount * step(0.5, fract(vUv.y * uRes.y * 0.33));
      c += (rnd(uv.y * 997.0 + uv.x * 131.0 + uTime) - 0.5) * 0.10 * uAmount;
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * 0.55;
      c = mix(c, vec3(0.0), uFade);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

// Particles: the walls dissolve, every particle funnels through the single door slit, then fans out into the outside world.
export const ParticleShader = {
  vertexShader: /* glsl */ `
    attribute vec3 aEnd; attribute float aDelay; attribute vec3 aColor; attribute vec3 aJit;
    uniform float uProgress; uniform float uTime; uniform vec3 uDoor; uniform float uSize; uniform float uMin; uniform float uMax;
    varying vec3 vColor; varying float vAlpha;
    void main(){
      float t = clamp((uProgress - aDelay * 0.55) / 0.45, 0.0, 1.0);
      vec3 D = uDoor + aJit;
      vec3 p;
      if (t < 0.42) { float u = smoothstep(0.0, 0.42, t); p = mix(position, D, u); }
      else { float u = smoothstep(0.42, 1.0, t); p = mix(D, aEnd, u); }
      float wob = sin(t * 3.14159);
      p += wob * 0.35 * vec3(sin(uTime * 1.3 + aDelay * 40.0), cos(uTime * 1.1 + aDelay * 30.0), sin(uTime * 0.9 + aDelay * 20.0));
      float settled = step(0.999, t);
      p.y += settled * sin(uTime * 0.6 + aEnd.x * 0.05 + aEnd.z * 0.04) * 0.6;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(uSize * (1.0 + wob * 1.2) / max(-mv.z, 0.5), uMin, uMax);
      vColor = mix(vec3(0.95), aColor, smoothstep(0.35, 1.0, t));
      vAlpha = mix(0.9, 0.85, t);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vColor; varying float vAlpha;
    void main(){
      vec2 d = gl_PointCoord - 0.5;
      float r = dot(d, d);
      if (r > 0.25) discard;
      gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.25, 0.0, r));
    }
  `,
};
