import * as THREE from 'three';
import { U } from './materials.js';

// Late afternoon: the sun twelve degrees up, a little south of west, behind the tent.
export const SUN_DIR = U.uSunDir.value;

// The sky, with the granite ranges of Sinai painted into it as two layers of ridges.
// Before the wash arrives the same ridges are two ink lines on the paper.
export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uEnv: U.uEnv, uPaper: U.uPaper, uInk: U.uInk, uSun: { value: SUN_DIR } },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform float uEnv; uniform vec3 uPaper; uniform vec3 uInk; uniform vec3 uSun;
      varying vec3 vDir;
      float ridge(float a, float f, float s){
        float h = 0.0, amp = 1.0;
        for (int o = 0; o < 6; o++) {
          float fo = float(o);
          h += amp * (0.5 + 0.5 * sin(a * f + s + fo * 2.37) * sin(a * f * 0.53 + s * 1.7 + fo));
          amp *= 0.52; f *= 2.13;
        }
        return h;
      }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        float e = asin(clamp(h, -1.0, 1.0));
        float s = max(dot(d, uSun), 0.0);
        vec2 hd = normalize(d.xz + 1e-5), hs = normalize(uSun.xz);
        float az = max(dot(hd, hs), 0.0);
        float a = atan(d.z, d.x);

        // sky
        float toward = pow(az, 2.5) * (1.0 - clamp(h, 0.0, 1.0));
        vec3 zenith  = vec3(0.32, 0.43, 0.66);
        vec3 horSun  = vec3(1.00, 0.72, 0.46);
        vec3 horAway = vec3(0.88, 0.74, 0.70);
        vec3 col = mix(mix(horAway, horSun, toward), zenith, pow(clamp(h, 0.0, 1.0), 0.5));
        col += vec3(1.0, 0.6, 0.3) * pow(s, 14.0) * 0.45;
        col += vec3(1.0, 0.82, 0.55) * pow(s, 400.0) * 0.6;
        col += vec3(1.0, 0.95, 0.82) * smoothstep(0.99955, 0.99975, s) * 2.0;

        // ridges: the far range higher behind the sun, the near range low and darker
        float west = pow(az, 3.0);
        float hFar  = radians(0.9 + 2.0 * ridge(a, 5.0, 1.3) + 2.4 * west * ridge(a, 9.0, 4.1));
        float hNear = radians(0.35 + 1.25 * ridge(a, 11.0, 7.7));
        float aa = fwidth(e) * 1.2;
        float inFar  = 1.0 - smoothstep(-aa, aa, e - hFar);
        float inNear = 1.0 - smoothstep(-aa, aa, e - hNear);
        vec3 haze = mix(horAway, horSun, pow(az, 2.0));
        vec3 farCol  = mix(mix(vec3(0.74, 0.52, 0.46), vec3(0.50, 0.36, 0.40), pow(az, 2.0)), haze, 0.45);
        vec3 nearCol = mix(mix(vec3(0.62, 0.40, 0.33), vec3(0.34, 0.24, 0.24), pow(az, 2.0)), haze, 0.25);
        col = mix(col, farCol, inFar);
        col = mix(col, nearCol, inNear);
        col = mix(col, haze, smoothstep(0.004, -0.01, e) * 0.7);

        // paper version: the two ridge lines in ink
        float lw = fwidth(e) * 0.9;
        float lineFar  = 1.0 - smoothstep(0.0, lw, abs(e - hFar));
        float lineNear = 1.0 - smoothstep(0.0, lw, abs(e - hNear));
        vec3 paper = mix(uPaper, uInk, max(lineFar * 0.55, lineNear * 0.8) * step(0.0, e));
        gl_FragColor = vec4(mix(paper, col, uEnv), 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1000, 64, 32), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

// Drifting particles: smoke from the altar, incense, and the cloud upon the mercy seat.
// Each particle lives a loop of rise, drift and fade; the look is set by the options.
export function makeParticles(origin, o = {}) {
  const opt = {
    count: 220, speed: 0.05, rise: 5.5, drift: [4.5, -5.5], spread: 1.0, swirl: 0.6,
    size: [0.8, 4.0], alpha: 0.13, colA: [0.62, 0.55, 0.50], colB: [0.66, 0.62, 0.64], additive: false, ...o,
  };
  const seeds = new Float32Array(opt.count);
  for (let i = 0; i < opt.count; i++) seeds[i] = i / opt.count;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(opt.count * 3), 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uAmt: { value: 0 }, uOrigin: { value: origin }, uScale: { value: 800 },
      uSpeed: { value: opt.speed }, uRise: { value: opt.rise }, uDrift: { value: new THREE.Vector2(...opt.drift) },
      uSpread: { value: opt.spread }, uSwirl: { value: opt.swirl }, uSize: { value: new THREE.Vector2(...opt.size) },
      uAlpha: { value: opt.alpha }, uColA: { value: new THREE.Vector3(...opt.colA) }, uColB: { value: new THREE.Vector3(...opt.colB) },
    },
    transparent: true,
    depthWrite: false,
    blending: opt.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */`
      attribute float seed;
      uniform float uTime, uSpeed, uRise, uSpread, uSwirl, uScale;
      uniform vec3 uOrigin; uniform vec2 uDrift, uSize;
      varying float vLife;
      void main(){
        float life = fract(seed * 7.0 + uTime * uSpeed);
        vLife = life;
        float r1 = fract(seed * 91.7) - 0.5, r2 = fract(seed * 53.3) - 0.5;
        float rise = 1.0 - pow(1.0 - life, 1.6);
        float sw = seed * 40.0 + uTime * 0.4;
        vec3 p = uOrigin + vec3(
          r1 * uSpread + life * uDrift.x + sin(sw) * uSwirl * life,
          rise * uRise,
          r2 * uSpread + life * uDrift.y + cos(sw * 0.8) * uSwirl * life);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = min(mix(uSize.x, uSize.y, life) * uScale / -mv.z, 400.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uAmt, uAlpha; uniform vec3 uColA, uColB;
      varying float vLife;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.05, length(q));
        a *= smoothstep(0.0, 0.1, vLife) * pow(1.0 - vLife, 2.2) * uAlpha * uAmt;
        gl_FragColor = vec4(mix(uColA, uColB, vLife) * (1.0 + 0.15 * (0.5 - q.y)), a);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

// A soft additive glow, for lamp flames and the light above the mercy seat.
let glowTex = null;
export function makeGlow(color, size) {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(c);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
  }));
  sp.scale.setScalar(size);
  return sp;
}
