import * as THREE from 'three';
import { SHEET } from './materials.js';
import { CU, COURT, TENT, SPOTS } from './model.js';

// The sheet lies on the ground under the model, in world metres.
// The model draws the walls and furniture; the sheet carries what an
// architect adds by hand: dimensions, names, the north point, the title block.
const PX = 40; // pixels per metre

export function drawSheet() {
  const cv = document.createElement('canvas');
  cv.width = Math.round(SHEET.w * PX);
  cv.height = Math.round(SHEET.h * PX);
  const g = cv.getContext('2d');
  const X = (x) => (x - SHEET.x0) * PX;
  const Z = (z) => (z - SHEET.z0) * PX;
  const ink = '#000';
  g.strokeStyle = ink; g.fillStyle = ink; g.lineCap = 'butt';

  const lw = (m) => { g.lineWidth = m * PX; };
  const seg = (x0, z0, x1, z1) => { g.beginPath(); g.moveTo(X(x0), Z(z0)); g.lineTo(X(x1), Z(z1)); g.stroke(); };
  const rect = (x0, z0, x1, z1) => g.strokeRect(X(x0), Z(z0), (x1 - x0) * PX, (z1 - z0) * PX);
  const font = (size, { family = 'Barlow Condensed', weight = 600, italic = false } = {}) => {
    g.font = `${italic ? 'italic ' : ''}${weight} ${size * PX}px "${family}"`;
  };
  const text = (s, x, z, size, opt = {}) => {
    font(size, opt);
    g.textAlign = opt.align || 'center';
    g.textBaseline = opt.base || 'alphabetic';
    g.letterSpacing = `${(opt.track ?? 0.08) * size * PX}px`;
    g.save();
    g.translate(X(x), Z(z));
    if (opt.rot) g.rotate(opt.rot);
    g.fillText(s, 0, 0);
    g.restore();
  };

  // ---- frame, zone marks ----
  const fx0 = SHEET.x0 + 1.4, fx1 = SHEET.x0 + SHEET.w - 1.4, fz0 = SHEET.z0 + 1.4, fz1 = SHEET.z0 + SHEET.h - 1.4;
  lw(0.16); rect(fx0, fz0, fx1, fz1);
  lw(0.04); rect(fx0 - 0.6, fz0 - 0.6, fx1 + 0.6, fz1 + 0.6);
  for (let i = 0; i < 8; i++) {
    const x = fx0 + (fx1 - fx0) * (i + 0.5) / 8;
    text(String(i + 1), x, fz0 - 0.12, 0.42, { weight: 500 });
    text(String(i + 1), x, fz1 + 0.5, 0.42, { weight: 500 });
    if (i) { lw(0.04); seg(fx0 + (fx1 - fx0) * i / 8, fz0 - 0.6, fx0 + (fx1 - fx0) * i / 8, fz0); seg(fx0 + (fx1 - fx0) * i / 8, fz1, fx0 + (fx1 - fx0) * i / 8, fz1 + 0.6); }
  }
  for (let j = 0; j < 6; j++) {
    const z = fz0 + (fz1 - fz0) * (j + 0.5) / 6 + 0.15;
    text('ABCDEF'[j], fx0 - 0.3, z, 0.42, { weight: 500 });
    text('ABCDEF'[j], fx1 + 0.3, z, 0.42, { weight: 500 });
  }

  // ---- centre line of approach ----
  lw(0.035); g.setLineDash([2.4 * PX, 0.4 * PX, 0.3 * PX, 0.4 * PX]);
  seg(-COURT.halfL - 6, 0, COURT.halfL + 7, 0);
  g.setLineDash([]);
  text('℄', COURT.halfL + 7.8, 0.3, 0.9, { family: 'Spectral', weight: 400 });

  // ---- dimension strings ----
  const tick = (x, z) => { lw(0.05); seg(x - 0.35, z + 0.35, x + 0.35, z - 0.35); };
  const dimH = (x0, x1, z, label, ext0, ext1) => {
    lw(0.03); seg(x0 - 0.6, z, x1 + 0.6, z);
    if (ext0 !== undefined) { seg(x0, ext0, x0, z + Math.sign(z - ext0) * 0.6); seg(x1, ext1 ?? ext0, x1, z + Math.sign(z - (ext1 ?? ext0)) * 0.6); }
    tick(x0, z); tick(x1, z);
    text(label, (x0 + x1) / 2, z - 0.35, 0.62);
  };
  const dimV = (z0, z1, x, label, ext) => {
    lw(0.03); seg(x, z0 - 0.6, x, z1 + 0.6);
    if (ext !== undefined) { seg(ext, z0, x + Math.sign(x - ext) * 0.6, z0); seg(ext, z1, x + Math.sign(x - ext) * 0.6, z1); }
    tick(x, z0); tick(x, z1);
    text(label, x - 0.35 * Math.sign(x), (z0 + z1) / 2, 0.62, { rot: -Math.PI / 2 * Math.sign(x) * -1 });
  };
  const L = COURT.halfL, W = COURT.halfW;
  const cu = (n) => `${n} CUBITS · ${(n * CU).toFixed(2)} M`;
  dimH(-L, L, -W - 4.6, cu(100), -W - 0.6);
  dimH(-L, TENT.west, -W - 2.6, cu(20), -W - 0.6);
  dimH(TENT.west, TENT.east, -W - 2.6, cu(30));
  dimH(TENT.east, L, -W - 2.6, cu(50));
  dimV(-W, W, -L - 3.2, cu(50), -L - 0.6);
  dimV(-W, -10 * CU, L + 3.2, cu(15), L + 0.6);
  dimV(-10 * CU, 10 * CU, L + 3.2, 'GATE · ' + cu(20));
  dimV(10 * CU, W, L + 3.2, cu(15));
  // inside: tent width and the rooms
  dimV(-TENT.halfW, TENT.halfW, TENT.east + 3.0, cu(10), TENT.east + 0.7);
  // clear of the coverings, which splay out about 1.5 m beyond the boards
  dimH(TENT.west, TENT.veil, -TENT.halfW - 3.0, '10 CU', -TENT.halfW - 2.0);
  dimH(TENT.veil, TENT.east, -TENT.halfW - 3.0, '20 CU', -TENT.halfW - 2.0);

  // ---- room names ----
  text('HOLY OF HOLIES', SPOTS.ark.x, 1.75, 0.46, { track: 0.14 });
  text('10 × 10 × 10 CUBITS', SPOTS.ark.x, 2.3, 0.3, { weight: 500 });
  text('HOLY PLACE', -3.0, 0.22, 0.6, { track: 0.16 });
  text('20 × 10 × 10 CUBITS', -3.0, 0.82, 0.3, { weight: 500 });
  text('OUTER COURT', 19.5, -8.3, 1.25, { track: 0.22 });
  text('100 × 50 CUBITS · LINEN HANGINGS 5 CUBITS HIGH ON 60 PILLARS', 19.5, -7.2, 0.36, { weight: 500 });

  // ramp arrow on the altar ramp
  {
    const x = SPOTS.altar.x, z0 = 6.4, z1 = 2.2;
    lw(0.04); seg(x, z0, x, z1);
    g.beginPath(); g.moveTo(X(x - 0.25), Z(z1 + 0.5)); g.lineTo(X(x), Z(z1)); g.lineTo(X(x + 0.25), Z(z1 + 0.5)); g.stroke();
    text('UP', x + 0.45, z0 - 0.2, 0.34, { align: 'left' });
  }

  // ---- keyed callouts, read west to east like the walk in reverse ----
  const items = [
    ['ARK OF THE COVENANT', '2½ × 1½ × 1½ CU · EX 25:10', SPOTS.ark, -21.0],
    ['THE VEIL', 'EX 26:31', { x: TENT.veil, z: 1.6 }, -15.4],
    ['ALTAR OF INCENSE', '1 × 1 × 2 CU · EX 30:1', SPOTS.incense, -10.4],
    ['CANDLESTICK', 'PURE GOLD · EX 25:31', SPOTS.menorah, -5.4],
    ['TABLE OF SHOWBREAD', '2 × 1 × 1½ CU · EX 25:23', SPOTS.table, -0.2],
    ['DOOR OF THE TENT', 'EX 26:36', { x: 0.3, z: 2.2 }, 5.0],
    ['LAVER OF BRASS', 'EX 30:18', SPOTS.laver, 10.0],
    ['ALTAR OF BURNT OFFERING', '5 × 5 × 3 CU · EX 27:1', { x: SPOTS.altar.x + 1.0, z: 1.0 }, 16.2],
    ['GATE OF THE COURT', '20 CU · EX 27:16', { x: L, z: 4.2 }, 23.4],
  ];
  const rowZ = W + 4.4;
  items.forEach(([name, sub, p, lx], i) => {
    lw(0.03);
    g.beginPath();
    g.moveTo(X(p.x), Z(p.z));
    g.lineTo(X(p.x), Z(W + 1.6));
    g.lineTo(X(lx), Z(rowZ - 1.4));
    g.lineTo(X(lx), Z(rowZ - 0.85));
    g.stroke();
    g.beginPath(); g.arc(X(p.x), Z(p.z), 0.11 * PX, 0, Math.PI * 2); g.fill();
    // key number in a circle
    lw(0.04); g.beginPath(); g.arc(X(lx), Z(rowZ - 0.35), 0.48 * PX, 0, Math.PI * 2); g.stroke();
    text(String(i + 1), lx, rowZ - 0.13, 0.55, { weight: 600, track: 0 });
    text(name, lx, rowZ + 0.8, 0.56, { track: 0.08 });
    text(sub, lx, rowZ + 1.45, 0.38, { weight: 500 });
  });

  // ---- north point ----
  {
    const cx = -36.5, cz = -21.5, r = 2.4;
    lw(0.05); g.beginPath(); g.arc(X(cx), Z(cz), r * PX, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(X(cx), Z(cz - r - 0.5)); g.lineTo(X(cx + 0.8), Z(cz + 1.2)); g.lineTo(X(cx), Z(cz + 0.5)); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(X(cx), Z(cz - r - 0.5)); g.lineTo(X(cx - 0.8), Z(cz + 1.2)); g.lineTo(X(cx), Z(cz + 0.5)); g.closePath(); g.stroke();
    text('N', cx, cz - r - 0.9, 1.0, { track: 0 });
  }

  // ---- the sun, low in the west ----
  {
    const cx = -36.5, cz = -8.5;
    lw(0.04);
    g.beginPath(); g.arc(X(cx), Z(cz), 0.7 * PX, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; seg(cx + Math.cos(a) * 0.95, cz + Math.sin(a) * 0.95, cx + Math.cos(a) * 1.35, cz + Math.sin(a) * 1.35); }
    g.setLineDash([0.5 * PX, 0.3 * PX]); seg(cx + 1.8, cz + 0.8, -L - 1.5, cz + 4.0); g.setLineDash([]);
    text('SUN · LATE AFTERNOON', cx, cz + 2.4, 0.36, { weight: 500 });
    text('ALTITUDE 12° · FROM THE WEST BY SOUTH', cx, cz + 2.95, 0.3, { weight: 500 });
  }

  // ---- scale bar ----
  {
    const x0 = 20.5, z = -25.2;
    for (let i = 0; i < 20; i++) {
      if (i % 2 === 0) g.fillRect(X(x0 + i * CU), Z(z - 0.3), CU * PX, 0.3 * PX);
    }
    lw(0.03); rect(x0, z - 0.3, x0 + 20 * CU, z);
    for (const n of [0, 5, 10, 15, 20]) text(String(n), x0 + n * CU, z - 0.55, 0.36, { weight: 500, track: 0 });
    text('CUBITS', x0 + 20 * CU + 0.5, z - 0.02, 0.36, { align: 'left', weight: 500 });
    lw(0.03); seg(x0, z + 0.35, x0 + 10, z + 0.35);
    for (let m = 0; m <= 10; m++) seg(x0 + m, z + 0.35, x0 + m, z + (m % 5 === 0 ? 0.85 : 0.6));
    for (const m of [0, 5, 10]) text(String(m), x0 + m, z + 1.35, 0.36, { weight: 500, track: 0 });
    text('METRES', x0 + 10.5, z + 0.75, 0.36, { align: 'left', weight: 500 });
  }

  // ---- title block ----
  {
    const x0 = 13.6, x1 = fx1, z0 = 20.2, z1 = fz1;
    lw(0.08); rect(x0, z0, x1, z1);
    lw(0.03);
    seg(x0, z0 + 6.1, x1, z0 + 6.1);
    seg(x0, z0 + 8.4, x1, z0 + 8.4);
    for (const k of [1, 2, 3]) seg(x0 + (x1 - x0) * k / 4, z0 + 6.1, x0 + (x1 - x0) * k / 4, z1);
    text('THE TABERNACLE OF MOSES', x0 + 0.9, z0 + 2.3, 1.55, { align: 'left', track: 0.06 });
    text('The tent of meeting and its court, after Exodus 25–27, 30 and 36–38', x0 + 0.95, z0 + 3.6, 0.62, { align: 'left', family: 'Spectral', weight: 400, italic: true, track: 0 });
    // the four fabrics of the gate, as a rule
    const cols = ['#000', '#000', '#000', '#000'];
    const stripes = [0.5, 0.25, 0.5, 0.25];
    let sx = x0 + 0.95;
    stripes.forEach((wd, k) => { g.fillStyle = cols[k]; g.fillRect(X(sx), Z(z0 + 4.45), (k % 2 ? 1.2 : 4.2) * PX, wd * 0.3 * PX); sx += (k % 2 ? 1.2 : 4.2) + 0.25; });
    g.fillStyle = ink;
    text('BLUE · PURPLE · SCARLET · FINE TWINED LINEN', x0 + 0.95, z0 + 5.45, 0.36, { align: 'left', weight: 500, track: 0.14 });
    const cells = [['DRAWING', 'PLAN AT +1.20 M'], ['SCALE', '1 : 100'], ['UNIT', '1 CUBIT = 0.52 M'], ['SHEET', 'A-101']];
    cells.forEach(([k, v], i) => {
      const cx = x0 + (x1 - x0) * i / 4 + 0.45;
      text(k, cx, z0 + 6.8, 0.3, { align: 'left', weight: 500, track: 0.2 });
      text(v, cx, z0 + 7.85, 0.6, { align: 'left', track: 0.04 });
    });
    text('DRAWN AFTER THE PATTERN SHEWED IN THE MOUNT · EX 25:40', x0 + 0.9, z1 - 0.7, 0.32, { align: 'left', weight: 500, track: 0.16 });
  }

  // ---- north side note on the hangings ----
  text('PILLARS AT 5 CUBITS · SOCKETS OF BRASS · HOOKS AND FILLETS OF SILVER', 0, -W - 6.4, 0.36, { weight: 500, track: 0.14 });

  const t = new THREE.CanvasTexture(cv);
  t.flipY = false;
  t.anisotropy = 16;
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
