import * as THREE from 'three';

// One set of uniforms drives every surface: where the section cut is,
// where the wash of real material has reached, and how much of the world
// beyond the court has turned from paper into landscape.
export const U = {
  uCut:   { value: 1.2 },      // world height of the plan cut (m)
  uSweep: { value: 200 },      // world x of the material front; x > uSweep is real
  uSweepOut: { value: 200 },   // the same front for the outside of the tent, which turns real at the door
  uEnv:   { value: 0 },        // 0 = paper world, 1 = sky, desert and mountains
  uPaper: { value: new THREE.Vector3(0.925, 0.929, 0.914) }, // display-space, not linear
  uInk:   { value: new THREE.Vector3(0.102, 0.110, 0.122) },
  uSheet: { value: null },
  uRag:   { value: 1 },        // raggedness of the wash front; tighter inside the tent
  uInkBack: { value: 0 },      // the ink drawing laid back over the finished building
  uSunDir: { value: new THREE.Vector3(-0.978, 0.2126, 0.208).normalize() },
};

export const SHEET = { x0: -44, z0: -31.1, w: 88, h: 62.2 };

export const GLSL_COMMON = /* glsl */`
uniform float uCut;
uniform float uSweep;
uniform float uSweepOut;
uniform float uEnv;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uSunDir;
uniform float uRag;
uniform float uInkBack;
varying vec3 vWPos;
float th_hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float th_noise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(th_hash(i), th_hash(i + vec2(1, 0)), u.x), mix(th_hash(i + vec2(0, 1)), th_hash(i + vec2(1, 1)), u.x), u.y);
}
// The front is ragged like a wash of colour soaking into paper.
float th_sweepAt(vec3 p, float front){
  float n = (th_noise(p.xz * 0.45) * 1.3 + th_noise(p.xz * 2.3 + p.y * 0.7) * 0.45 - 0.9) * uRag;
  return smoothstep(-0.7 * uRag, 0.7 * uRag, p.x - front + n);
}
float th_sweep(vec3 p){ return th_sweepAt(p, uSweep); }
`;

const FINAL = /* glsl */`
{
#if defined(TH_ENV)
  float m = uEnv;
#elif defined(TH_GROUND)
  // the tent's own floor follows the visitor in; the court and the land beyond follow the outer wash
  float inside = step(abs(vWPos.x), 26.3) * step(abs(vWPos.z), 13.3);
  float inTent = step(-15.9, vWPos.x) * step(vWPos.x, 0.0) * step(abs(vWPos.z), 2.85);
  float mOut = th_sweepAt(vWPos, uSweepOut);
  float m = mix(max(mOut, uEnv), mix(mOut, th_sweep(vWPos), inTent), inside);
#elif defined(TH_OUTER)
  float m = th_sweepAt(vWPos, uSweepOut);
#else
  float m = th_sweep(vWPos);
#endif
#ifdef TH_GROUND
  vec3 paper = uPaper * (0.988 + 0.012 * th_noise(vWPos.xz * 9.0));
  vec2 suv = vec2((vWPos.x - ${SHEET.x0.toFixed(2)}) / ${SHEET.w.toFixed(2)}, (vWPos.z - ${SHEET.z0.toFixed(2)}) / ${SHEET.h.toFixed(2)});
  float sheetInk = (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) ? texture2D(uSheet, suv).a : 0.0;
  paper = mix(paper, uInk, sheetInk);
#else
  vec3 wn = normalize(vWNorm);
  vec3 paper = uPaper * (0.80 + 0.20 * clamp(dot(wn, vec3(0.29, 0.84, 0.46)), 0.0, 1.0));
  if (!gl_FrontFacing && uCut < 500.0) paper = uInk;   // section poché: the inside of a cut solid reads as solid black
#endif
  float rim = 1.0 - abs(m * 2.0 - 1.0);
  vec3 real = gl_FragColor.rgb;
#ifdef TH_TRANSLUCENT
  // low sun shining through the woven cloth from the far side
  real += sqrt(diffuseColor.rgb) * vec3(1.0, 0.76, 0.54) * (0.07 + 0.42 * max(0.0, -dot(wn, uSunDir))) * float(gl_FrontFacing);
#endif
  vec3 col = mix(paper, real, m);
  col = mix(col, uInk, rim * 0.22);
#ifdef TH_GROUND
  col = mix(col, uInk, sheetInk * uInkBack * 0.85);
#else
  if (!gl_FrontFacing && uCut < 500.0) col = uInk;   // while the cut is on, a cut solid stays solid in section
#endif
  gl_FragColor.rgb = col;
  gl_FragColor.a = mix(1.0, gl_FragColor.a, m);
}
`;

// mode: how the surface is lit and masked; outer: follows the outer wash (court and tent exterior)
export function patch(mat, mode = 'sweep', outer = false) {
  const defs = (mode === 'env' ? '#define TH_ENV\n' : mode === 'ground' ? '#define TH_GROUND\nuniform sampler2D uSheet;\n' : mode === 'cloth' ? '#define TH_TRANSLUCENT\n' : '')
    + (outer ? '#define TH_OUTER\n' : '');
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 thP = vec4(transformed, 1.0);
        vec3 thN = objectNormal;
        #ifdef USE_INSTANCING
          thP = instanceMatrix * thP; thN = mat3(instanceMatrix) * thN;
        #endif
        vWPos = (modelMatrix * thP).xyz;
        vWNorm = normalize(mat3(modelMatrix) * thN);`);
    sh.fragmentShader = defs + sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWNorm;\n' + GLSL_COMMON)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vWPos.y > uCut) discard;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + FINAL);
  };
  mat.customProgramCacheKey = () => 'th-' + mode + (outer ? '-out' : '');
  mat.userData.outer = outer;
  if (mode === 'sweep' || mode === 'cloth') {
    mat.side = THREE.DoubleSide;
    mat.shadowSide = THREE.BackSide;
  }
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = 1;
  mat.polygonOffsetUnits = 1;
  return mat;
}

// Ink lines: every hard edge of the model, fading out where the wash has passed.
export function lineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: U,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      attribute float aOuter;
      varying vec3 vWPos;
      varying float vOuter;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        vOuter = aOuter;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: GLSL_COMMON + /* glsl */`
      varying float vOuter;
      void main(){
        if (vWPos.y > uCut + 0.002) discard;
        float a = max(1.0 - th_sweepAt(vWPos, mix(uSweep, uSweepOut, vOuter)), uInkBack * 0.8);
        if (a < 0.01) discard;
        gl_FragColor = vec4(uInk, a);
      }`,
  });
}

// ---------- textures ----------
const loader = new THREE.TextureLoader();
let maxAniso = 8;
export function setAnisotropy(n) { maxAniso = n; }

function tex(name, srgb, repeat) {
  const t = loader.load(`textures/${name}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(repeat, repeat);
  return t;
}
function set(name, repeat) {
  return {
    map: tex(name + '_diff', true, repeat),
    normalMap: tex(name + '_nor', false, repeat),
    roughnessMap: tex(name + '_rough', false, repeat),
  };
}

function canvasTex(w, h, draw, repeatU, repeatV) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.repeat.set(repeatU, repeatV);
  return t;
}

// The three hangings at the gate, the door and the veil use only these four (Ex 26:31, 36; 27:16).
const BLUE = '#2b4a8c', PURPLE = '#5f2a57', SCARLET = '#a3231f', LINEN = '#e8e0cd';

// Gate of the court: blue, purple, scarlet and fine twined linen, needlework (Ex 27:16).
// A field of blue and purple twined together, a lattice of linen thread with
// scarlet pomegranates at the crossings, and deep borders at head and hem.
// One tile covers 3.47 m x 2.6 m, one bay of the gate.
function drawGate(g, w, h) {
  const fieldTop = h * 0.16, fieldBot = h * 0.84;
  // twined field: fine alternating threads of blue and purple
  for (let x = 0; x < w; x += 4) {
    g.fillStyle = (x / 4) % 3 === 2 ? PURPLE : BLUE;
    g.fillRect(x, fieldTop, 4, fieldBot - fieldTop);
  }
  // the linen twined through it, a fine weft
  g.fillStyle = 'rgba(232,224,205,0.14)';
  for (let y = fieldTop; y < fieldBot; y += 3) g.fillRect(0, y, w, 1);
  // lattice of linen thread
  const cell = w / 8;
  g.strokeStyle = 'rgba(232,224,205,0.8)'; g.lineWidth = 3;
  g.save(); g.beginPath(); g.rect(0, fieldTop, w, fieldBot - fieldTop); g.clip();
  for (let k = -8; k < 16; k++) {
    g.beginPath(); g.moveTo(k * cell, fieldTop); g.lineTo(k * cell + (fieldBot - fieldTop), fieldBot); g.stroke();
    g.beginPath(); g.moveTo(k * cell, fieldBot); g.lineTo(k * cell + (fieldBot - fieldTop), fieldTop); g.stroke();
  }
  // pomegranates of scarlet at the crossings
  for (let k = -8; k < 16; k++) for (let j = 0; j < 8; j++) {
    const cx = k * cell + j * cell, cy = fieldTop + j * (cell / 2) * 2;
    if (cy > fieldBot) continue;
    for (const [px, py] of [[cx, cy], [cx + cell / 2, cy + cell / 2]]) {
      g.fillStyle = SCARLET; g.beginPath(); g.ellipse(px, py, 10, 12, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = PURPLE; g.fillRect(px - 3, py - 16, 6, 5);
    }
  }
  g.restore();
  // borders at head and hem: scarlet with purple and linen edging, a running almond-flower band
  for (const [y0, y1] of [[0, fieldTop], [fieldBot, h]]) {
    g.fillStyle = LINEN; g.fillRect(0, y0, w, y1 - y0);
    g.fillStyle = SCARLET; g.fillRect(0, y0 + 10, w, y1 - y0 - 20);
    g.fillStyle = PURPLE; g.fillRect(0, y0 + 10, w, 8); g.fillRect(0, y1 - 18, w, 8);
    const my = (y0 + y1) / 2;
    for (let x = 18; x < w; x += 36) {
      g.fillStyle = LINEN;
      g.beginPath(); g.ellipse(x, my, 12, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = BLUE;
      g.beginPath(); g.arc(x, my, 3.5, 0, Math.PI * 2); g.fill();
    }
  }
}

// Cherubim of cunning work (Ex 26:1, 31): woven figures with wings raised, in a lattice
// of purple with scarlet knots. One tile holds two by two figures.
function drawCherubim(g, w, h, field, thread, accent = SCARLET) {
  g.fillStyle = field; g.fillRect(0, 0, w, h);
  const cell = w / 2;
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const cx = cell * i + cell / 2, cy = cell * j + cell / 2 + 30;
    // wings: two raised and spread, filled with the figure's thread, feathers picked out in the accent
    for (const sd of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + sd * 14, cy - 60);
      g.bezierCurveTo(cx + sd * 90, cy - 210, cx + sd * 200, cy - 190, cx + sd * 215, cy - 120);
      for (let k = 0; k < 6; k++) {
        const t = k / 5;
        g.quadraticCurveTo(cx + sd * (205 - t * 150), cy - 95 + t * 50, cx + sd * (190 - t * 165), cy - 108 + t * 70);
      }
      g.closePath();
      g.fillStyle = thread; g.fill();
      g.strokeStyle = accent; g.lineWidth = 4;
      for (let k = 1; k < 6; k++) {
        g.beginPath(); g.moveTo(cx + sd * 26, cy - 62); g.lineTo(cx + sd * (60 + k * 28), cy - 150 + k * 10); g.stroke();
      }
    }
    // figure: robe, head
    g.fillStyle = thread;
    g.beginPath(); g.moveTo(cx - 34, cy + 120); g.lineTo(cx - 20, cy - 60); g.lineTo(cx + 20, cy - 60); g.lineTo(cx + 34, cy + 120); g.closePath(); g.fill();
    g.beginPath(); g.arc(cx, cy - 84, 22, 0, Math.PI * 2); g.fill();
    g.strokeStyle = accent; g.lineWidth = 3;
    for (let y = cy - 30; y < cy + 120; y += 22) { g.beginPath(); g.moveTo(cx - 24, y); g.lineTo(cx + 24, y); g.stroke(); }
  }
  // the lattice between the figures
  g.strokeStyle = PURPLE; g.lineWidth = 12;
  for (let k = 0; k <= 2; k++) { g.beginPath(); g.moveTo(k * cell, 0); g.lineTo(k * cell, h); g.stroke(); g.beginPath(); g.moveTo(0, k * cell); g.lineTo(w, k * cell); g.stroke(); }
  g.fillStyle = accent;
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) { g.beginPath(); g.arc(i * cell, j * cell, 16, 0, Math.PI * 2); g.fill(); }
}

function drawHammered(g, w, h) {
  g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, w, h);
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * w, y = rnd() * h, r = 6 + rnd() * 18, v = 150 + rnd() * 90 | 0;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${v},${v},${v},0.5)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// Relief for the table's border: a running scroll with rosettes, read through the bump map.
function drawRelief(g, w, h) {
  g.fillStyle = '#777'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10);
  g.strokeStyle = '#eee'; g.lineWidth = 7; g.lineCap = 'round';
  const step = w / 4;
  for (let i = 0; i < 4; i++) {
    const cx = i * step + step / 2;
    g.beginPath(); g.arc(cx, h / 2, h * 0.22, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      g.beginPath(); g.moveTo(cx, h / 2); g.lineTo(cx + Math.cos(a) * h * 0.2, h / 2 + Math.sin(a) * h * 0.2); g.stroke();
    }
    g.beginPath();
    g.moveTo(cx + h * 0.3, h / 2);
    g.bezierCurveTo(cx + step * 0.35, h * 0.1, cx + step * 0.45, h * 0.9, cx + step - h * 0.3, h / 2);
    g.stroke();
  }
}

function drawFlutes(g, w, h) {
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, '#222'); gr.addColorStop(0.5, '#ddd'); gr.addColorStop(1, '#222');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}

function drawRope(g, w, h) {
  g.fillStyle = '#333'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#eee'; g.lineWidth = w * 0.32;
  for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(k * w, h); g.lineTo(k * w + w, 0); g.stroke(); }
}

// framed panels of the altar's upper zone: four across, two high, raised frames, sunk fields
function drawPanels(g, w, h) {
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  const pw = w / 4, ph = h / 2, m = 14;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
    g.fillStyle = '#333'; g.fillRect(i * pw + m, j * ph + m, pw - 2 * m, ph - 2 * m);
    g.fillStyle = '#777'; g.fillRect(i * pw + m + 6, j * ph + m + 6, pw - 2 * m - 12, ph - 2 * m - 12);
  }
}

// the network of brass: diagonal bars crossing, a stud at every crossing
function drawLattice(g, w, h) {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#fff'; g.lineWidth = 15;
  const step = 78;
  for (let k = -h; k < w + h; k += step) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke();
    g.beginPath(); g.moveTo(k, h); g.lineTo(k + h, 0); g.stroke();
  }
  g.fillStyle = '#fff';
  for (let k = -h; k < w + h; k += step) for (let y = 0; y <= h; y += step) {
    g.beginPath(); g.arc(k + y, y, 13, 0, Math.PI * 2); g.fill();
  }
}

function drawRosette(g, w, h) {
  g.fillStyle = '#555'; g.fillRect(0, 0, w, h);
  const c = w / 2;
  g.fillStyle = '#ddd';
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    g.beginPath(); g.ellipse(c + Math.cos(a) * w * 0.22, c + Math.sin(a) * w * 0.22, w * 0.15, w * 0.07, a, 0, Math.PI * 2); g.fill();
  }
  g.beginPath(); g.arc(c, c, w * 0.1, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  g.strokeStyle = '#eee'; g.lineWidth = w * 0.04; g.beginPath(); g.arc(c, c, w * 0.45, 0, Math.PI * 2); g.stroke();
}

// a raised and fielded panel: a sunk margin round a bevelled, raised field
function drawFielded(g, w, h) {
  g.fillStyle = '#bbb'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#444'; g.fillRect(w * 0.08, h * 0.05, w * 0.84, h * 0.9);
  const bx = w * 0.13, by = h * 0.08;
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, '#555'); gr.addColorStop(0.08, '#eee'); gr.addColorStop(0.92, '#eee'); gr.addColorStop(1, '#555');
  g.fillStyle = gr; g.fillRect(bx, by, w - 2 * bx, h - 2 * by);
  g.fillStyle = '#fff'; g.fillRect(bx + w * 0.07, by + h * 0.04, w - 2 * bx - w * 0.14, h - 2 * by - h * 0.08);
}

// a frieze of palmettes, each standing in an arch, after the reference ark
function drawPalmettes(g, w, h) {
  g.fillStyle = '#555'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ccc'; g.fillRect(0, 0, w, h * 0.12); g.fillRect(0, h * 0.88, w, h * 0.12);
  const cx = w / 2, by = h * 0.85;
  g.strokeStyle = '#eee'; g.lineWidth = w * 0.05;
  g.beginPath(); g.arc(cx, by, w * 0.44, Math.PI, 0); g.stroke();
  g.fillStyle = '#fff';
  for (let k = -3; k <= 3; k++) {
    const a = -Math.PI / 2 + k * 0.32;
    g.save(); g.translate(cx, by - h * 0.05); g.rotate(a + Math.PI / 2);
    g.beginPath(); g.ellipse(0, -h * 0.3, w * 0.05, h * 0.26, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }
}

// feathers: long quills with a shaft line, and a scale pattern for the covert feathers
function drawQuills(g, w, h) {
  g.fillStyle = '#666'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 8; i++) {
    const x0 = (i + 0.5) * w / 8;
    g.fillStyle = '#ccc'; g.fillRect(x0 - w / 20, 0, w / 10, h);
    g.fillStyle = '#fff'; g.fillRect(x0 - 1.5, 0, 3, h);
  }
}
function drawScales(g, w, h) {
  g.fillStyle = '#444'; g.fillRect(0, 0, w, h);
  const r = w / 8;
  for (let j = 0; j < 9; j++) for (let i = -1; i < 9; i++) {
    const cx = i * r * 2 + (j % 2) * r, cy = j * r * 1.2;
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.8, '#bbb'); gr.addColorStop(1, '#333');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI); g.fill();
  }
}

// the door screen: needlework in bands of blue, purple, scarlet and linen, hanging in folds
function drawDoorScreen(g, w, h) {
  // the four threads in turn, blue and purple leading, scarlet and linen between
  const bands = [BLUE, PURPLE, BLUE, SCARLET, PURPLE, BLUE, PURPLE, LINEN, BLUE, PURPLE, SCARLET, PURPLE];
  const n = 36, bw = w / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = bands[i % bands.length]; g.fillRect(i * bw, 0, bw + 1, h);
    const gr = g.createLinearGradient(i * bw, 0, (i + 1) * bw, 0);   // the fold: lit on one side, shaded on the other
    gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = gr; g.fillRect(i * bw, 0, bw + 1, h);
  }
  // needlework stitches of linen
  g.fillStyle = LINEN;
  for (let i = 0; i < n; i++) for (let y = 30; y < h; y += 90) g.fillRect(i * bw + bw / 2 - 1, y, 2, 12);
}

function drawGrate(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#fff';
  const s = w / 16;
  for (let i = 0; i <= 16; i++) { g.fillRect(i * s - 2, 0, 4, h); g.fillRect(0, i * s - 2, w, 4); }
}

export function makeMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);

  const linenSet = set('rough_linen', 1.2);
  const linen = std({ ...linenSet, color: 0xf2ebdc, roughness: 1, envMapIntensity: 0.45 });

  const gateMap = canvasTex(1024, 768, drawGate, 1 / 3.47, 1 / 2.6);
  const gate = std({ map: gateMap, normalMap: linenSet.normalMap, roughness: 0.95, envMapIntensity: 0.6 });

  const doorMap = canvasTex(1024, 1024, drawDoorScreen, 1 / 2.6, 1 / 5.2);
  const door = std({ map: doorMap, normalMap: linenSet.normalMap, roughness: 0.95, envMapIntensity: 0.6 });

  const veilMap = canvasTex(1024, 1024, (g, w, h) => drawCherubim(g, w, h, BLUE, LINEN), 1 / 1.3, 1 / 1.3);
  const veil = std({ map: veilMap, normalMap: linenSet.normalMap, roughness: 0.9 });

  const ceilMap = canvasTex(1024, 1024, (g, w, h) => drawCherubim(g, w, h, BLUE, LINEN), 1 / 2.0, 1 / 2.0);
  const ceiling = std({ map: ceilMap, normalMap: linenSet.normalMap, roughness: 0.9 });

  const woodSet = set('rough_wood', 1);
  const acacia = std({ ...woodSet, color: 0xe6b98a, roughness: 1, envMapIntensity: 0.5 });
  const charred = std({ map: woodSet.map, color: 0x2a1c14, roughness: 1, envMapIntensity: 0 });

  // hammered metal: a soft mottle in the roughness, the marks of beaten work
  const hammer = canvasTex(512, 512, drawHammered, 1.5, 1.5);
  hammer.colorSpace = THREE.NoColorSpace;
  const metal = (color, rough, bump = 0.6) => std({ roughnessMap: hammer, bumpMap: hammer, bumpScale: bump, color, metalness: 1, roughness: rough });
  const bronze = metal(0x9c6f45, 0.48, 1.2);
  const silver = metal(0xd2d4d6, 0.42);
  // the altar of burnt offering: panels, network and rosettes in brass
  const panelTex = canvasTex(512, 256, drawPanels, 1 / 1.96, 1 / 0.55); panelTex.colorSpace = THREE.NoColorSpace;
  const latticeTex = canvasTex(1024, 384, drawLattice, 1 / 1.96, 1 / 0.58); latticeTex.colorSpace = THREE.NoColorSpace;
  const rosetteTex = canvasTex(128, 128, drawRosette, 1, 1); rosetteTex.colorSpace = THREE.NoColorSpace;
  const bronzePanel = std({ roughnessMap: hammer, bumpMap: panelTex, bumpScale: 5, color: 0x9c6f45, metalness: 1, roughness: 0.48 });
  const lattice = std({ roughnessMap: hammer, alphaMap: latticeTex, alphaTest: 0.5, bumpMap: latticeTex, bumpScale: 4, color: 0xa47548, metalness: 1, roughness: 0.4 });
  const bronzeRosette = std({ bumpMap: rosetteTex, bumpScale: 6, color: 0xa47548, metalness: 1, roughness: 0.42 });
  // the laver: brass from the women's looking-glasses, polished, with fluted foot and knop and twisted bands
  const flutes = canvasTex(128, 32, drawFlutes, 40, 1); flutes.colorSpace = THREE.NoColorSpace;
  const rope = canvasTex(64, 64, drawRope, 110, 1); rope.colorSpace = THREE.NoColorSpace;
  // the candlestick: petalled buds and reeded steps, in gold
  const budTex = flutes.clone(); budTex.repeat.set(10, 1); budTex.needsUpdate = true;
  const reedTex = flutes.clone(); reedTex.repeat.set(90, 1); reedTex.needsUpdate = true;
  const fielded = canvasTex(256, 512, drawFielded, 1 / 0.39, 1 / 0.75); fielded.colorSpace = THREE.NoColorSpace;
  const goldFielded = std({ roughnessMap: hammer, bumpMap: fielded, bumpScale: 5, color: 0xe2b05a, metalness: 1, roughness: 0.45 });
  // the ark: sunk panels, palmette frieze, rosettes, a reeded cornice, feathered wings
  const sunkTex = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#ddd'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#999'; g.fillRect(w * 0.03, h * 0.06, w * 0.94, h * 0.88);
    g.fillStyle = '#555'; g.fillRect(w * 0.05, h * 0.1, w * 0.9, h * 0.8);
  }, 1, 1);
  sunkTex.colorSpace = THREE.NoColorSpace;
  const goldSunk = std({ roughnessMap: hammer, bumpMap: sunkTex, bumpScale: 4, color: 0xe2b05a, metalness: 1, roughness: 0.42 });
  const palmTex = canvasTex(128, 128, drawPalmettes, 1 / 0.075, 1 / 0.075); palmTex.colorSpace = THREE.NoColorSpace;
  const goldFrieze = std({ roughnessMap: hammer, bumpMap: palmTex, bumpScale: 6, color: 0xe2b05a, metalness: 1, roughness: 0.4 });
  const goldRosette = std({ bumpMap: rosetteTex, bumpScale: 6, color: 0xe2b05a, metalness: 1, roughness: 0.4 });
  const cavTex = flutes.clone(); cavTex.repeat.set(70, 1); cavTex.needsUpdate = true;
  const goldCavetto = std({ roughnessMap: hammer, bumpMap: cavTex, bumpScale: 3, color: 0xe2b05a, metalness: 1, roughness: 0.4, side: THREE.DoubleSide });
  const quillTex = canvasTex(256, 64, drawQuills, 4, 4); quillTex.colorSpace = THREE.NoColorSpace;
  quillTex.rotation = Math.PI / 2;   // quills run along the wing, root to tip
  const scaleTex = canvasTex(256, 256, drawScales, 16, 16); scaleTex.colorSpace = THREE.NoColorSpace;
  const goldFeather = std({ bumpMap: quillTex, bumpScale: 1.4, color: 0xe8b860, metalness: 1, roughness: 0.38 });
  const goldScale = std({ bumpMap: scaleTex, bumpScale: 1.6, color: 0xe8b860, metalness: 1, roughness: 0.38 });
  const goldBud = std({ roughnessMap: hammer, bumpMap: budTex, bumpScale: 3, color: 0xe2b05a, metalness: 1, roughness: 0.42 });
  const goldReed = std({ roughnessMap: hammer, bumpMap: reedTex, bumpScale: 2, color: 0xe2b05a, metalness: 1, roughness: 0.45 });
  const bronzePolished = std({ roughnessMap: hammer, color: 0x7a5434, metalness: 1, roughness: 0.18, envMapIntensity: 1.0 });
  const bronzeFluted = std({ roughnessMap: hammer, bumpMap: flutes, bumpScale: 3, color: 0x725032, metalness: 1, roughness: 0.24, envMapIntensity: 1.0 });
  const bronzeRope = std({ bumpMap: rope, bumpScale: 4, color: 0x86603c, metalness: 1, roughness: 0.22, envMapIntensity: 1.0 });
  const relief = canvasTex(1024, 256, drawRelief, 1 / 0.6, 1 / 0.09);
  relief.colorSpace = THREE.NoColorSpace;
  const goldPanel = std({ roughnessMap: hammer, bumpMap: hammer, bumpScale: 4, color: 0xe2b05a, metalness: 1, roughness: 0.42 });
  const goldRelief = std({ roughnessMap: hammer, bumpMap: relief, bumpScale: 6, color: 0xe2b05a, metalness: 1, roughness: 0.45 });
  const gold = metal(0xe2b05a, 0.5);

  const grateMap = canvasTex(256, 256, drawGrate, 3, 3);
  grateMap.colorSpace = THREE.NoColorSpace;
  const grate = std({ color: 0x8a5a30, metalness: 1, roughness: 0.6, alphaMap: grateMap, alphaTest: 0.5 });

  const hairSet = set('hessian_230', 1.4);
  const goatHair = std({ ...hairSet, color: 0x3b332d, roughness: 1, envMapIntensity: 0.4 });
  const leatherSet = set('brown_leather', 0.8);
  const ramRed = std({ ...leatherSet, color: 0xb2392a, roughness: 0.9, envMapIntensity: 0.4 });
  const tachash = std({ ...leatherSet, color: 0x4a3f37, roughness: 0.85, envMapIntensity: 0.5 });

  const sandSet = set('dense_sand', 1);
  const earth = std({ ...sandSet, color: 0xb59a7a, roughness: 1 });

  const groundSet = set('dense_sand', 1 / 3);
  const ground = std({ ...groundSet, color: 0xe8cfae, roughness: 1, envMapIntensity: 0.6 });

  const water = std({ color: 0x24302f, metalness: 0.2, roughness: 0.05, bumpMap: hammer, bumpScale: 0.25, envMapIntensity: 1.4 });
  const bread = std({ color: 0xe9dcc0, roughness: 0.95 });
  const coal = std({ color: 0x220b02, emissive: 0xff5a10, emissiveMap: hammer, emissiveIntensity: 1.6, roughness: 1 });
  const flame = std({ color: 0xffd28a, emissive: 0xffb050, emissiveIntensity: 3 });

  const M = { linen, gate, door, veil, ceiling, acacia, charred, bronze, silver, gold, goldRelief, goldPanel, goldBud, goldReed, goldFielded, goldSunk, goldFrieze, goldRosette, goldCavetto, goldFeather, goldScale, bronzePanel, lattice, bronzeRosette, bronzePolished, bronzeFluted, bronzeRope, grate, goatHair, ramRed, tachash, earth, water, bread, coal, flame };
  // the coverings, cords and pins of the tent: their own wash, which reaches them at the door
  M.tentCord = std({ color: 0xd8ccb0, roughness: 1 });
  M.tentPin = std({ roughnessMap: hammer, color: 0x9c6f45, metalness: 1, roughness: 0.5 });
  M.silverCourt = metal(0xd2d4d6, 0.42);
  const OUTER = ['goatHair', 'ramRed', 'tachash', 'tentCord', 'tentPin', 'linen', 'acacia', 'bronze', 'silverCourt'];
  for (const [k, m] of Object.entries(M)) patch(m, ['linen', 'gate', 'door', 'veil'].includes(k) ? 'cloth' : 'sweep', OUTER.includes(k));
  M.ground = patch(ground, 'ground');
  return M;
}
