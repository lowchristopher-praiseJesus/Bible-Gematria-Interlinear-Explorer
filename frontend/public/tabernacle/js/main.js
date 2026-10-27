import * as THREE from 'three';
import { U, makeMaterials, lineMaterial, setAnisotropy, SHEET } from './materials.js';
import { buildTabernacle, inkEdges, ownEdges, bakeStatic, SPOTS, COURT, MENORAH_LAMPS } from './model.js';
import { drawSheet } from './sheet.js';
import { initBridge } from './bridge.js';
import { makeSky, makeParticles, makeGlow, SUN_DIR } from './world.js';

const CAPTURE = new URLSearchParams(location.search).has('capture');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const D2R = THREE.MathUtils.degToRad;

// ---------------- renderer, scene ----------------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: CAPTURE });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xdcae8e, 0.00105);
const camera = new THREE.PerspectiveCamera(2, 1, 1, 5000);
camera.rotation.order = 'YXZ';

const sky = makeSky();
scene.add(sky);

const sun = new THREE.DirectionalLight(0xffc28a, 3.4);
sun.position.copy(SUN_DIR).multiplyScalar(120);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 20, far: 260 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xcdc4cc, 0xc8925f, 0.95);
scene.add(hemi);

// ---------------- the model ----------------
const M = makeMaterials();
const lines = lineMaterial();

const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), M.ground);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
// world-metre UVs so the sand keeps its grain size
{
  const uv = ground.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6000, uv.getY(i) * 6000);
}
scene.add(ground);

const T = buildTabernacle(M);
scene.add(T.root);
scene.add(inkEdges(T.root, lines));
T.gateL.children.forEach((m) => ownEdges(m, lines));
for (const g of [T.gateL, T.gateR, T.doorBay, T.veilL, T.veilR]) g.children.forEach((m) => ownEdges(m, lines));
bakeStatic(T.root, new Set());

// ---------------- fire, lamps, incense and the glory ----------------
const fireGlow = new THREE.PointLight(0xff7a2a, 0, 9, 1.6);
fireGlow.position.set(SPOTS.altar.x, 1.9, SPOTS.altar.z);
scene.add(fireGlow);
const smoke = makeParticles(new THREE.Vector3(SPOTS.altar.x, 1.5, SPOTS.altar.z));
const flames = makeParticles(new THREE.Vector3(SPOTS.altar.x, 1.08, SPOTS.altar.z), {
  count: 140, speed: 0.7, rise: 0.75, drift: [0.15, -0.1], spread: 1.5, swirl: 0.12, size: [0.35, 0.8],
  alpha: 0.3, colA: [1.0, 0.62, 0.2], colB: [1.0, 0.25, 0.04], additive: true,
});
scene.add(smoke, flames);

// the candlestick: seven lamps that light the Holy Place (seven flames give soft light, so no hard shadow)
const menLight = new THREE.PointLight(0xffa24a, 0, 13, 2);
menLight.position.set(SPOTS.menorah.x, 1.72, SPOTS.menorah.z);
scene.add(menLight);
const lampGlows = MENORAH_LAMPS.dx.map((dx, i) => {
  const g = makeGlow(0xffb35a, 0.22);
  g.position.set(SPOTS.menorah.x + dx, MENORAH_LAMPS.y[i] + 0.08, SPOTS.menorah.z);
  scene.add(g);
  return g;
});
// a little evening daylight through the woven door screen
const doorLight = new THREE.PointLight(0xffd2a0, 0, 9, 2);
doorLight.position.set(-0.7, 2.6, 0);
scene.add(doorLight);
// incense: coals on the golden altar and a thin rising column
const incenseLight = new THREE.PointLight(0xff6a20, 0, 3, 2);
incenseLight.position.set(SPOTS.incense.x, 1.3, SPOTS.incense.z);
scene.add(incenseLight);
const incense = makeParticles(new THREE.Vector3(SPOTS.incense.x, 1.18, SPOTS.incense.z), {
  count: 160, speed: 0.06, rise: 3.2, drift: [-0.25, 0.15], spread: 0.06, swirl: 0.3, size: [0.06, 0.7],
  alpha: 0.26, colA: [0.86, 0.84, 0.88], colB: [0.72, 0.72, 0.8],
});
scene.add(incense);
// the glory above the mercy seat, between the cherubim (Ex 25:22; Lev 16:2)
const shekLight = new THREE.PointLight(0xfff0d0, 0, 11, 2);
shekLight.position.set(SPOTS.ark.x, 1.3, SPOTS.ark.z);
shekLight.castShadow = true;
shekLight.shadow.mapSize.set(1024, 1024);
shekLight.shadow.bias = -0.002;
scene.add(shekLight);
// lamplight from the Holy Place, through the parted veil, on the face of the ark
const veilFill = new THREE.PointLight(0xffb870, 0, 6, 2);
veilFill.position.set(-10.5, 1.2, 0.5);
scene.add(veilFill);
const shekCore = makeGlow(0xfff4dc, 0.9), shekHalo = makeGlow(0xffdcaa, 3.2);
shekCore.position.set(SPOTS.ark.x, 1.02, SPOTS.ark.z);
shekHalo.position.copy(shekCore.position);
const cloud = makeParticles(new THREE.Vector3(SPOTS.ark.x, 0.95, SPOTS.ark.z), {
  count: 170, speed: 0.025, rise: 1.1, drift: [0, 0], spread: 1.0, swirl: 0.35, size: [0.4, 1.5],
  alpha: 0.11, colA: [1.0, 0.92, 0.76], colB: [1.0, 0.97, 0.9], additive: true,
});
scene.add(shekCore, shekHalo, cloud);
const particles = [smoke, flames, incense, cloud];

// outdoor light is turned down inside the tent, where only the lamps burn
const envBase = new Map(Object.values(M).map((m) => [m, m.envMapIntensity]));

// environment light for the metals, rendered from the evening sky itself
{
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const s2 = makeSky();
  s2.material.uniforms.uEnv = { value: 1 };
  envScene.add(s2);
  const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x9c7552 }));
  g.rotation.x = -Math.PI / 2; g.position.y = -2;
  envScene.add(g);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
}

// ---------------- the camera path ----------------
// Each stop is a view: yaw (0 = facing north, 90 = facing west), pitch, lens, and either
// a target with a framed height W (overhead views) or an eye position P (on foot).
// Between stops the lens and the framed height change together, so the long-lens
// plan opens into perspective without the drawing jumping in size.
const EYE = 1.62;
const RAMP_EYE = 0.8 + EYE;
function stops(aspect) {
  const fitPlan = Math.max(SHEET.h * 1.02, (SHEET.w * 1.02) / aspect);
  const wide = (w) => w * Math.max(1, 1.5 / aspect);
  const A = SPOTS.altar, Lv = SPOTS.laver, Tb = SPOTS.table, Mn = SPOTS.menorah, In = SPOTS.incense, Ak = SPOTS.ark;
  return [
    // the plan, the walls rising, down to the gate
    { b: 0.0, yaw: 0, pitch: -90, fov: 2, W: fitPlan, T: [0, 0, 0] },
    { b: 0.7, yaw: 0, pitch: -90, fov: 2, W: fitPlan, T: [0, 0, 0] },
    { b: 2.5, yaw: 90, pitch: -36, fov: 9, W: wide(46), T: [3, 0, 0], ease: 'power2.inOut' },
    { b: 3.1, yaw: 90, pitch: -31, fov: 11, W: wide(44), T: [4, 0, 0], ease: 'none' },
    { b: 4.5, yaw: 90, pitch: -11, fov: 34, W: 16, T: [34, 2.2, 0], ease: 'power2.inOut' },
    { b: 5.6, yaw: 90, pitch: -1.5, fov: 54, P: [45, EYE, 0], ease: 'power2.out' },
    { b: 6.1, yaw: 90, pitch: -1.0, fov: 54, P: [44.2, EYE, 0], ease: 'none' },
    // through the gate into the court
    { b: 7.4, yaw: 90, pitch: 0, fov: 54, P: [31.5, EYE, 0], ease: 'power1.in', walk: true },
    { b: 8.4, yaw: 90, pitch: 0.6, fov: 55, P: [24.4, EYE, 0.6], ease: 'none', walk: true },
    { b: 9.7, yaw: 87.5, pitch: 2.0, fov: 56, P: [21.6, EYE, 2.9], ease: 'power2.out', walk: true },
    { b: 10.4, fov: 56, P: [21.0, EYE, 3.4], L: [A.x, 1.0, 0.5] },
    // the altar of burnt offering: round to the ramp, up it, and look into the fire
    { b: 11.6, fov: 56, P: [14.7, EYE, 8.6], L: [A.x, 1.1, 1.0], walk: true },
    { b: 12.1, fov: 56, P: [A.x, EYE + 0.02, 7.5], L: [A.x, 1.2, 0], ease: 'power1.inOut', walk: true },
    { b: 13.0, fov: 58, P: [A.x, RAMP_EYE, 2.25], L: [A.x, 0.95, -0.35], walk: true },
    { b: 13.7, fov: 58, P: [A.x, RAMP_EYE, 2.0], L: [A.x, 0.9, -0.4], ease: 'none' },
    // down again and on to the laver
    { b: 14.6, fov: 56, P: [12.6, 2.0, 5.0], L: [Lv.x, 1.0, 1.2], walk: true },
    { b: 15.6, fov: 56, P: [8.6, EYE, 1.9], L: [Lv.x, 0.9, 0], walk: true },
    { b: 16.2, fov: 56, P: [8.3, EYE, 1.7], L: [Lv.x, 0.95, 0.1], ease: 'none' },
    // the door of the tent
    { b: 17.3, fov: 56, P: [7.9, EYE, 2.3], L: [0, 2.4, 0.3], walk: true },
    { b: 17.9, fov: 56, P: [7.4, EYE, 2.2], L: [0, 2.4, 0.35], ease: 'none' },
    // into the Holy Place
    { b: 18.9, fov: 60, P: [-1.0, EYE, 0.65], L: [-6, 1.5, 0.3], ease: 'power1.in', walk: true },
    { b: 19.9, fov: 62, P: [-1.8, EYE, 0.5], L: [-7, 1.6, 0], ease: 'power2.out', walk: true },
    { b: 20.6, fov: 62, P: [-2.0, EYE, 0.5], L: [-7, 1.5, 0], ease: 'none' },
    { b: 21.6, fov: 56, P: [-3.7, EYE, -0.1], L: [Tb.x, 0.85, Tb.z] },
    { b: 22.3, fov: 56, P: [-3.85, EYE, -0.15], L: [Tb.x, 0.85, Tb.z], ease: 'none' },
    { b: 23.3, fov: 56, P: [-3.5, EYE, -0.45], L: [Mn.x, 0.92, Mn.z] },
    { b: 24.0, fov: 56, P: [-3.6, EYE, -0.5], L: [Mn.x, 0.92, Mn.z], ease: 'none' },
    { b: 25.0, fov: 58, P: [-7.0, EYE, -1.1], L: [In.x, 0.78, In.z], walk: true },
    { b: 25.6, fov: 58, P: [-7.2, EYE, -1.1], L: [In.x, 0.8, In.z], ease: 'none' },
    // the veil
    { b: 26.4, fov: 60, P: [-6.9, EYE, -1.05], L: [-10.4, 2.4, -0.1], walk: true },
    { b: 27.0, fov: 60, P: [-7.3, EYE, -1.0], L: [-10.4, 2.2, -0.05], ease: 'none' },
    // the Holy of Holies
    { b: 27.6, fov: 60, P: [-9.6, 1.6, -0.4], L: [Ak.x, 1.1, 0], ease: 'power1.inOut', walk: true },
    { b: 28.1, fov: 60, P: [-10.35, 1.6, -0.05], L: [Ak.x, 1.1, 0.2], ease: 'none' },
    { b: 28.9, fov: 54, P: [-10.95, 1.74, 0.35], L: [Ak.x, 1.0, 0], ease: 'power2.out' },
    { b: 30.0, fov: 52, P: [-11.2, 1.7, 0.3], L: [Ak.x, 1.0, 0], ease: 'none' },
    // up through the roof, back to the drawing
    { b: 30.6, fov: 56, P: [-12.0, 4.4, 0], L: [Ak.x, 0.9, 0], ease: 'power1.inOut' },
    { b: 31.6, yaw: 90, pitch: -90, fov: 26, W: 11, T: [Ak.x, 0, 0], ease: 'power1.inOut' },
    { b: 33.4, yaw: 0, pitch: -90, fov: 2, W: fitPlan, T: [0, 0, 0], ease: 'power2.inOut' },
    { b: 34.4, yaw: 0, pitch: -90, fov: 2, W: fitPlan, T: [0, 0, 0], ease: 'none' },
  ];
}
export const END = 34.4;

const fwd = (yaw, pitch) => new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
let KEYS = [];
function buildKeys() {
  KEYS = stops(camera.aspect).map((k) => {
    let yaw = D2R(k.yaw ?? 0), pitch = D2R(k.pitch ?? 0);
    const fov = D2R(k.fov);
    if (k.L) {  // an eye position looking at a point
      const d = new THREE.Vector3(...k.L).sub(new THREE.Vector3(...k.P));
      yaw = Math.atan2(-d.x, -d.z);
      pitch = Math.asin(d.y / d.length());
    }
    let T, W;
    if (k.P) {
      const D = 6;
      T = new THREE.Vector3(...k.P).add(fwd(yaw, pitch).multiplyScalar(D));
      W = 2 * D * Math.tan(fov / 2);
    } else { T = new THREE.Vector3(...k.T); W = k.W; }
    return { ...k, yaw, pitch, fov, T, W, ease: gsap.parseEase(k.ease || 'power2.inOut') };
  });
}

const tmpT = new THREE.Vector3();
// where the visitor has turned their head, on top of the path's own direction
export const look = { yaw: 0, pitch: 0 };
function placeCamera(beat) {
  let i = 0;
  while (i < KEYS.length - 2 && beat > KEYS[i + 1].b) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const u = b.ease(THREE.MathUtils.clamp((beat - a.b) / (b.b - a.b), 0, 1));
  const lerp = THREE.MathUtils.lerp;
  const yaw = lerp(a.yaw, b.yaw, u), pitch = lerp(a.pitch, b.pitch, u);
  const fov = Math.exp(lerp(Math.log(a.fov), Math.log(b.fov), u));
  const W = Math.exp(lerp(Math.log(a.W), Math.log(b.W), u));
  tmpT.lerpVectors(a.T, b.T, u);
  const D = W / (2 * Math.tan(fov / 2));
  const f = fwd(yaw, pitch);
  camera.position.copy(tmpT).addScaledVector(f, -D);
  // footsteps: a slight rise and fall while walking
  if (b.walk && !REDUCED) {
    const stride = camera.position.x * (Math.PI * 2) / 1.5;
    camera.position.y += Math.sin(stride) * 0.018 * Math.sin(u * Math.PI);
  }
  // the head never tips past 75° up or down, but the plan's own straight-down view stays as drawn
  const lim = D2R(75);
  const lp = THREE.MathUtils.clamp(pitch + look.pitch, Math.min(pitch, -lim), Math.max(pitch, lim));
  camera.rotation.set(lp, yaw + look.yaw, Math.sin(camera.position.x * 0.9) * 0.002 * (b.walk ? 1 : 0));
  camera.fov = THREE.MathUtils.radToDeg(fov);
  camera.near = Math.max(0.05, D - 140);
  camera.far = D + 3200;
  camera.updateProjectionMatrix();
}

// ---------------- what changes with the scroll ----------------
const ramp = (x, a, b) => THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
const smooth = (x, a, b) => { const t = ramp(x, a, b); return t * t * (3 - 2 * t); };

const track = (x, pts) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [b0, v0] = pts[i], [b1, v1] = pts[i + 1];
    if (x <= b1) return THREE.MathUtils.lerp(v0, v1, smooth(x, b0, b1));
  }
  return pts[pts.length - 1][1];
};
// how far the wash has turned a point at world x into real material
const realAt = (x) => smooth(x - U.uSweep.value, -0.4, 0.6);

function applyBeat(beat, time) {
  placeCamera(beat);
  sky.position.copy(camera.position);

  // the section cut: rises from 1.2 m until the building stands; at the end it comes down again
  if (beat < 30.3) {
    const rise = smooth(beat, 0.9, 2.9);
    U.uCut.value = rise >= 1 ? 1000 : THREE.MathUtils.lerp(1.2, 7.2, rise);
  } else U.uCut.value = THREE.MathUtils.lerp(5.2, 1.2, smooth(beat, 30.3, 31.5));

  // the wash of real material: it overtakes the visitor outside the gate and runs ahead into
  // the court, waits at the door, then fills each room only as the visitor enters it
  U.uSweep.value = track(beat, [[5.9, 64], [6.9, 25], [9.3, 2.4], [16.6, 2.4], [17.2, -0.6], [18.9, -0.6],
    [20.3, -9.85], [25.7, -9.85], [26.3, -10.6], [27.3, -10.6], [28.6, -16.7], [31.0, -16.7], [32.4, -40]]);
  // the outside of the tent turns real as the visitor arrives at its door
  U.uSweepOut.value = beat < 16.8 ? U.uSweep.value : THREE.MathUtils.lerp(2.4, -40, smooth(beat, 16.8, 17.6));
  U.uRag.value = track(beat, [[16.4, 1], [17.0, 0.35], [25.5, 0.35], [25.8, 0.15], [27.2, 0.15], [27.5, 0.35], [30.8, 0.35], [31.4, 1]]);
  U.uEnv.value = smooth(beat, 5.9, 7.6);
  U.uInkBack.value = smooth(beat, 32.2, 33.4);

  // curtains: the gate, the door and the veil each draw aside as the visitor reaches them
  const gate = smooth(beat, 7.0, 8.0);
  T.gateL.scale.z = T.gateR.scale.z = 1 - gate * 0.82;
  T.doorBay.scale.z = 1 - smooth(beat, 17.9, 18.5) * 0.85;
  T.veilL.scale.z = T.veilR.scale.z = 1 - smooth(beat, 26.9, 27.7) * 0.85;

  // inside the tent the daylight falls away and the eye adjusts to the lamps
  const inside = track(beat, [[17.8, 0], [18.9, 1], [30.3, 1], [31.0, 0]]);
  renderer.toneMappingExposure = 1.05 * (1 + 1.25 * inside);
  hemi.intensity = 0.95 * (1 - 0.93 * inside);
  for (const [m, base] of envBase) m.envMapIntensity = base * (1 - 0.85 * inside);

  const flick = 1 + Math.sin(time * 11.3) * 0.06 + Math.sin(time * 23.7 + 1.3) * 0.04;
  const altarReal = realAt(SPOTS.altar.x);
  const menReal = realAt(SPOTS.menorah.x), incReal = realAt(SPOTS.incense.x), shek = realAt(SPOTS.ark.x + 0.6);
  fireGlow.intensity = altarReal * (6 + Math.sin(time * 7.1) * 0.8 + Math.sin(time * 13.3) * 0.5);
  menLight.intensity = menReal * 6.5 * flick;
  lampGlows.forEach((g, i) => { g.material.opacity = menReal * (0.85 + 0.15 * Math.sin(time * 9 + i * 1.7)); });
  doorLight.intensity = realAt(-0.5) * 2.2;
  incenseLight.intensity = incReal * 0.9 * flick;
  shekLight.intensity = shek * 5 * (1 + Math.sin(time * 0.8) * 0.05);
  veilFill.intensity = shek * 3.5 * flick;
  shekCore.material.opacity = shek * 0.4;
  shekHalo.material.opacity = shek * 0.12;

  const pxScale = renderer.domElement.height / (2 * Math.tan(D2R(camera.fov) / 2));
  const amts = [altarReal, altarReal, incReal, shek];
  particles.forEach((p, i) => {
    p.material.uniforms.uAmt.value = amts[i];
    p.material.uniforms.uTime.value = time;
    p.material.uniforms.uScale.value = pxScale;
  });
  updateCaptions(beat);
}

// ---------------- captions and the station rail ----------------
const notes = [...document.querySelectorAll('.note')].map((el) => ({ el, a: +el.dataset.from, b: +el.dataset.to }));
const stationsEl = [...document.querySelectorAll('.stations li')];
const hint = document.querySelector('.hint');
const STATION_AT = [0, 5.0, 10.6, 14.4, 16.6, 18.6, 26.0, 27.8];
// where the walk waits, and what lies ahead from each
const STOPS = [
  { b: 6.1, next: 'Enter the court' },
  { b: 13.7, next: 'On to the laver' },
  { b: 16.2, next: 'On to the door' },
  { b: 17.8, next: 'Into the Holy Place' },
  { b: 20.6, next: 'To the table' },
  { b: 22.0, next: 'To the candlestick' },
  { b: 23.8, next: 'To the altar of incense' },
  { b: 25.5, next: 'To the veil' },
  { b: 26.8, next: 'Through the veil' },
  { b: 29.6, next: 'Back to the pattern' },
];
function updateCaptions(beat) {
  for (const n of notes) {
    const o = Math.min(ramp(beat, n.a - 0.3, n.a), 1 - ramp(beat, n.b, n.b + 0.3));
    n.el.style.opacity = n.a <= 0 ? (1 - ramp(beat, n.b, n.b + 0.3)) : o;
    n.el.style.transform = `translateY(${(1 - o) * 8}px)`;
    n.el.style.visibility = o > 0.001 || n.a <= 0 && beat < n.b + 0.3 ? 'visible' : 'hidden';
  }
  let s = 0;
  STATION_AT.forEach((b, i) => { if (beat >= b) s = i; });
  if (beat > 31.8) s = 0;  // back to the pattern
  stationsEl.forEach((li, i) => li.classList.toggle('is-here', i === s));
  hint.style.opacity = 1 - ramp(beat, 0.05, 0.35);
  document.documentElement.classList.toggle('is-dusk', U.uEnv.value > 0.5);
}

// ---------------- sizing ----------------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  buildKeys();
}
addEventListener('resize', resize);
resize();

// ---------------- startup ----------------
let SPOT_DATA = {};
const loadDone = new Promise((resolve) => {
  THREE.DefaultLoadingManager.onLoad = resolve;
});

(async () => {
  const spotsReady = fetch('data/spots.json').then((r) => (r.ok ? r.json() : {})).then((d) => { SPOT_DATA = d; }).catch(() => {});
  await Promise.all([
    spotsReady,
    document.fonts.load('600 40px "Barlow Condensed"'),
    document.fonts.load('500 40px "Barlow Condensed"'),
    document.fonts.load('italic 400 40px "Spectral"'),
  ]).catch(() => {});
  U.uSheet.value = drawSheet();
  await Promise.race([loadDone, new Promise((r) => setTimeout(r, 15000))]);
  applyBeat(0, 0);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  document.documentElement.classList.add('is-ready');

  if (CAPTURE) {
    document.documentElement.classList.add('is-capture');
    window.__render = (beat, time) => { applyBeat(beat, time); renderer.render(scene, camera); };
    window.__END = END;
    // a free camera for checking details: the scene as at `beat`, seen from P toward L
    window.__view = (beat, P, L, fov, hide = []) => {
      applyBeat(beat, 0);
      for (const k in M) if (M[k].isMaterial) M[k].visible = !hide.includes(k);
      camera.position.set(...P); camera.lookAt(...L); camera.fov = fov; camera.near = 0.05; camera.far = 3000;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    window.__ready = true;
    return;
  }

  const lenis = new Lenis({ lerp: REDUCED ? 1 : 0.085, smoothWheel: !REDUCED });
  gsap.registerPlugin(ScrollTrigger);
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);

  let progress = 0;
  ScrollTrigger.create({
    trigger: '#track', start: 'top top', end: 'bottom bottom',
    onUpdate: (self) => { progress = self.progress; },
  });

  // ---- stops: the walk waits at each part until the visitor moves on ----
  const root = document.documentElement;
  const lookEl = document.querySelector('.look');
  const lookNext = lookEl.querySelector('.look-next');
  const pxAt = (beat) => (beat / END) * lenis.limit;
  let held = null, heldT = 0, lastBeat = 0;
  let wheelAcc = 0, wheelT = 0, wheelFresh = false;

  function hold(stop) {
    held = stop; heldT = performance.now();
    wheelAcc = 0; wheelFresh = false;
    lenis.scrollTo(pxAt(stop.b), { immediate: true, force: true });
    progress = stop.b / END;
    lenis.stop();
    lookNext.textContent = stop.next;
    root.classList.add('is-held');
  }
  function release(dir = 1) {
    if (!held) return;
    const stop = held;
    held = null;
    root.classList.remove('is-held');
    closeInfo();
    lenis.start();
    // step just clear of the stop, so it does not catch the visitor again
    lenis.scrollTo(pxAt(stop.b + dir * 0.05), { immediate: true, force: true });
    return stop;
  }
  // "walk on": carry the visitor to the next stop without scrolling
  lookNext.addEventListener('click', () => {
    const stop = release(1);
    const i = STOPS.indexOf(stop);
    const to = STOPS[i + 1] ? STOPS[i + 1].b + 0.03 : END;
    lenis.scrollTo(pxAt(to), { duration: REDUCED ? 0 : THREE.MathUtils.clamp((to - stop.b) * 1.1, 2, 7), easing: (t) => t * t * (3 - 2 * t) });
  });

  // a deliberate new scroll gesture moves on; the tail of the one that arrived does not
  addEventListener('wheel', (e) => {
    if (!held) return;
    const now = performance.now();
    if (now - wheelT > 250) wheelFresh = true;
    wheelT = now;
    if (!wheelFresh || now - heldT < 1100) return;
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) > 80) release(Math.sign(wheelAcc));
  }, { passive: true });
  addEventListener('keydown', (e) => {
    if (!held) return;
    if (['ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key) && document.activeElement !== lookNext) { e.preventDefault(); release(1); }
    else if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); release(-1); }
    else if (e.key === 'ArrowLeft') look.yaw += D2R(6);
    else if (e.key === 'ArrowRight') look.yaw -= D2R(6);
  });

  // drag to turn the head; the scene follows the pointer like a held drawing
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!held && e.pointerType !== 'mouse') return;  // on touch, dragging scrolls between stops
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    root.classList.add('is-dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = D2R(camera.fov) / innerHeight;
    look.yaw += (e.clientX - drag.x) * k;
    look.pitch = THREE.MathUtils.clamp(look.pitch + (e.clientY - drag.y) * k, -D2R(70), D2R(60));
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const endDrag = () => { drag = null; root.classList.remove('is-dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- things to click: pinned to the model, offered while the walk waits ----
  const infoEl = document.querySelector('.info');
  const infoBody = infoEl.querySelector('.info-body');
  const spots = [...document.querySelectorAll('.spot')].map((el) => ({
    el, id: el.dataset.spot, label: el.querySelector('.spot-label'), pos: new THREE.Vector3(...el.dataset.pos.split(',').map(Number)), seen: false,
  }));
  let openSpot = null;
  let bridge = { notifySpotOpened() {} };  // replaced by initBridge when embedded
  function openInfo(spot) {
    const data = SPOT_DATA[spot.id];
    if (!data) return; // spots.json missing or failed to load: stay clickable, open nothing
    if (openSpot) openSpot.el.setAttribute('aria-expanded', 'false');
    openSpot = spot;
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    infoBody.innerHTML = `<p class="refs">${data.refs.map((r) => `<span class="ref">${esc(r.label)}</span>`).join('; ')}</p><h2 id="info-title">${data.title}</h2>${data.html}`;
    infoEl.hidden = false;
    infoBody.scrollTop = 0;
    bridge.notifySpotOpened(spot.id);
    spot.el.setAttribute('aria-expanded', 'true');
    infoEl.querySelector('.info-close').focus({ preventScroll: true });
  }
  function closeInfo() {
    if (!openSpot) return;
    infoEl.hidden = true;
    openSpot.el.setAttribute('aria-expanded', 'false');
    if (document.activeElement && infoEl.contains(document.activeElement)) openSpot.el.focus({ preventScroll: true });
    openSpot = null;
  }
  for (const spot of spots) {
    spot.el.setAttribute('aria-expanded', 'false');
    spot.el.setAttribute('aria-label', `About ${spot.el.textContent.trim().toLowerCase()}`);
    spot.el.addEventListener('click', () => (openSpot === spot ? closeInfo() : openInfo(spot)));
  }
  infoEl.querySelector('.info-close').addEventListener('click', closeInfo);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInfo(); });
  // the panel scrolls itself; keep the wheel from moving on along the walk
  infoEl.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  // ---- driven from outside (the chat app, via bridge.js) ----
  // Each spot is offered at the stop where the walk waits beside it.
  const SPOT_STOP = {
    gate: 6.1, altar: 13.7, laver: 16.2, door: 17.8, boards: 20.6,
    table: 22.0, menorah: 23.8, incense: 25.5, veil: 26.8, ark: 29.6,
  };
  function letGo() {
    held = null;
    root.classList.remove('is-held');
    closeInfo();
    lenis.start();
    look.yaw = look.pitch = 0;
  }
  function goToSpot(id) {
    const spot = spots.find((s) => s.id === id);
    const stop = STOPS.find((s) => s.b === SPOT_STOP[id]);
    if (!spot || !stop) return;
    letGo();
    hold(stop);  // jumps there and waits, so the spot is offered
    openInfo(spot);
  }
  function goToStation(n) {
    if (!(n >= 0 && n < STATION_AT.length)) return;
    letGo();
    lenis.scrollTo(pxAt(STATION_AT[n]), { immediate: true, force: true });
    progress = STATION_AT[n] / END;
  }
  bridge = initBridge({ win: window, goToSpot, goToStation });

  // a point is offered only when it faces the visitor, unhidden by the model
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector3(), toSpot = new THREE.Vector3();
  ray.camera = camera;
  let lastOcclusion = 0;
  function placeSpots(now) {
    const checkOcclusion = now - lastOcclusion > 120;
    if (checkOcclusion) lastOcclusion = now;
    for (const spot of spots) {
      ndc.copy(spot.pos).project(camera);
      const inView = held && ndc.z < 1 && Math.abs(ndc.x) < 0.96 && Math.abs(ndc.y) < 0.94;
      if (inView && checkOcclusion) {
        toSpot.subVectors(spot.pos, camera.position);
        const dist = toSpot.length();
        ray.set(camera.position, toSpot.normalize());
        ray.far = dist - 0.04;
        spot.seen = !ray.intersectObject(T.root, true).some((h) => h.object.isMesh);
      }
      const x = ((ndc.x + 1) / 2) * innerWidth, y = ((1 - ndc.y) / 2) * innerHeight;
      // nothing is offered from behind the open card
      const card = infoEl.hidden ? null : infoEl.getBoundingClientRect();
      const underCard = card && x > card.left - 16 && y > card.top - 16 && y < card.bottom + 16;
      const shown = inView && spot.seen && !underCard;
      spot.el.classList.toggle('is-shown', shown);
      if (shown) {
        spot.el.style.transform = `translate(${x}px, ${y}px)`;
        // the label reads to the right, unless it would run off the page or under the open card
        spot.el.classList.toggle('is-left', x + 48 + spot.label.offsetWidth > (card ? card.left : innerWidth));
      }
      else if (openSpot === spot && !held) closeInfo();
    }
  }

  gsap.ticker.add((time) => {
    let beat = progress * END;
    if (!held) {
      // only a walk is caught at a stop; a jump (End key, the scrollbar) goes straight through
      const stop = beat - lastBeat < 1.2 && STOPS.find((s) => lastBeat < s.b && beat >= s.b);
      if (stop) { hold(stop); beat = stop.b; }
      // walking on, the head turns back to the way ahead
      const k = 1 - Math.exp(-Math.abs(beat - lastBeat) * 7);
      if (!drag) {
        look.yaw = Math.atan2(Math.sin(look.yaw), Math.cos(look.yaw)) * (1 - k);
        look.pitch *= 1 - k;
      }
    }
    lastBeat = beat;
    applyBeat(beat, time);
    renderer.render(scene, camera);
    placeSpots(performance.now());
  });
})();
