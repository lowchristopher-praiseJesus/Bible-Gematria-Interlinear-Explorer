import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Royal cubit. Every size below is written in cubits from Exodus 25–38.
export const CU = 0.52;
const c = (n) => n * CU;

// World axes: +x east, -z north, +y up. The court is centred on the origin.
export const COURT = { halfL: c(50), halfW: c(25), h: c(5) };
export const TENT = { west: -c(30), east: 0, halfW: c(5), h: c(10), veil: -c(20) };
// the seven lamps of the candlestick, as offsets along x from its shaft, and their height
export const MENORAH_LAMPS = { dx: [-0.5, -0.345, -0.19, 0, 0.19, 0.345, 0.5], y: [1.47, 1.47, 1.47, 1.5, 1.47, 1.47, 1.47] };
export const SPOTS = {
  gate: new THREE.Vector3(c(50), 0, 0),
  altar: new THREE.Vector3(c(25), 0, 0),
  laver: new THREE.Vector3(c(12.5), 0, 0),
  door: new THREE.Vector3(0, 0, 0),
  table: new THREE.Vector3(-c(10), 0, -c(3)),
  menorah: new THREE.Vector3(-c(10), 0, c(3)),
  incense: new THREE.Vector3(-c(17.7), 0, 0),
  ark: new THREE.Vector3(-c(25), 0, 0),
};

// ---- geometry helpers: UVs measured in metres so textures keep one scale ----
function uvBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const spans = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * spans[f][0], uv.getY(i) * spans[f][1]);
  }
  return g;
}
function uvScale(g, su, sv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}
const uvCyl = (rt, rb, h, seg = 20) => uvScale(new THREE.CylinderGeometry(rt, rb, h, seg), Math.PI * 2 * Math.max(rt, rb), h);

// A horn of one piece with its altar: rising from the corner and curling outward,
// tapered from a broad root to a point. `out` is the horizontal outward direction.
function hornGeometry(out, rise, reach, r0) {
  const o = out.clone().setY(0).normalize();
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, rise * 0.8, 0), new THREE.Vector3(o.x * reach, rise, o.z * reach));
  const seg = 16, rad = 14;
  const g = new THREE.TubeGeometry(curve, seg, r0, rad, false);
  const p = g.attributes.position, c0 = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    curve.getPoint(i / seg, c0);
    const k = 1 - 0.85 * (i / seg);
    for (let j = 0; j <= rad; j++) {
      const vi = i * (rad + 1) + j;
      p.setXYZ(vi, c0.x + (p.getX(vi) - c0.x) * k, c0.y + (p.getY(vi) - c0.y) * k, c0.z + (p.getZ(vi) - c0.z) * k);
    }
  }
  g.computeVertexNormals();
  return g;
}

export function buildTabernacle(M) {
  const root = new THREE.Group();
  const dynamic = new THREE.Group();
  root.add(dynamic);

  const put = (geo, mat, x, y, z, parent = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  // boxes and cylinders are placed by their footprint centre and their base height
  const box = (w, h, d, mat, x, y, z, p) => put(uvBox(w, h, d), mat, x, y + h / 2, z, p);
  const cyl = (r, h, mat, x, y, z, seg, p) => put(uvCyl(r, r, h, seg), mat, x, y + h / 2, z, p);
  const cone = (rt, rb, h, mat, x, y, z, seg = 12) => put(uvCyl(rt, rb, h, seg), mat, x, y + h / 2, z);
  const rod = (len, r, mat, a, b, y) => { // horizontal rod from point a to b (xz)
    const m = put(uvCyl(r, r, len, 10), mat, (a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
    if (Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1])) m.rotation.z = Math.PI / 2; else m.rotation.x = Math.PI / 2;
    return m;
  };

  // ======================= COURT (Ex 27:9–19; 38:9–20) =======================
  const { halfL: L, halfW: W, h: H } = COURT;
  const posts = [];
  for (let i = 0; i <= 20; i++) posts.push([-L + i * c(5), -W, 'n'], [-L + i * c(5), W, 's']);
  for (let j = 1; j < 10; j++) posts.push([-L, -W + j * c(5), 'w']);
  const gateHalf = c(10);
  const gatePosts = [-gateHalf, -gateHalf / 3, gateHalf / 3, gateHalf];
  for (const z of [-W + c(5), -W + c(10), ...gatePosts, W - c(10), W - c(5)]) posts.push([L, z, 'e']);

  for (const [x, z, side] of posts) {
    box(0.36, 0.22, 0.36, M.bronze, x, 0, z);                 // socket of brass
    cyl(0.085, H, M.acacia, x, 0.2, z, 16);                   // pillar
    cyl(0.12, 0.13, M.silverCourt, x, H + 0.18, z, 16);       // chapiter overlaid with silver
    // cord and pin of brass (Ex 27:19; 38:20), staked outward
    const out = side === 'n' ? [0, -1] : side === 's' ? [0, 1] : side === 'w' ? [-1, 0] : [1, 0];
    const px = x + out[0] * 1.5, pz = z + out[1] * 1.5;
    box(0.05, 0.22, 0.05, M.bronze, px, 0, pz);
    const top = new THREE.Vector3(x, H + 0.2, z), peg = new THREE.Vector3(px, 0.2, pz);
    const len = top.distanceTo(peg);
    const cord = put(new THREE.CylinderGeometry(0.008, 0.008, len, 5), M.linen, (x + px) / 2, (H + 0.4) / 2, (z + pz) / 2);
    cord.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(peg).normalize());
    cord.userData.edgeThreshold = 60;
    cord.castShadow = true;
  }

  // hangings of fine twined linen, five cubits high, on silver fillets
  const T = 0.035;
  const hang = (a, b, mat, parent) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) - 0.16;
    const alongX = Math.abs(dx) > Math.abs(dz);
    const g = alongX ? uvBox(len, H - 0.2, T) : uvBox(T, H - 0.2, len);
    return put(g, mat, (a[0] + b[0]) / 2, 0.12 + (H - 0.2) / 2, (a[1] + b[1]) / 2, parent);
  };
  const fillet = (a, b) => {
    const alongX = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    box(alongX ? len : 0.04, 0.04, alongX ? 0.04 : len, M.silverCourt, (a[0] + b[0]) / 2, H + 0.08, (a[1] + b[1]) / 2);
  };
  const line = (pts) => { for (let i = 0; i < pts.length - 1; i++) { hang(pts[i], pts[i + 1], M.linen); fillet(pts[i], pts[i + 1]); } };
  const run = (x0, z0, x1, z1, n) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
  line(run(-L, -W, L, -W, 20));
  line(run(-L, W, L, W, 20));
  line(run(-L, -W, -L, W, 10));
  line(run(L, -W, L, -gateHalf, 3));
  line(run(L, gateHalf, L, W, 3));

  // the gate screen: three bays; the middle one parts as the visitor walks through
  hang([L, -gateHalf], [L, gatePosts[1]], M.gate);
  hang([L, gatePosts[2]], [L, gateHalf], M.gate);
  for (let i = 0; i < 3; i++) fillet([L, gatePosts[i]], [L, gatePosts[i + 1]]);
  const bay = gatePosts[2] - gatePosts[1];
  const gateL = new THREE.Group(), gateR = new THREE.Group();
  gateL.position.set(L, 0, gatePosts[1]);
  gateR.position.set(L, 0, gatePosts[2]);
  const halfCurtain = (grp, dir) => {
    const m = put(uvBox(T, H - 0.2, bay / 2 - 0.04), M.gate, 0, 0.12 + (H - 0.2) / 2, dir * (bay / 4), grp);
    m.userData.ownEdges = true;
  };
  halfCurtain(gateL, 1); halfCurtain(gateR, -1);
  dynamic.add(gateL, gateR);

  // ======================= TENT (Ex 26; 36:8–38) =======================
  const { west: X0, east: X1, halfW: TW, h: TH } = TENT;
  const BT = 0.22, sockH = 0.3;
  const boardW = c(1.5);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 20; i++) {
      const x = X0 + boardW / 2 + i * boardW, z = s * (TW + BT / 2);
      box(boardW - 0.02, TH, BT, M.gold, x, 0.12, z);
      box(0.34, sockH, BT + 0.06, M.silver, x - boardW / 4, 0, z);
      box(0.34, sockH, BT + 0.06, M.silver, x + boardW / 4, 0, z);
    }
  }
  // the west end: six boards, and two corner boards that close the corners (Ex 26:22–25).
  // Six boards give nine cubits; each corner board shows half a cubit within, making the ten.
  const westX = X0 - BT / 2;
  for (let k = 0; k < 6; k++) {
    const z = -3 * boardW + boardW / 2 + k * boardW;
    box(BT, TH, boardW - 0.02, M.gold, westX, 0.12, z);
    // two tenons, two sockets of silver under every board (Ex 26:19, 25)
    box(BT + 0.06, sockH, 0.34, M.silver, westX, 0, z - boardW / 4);
    box(BT + 0.06, sockH, 0.34, M.silver, westX, 0, z + boardW / 4);
  }
  const cornerW = TW + BT - 3 * boardW;  // runs past the side wall's end, so the corner is closed
  for (const s of [-1, 1]) {
    const z = s * (3 * boardW + cornerW / 2);
    box(BT, TH, cornerW - 0.02, M.gold, westX, 0.12, z);
    box(BT + 0.06, sockH, cornerW / 2 - 0.03, M.silver, westX, 0, z - cornerW / 4);
    box(BT + 0.06, sockH, cornerW / 2 - 0.03, M.silver, westX, 0, z + cornerW / 4);
    // "coupled together beneath, and… above the head of it unto one ring" (Ex 26:24):
    // a gold clasp binding the corner board to the last side board, low and high
    for (const y of [0.55, TH - 0.25]) {
      const cx = X0 - BT / 2 + 0.11, cz = s * (TW + BT / 2 + 0.01);
      box(0.5, 0.09, BT + 0.05, M.gold, cx, y, cz);
      box(BT + 0.05, 0.09, 0.5, M.gold, westX - 0.01, y, s * (TW + BT / 2 - 0.14));
      const ring = put(new THREE.TorusGeometry(0.075, 0.016, 8, 20), M.gold, X0 - BT - 0.02, y + 0.045, s * (TW + BT + 0.02));
      ring.rotation.y = Math.PI / 4 * s;
    }
  }
  // five bars on each of the three walls, the middle bar shot through from end to end (Ex 26:26–28)
  const barRows = (len) => [[1.2, 0, len / 2], [1.2, len / 2, len], [c(5), 0, len], [4.0, 0, len / 2], [4.0, len / 2, len]];
  const XW = X0 - BT;  // outer face of the west wall: the side bars run to the corner
  for (const s of [-1, 1]) {
    const z = s * (TW + BT + 0.05), len = X1 - XW;
    for (const [y, a0, a1] of barRows(len)) rod(a1 - a0 - 0.1, 0.045, M.gold, [XW + a0 + 0.05, z], [XW + a1 - 0.05, z], y);
  }
  {
    const x = XW - 0.05, z0 = -(TW + BT), len = 2 * (TW + BT);
    for (const [y, a0, a1] of barRows(len)) rod(a1 - a0 - 0.1, 0.045, M.gold, [x, z0 + a0 + 0.05], [x, z0 + a1 - 0.05], y);
  }
  // rings of gold on every board, places for the bars (Ex 26:29)
  const ringGeo = new THREE.TorusGeometry(0.06, 0.011, 6, 14);
  const barYs = [1.2, c(5), 4.0];
  for (const s of [-1, 1]) for (let i = 0; i < 20; i++) for (const y of barYs) {
    const r = put(ringGeo, M.gold, X0 + boardW / 2 + i * boardW, y, s * (TW + BT + 0.05));
    r.rotation.y = Math.PI / 2;
  }
  const westBoards = [-(3 * boardW + cornerW / 2), ...[0, 1, 2, 3, 4, 5].map((k) => -3 * boardW + boardW / 2 + k * boardW), 3 * boardW + cornerW / 2];
  for (const z of westBoards) for (const y of barYs) put(ringGeo, M.gold, XW - 0.05, y, z);

  // ceiling of cherubim linen, then the coverings: goats' hair, rams' skins dyed red, tachash skins
  box(X1 - X0 + BT, 0.03, 2 * (TW + BT), M.ceiling, (X0 + X1) / 2 - BT / 2, TH + 0.12, 0);
  // Each covering is lofted through rows round the north, west and south sides: the flat roof,
  // a rounded shoulder over the boards, then a skirt splayed out toward the pegs. Open at the east.
  const cover = (mat, o, bottomY, frontX, splay) => {
    const rows = [
      { zw: TW + BT + o - 0.3, xb: X0 - BT - o + 0.3, y: TH + 0.32 + o * 0.25 },
      { zw: TW + BT + o - 0.1, xb: X0 - BT - o + 0.1, y: TH + 0.27 + o * 0.25 },
      { zw: TW + BT + o + 0.02, xb: X0 - BT - o - 0.02, y: TH + 0.15 + o * 0.2 },
      { zw: TW + BT + o + 0.1, xb: X0 - BT - o - 0.1, y: TH - 0.05 },
      { zw: TW + BT + o + splay, xb: X0 - BT - o - splay, y: bottomY },
    ];
    const path = (r) => [[frontX, -r.zw], [r.xb, -r.zw], [r.xb, r.zw], [frontX, r.zw]];
    const pos = [], uv = [];
    const vtx = (p, r, u, v) => { pos.push(p[0], r.y, p[1]); uv.push(u, v); };
    const tri = (a, b, cc, out) => {
      // keep every face turned outward, so the outside reads as outside and a cut shows poché
      const ab = new THREE.Vector3(b[0][0] - a[0][0], b[1].y - a[1].y, b[0][1] - a[0][1]);
      const ac = new THREE.Vector3(cc[0][0] - a[0][0], cc[1].y - a[1].y, cc[0][1] - a[0][1]);
      const flip = ab.cross(ac).dot(out) < 0;
      for (const q of flip ? [a, cc, b] : [a, b, cc]) vtx(q[0], q[1], q[2], q[3]);
    };
    let vAcc = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const A = rows[i], B = rows[i + 1], pa = path(A), pb = path(B);
      const dv = Math.hypot(A.zw - B.zw, A.y - B.y);
      let uA = 0, uB = 0;
      for (let k = 0; k < 3; k++) {
        const la = Math.hypot(pa[k + 1][0] - pa[k][0], pa[k + 1][1] - pa[k][1]);
        const lb = Math.hypot(pb[k + 1][0] - pb[k][0], pb[k + 1][1] - pb[k][1]);
        const a0 = [pa[k], A, uA, vAcc], a1 = [pa[k + 1], A, uA + la, vAcc];
        const b0 = [pb[k], B, uB, vAcc + dv], b1 = [pb[k + 1], B, uB + lb, vAcc + dv];
        const mid = [(pa[k][0] + pa[k + 1][0]) / 2, (pa[k][1] + pa[k + 1][1]) / 2];
        const out = new THREE.Vector3(mid[0] - (X0 + X1) / 2 * (k === 1 ? 1 : 0), 0.6, k === 1 ? 0 : mid[1]);
        if (k === 1) out.set(-1, 0.6, 0);
        tri(a0, a1, b1, out); tri(a0, b1, b0, out);
        uA += la; uB += lb;
      }
      vAcc += dv;
    }
    const r0 = path(rows[0]), up = new THREE.Vector3(0, 1, 0);
    const R = rows[0];
    tri([r0[0], R, 0, 0], [r0[1], R, 1, 0], [r0[2], R, 1, 1], up);
    tri([r0[0], R, 0, 0], [r0[2], R, 1, 1], [r0[3], R, 0, 1], up);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    put(g, mat, 0, 0, 0).userData.edgeThreshold = 20;
    return rows[rows.length - 1];
  };
  cover(M.goatHair, 0.1, 0.3, X1 + 0.45, 1.42);
  cover(M.ramRed, 0.16, 0.42, X1 + 0.4, 1.46);
  const skirt = cover(M.tachash, 0.22, 0.55, X1 + 0.36, 1.48);
  // the cords and pins of the tabernacle, staking the skirts out to the ground (Ex 35:18)
  const stake = (ex, ez, ox, oz) => {
    const px = ex + ox * 0.9, pz = ez + oz * 0.9;
    box(0.05, 0.2, 0.05, M.tentPin, px, 0, pz);
    const top = new THREE.Vector3(ex, skirt.y + 0.02, ez), pin = new THREE.Vector3(px, 0.18, pz);
    const cord = put(new THREE.CylinderGeometry(0.007, 0.007, top.distanceTo(pin), 5), M.tentCord, (ex + px) / 2, (top.y + pin.y) / 2, (ez + pz) / 2);
    cord.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(pin).normalize());
    cord.userData.edgeThreshold = 60;
  };
  for (let xk = skirt.xb + 0.4; xk <= X1 + 0.3; xk += 1.3) for (const sz of [-1, 1]) stake(xk, sz * skirt.zw, 0, sz);
  for (let zk = -skirt.zw + 0.6; zk <= skirt.zw - 0.5; zk += 1.3) stake(skirt.xb, zk, -1, 0);
  // the sixth goats'-hair curtain doubled over the front (Ex 26:9), a dark valance across the head of the door
  box(0.04, 0.55, 2 * (TW + BT + 0.32), M.goatHair, X1 + 0.47, TH - 0.2, 0);

  // door: five pillars of acacia overlaid with gold, sockets of brass (Ex 26:36–37)
  for (let i = 0; i < 5; i++) {
    const z = -TW + i * (TW / 2);
    box(0.32, 0.25, 0.32, M.bronze, X1 + 0.12, 0, z);
    cyl(0.1, TH - 0.1, M.gold, X1 + 0.12, 0.2, z, 16);
    cyl(0.14, 0.14, M.gold, X1 + 0.12, TH + 0.06, z, 16);
  }
  const bayW = TW / 2;
  for (const z0 of [-TW, -bayW, bayW]) box(T, TH - 0.15, bayW - 0.04, M.door, X1 - 0.06, 0.1, z0 + bayW / 2);
  const doorBay = new THREE.Group();
  doorBay.position.set(X1 - 0.06, 0, 0.02);
  const dm = put(uvBox(T, TH - 0.15, bayW - 0.04), M.door, 0, 0.1 + (TH - 0.15) / 2, (bayW - 0.04) / 2, doorBay);
  dm.userData.ownEdges = true;
  dynamic.add(doorBay);

  // the veil on four pillars with sockets of silver (Ex 26:31–33)
  const VX = TENT.veil;
  for (let i = 0; i < 4; i++) {
    const z = -TW + TW * 2 * (i + 0.5) / 4;
    box(0.3, 0.25, 0.3, M.silver, VX - 0.12, 0, z);
    cyl(0.09, TH - 0.1, M.gold, VX - 0.12, 0.2, z, 16);
  }
  const vIn = TW * 0.25;  // inner pillars at ±0.65 m
  box(T, TH - 0.05, TW - vIn, M.veil, VX + 0.02, 0.02, -(TW + vIn) / 2);
  box(T, TH - 0.05, TW - vIn, M.veil, VX + 0.02, 0.02, (TW + vIn) / 2);
  const veilL = new THREE.Group(), veilR = new THREE.Group();
  veilL.position.set(VX + 0.02, 0, -vIn);
  veilR.position.set(VX + 0.02, 0, vIn);
  for (const [grp, dir] of [[veilL, 1], [veilR, -1]]) {
    const vm = put(uvBox(T, TH - 0.05, vIn - 0.01), M.veil, 0, 0.02 + (TH - 0.05) / 2, dir * (vIn / 2), grp);
    vm.userData.ownEdges = true;
  }
  dynamic.add(veilL, veilR);

  // ======================= FURNITURE =======================
  // --- Altar of burnt offering: 5 x 5 x 3 cubits, acacia overlaid with brass, hollow with boards (Ex 27:1–8)
  {
    const { x, z } = SPOTS.altar, s = c(5), h = c(3);
    const P = 0.32, fp = s / 2 - 0.06, span = s - 2 * P, ledgeY = h / 2;
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    // the hollow chest of boards (Ex 27:8)
    for (const sz of [-1, 1]) box(s - 0.12, h - 0.06, 0.08, M.bronze, x, 0.02, z + sz * (fp - 0.04));
    for (const sx of [-1, 1]) box(0.08, h - 0.06, s - 0.28, M.bronze, x + sx * (fp - 0.04), 0.02, z);
    // corner pilasters: plinth, shaft, stepped capital, carved rosettes on their outer faces
    for (const [dx, dz] of corners) {
      const px = x + dx * (s / 2 - P / 2), pz = z + dz * (s / 2 - P / 2);
      box(P + 0.06, 0.09, P + 0.06, M.bronze, px, 0, pz);
      box(P, h - 0.16, P, M.bronze, px, 0.09, pz);
      box(P + 0.03, 0.035, P + 0.03, M.bronze, px, h - 0.105, pz);
      box(P + 0.07, 0.04, P + 0.07, M.bronze, px, h - 0.07, pz);
      box(P + 0.03, 0.03, P + 0.03, M.bronze, px, h - 0.03, pz);
      for (const yy of [h - 0.3, h - 0.5]) {
        const rx = put(new THREE.CylinderGeometry(0.075, 0.075, 0.016, 28), M.bronzeRosette, px + dx * (P / 2 + 0.008), yy, pz);
        rx.rotation.z = Math.PI / 2; rx.userData.edgeThreshold = 60;
        const rz = put(new THREE.CylinderGeometry(0.075, 0.075, 0.016, 28), M.bronzeRosette, px, yy, pz + dz * (P / 2 + 0.008));
        rz.rotation.x = Math.PI / 2; rz.userData.edgeThreshold = 60;
      }
      // a horn of one piece with the altar (Ex 27:2), rising from a small block and curling outward
      box(0.2, 0.05, 0.2, M.bronze, px, h, pz);
      const hg = hornGeometry(new THREE.Vector3(dx, 0, dz), 0.3, 0.14, 0.065);
      put(hg, M.bronze, px, h + 0.05, pz).userData.edgeThreshold = 50;
    }
    // each face between the pilasters: rim, fluted frieze, panelled upper zone, the compass,
    // and below it the grate of network of brass (Ex 27:4–5)
    const faces = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [fx, fz] of faces) {
      const along = fx === 0;                                       // face runs along x
      const at = (d) => [x + fx * (fp + d), z + fz * (fp + d)];
      const slab = (hgt, thick, mat, y, d, extra = 0) => {
        const [cx, cz] = at(d);
        return along ? box(span + extra, hgt, thick, mat, cx, y, cz) : box(thick, hgt, span + extra, mat, cx, y, cz);
      };
      slab(0.06, 0.07, M.bronze, h - 0.06, 0.035);                    // rim
      slab(0.09, 0.02, M.bronzeFluted, h - 0.16, 0.01);               // fluted frieze
      slab(h - 0.16 - (ledgeY + 0.07), 0.02, M.bronzePanel, ledgeY + 0.07, 0.01);
      slab(0.07, 0.11, M.bronze, ledgeY, 0.055, 2 * P + 0.1);         // the compass, running round the pilasters
      slab(0.03, 0.08, M.bronze, ledgeY - 0.03, 0.04, 2 * P + 0.06);
      slab(ledgeY - 0.03 - 0.16, 0.025, M.lattice, 0.16, 0.05);       // the network, standing proud of the boards
      slab(0.05, 0.07, M.bronze, ledgeY - 0.08, 0.035);               // frame round the network
      slab(0.07, 0.07, M.bronze, 0.09, 0.035);
    }
    // rings at the east and west faces, below the compass, and the staves through them (Ex 27:6–7)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const ring = put(new THREE.TorusGeometry(0.055, 0.012, 8, 20), M.bronze, x + sx * (s / 2 + 0.06), ledgeY - 0.17, z + sz * (s / 2 - 0.5));
        ring.userData.edgeThreshold = 60;
      }
      rod(s + 1.6, 0.045, M.bronze, [x + sx * (s / 2 + 0.06), z - s / 2 - 0.8], [x + sx * (s / 2 + 0.06), z + s / 2 + 0.8], ledgeY - 0.17);
    }
    // grate, wood and fire inside
    box(s - 0.2, 0.04, s - 0.2, M.grate, x, h - 0.55, z);
    box(s - 0.5, 0.08, s - 0.5, M.coal, x, h - 0.5, z);
    for (let k = -1; k <= 1; k++) {
      const log = cyl(0.09, s - 0.7, M.charred, x + k * 0.3, h - 0.4, z, 10);
      log.rotation.x = Math.PI / 2; log.position.y = h - 0.38 + (k === 0 ? 0.1 : 0);
    }
    // a ramp of earth on the south side: no steps up to the altar (Ex 20:26)
    const rampLen = 5.2, rampH = ledgeY + 0.05;
    const g = uvBox(1.6, rampH, rampLen);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0 && p.getZ(i) > 0) p.setY(i, -rampH / 2 + 0.02);
    g.computeVertexNormals();
    put(g, M.earth, x, rampH / 2, z + s / 2 + 0.13 + rampLen / 2);
  }

  // --- Laver of brass and its foot, made of the women's mirrors (Ex 30:17–21; 38:8)
  {
    // a goblet of polished brass: fluted foot, slender stem, gadrooned knop, deep bowl with a rolled rim
    const { x, z } = SPOTS.laver;
    const lathe = (pts, seg = 64) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    const parts = [
      [lathe([[0.001, 0], [0.42, 0], [0.43, 0.025], [0.42, 0.05], [0.36, 0.075], [0.25, 0.105], [0.16, 0.13], [0.001, 0.13]]), M.bronzeFluted],
      [lathe([[0.001, 0.125], [0.15, 0.125], [0.11, 0.17], [0.088, 0.26], [0.078, 0.42], [0.084, 0.5], [0.1, 0.525], [0.001, 0.525]]), M.bronzePolished],
      [lathe([[0.001, 0.515], [0.1, 0.515], [0.128, 0.54], [0.138, 0.57], [0.128, 0.6], [0.1, 0.62], [0.001, 0.62]]), M.bronzeFluted],
      [lathe([[0.001, 0.61], [0.13, 0.61], [0.3, 0.655], [0.45, 0.74], [0.54, 0.84], [0.58, 0.93], [0.595, 0.99], [0.615, 1.02], [0.625, 1.055],
        [0.61, 1.085], [0.575, 1.09], [0.552, 1.06], [0.53, 0.97], [0.45, 0.85], [0.3, 0.76], [0.001, 0.73]]), M.bronzePolished],
    ];
    for (const [g, mat] of parts) put(g, mat, x, 0, z).userData.edgeThreshold = 40;
    // two twisted bands round the bowl, below the rim
    for (const [r, y] of [[0.605, 1.005], [0.575, 0.925]]) {
      const band = put(new THREE.TorusGeometry(r, 0.013, 10, 96), M.bronzeRope, x, y, z);
      band.rotation.x = Math.PI / 2;
      band.userData.edgeThreshold = 89;
    }
    const w = put(new THREE.CircleGeometry(0.535, 48), M.water, x, 1.0, z);
    w.rotation.x = -Math.PI / 2;
  }

  // --- Table of showbread: 2 x 1 x 1.5 cubits, crown and border of gold, twelve loaves (Ex 25:23–30; Lev 24:5–7)
  {
    const { x, z } = SPOTS.table, l = c(2), w = c(1), h = c(1.5);
    const lx = l / 2 - 0.06, lz = w / 2 - 0.06, legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    // square legs on small feet, tied by a stretcher frame near the ground
    for (const [dx, dz] of legs) {
      box(0.06, h - 0.08, 0.06, M.gold, x + dx * lx, 0.03, z + dz * lz);
      box(0.08, 0.03, 0.08, M.gold, x + dx * lx, 0, z + dz * lz);
    }
    box(2 * lx, 0.035, 0.035, M.gold, x, 0.13, z - lz);
    box(2 * lx, 0.035, 0.035, M.gold, x, 0.13, z + lz);
    box(0.035, 0.035, 2 * lz, M.gold, x - lx, 0.13, z);
    box(0.035, 0.035, 2 * lz, M.gold, x + lx, 0.13, z);
    // the border of an handbreadth round about, wrought in relief (Ex 25:25)
    const bh = 0.09, by = h - 0.05 - bh;
    box(2 * lx + 0.07, bh, 0.025, M.goldRelief, x, by, z - lz - 0.025);
    box(2 * lx + 0.07, bh, 0.025, M.goldRelief, x, by, z + lz + 0.025);
    box(0.025, bh, 2 * lz + 0.02, M.goldRelief, x - lx - 0.025, by, z);
    box(0.025, bh, 2 * lz + 0.02, M.goldRelief, x + lx + 0.025, by, z);
    box(l - 0.02, 0.015, w - 0.02, M.gold, x, h - 0.055, z);           // moulding under the top
    box(l, 0.035, w, M.gold, x, h - 0.04, z);                           // top
    // the golden crown round about: a low rim crested with small leaves (Ex 25:24)
    box(l, 0.02, 0.018, M.gold, x, h - 0.005, z - w / 2 + 0.009);
    box(l, 0.02, 0.018, M.gold, x, h - 0.005, z + w / 2 - 0.009);
    box(0.018, 0.02, w - 0.036, M.gold, x - l / 2 + 0.009, h - 0.005, z);
    box(0.018, 0.02, w - 0.036, M.gold, x + l / 2 - 0.009, h - 0.005, z);
    const crest = (x0, z0, x1, z1) => {
      const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.045);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        box(0.018, 0.035, 0.018, M.gold, x0 + (x1 - x0) * t, h + 0.015, z0 + (z1 - z0) * t);
      }
    };
    crest(x - l / 2 + 0.009, z - w / 2 + 0.009, x + l / 2 - 0.009, z - w / 2 + 0.009);
    crest(x - l / 2 + 0.009, z + w / 2 - 0.009, x + l / 2 - 0.009, z + w / 2 - 0.009);
    crest(x - l / 2 + 0.009, z - w / 2 + 0.054, x - l / 2 + 0.009, z + w / 2 - 0.054);
    crest(x + l / 2 - 0.009, z - w / 2 + 0.054, x + l / 2 - 0.009, z + w / 2 - 0.054);
    // twelve cakes in two rows, six on a row, pure frankincense upon each row (Lev 24:5–7)
    const top = h;
    const cake = new THREE.LatheGeometry([[0.001, 0], [0.118, 0], [0.13, 0.007], [0.133, 0.017], [0.127, 0.028], [0.112, 0.032], [0.001, 0.032]]
      .map(([r, y]) => new THREE.Vector2(r, y)), 36);
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 6; k++) put(cake, M.bread, x + sx * 0.25, top + k * 0.033, z).userData.edgeThreshold = 50;
      const cup = [[0.001, 0], [0.03, 0.005], [0.045, 0.025], [0.05, 0.04]].map(([r, y]) => new THREE.Vector2(r, y));
      put(new THREE.LatheGeometry(cup, 18), M.gold, x + sx * 0.25, top + 6 * 0.033, z).userData.edgeThreshold = 50;
    }
    // vessels of pure gold between the rows: a flagon and two small bowls (Ex 25:29)
    const flagon = [[0.001, 0], [0.045, 0], [0.05, 0.015], [0.062, 0.07], [0.058, 0.12], [0.034, 0.17], [0.024, 0.205], [0.034, 0.225], [0.03, 0.23], [0.001, 0.22]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    put(new THREE.LatheGeometry(flagon, 24), M.gold, x, top, z - 0.04).userData.edgeThreshold = 45;
    const handle = put(new THREE.TorusGeometry(0.045, 0.007, 8, 18, Math.PI * 1.2), M.gold, x + 0.055, top + 0.14, z - 0.04);
    handle.rotation.z = -Math.PI * 0.6;
    handle.userData.edgeThreshold = 60;
    const dish = [[0.001, 0], [0.035, 0.004], [0.05, 0.02], [0.055, 0.028]].map(([r, y]) => new THREE.Vector2(r, y));
    for (const dz of [-1, 1]) put(new THREE.LatheGeometry(dish, 18), M.gold, x + 0.04 * dz, top, z + 0.15).userData.edgeThreshold = 50;
    // four rings over against the border, at the legs, and the staves through them (Ex 25:26–28)
    for (const [dx, dz] of legs) {
      const ring = put(new THREE.TorusGeometry(0.035, 0.009, 8, 20), M.gold, x + dx * (lx - 0.07), by + bh / 2, z + dz * (lz + 0.075));
      ring.rotation.y = Math.PI / 2;
      ring.userData.edgeThreshold = 60;
    }
    for (const dz of [-1, 1]) rod(l + 0.8, 0.022, M.gold, [x - l / 2 - 0.4, z + dz * (lz + 0.075)], [x + l / 2 + 0.4, z + dz * (lz + 0.075)], by + bh / 2);
  }

  // --- Candlestick of pure gold, a talent, beaten work, seven lamps (Ex 25:31–40)
  //     a stepped six-sided foot, the shaft, three branches out of each side, and on shaft and
  //     branches bowls made like unto almonds, each with a knop and a flower
  {
    const { x, z } = SPOTS.menorah;
    const v2 = (pts) => pts.map(([r, y]) => new THREE.Vector2(r, y));
    // the foot: two hexagonal steps with reeded edges and a tapering hexagonal pedestal
    const hex = (rt, rb, hgt, mat, y) => {
      const m = put(new THREE.CylinderGeometry(rt, rb, hgt, 6), mat, x, y + hgt / 2, z);
      m.rotation.y = Math.PI / 6;
      m.userData.edgeThreshold = 20;
    };
    hex(0.3, 0.31, 0.055, M.goldReed, 0);
    hex(0.26, 0.27, 0.012, M.gold, 0.055);
    hex(0.22, 0.23, 0.045, M.goldReed, 0.067);
    hex(0.075, 0.12, 0.22, M.gold, 0.112);
    hex(0.085, 0.085, 0.02, M.gold, 0.33);
    const shaftTop = 1.5, lampY = 1.47, r = 0.019;
    cyl(0.026, shaftTop - 0.35, M.gold, x, 0.35, z, 16);
    // the almond bud: a knop with its petals, used on shaft and branches alike
    const bud = new THREE.LatheGeometry(v2([[0.001, 0], [0.024, 0.004], [0.038, 0.022], [0.042, 0.04], [0.035, 0.058], [0.024, 0.07], [0.03, 0.076], [0.022, 0.082], [0.001, 0.082]]), 20);
    const putBud = (px, py, s = 1) => {
      const m = put(bud, M.goldBud, px, py - 0.041 * s, z);
      m.scale.setScalar(s);
      m.userData.edgeThreshold = 40;
    };
    // the lamp: a flared cup with a lipped rim
    const lamp = new THREE.LatheGeometry(v2([[0.001, 0], [0.018, 0], [0.024, 0.018], [0.04, 0.034], [0.06, 0.045], [0.066, 0.055], [0.058, 0.056], [0.035, 0.045], [0.001, 0.04]]), 24);
    const putLamp = (px, py) => {
      put(lamp, M.gold, px, py, z).userData.edgeThreshold = 45;
      const f = put(new THREE.ConeGeometry(0.011, 0.05, 8), M.flame, px, py + 0.075, z);
      f.castShadow = false; f.userData.edgeThreshold = 89;
    };
    // three branches on each side, the outermost leaving the shaft lowest
    for (const [reach, yJ] of [[0.5, 0.8], [0.345, 0.99], [0.19, 1.17]]) {
      for (const sd of [-1, 1]) {
        const path = new THREE.CurvePath();
        const rise = Math.min(0.24, (lampY - yJ) * 0.45);
        path.add(new THREE.CubicBezierCurve3(
          new THREE.Vector3(x, yJ, z), new THREE.Vector3(x + sd * reach * 0.62, yJ - 0.02, z),
          new THREE.Vector3(x + sd * reach, yJ + rise * 0.3, z), new THREE.Vector3(x + sd * reach, yJ + rise, z)));
        path.add(new THREE.LineCurve3(new THREE.Vector3(x + sd * reach, yJ + rise, z), new THREE.Vector3(x + sd * reach, lampY, z)));
        put(new THREE.TubeGeometry(path, 48, r, 10, false), M.gold, 0, 0, 0).userData.edgeThreshold = 50;
        // a bud on the bend and two on the upright, the upper one just under the lamp
        const mid = path.curves[0].getPoint(0.55);
        const k = put(bud, M.goldBud, mid.x, mid.y - 0.03, z);
        k.rotation.z = sd * 0.9; k.userData.edgeThreshold = 40;
        putBud(x + sd * reach, lampY - 0.18);
        putBud(x + sd * reach, lampY - 0.05);
        putLamp(x + sd * reach, lampY);
      }
      putBud(x, yJ, 1.12);                      // a knop under each pair of branches (Ex 25:35)
    }
    putBud(x, shaftTop - 0.17, 1.05);
    putBud(x, shaftTop - 0.05, 1.05);
    putLamp(x, shaftTop);
  }

  // --- Altar of incense: 1 x 1 x 2 cubits, overlaid with pure gold, horns and a crown (Ex 30:1–10)
  {
    const { x, z } = SPOTS.incense, s = c(1), h = c(2);
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    // stepped plinth, the chest, slender corner pilasters
    box(s + 0.08, 0.05, s + 0.08, M.gold, x, 0, z);
    box(s + 0.04, 0.04, s + 0.04, M.gold, x, 0.05, z);
    const bodyY = 0.09, bodyH = h - 0.1 - bodyY;
    box(s - 0.02, bodyH, s - 0.02, M.gold, x, bodyY, z);
    for (const [dx, dz] of corners) box(0.055, bodyH, 0.055, M.gold, x + dx * (s / 2 - 0.022), bodyY, z + dz * (s / 2 - 0.022));
    // a raised and fielded panel on each face
    const pw = s - 0.13, ph = bodyH - 0.1, py = bodyY + 0.05, fd = (s - 0.02) / 2;
    box(pw, ph, 0.012, M.goldFielded, x, py, z - fd - 0.006);
    box(pw, ph, 0.012, M.goldFielded, x, py, z + fd + 0.006);
    box(0.012, ph, pw, M.goldFielded, x - fd - 0.006, py, z);
    box(0.012, ph, pw, M.goldFielded, x + fd + 0.006, py, z);
    // the cornice, the top, and the crown of gold round about with its reeded rim (Ex 30:3)
    box(s + 0.02, 0.03, s + 0.02, M.gold, x, h - 0.1, z);
    box(s + 0.06, 0.045, s + 0.06, M.goldReed, x, h - 0.07, z);
    box(s + 0.04, 0.025, s + 0.04, M.gold, x, h - 0.025, z);
    const cw = s + 0.04, ct = 0.022, chH = 0.045;
    box(cw, chH, ct, M.goldReed, x, h, z - cw / 2 + ct / 2);
    box(cw, chH, ct, M.goldReed, x, h, z + cw / 2 - ct / 2);
    box(ct, chH, cw - 2 * ct, M.goldReed, x - cw / 2 + ct / 2, h, z);
    box(ct, chH, cw - 2 * ct, M.goldReed, x + cw / 2 - ct / 2, h, z);
    // the horns, of one piece with it (Ex 30:2)
    for (const [dx, dz] of corners) {
      put(hornGeometry(new THREE.Vector3(dx, 0, dz), 0.11, 0.05, 0.03), M.gold, x + dx * (cw / 2 - 0.03), h + chH - 0.01, z + dz * (cw / 2 - 0.03)).userData.edgeThreshold = 50;
    }
    // a footed censer of coals, from which the incense rises
    const v2 = (pts) => pts.map(([r, y]) => new THREE.Vector2(r, y));
    put(new THREE.LatheGeometry(v2([[0.001, 0], [0.045, 0], [0.045, 0.012], [0.018, 0.03], [0.014, 0.06], [0.03, 0.075], [0.06, 0.095], [0.082, 0.13], [0.085, 0.14],
      [0.078, 0.14], [0.055, 0.105], [0.001, 0.095]]), 28), M.gold, x, h, z).userData.edgeThreshold = 45;
    const coals = put(new THREE.CylinderGeometry(0.07, 0.05, 0.03, 20), M.coal, x, h + 0.112, z);
    coals.userData.edgeThreshold = 89;
    // rings under the crown on two sides, and banded staves through them (Ex 30:4–5)
    const ringY = h - 0.17, pz = s / 2 + 0.03;
    for (const [dx, dz] of corners) {
      const ring = put(new THREE.TorusGeometry(0.03, 0.008, 8, 18), M.gold, x + dx * (s / 2 - 0.08), ringY, z + dz * pz);
      ring.rotation.y = Math.PI / 2;
      ring.userData.edgeThreshold = 60;
    }
    const half = s / 2 + 0.65;
    for (const dz of [-1, 1]) {
      const zz = z + dz * pz;
      rod(2 * half, 0.018, M.gold, [x - half, zz], [x + half, zz], ringY);
      for (const e of [-1, 1]) {
        rod(0.03, 0.024, M.gold, [x + e * half - e * 0.015 - 0.015, zz], [x + e * half - e * 0.015 + 0.015, zz], ringY);   // end cap
        rod(0.02, 0.022, M.gold, [x + e * (half - 0.1) - 0.01, zz], [x + e * (half - 0.1) + 0.01, zz], ringY);            // band
        rod(0.02, 0.022, M.gold, [x + e * (half - 0.14) - 0.01, zz], [x + e * (half - 0.14) + 0.01, zz], ringY);
      }
    }
  }

  // --- Ark of the testimony: 2.5 x 1.5 x 1.5 cubits of acacia overlaid within and without with pure gold,
  //     a crown of gold round about, four rings in its four feet, staves of acacia overlaid with gold,
  //     the mercy seat of pure gold with two cherubim of beaten work (Ex 25:10–22)
  {
    const { x, z } = SPOTS.ark, l = c(2.5), w = c(1.5);
    const arkFirst = root.children.length;
    const v2 = (pts) => pts.map(([r, y]) => new THREE.Vector2(r, y));
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    const post = 0.1, bodyTop = 0.56, friezeTop = 0.635, corniceTop = 0.71;

    // square corner posts running down into feet
    for (const [dx, dz] of corners) {
      const px = x + dx * (l / 2 - post / 2), pz = z + dz * (w / 2 - post / 2);
      box(post, bodyTop, post, M.gold, px, 0, pz);
      box(post + 0.025, 0.03, post + 0.025, M.gold, px, 0, pz);
    }
    // the chest, set between the posts, with a sunk panel on each face
    box(l - 0.06, bodyTop - 0.11, w - 0.06, M.gold, x, 0.11, z);
    const fz = (w - 0.06) / 2, fx = (l - 0.06) / 2, pH = bodyTop - 0.11 - 0.06;
    const panel = (pw, mx, mz, along) => put(along ? new THREE.BoxGeometry(pw, pH, 0.01) : new THREE.BoxGeometry(0.01, pH, pw), M.goldSunk, mx, 0.14 + pH / 2, mz);
    panel(l - 2 * post - 0.06, x, z - fz - 0.005, true);
    panel(l - 2 * post - 0.06, x, z + fz + 0.005, true);
    panel(w - 2 * post - 0.06, x - fx - 0.005, z, false);
    panel(w - 2 * post - 0.06, x + fx + 0.005, z, false);
    // an apron between the feet, its lower edge cut in a shallow arch
    const apron = (span) => {
      const sh = new THREE.Shape();
      sh.moveTo(-span / 2, 0.02);
      sh.quadraticCurveTo(-span / 2 + 0.01, 0.075, -span / 2 + 0.08, 0.08);
      sh.lineTo(span / 2 - 0.08, 0.08);
      sh.quadraticCurveTo(span / 2 - 0.01, 0.075, span / 2, 0.02);
      sh.lineTo(span / 2, 0.14); sh.lineTo(-span / 2, 0.14); sh.closePath();
      return new THREE.ExtrudeGeometry(sh, { depth: 0.035, bevelEnabled: false, curveSegments: 10 });
    };
    const apL = apron(l - 2 * post), apW = apron(w - 2 * post);
    for (const sz of [-1, 1]) {
      const m = put(apL, M.gold, x, 0, z + sz * (w / 2 - 0.0175) - 0.0175);
      m.userData.edgeThreshold = 40;
    }
    for (const sx of [-1, 1]) {
      const m = put(apW, M.gold, x + sx * (l / 2 - 0.0175), 0, z);
      m.rotation.y = Math.PI / 2; m.position.x -= 0.0175;
      m.userData.edgeThreshold = 40;
    }
    // the frieze of palmettes, with a rosette block above every post
    const fh = friezeTop - bodyTop;
    box(l - 2 * post, fh, 0.012, M.goldFrieze, x, bodyTop, z - w / 2 + 0.006);
    box(l - 2 * post, fh, 0.012, M.goldFrieze, x, bodyTop, z + w / 2 - 0.006);
    box(0.012, fh, w - 2 * post, M.goldFrieze, x - l / 2 + 0.006, bodyTop, z);
    box(0.012, fh, w - 2 * post, M.goldFrieze, x + l / 2 - 0.006, bodyTop, z);
    box(l - 0.06, fh, w - 0.06, M.gold, x, bodyTop, z);
    for (const [dx, dz] of corners) {
      const px = x + dx * (l / 2 - post / 2), pz = z + dz * (w / 2 - post / 2);
      box(post, fh, post, M.gold, px, bodyTop, pz);
      put(new THREE.BoxGeometry(post * 0.8, fh * 0.8, 0.006), M.goldRosette, px, bodyTop + fh / 2, pz + dz * (post / 2 + 0.003));
      put(new THREE.BoxGeometry(0.006, fh * 0.8, post * 0.8), M.goldRosette, px + dx * (post / 2 + 0.003), bodyTop + fh / 2, pz);
    }
    // the crown of gold round about: a flared cornice of reeded leaves
    {
      const ch = corniceTop - friezeTop, k = Math.SQRT1_2;
      const g = new THREE.CylinderGeometry(1, 0.9, ch, 4, 1, true);
      g.rotateY(Math.PI / 4);
      const m = put(g, M.goldCavetto, x, friezeTop + ch / 2, z);
      m.scale.set((l / 2 + 0.07) / k, 1, (w / 2 + 0.07) / k);
      m.userData.edgeThreshold = 30;
      box(l + 0.16, 0.018, w + 0.16, M.gold, x, corniceTop, z);
    }
    // the mercy seat of pure gold, its raised border round a sunk field
    const seatY = corniceTop + 0.018;
    box(l + 0.08, 0.025, w + 0.08, M.gold, x, seatY, z);
    const rimY = seatY + 0.025, rT = 0.04, rH = 0.022, sl = l + 0.02, sw = w + 0.02;
    box(sl, rH, rT, M.gold, x, rimY, z - sw / 2 + rT / 2);
    box(sl, rH, rT, M.gold, x, rimY, z + sw / 2 - rT / 2);
    box(rT, rH, sw - 2 * rT, M.gold, x - sl / 2 + rT / 2, rimY, z);
    box(rT, rH, sw - 2 * rT, M.gold, x + sl / 2 - rT / 2, rimY, z);
    const seatTop = rimY;

    // rings at the head of the posts, and the staves through them (Ex 25:12–15)
    const ringY = bodyTop - 0.06, poleZ = w / 2 + 0.035;
    for (const [dx, dz] of corners) {
      const ring = put(new THREE.TorusGeometry(0.032, 0.008, 8, 20), M.gold, x + dx * (l / 2 - post / 2), ringY, z + dz * (poleZ - 0.004));
      ring.rotation.y = Math.PI / 2;
      ring.userData.edgeThreshold = 60;
    }
    const half = l / 2 + 0.6;
    for (const sz of [-1, 1]) {
      const zz = z + sz * poleZ;
      rod(2 * half, 0.022, M.gold, [x - half, zz], [x + half, zz], ringY);
      for (const e of [-1, 1]) {
        rod(0.03, 0.028, M.gold, [x + e * (half - 0.015) - 0.015, zz], [x + e * (half - 0.015) + 0.015, zz], ringY);
        for (const d of [0.1, 0.13]) rod(0.012, 0.026, M.gold, [x + e * (half - d) - 0.006, zz], [x + e * (half - d) + 0.006, zz], ringY);
      }
    }

    // the cherubim, kneeling on low pedestals at the two ends, faces bowed toward the seat,
    // wings stretched forth on high and sweeping forward over it (Ex 25:18–20)
    const featherRow = (len, hgt, nFeathers, drop) => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.bezierCurveTo(len * 0.18, hgt * 0.9, len * 0.45, hgt, len, hgt * 0.92);
      for (let i = 1; i <= nFeathers; i++) {
        const t = i / nFeathers;
        const fx2 = len * (1 - t), fy = hgt * 0.92 * (1 - t) - drop * Math.sin(Math.PI * Math.min(1, t * 1.1));
        sh.quadraticCurveTo(len * (1 - t + 0.5 / nFeathers) + 0.01, fy - 0.03, fx2, fy + 0.012);
      }
      sh.lineTo(0, 0);
      return new THREE.ExtrudeGeometry(sh, { depth: 0.008, bevelEnabled: false, curveSegments: 5 });
    };
    const primaries = featherRow(0.56, 0.19, 12, 0.08), coverts = featherRow(0.34, 0.15, 8, 0.03);
    const robe = new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const torso = new THREE.LatheGeometry(v2([[0.001, 0], [0.07, 0], [0.074, 0.05], [0.064, 0.12], [0.05, 0.17], [0.034, 0.2], [0.001, 0.205]]), 20);
    for (const side of [-1, 1]) {
      const cxp = x + side * (l / 2 - 0.2);
      box(0.24, 0.025, 0.22, M.gold, cxp, seatTop, z);
      box(0.2, 0.025, 0.18, M.gold, cxp, seatTop + 0.025, z);
      const ch = new THREE.Group();
      ch.position.set(cxp, seatTop + 0.05, z);
      ch.rotation.y = side < 0 ? 0 : Math.PI;     // local +x points to the centre of the mercy seat
      root.add(ch);
      const lower = put(robe, M.gold, -0.01, 0, 0, ch);
      lower.scale.set(0.11, 0.075, 0.09);
      lower.userData.edgeThreshold = 60;
      const body = put(torso, M.gold, -0.035, 0.045, 0, ch);
      body.rotation.z = -0.55;
      body.userData.edgeThreshold = 40;
      put(new THREE.SphereGeometry(0.05, 18, 12), M.gold, 0.12, 0.215, 0, ch).userData.edgeThreshold = 89;
      for (const sw2 of [-1, 1]) {
        // the upper wing, raised high and sweeping forward toward the other cherub
        const up = new THREE.Group();
        up.position.set(-0.07, 0.22, sw2 * 0.07);
        up.rotation.set(-sw2 * 0.34, -sw2 * 0.1, 0.2);
        ch.add(up);
        const off = sw2 > 0 ? 0 : -0.008;
        put(primaries, M.goldFeather, 0, 0, off, up).userData.edgeThreshold = 40;
        put(coverts, M.goldScale, 0, 0.035, off + sw2 * 0.009, up).userData.edgeThreshold = 40;
        // the lower wing, folded forward round the body
        const low = new THREE.Group();
        low.position.set(-0.06, 0.16, sw2 * 0.08);
        low.rotation.set(sw2 * 0.15, -sw2 * 0.55, -0.35);
        low.scale.setScalar(0.62);
        ch.add(low);
        put(primaries, M.goldFeather, 0, 0, off, low).userData.edgeThreshold = 40;
        put(coverts, M.goldScale, 0, 0.035, off + sw2 * 0.009, low).userData.edgeThreshold = 40;
      }
    }
    // The ark stands across the room, its length running north–south, as on the floor plan.
    // Built along x above, then turned a quarter about its own centre.
    const ark = new THREE.Group();
    ark.position.set(x, 0, z);
    ark.rotation.y = Math.PI / 2;
    for (const o of root.children.splice(arkFirst)) {
      o.position.x -= x; o.position.z -= z;
      o.parent = null;
      ark.add(o);
    }
    root.add(ark);
  }

  return { root, dynamic, gateL, gateR, doorBay, veilL, veilR };
}

// Collect every hard edge in world space into one ink drawing.
export function inkEdges(root, lineMat) {
  root.updateMatrixWorld(true);
  const pts = [], outer = [];
  const tmp = new THREE.Vector3();
  const cache = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.userData.ownEdges) return;
    const th = o.userData.edgeThreshold ?? 25;
    const key = o.geometry.uuid + ':' + th;
    let eg = cache.get(key);
    if (!eg) { eg = new THREE.EdgesGeometry(o.geometry, th); cache.set(key, eg); }
    const p = eg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      tmp.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      pts.push(tmp.x, tmp.y, tmp.z);
      outer.push(o.material.userData.outer ? 1 : 0);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute('aOuter', new THREE.Float32BufferAttribute(outer, 1));
  return new THREE.LineSegments(g, lineMat);
}

export function ownEdges(mesh, lineMat) {
  const g = new THREE.EdgesGeometry(mesh.geometry, 25);
  g.setAttribute('aOuter', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  mesh.add(new THREE.LineSegments(g, lineMat));
}

// Bake all static meshes into one mesh per material: a few draw calls for the whole building.
export function bakeStatic(root, skip) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  const remove = [];
  root.traverse((o) => {
    if (!o.isMesh || skip.has(o) || o.userData.ownEdges) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    g.applyMatrix4(o.matrixWorld);
    const key = o.material.uuid + (o.castShadow ? 's' : '');
    if (!byMat.has(key)) byMat.set(key, { mat: o.material, cast: o.castShadow, geos: [] });
    byMat.get(key).geos.push(g);
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  const out = new THREE.Group();
  for (const { mat, cast, geos } of byMat.values()) {
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
    m.castShadow = cast; m.receiveShadow = true;
    out.add(m);
  }
  root.add(out);
  return out;
}
