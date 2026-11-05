// 파라메트릭 부품 생성기 (12.7mm 격자)
// 좌표계: 1 unit = 1mm. 판 부품: 길이=X, 두께=Y, 폭=Z. 회전 부품(축/기어): 축방향=로컬 +Y.
// 반환: { group, holes, kind, ... }
//   holes = [{ p: Vector3(로컬), n: Vector3(구멍 축), t: 그 지점의 판 두께 }]
//   kind  = 'plate' | 'axle' | 'gear' | 'motor'
//   회전 부품은 spinner(자전용 내부 그룹) 포함

import * as THREE from 'three';

export const PITCH = 12.7;      // 구멍 피치 (1/2인치)
export const HOLE_R = 2.05;     // 볼트용 구멍 반지름 (Ø4.1, geometry_spec)
export const THICK = 1.2;       // 강판 두께
export const STRIP_W = 12.7;    // 표준 스트립 폭
export const NARROW_W = 8.8;    // 좁은스트립 폭 (OCR 실측)

// 기어 모듈: 평기어(소)+피니언 축간거리 = 25.4mm(구멍 2칸)이 되도록 역산
// m*(57+19)/2 = 25.4 → m = 0.66842
// 검산: 평기어(소) 외경 m*59 = 39.4 ≈ 39.3mm ✓, 피니언 외경 m*21 = 14.0mm ✓
export const GEAR_MODULE = 50.8 / 76;

function steelMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xb9bdc4, metalness: 0.65, roughness: 0.35 });
}
function boltMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x6f7680, metalness: 0.8, roughness: 0.4 });
}
function plasticMaterial(color) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.55 });
}

// 모서리 둥근 사각형 Shape (shape 좌표: x=길이, y=폭)
function roundedRectShape(L, W, r) {
  const hx = L / 2, hy = W / 2;
  r = Math.min(r, hx, hy);
  const s = new THREE.Shape();
  s.moveTo(-hx + r, -hy);
  s.lineTo(hx - r, -hy);
  s.absarc(hx - r, -hy + r, r, -Math.PI / 2, 0, false);
  s.lineTo(hx, hy - r);
  s.absarc(hx - r, hy - r, r, 0, Math.PI / 2, false);
  s.lineTo(-hx + r, hy);
  s.absarc(-hx + r, hy - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-hx, -hy + r);
  s.absarc(-hx + r, -hy + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

// 장공 윤곽(양 끝 반원, 폭 = 구멍 지름). (ax,ay)~(bx,by) = 볼트 중심이 움직이는 선분 (shape 좌표)
function stadiumPath(ax, ay, bx, by, r) {
  const th = Math.atan2(by - ay, bx - ax), N = 10, pts = [];
  for (let i = 0; i <= N; i++) { const a = th - Math.PI / 2 + Math.PI * i / N; pts.push([bx + r * Math.cos(a), by + r * Math.sin(a)]); }
  for (let i = 0; i <= N; i++) { const a = th + Math.PI / 2 + Math.PI * i / N; pts.push([ax + r * Math.cos(a), ay + r * Math.sin(a)]); }
  const path = new THREE.Path();
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
  path.closePath();
  return path;
}

// 중심점들(반시계 볼록 다각형)을 반지름 R 만큼 부풀린 윤곽 — 구멍 중심에서 가장자리까지 R 인 판(삼각·오각평판)에 씀
function hullShape(centers, R) {
  const m = centers.length, s = new THREE.Shape();
  const edgeAng = i => { const p = centers[i % m], q = centers[(i + 1) % m]; return Math.atan2(-(q.x - p.x), q.y - p.y); };
  for (let i = 0; i < m; i++) {
    const a0 = edgeAng(i - 1 + m);
    let a1 = edgeAng(i);
    while (a1 < a0) a1 += Math.PI * 2;
    s.absarc(centers[i].x, centers[i].y, R, a0, a1, false);
  }
  s.closePath();
  return s;
}

// 구멍 뚫린 평판 지오메트리. holesXZ = [{x, z}] (3D 기준).
// L 자리에 THREE.Shape 를 주면 그 윤곽을 그대로 씀 (shape y = -z).
// slotsXZ = [{ x1, x2, z }] (X 방향) 또는 [{ x1, z1, x2, z2 }] (임의 방향): 장공
// polyHoles = [[[x,y],…]]: 다각형 창 (shape 좌표)
function flatPlateGeometry(L, W, holesXZ, cornerR, depth = THICK, slotsXZ = [], polyHoles = []) {
  const shape = L instanceof THREE.Shape ? L : roundedRectShape(L, W, cornerR);
  for (const h of holesXZ) {
    const path = new THREE.Path();
    path.absarc(h.x, -h.z, HOLE_R, 0, Math.PI * 2, true); // shape y = -z 매핑 보정
    shape.holes.push(path);
  }
  for (const s of slotsXZ) shape.holes.push(stadiumPath(s.x1, -(s.z1 ?? s.z), s.x2, -(s.z2 ?? s.z), HOLE_R));
  for (const pts of polyHoles) {
    const path = new THREE.Path();
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 16 });
  geo.translate(0, 0, -depth / 2);
  geo.rotateX(-Math.PI / 2); // (x,y,z) -> (x,z,-y)
  return geo;
}

function lineXs(n) {
  const xs = [];
  for (let i = 0; i < n; i++) xs.push((i - (n - 1) / 2) * PITCH);
  return xs;
}
function stripLength(n, endMargin) {
  return (n - 1) * PITCH + 2 * endMargin;
}
function holeMeta(x, y, z, nx, ny, nz, t = THICK) {
  return { p: new THREE.Vector3(x, y, z), n: new THREE.Vector3(nx, ny, nz), t };
}

// ── 스트립-N ──  예) 스트립-15: 12.7 × 188.8mm ✓ / 좁은스트립-5: 8.8 × 62.8mm ✓
export function makeStrip(n, width = STRIP_W) {
  const endMargin = width === STRIP_W ? 5.5 : 6.0;
  const L = stripLength(n, endMargin);
  const holesXZ = lineXs(n).map(x => ({ x, z: 0 }));
  const mesh = new THREE.Mesh(flatPlateGeometry(L, width, holesXZ, width / 2 - 0.35), steelMaterial());
  const group = new THREE.Group();
  group.add(mesh);
  return { group, kind: 'plate', holes: holesXZ.map(h => holeMeta(h.x, 0, 0, 0, 1, 0)) };
}

// ── 장공스트립-N ──  길이·폭은 일반 스트립과 같음(geometry_spec 3A/4A: 113.8 / 61.8, 12.7)
// 모양은 추정(실물 미확인): 양 끝 둥근 구멍 + 그 사이 2번~N-1번 구멍 자리를 잇는 장공 하나
// slots = [{ a, b, n, t }]: 장공 중심선 양 끝(볼트 중심이 갈 수 있는 범위)
export function makeSlottedStrip(n) {
  const L = stripLength(n, 5.5);
  const xs = lineXs(n);
  const ends = [xs[0], xs[n - 1]];
  const slot = { x1: xs[1], x2: xs[n - 2], z: 0 };
  const mesh = new THREE.Mesh(flatPlateGeometry(L, STRIP_W, ends.map(x => ({ x, z: 0 })), STRIP_W / 2 - 0.35, THICK, [slot]), steelMaterial());
  const group = new THREE.Group();
  group.add(mesh);
  return {
    group, kind: 'plate',
    holes: ends.map(x => holeMeta(x, 0, 0, 0, 1, 0)),
    slots: [{ a: new THREE.Vector3(slot.x1, 0, 0), b: new THREE.Vector3(slot.x2, 0, 0), n: new THREE.Vector3(0, 1, 0), t: THICK }],
  };
}

// ── 앵글-N ──  L자 단면 13.5×15 (실측), 양쪽 플랜지에 구멍 N개씩
export function makeAngle(n) {
  const A = 13.5;  // 수평 플랜지 폭
  const B = 15.0;  // 수직 플랜지 높이
  const L = stripLength(n, 5.5);
  const xs = lineXs(n);
  const holesXZ = xs.map(x => ({ x, z: 0 }));
  const group = new THREE.Group();

  const flat = new THREE.Mesh(flatPlateGeometry(L, A, holesXZ, 1.5), steelMaterial());
  flat.position.set(0, 0, A / 2);
  group.add(flat);

  const vert = new THREE.Mesh(flatPlateGeometry(L, B, holesXZ, 1.5), steelMaterial());
  vert.rotation.x = Math.PI / 2;
  vert.position.set(0, B / 2, 0);
  group.add(vert);

  const holes = [];
  for (const x of xs) {
    holes.push(holeMeta(x, 0, A / 2, 0, 1, 0));
    holes.push(holeMeta(x, B / 2, 0, 0, 0, 1));
  }
  return { group, kind: 'plate', holes };
}

// ── ㄷ형스트립-N (47~49) ──  납작한 스트립(구멍 N개) 양 끝만 위로 꺾은 모양 (상품 이미지 확인).
// 바닥 길이 = (N-1)·12.7+12 → 37.4 / 62.8 / 88.2 (이미지 치수와 일치), 폭 12.7, 날개 길이 14.3, 날개 구멍 1개씩.
// 꺾임각(바깥으로 20° 기울어짐)과 날개 구멍 위치(꺾임선에서 7mm)는 이미지에서 읽은 추정치.
const CHANNEL_TAB_L = 14.3;
const CHANNEL_TAB_LEAN = 20 * Math.PI / 180;
const CHANNEL_TAB_HOLE = 7.0;
export function makeChannel(n) {
  const W = STRIP_W;
  const Lw = (n - 1) * PITCH + 12;
  const xs = lineXs(n);
  const holesXZ = xs.map(x => ({ x, z: 0 }));
  const group = new THREE.Group();

  group.add(new THREE.Mesh(flatPlateGeometry(Lw, W, holesXZ, 1.0), steelMaterial()));
  const holes = xs.map(x => holeMeta(x, 0, 0, 0, 1, 0));

  const a = CHANNEL_TAB_LEAN;
  for (const side of [-1, 1]) {
    const u = new THREE.Vector3(side * Math.sin(a), Math.cos(a), 0);        // 날개가 뻗는 방향
    const base = new THREE.Vector3(side * Lw / 2, 0, 0);
    const tab = new THREE.Mesh(
      flatPlateGeometry(CHANNEL_TAB_L, W, [{ x: CHANNEL_TAB_HOLE - CHANNEL_TAB_L / 2, z: 0 }], 5, 1.0), steelMaterial());
    tab.rotation.z = Math.atan2(u.y, u.x);
    tab.position.copy(base).addScaledVector(u, CHANNEL_TAB_L / 2);
    group.add(tab);
    const hp = base.clone().addScaledVector(u, CHANNEL_TAB_HOLE);
    holes.push(holeMeta(hp.x, hp.y, 0, Math.cos(a), -side * Math.sin(a), 0, 1.0));
  }
  return { group, kind: 'plate', holes };
}

// ── 평판 cols×rows ──
export function makeRectPlate(cols, rows) {
  const L = stripLength(cols, 5.5);
  const W = stripLength(rows, 5.5);
  const holesXZ = [];
  for (const x of lineXs(cols)) for (const z of lineXs(rows)) holesXZ.push({ x, z });
  const mesh = new THREE.Mesh(flatPlateGeometry(L, W, holesXZ, 3), steelMaterial());
  const group = new THREE.Group();
  group.add(mesh);
  return { group, kind: 'plate', holes: holesXZ.map(h => holeMeta(h.x, 0, h.z, 0, 1, 0)) };
}

// ── 평판(대) 11×5 / 평판(소) 3×3 (55·56) ──  가로·세로 = 칸수 × 12.7, 모서리 R6.35, 구멍이 12.7 격자 (상품 이미지 확인)
export function makeGridPlate(cols, rows) {
  const L = cols * PITCH, W = rows * PITCH;
  const holesXZ = [];
  for (const x of lineXs(cols)) for (const z of lineXs(rows)) holesXZ.push({ x, z });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(flatPlateGeometry(L, W, holesXZ, 6.35), steelMaterial()));
  return { group, kind: 'plate', holes: holesXZ.map(h => holeMeta(h.x, 0, h.z, 0, 1, 0)) };
}

// ── 평판-N (60~63) ──  N칸 × 27.3, 모서리 R7. 한 줄은 둥근 구멍 N개, 다른 줄은 (폭 방향) 긴 구멍 N개.
// 길이 = (N-1)·12.7+12 → 평판-9 = 113.6 ✓(이미지). 평판-7/5/3 은 규격 이미지가 없어 같은 규칙으로 계산(사진으로 구성만 확인).
// 줄 위치(둥근 구멍 +7.35 / 장공 중심 -5.35, 이동폭 ±2.8)는 이미지 픽셀 측정 추정치.
const FLAT_PLATE_W = 27.3, FLAT_ROUND_Z = 7.35, FLAT_SLOT_Z1 = -2.55, FLAT_SLOT_Z2 = -8.15;
export function makeFlatPlateN(n) {
  const L = (n - 1) * PITCH + 12;
  const xs = lineXs(n);
  const holesXZ = xs.map(x => ({ x, z: FLAT_ROUND_Z }));
  const slotsXZ = xs.map(x => ({ x1: x, z1: FLAT_SLOT_Z1, x2: x, z2: FLAT_SLOT_Z2 }));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(flatPlateGeometry(L, FLAT_PLATE_W, holesXZ, 7, THICK, slotsXZ), steelMaterial()));
  return {
    group, kind: 'plate',
    holes: holesXZ.map(h => holeMeta(h.x, 0, h.z, 0, 1, 0)),
    slots: xs.map(x => ({ a: new THREE.Vector3(x, 0, FLAT_SLOT_Z1), b: new THREE.Vector3(x, 0, FLAT_SLOT_Z2), n: new THREE.Vector3(0, 1, 0), t: THICK })),
  };
}

// ── 오각평판 (71) ──  너비 37.4 × 높이 37.7, 둥근 구멍 5개(아래 3 + 가운데 + 꼭대기, 12.7 격자) + 삼각 창 2개 (상품 이미지)
// 윤곽은 구멍 중심 + 반지름 6 로 부풀려 만든 근사 (꼭지각 80° 표기는 둥근 모서리 때문에 정확히 재현 안 됨)
export function makePentagonPlate() {
  const G = [{ x: -12.7, y: 6 }, { x: 12.7, y: 6 }, { x: 12.7, y: 18.7 }, { x: 0, y: 31.7 }, { x: -12.7, y: 18.7 }];
  const hy = [[-12.7, 6.35], [0, 6.35], [12.7, 6.35], [0, 19.05], [0, 31.75]];
  const holesXZ = hy.map(([x, y]) => ({ x, z: -y }));
  const win = [[-11.7, 13.7], [-6.7, 13.7], [-6.7, 26.5], [-11.7, 21.0]];
  const windows = [win, win.map(([x, y]) => [-x, y])];
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(flatPlateGeometry(hullShape(G, 6), 0, holesXZ, 0, THICK, [], windows), steelMaterial());
  mesh.position.z = 18.85;     // 윤곽 중심(높이 방향)을 원점 근처로
  group.add(mesh);
  return { group, kind: 'plate', holes: holesXZ.map(h => holeMeta(h.x, 0, h.z + 18.85, 0, 1, 0)) };
}

// ── 삼각평판 3×5 (130) ──  63.5 × 38.1 직각삼각형(직각은 오른쪽 아래), 모서리 R6.35.
// 구멍 8개: 아랫줄 5 + 오른쪽 줄 추가 2 + 빗변 중점 1. 빗변 위(구멍 중심들을 잇는 선)에 장공 2개 (이미지 측정 추정)
export function makeTrianglePlate() {
  const CX = 31.75, CY = 19.05;                                 // 윤곽 중심을 원점으로
  const P = (x, y) => ({ x: x - CX, y: y - CY });
  const hullPts = [P(6.35, 6.35), P(57.15, 6.35), P(57.15, 31.75)];
  const hy = [];
  for (let i = 0; i < 5; i++) hy.push([6.35 + i * PITCH, 6.35]);
  hy.push([57.15, 19.05], [57.15, 31.75], [31.75, 19.05]);
  const holesXZ = hy.map(([x, y]) => { const p = P(x, y); return { x: p.x, z: -p.y }; });
  const lineY = x => 6.35 + 0.5 * (x - 6.35);                   // 빗변(구멍 중심선)
  const slotEnds = [[20.9, 24.8], [39.3, 49.4]];
  const slotsXZ = slotEnds.map(([xa, xb]) => { const a = P(xa, lineY(xa)), b = P(xb, lineY(xb)); return { x1: a.x, z1: -a.y, x2: b.x, z2: -b.y }; });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(flatPlateGeometry(hullShape(hullPts, 6.35), 0, holesXZ, 0, THICK, slotsXZ), steelMaterial()));
  return {
    group, kind: 'plate',
    holes: holesXZ.map(h => holeMeta(h.x, 0, h.z, 0, 1, 0)),
    slots: slotsXZ.map(s => ({ a: new THREE.Vector3(s.x1, 0, s.z1), b: new THREE.Vector3(s.x2, 0, s.z2), n: new THREE.Vector3(0, 1, 0), t: THICK })),
  };
}

// ── 이음판 (12) ──  23×12.7, 구멍 2개 @12.7 피치
export function makeJoinPlate() {
  const L = 23, W = STRIP_W;
  const holesXZ = [{ x: -PITCH / 2, z: 0 }, { x: PITCH / 2, z: 0 }];
  const mesh = new THREE.Mesh(flatPlateGeometry(L, W, holesXZ, 2), steelMaterial());
  const group = new THREE.Group();
  group.add(mesh);
  return { group, kind: 'plate', holes: holesXZ.map(h => holeMeta(h.x, 0, 0, 0, 1, 0)) };
}

// ── ㄱ형브래킷 (15/16) ──  수평 발(구멍 nFoot개) + 수직 벽(구멍 1개)
// 소: 발 13.5 구멍1 / 대: 발 26.3 구멍2 @12.7. 벽 높이 10.7 (실측)
// 구멍 위치는 OCR 외형치수 기반 근사 — 코너에서 6.75mm
// 2×2 (16A): 폭 25.4 (구멍 2열), 발 26.3 구멍 2×2, 벽 높이 12.3 구멍 2개 — 벽 구멍 수는 높이로 보아 1행 가정(추정)
export function makeLBracket(nFoot = 1, nWide = 1, wallH = 10.7) {
  const W = nWide === 1 ? STRIP_W : nWide * PITCH;
  const footL = nFoot === 1 ? 13.5 : 26.3;
  const zs = Array.from({ length: nWide }, (_, j) => (j - (nWide - 1) / 2) * PITCH);
  const group = new THREE.Group();

  const footHoleXs = [];
  for (let i = 0; i < nFoot; i++) footHoleXs.push(6.75 + i * PITCH);
  const footLocal = footHoleXs.flatMap(x => zs.map(z => ({ x: x - footL / 2, z })));
  const foot = new THREE.Mesh(flatPlateGeometry(footL, W, footLocal, 1.5), steelMaterial());
  foot.position.x = footL / 2;
  group.add(foot);

  const wall = new THREE.Mesh(flatPlateGeometry(wallH, W, zs.map(z => ({ x: 0, z })), 1.5), steelMaterial());
  wall.rotation.z = Math.PI / 2;
  wall.position.set(0, wallH / 2, 0);
  group.add(wall);

  const holes = footHoleXs.flatMap(x => zs.map(z => holeMeta(x, 0, z, 0, 1, 0)));
  for (const z of zs) holes.push(holeMeta(0, wallH / 2, z, 1, 0, 0));
  return { group, kind: 'plate', holes };
}

// ── ㄷ형브래킷 (13) ──  U자: 바닥 폭 15 + 양쪽 날개(높이 12.5), 구멍 각 1개 (상품 이미지: 15=바닥 폭, 12.5=날개 높이.
// geometry_spec 의 flange/span 라벨이 뒤바뀌어 있어서 이전엔 거꾸로 만들었음)
export function makeUBracket(span = 15, wingH = 12.5) {
  const W = STRIP_W;
  const group = new THREE.Group();

  const webHoles = span > 20 ? [{ x: -PITCH / 2, z: 0 }, { x: PITCH / 2, z: 0 }] : [{ x: 0, z: 0 }];
  const web = new THREE.Mesh(flatPlateGeometry(span, W, webHoles, 1.0), steelMaterial());
  group.add(web);

  const holes = webHoles.map(h => holeMeta(h.x, 0, h.z, 0, 1, 0));
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(flatPlateGeometry(wingH, W, [{ x: 0, z: 0 }], 1.0), steelMaterial());
    wing.rotation.z = Math.PI / 2;
    wing.position.set(side * (span / 2 + THICK / 2), wingH / 2, 0);
    group.add(wing);
    holes.push(holeMeta(side * (span / 2 + THICK / 2), wingH / 2, 0, 1, 0, 0));
  }
  return { group, kind: 'plate', holes };
}

// ── 축 (Ø4 강봉, 로컬 +Y 방향) ──
export function makeAxle(lengthMm) {
  const group = new THREE.Group();
  const spinner = new THREE.Group();
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, lengthMm, 16), steelMaterial());
  spinner.add(rod);
  // 끝단 표시(회전 확인용)
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 2, 16), boltMaterial());
  tip.position.y = lengthMm / 2 - 1;
  spinner.add(tip);
  group.add(spinner);
  return { group, kind: 'axle', holes: [], axisLen: lengthMm, spinner };
}

// ── 기어 이빨 프로파일 (근사 사다리꼴 치형) ──
function gearShape(teeth, mod) {
  const ra = mod * (teeth + 2) / 2;    // 이끝원
  const rr = mod * (teeth - 2.5) / 2;  // 이뿌리원
  const T = (Math.PI * 2) / teeth;
  const s = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a = i * T;
    const pts = [[rr, 0], [rr, 0.25], [ra, 0.375], [ra, 0.625], [rr, 0.75]];
    for (const [r, f] of pts) {
      const ang = a + f * T;
      const x = r * Math.cos(ang), y = r * Math.sin(ang);
      if (i === 0 && f === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
  }
  s.closePath();
  return s;
}

// ── 기어 공통 ──  디스크 두께 4mm(로컬 y ∈ [-2,2]), 허브 위쪽, 축 구멍 Ø4.1
function makeGear(teeth, { boltHoleCount = 0, boltCircleR = 0, boltHoleCount2 = 0, boltCircleR2 = 0, hubH = 10 } = {}) {
  const mod = GEAR_MODULE;
  const shape = gearShape(teeth, mod);

  const hubHole = new THREE.Path();
  hubHole.absarc(0, 0, 2.05, 0, Math.PI * 2, true);
  shape.holes.push(hubHole);

  const holes = [];
  const addRing = (count, r, angOffset = 0) => {
    for (let i = 0; i < count; i++) {
      const ang = angOffset + (i / count) * Math.PI * 2;
      const sx = r * Math.cos(ang), sy = r * Math.sin(ang);
      const path = new THREE.Path();
      path.absarc(sx, sy, HOLE_R, 0, Math.PI * 2, true);
      shape.holes.push(path);
      holes.push(holeMeta(sx, 0, -sy, 0, 1, 0, 4)); // shape(x,y) → 3D(x,0,-y)
    }
  };
  addRing(boltHoleCount, boltCircleR);
  if (boltHoleCount2) addRing(boltHoleCount2, boltCircleR2, Math.PI / boltHoleCount2);

  const geo = new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false, curveSegments: 8 });
  geo.translate(0, 0, -2);
  geo.rotateX(-Math.PI / 2);

  const spinner = new THREE.Group();
  spinner.add(new THREE.Mesh(geo, plasticMaterial(0xe8b90f)));

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, hubH, 20), steelMaterial());
  hub.position.y = 2 + hubH / 2;
  spinner.add(hub);

  const group = new THREE.Group();
  group.add(spinner);
  return {
    group, kind: 'gear', holes, spinner,
    gear: { teeth, pitchR: mod * teeth / 2, thick: 4 },
  };
}

// 평기어(소): 57T Ø39.3, 면 구멍 8개 (33_detail.jpg 확인) / 피니언: 19T Ø14
// 평기어(대): 95T Ø64.7, 실물은 십자 장공 4개+원형 구멍 — 기본 구현은 8공 링 2줄로 근사
export const makeSpurGearS = () => makeGear(57, { boltHoleCount: 8, boltCircleR: 12.7 });
export const makePinionGear = () => makeGear(19, { hubH: 10.5 });
export const makeSpurGearL = () => makeGear(95, { boltHoleCount: 8, boltCircleR: 12.7, boltHoleCount2: 8, boltCircleR2: 25.4 });

// ── 체인기어 (스프로킷) ──  체인 피치 6.35mm(OCR, 104번 체인).
// 피치원 R = p / (2·sin(π/N)) — 검산: 12T 외경 ≈ 2R+3.7 = 28.2 ✓(OCR Ø28.2), 25T ≈ 54.4 ✓(OCR Ø54.5)
// 전체 높이(디스크+허브): 소 14.6 / 대 15.5 (OCR). 디스크 두께·롤러 자리 반경은 추정치.
export const CHAIN_PITCH = 6.35;
export const SPROCKET_DISC = 3;
const CHAIN_SEAT_R = 2.0;   // 롤러가 앉는 이뿌리 반경(롤러 Ø3.8 + 여유)

function sprocketShape(teeth, outerR) {
  const R = CHAIN_PITCH / (2 * Math.sin(Math.PI / teeth));
  const T = (Math.PI * 2) / teeth;
  const s = new THREE.Shape();
  const SAMPLES = 14;
  for (let i = 0; i < teeth * SAMPLES; i++) {
    const phi = (i / SAMPLES) * T;
    const da = phi - Math.round(phi / T) * T; // 가장 가까운 롤러 자리까지 각도차
    let r = outerR;
    const perp = R * Math.sin(da);
    if (Math.abs(perp) < CHAIN_SEAT_R) r = Math.min(r, R * Math.cos(da) - Math.sqrt(CHAIN_SEAT_R ** 2 - perp ** 2));
    const x = r * Math.cos(phi), y = r * Math.sin(phi);
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return { shape: s, pitchR: R };
}

function makeSprocket(teeth, outerD, totalH) {
  const { shape, pitchR } = sprocketShape(teeth, outerD / 2);
  const hubHole = new THREE.Path();
  hubHole.absarc(0, 0, 2.05, 0, Math.PI * 2, true);
  shape.holes.push(hubHole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: SPROCKET_DISC, bevelEnabled: false, curveSegments: 8 });
  geo.translate(0, 0, -SPROCKET_DISC / 2);
  geo.rotateX(-Math.PI / 2);

  const spinner = new THREE.Group();
  spinner.add(new THREE.Mesh(geo, plasticMaterial(0xd32f2f))); // 빨간 체인기어
  const hubH = totalH - SPROCKET_DISC;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, hubH, 20), boltMaterial());
  hub.position.y = SPROCKET_DISC / 2 + hubH / 2;
  spinner.add(hub);

  const group = new THREE.Group();
  group.add(spinner);
  return {
    group, kind: 'gear', holes: [], spinner,
    gear: { teeth, pitchR, thick: SPROCKET_DISC, chain: true }, // chain: 이빨끼리 안 맞물림, 체인으로만 연동
  };
}
export const makeSprocketS = () => makeSprocket(12, 28.2, 14.6);
export const makeSprocketL = () => makeSprocket(25, 54.5, 15.5);

// ── 풀리 ──  OCR: 대 Ø76 / 중 Ø38 / 소 Ø25.5 (높이 14, 허브 포함), 타이어풀리 Ø15.5 × 5.5
// 림에 V 홈 → 고무줄(벨트)이 감김. 타이어를 씌우면 바퀴(T 키). 홈 깊이·림 폭·허브 반경은 추정치.
// 타이어 매칭(외경 OCR, 고무 두께 ≈6mm 로 일관): 타이어풀리→타이어(소) Ø27×7.7, 소→타이어(중) Ø37×8.5,
// 중→타이어(대) Ø50×10, 대→없음(6호 기준)
const PULLEY_GROOVE = 1.6;
function pulleyProfile(R, W, H, bossR) {
  // LatheGeometry 단면 (r, y): 축 구멍 Ø4.1, 허브는 +Y 로 뻗음, 림 가운데에 V 홈
  const web = Math.max(bossR + 0.6, R - PULLEY_GROOVE - 2);
  const tw = Math.min(2.4, W);
  const pts = [[2.05, -W / 2], [bossR, -W / 2]];
  if (web < R - PULLEY_GROOVE - 0.5) pts.push([bossR, -tw / 2], [web, -tw / 2], [web, -W / 2]); // 얇은 원판 + 두꺼운 림
  pts.push([R, -W / 2], [R - PULLEY_GROOVE, 0], [R, W / 2]);
  if (web < R - PULLEY_GROOVE - 0.5) pts.push([web, W / 2], [web, tw / 2], [bossR, tw / 2]);
  pts.push([bossR, H - W / 2], [2.05, H - W / 2], [2.05, -W / 2]);
  return pts.map(([r, y]) => new THREE.Vector2(r, y));
}
function makePulley(D, W, H, tire = null) {
  const R = D / 2;
  const geo = new THREE.LatheGeometry(pulleyProfile(R, W, H, Math.min(5, R - 1.5)), 40);
  const spinner = new THREE.Group();
  const body = new THREE.Mesh(geo, steelMaterial());
  body.material.side = THREE.DoubleSide;
  spinner.add(body);
  // 회전 확인용 표식 (림 옆면 작은 점)
  const dot = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), new THREE.MeshBasicMaterial({ color: 0xe53935 }));
  dot.position.set(R - PULLEY_GROOVE - 1.4, W / 2 + 0.2, 0);
  spinner.add(dot);
  const group = new THREE.Group();
  group.add(spinner);
  return {
    group, kind: 'gear', holes: [], spinner,
    // pitchR = 고무줄이 감기는 홈 반지름. belt: 이빨 맞물림 없음, 고무줄로만 연동
    gear: { pitchR: R - PULLEY_GROOVE * 0.6, thick: W, belt: true, outerR: R },
    tireSpec: tire, // { od, w } — 씌울 수 있는 타이어 (없으면 null)
  };
}
export const makePulleyL = () => makePulley(76, 6, 14);
export const makePulleyM = () => makePulley(38, 6, 14, { od: 50, w: 10, name: '타이어(대)' });
export const makePulleyS = () => makePulley(25.5, 5, 14, { od: 37, w: 8.5, name: '타이어(중)' });
export const makeTirePulley = () => makePulley(15.5, 5.5, 5.5, { od: 27, w: 7.7, name: '타이어(소)' });

// ── 휠판-8 (30) ──  Ø36 얇은 원판 + 가운데 황동 허브(멈춤나사), 원판에 구멍 8개 (상품 이미지: 구멍 원 R≈12.7, 0°·45°… 배치)
// 이빨·홈이 없어 기어/벨트로는 안 엮임(noMesh). 허브 치수(Ø9×9)와 원판 두께 1.5 는 추정치.
export function makeWheelPlate8() {
  const R = 18, T = 1.5, hubR = 4.5, hubH = 9, boltR = 12.7;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, R, 0, Math.PI * 2, false);
  const hubHole = new THREE.Path();
  hubHole.absarc(0, 0, 2.05, 0, Math.PI * 2, true);
  shape.holes.push(hubHole);
  const holes = [];
  for (let i = 0; i < 8; i++) {
    const ang = i * Math.PI / 4, sx = boltR * Math.cos(ang), sy = boltR * Math.sin(ang);
    const path = new THREE.Path();
    path.absarc(sx, sy, HOLE_R, 0, Math.PI * 2, true);
    shape.holes.push(path);
    holes.push(holeMeta(sx, 0, -sy, 0, 1, 0, T));
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 32 });
  geo.translate(0, 0, -T / 2);
  geo.rotateX(-Math.PI / 2);

  const spinner = new THREE.Group();
  spinner.add(new THREE.Mesh(geo, steelMaterial()));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, hubH, 24),
    new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.7, roughness: 0.35 }));
  hub.position.y = T / 2 + hubH / 2;
  spinner.add(hub);
  const dot = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), new THREE.MeshBasicMaterial({ color: 0xe53935 })); // 회전 확인 표식
  dot.position.set(R - 2.2, T / 2 + 0.2, 0);
  spinner.add(dot);
  const group = new THREE.Group();
  group.add(spinner);
  return { group, kind: 'gear', holes, spinner, gear: { pitchR: boltR, thick: T, noMesh: true } };
}

// 타이어: 풀리 홈에 끼우는 고무 링 (단면 = 둥근 사각형). spinner 에 붙여서 같이 돎.
export function makeTireMesh(spec, pulleyR) {
  const ri = pulleyR - PULLEY_GROOVE, ro = spec.od / 2, hw = spec.w / 2, c = Math.min(2.2, (ro - ri) / 2, hw);
  const pts = [];
  const arc = (cx, cy, a0, a1) => { for (let i = 0; i <= 6; i++) { const a = a0 + (a1 - a0) * i / 6; pts.push(new THREE.Vector2(cx + c * Math.cos(a), cy + c * Math.sin(a))); } };
  pts.push(new THREE.Vector2(ri, -hw));
  arc(ro - c, -hw + c, -Math.PI / 2, 0);
  arc(ro - c, hw - c, 0, Math.PI / 2);
  pts.push(new THREE.Vector2(ri, hw), new THREE.Vector2(ri, -hw));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 48),
    new THREE.MeshStandardMaterial({ color: 0x26282b, metalness: 0, roughness: 0.9, side: THREE.DoubleSide }));
  // 트레드 홈 (회전이 보이게)
  const tread = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, spec.w * 0.7, 0.8), new THREE.MeshStandardMaterial({ color: 0x3c3f44, roughness: 1 }), 18);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2;
    m.makeRotationY(-a).setPosition(Math.cos(a) * (ro - 0.3), 0, Math.sin(a) * (ro - 0.3));
    tread.setMatrixAt(i, m);
  }
  mesh.add(tread);
  mesh.userData.tire = true;
  return mesh;
}

// 모터뭉치 — 실물 사진 기준: 가로 원통형 몸체 + 받침 블록 + 구멍 뚫린 바닥판, 출력축은 몸체에서 바로 나옴.
// 치수는 사진 비율로 잡은 추정치(실측 후 보정). 출력축 = 로컬 +X, 축 지름 Ø4.
export const MOTOR_BODY_R = 16;                       // 몸체 반지름
export const MOTOR_BODY_L = 36;                       // 몸체 길이(X)
const MOTOR_PILLAR_H = 10;                            // 받침 블록 높이
export const MOTOR_OUT_H = THICK / 2 + MOTOR_PILLAR_H + MOTOR_BODY_R; // 출력축 중심 높이
export const MOTOR_SHAFT_LEN = 22;
export const MOTOR_SHAFT_R = 2;

export function makeMotor() {
  const BASE = 38.1;                                   // 바닥판 정사각 (3칸)
  const group = new THREE.Group();
  const baseHoles = [];
  for (const x of [-PITCH, 0, PITCH]) for (const z of [-PITCH, PITCH]) baseHoles.push({ x, z });
  group.add(new THREE.Mesh(flatPlateGeometry(BASE, BASE, baseHoles, 3), steelMaterial()));

  const yellow = plasticMaterial(0xf2c11c);
  const cy = MOTOR_OUT_H;
  // 받침 블록
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(18, MOTOR_PILLAR_H + 2, 17), yellow);
  pillar.position.y = THICK / 2 + MOTOR_PILLAR_H / 2 - 0.5;
  group.add(pillar);
  // 원통 몸체 (축 = X)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(MOTOR_BODY_R, MOTOR_BODY_R, MOTOR_BODY_L, 36), yellow);
  body.rotation.z = Math.PI / 2;
  body.position.set(0, cy, 0);
  group.add(body);
  // 앞 캡 (살짝 작은 원판)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(MOTOR_BODY_R - 1.5, MOTOR_BODY_R - 1.5, 1.6, 36), yellow);
  cap.rotation.z = Math.PI / 2;
  cap.position.set(MOTOR_BODY_L / 2 + 0.8, cy, 0);
  group.add(cap);
  // 방열 리브 + 단자함 (겉모양)
  for (let k = -3; k <= 3; k++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(MOTOR_BODY_L - 6, 1.6, 1.6), yellow);
    const a = k * 0.28;
    rib.position.set(-1, cy + Math.cos(a) * (MOTOR_BODY_R + 0.4), Math.sin(a) * (MOTOR_BODY_R + 0.4));
    rib.rotation.x = -a;
    group.add(rib);
  }
  const termBox = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 8), yellow);
  termBox.position.set(-6, cy + MOTOR_BODY_R + 1.5, 0);
  group.add(termBox);

  // 출력축 (spinner: 시뮬에서 몸체와 따로 회전해 돌아가는 게 보임)
  const faceX = MOTOR_BODY_L / 2 + 1.6;
  const spinner = new THREE.Group();
  spinner.position.set(faceX, cy, 0);
  const shaftMat = new THREE.MeshStandardMaterial({ color: 0xe0bd78, metalness: 0.3, roughness: 0.35 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(MOTOR_SHAFT_R, MOTOR_SHAFT_R, MOTOR_SHAFT_LEN, 20), shaftMat);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = MOTOR_SHAFT_LEN / 2;
  spinner.add(shaft);
  // 회전 확인용 표식: 빨간 띠 + 끝의 가로 홈
  const mark = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 1.0), new THREE.MeshBasicMaterial({ color: 0xe53935 }));
  mark.position.set(MOTOR_SHAFT_LEN * 0.55, MOTOR_SHAFT_R, 0);
  spinner.add(mark);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, MOTOR_SHAFT_R * 2 + 0.2), new THREE.MeshBasicMaterial({ color: 0x3a2d1a }));
  slot.position.set(MOTOR_SHAFT_LEN - 2, 0, 0);
  spinner.add(slot);
  group.add(spinner);

  return {
    group, kind: 'motor', spinner,
    holes: baseHoles.map(h => holeMeta(h.x, 0, h.z, 0, 1, 0)),
    // 출력축 중심점(축 중간) · 방향 · 길이
    output: { p: new THREE.Vector3(faceX + MOTOR_SHAFT_LEN / 2, cy, 0), n: new THREE.Vector3(1, 0, 0), len: MOTOR_SHAFT_LEN },
  };
}

// 기어드모터 (100A) — 상품 이미지: 검정 플라스틱 기어박스 몸체 + 양옆에 세운 구멍판 + 금속 출력축.
// 외형 52(축 방향) × 35(양옆 판 바깥 폭) mm, 4.5V · 무부하 250rpm. 출력축 = 로컬 +X, Ø4.
// 몸체 높이·구멍판 구멍 배열(4×2 @12.7)·축 길이는 이미지 비율 추정치(실측 후 보정).
export function makeGearedMotor() {
  const PL = 52, PW = 35, PT = 2, PH = 25.4;           // 구멍판 길이·바깥 폭·두께·높이
  const BODY_L = 40, BODY_X = -2;                       // 몸체 길이, 중심 x
  const SHAFT_LEN = 14;
  const cy = PH / 2;
  const group = new THREE.Group();
  const dark = plasticMaterial(0x34373c);

  const body = new THREE.Mesh(new THREE.BoxGeometry(BODY_L, PH, PW - 2 * PT), dark);
  body.position.set(BODY_X, cy, 0);
  group.add(body);
  const cover = new THREE.Mesh(new THREE.BoxGeometry(BODY_L - 12, 4, PW - 2 * PT - 8), dark);   // 윗면 기어박스 덮개
  cover.position.set(BODY_X - 2, PH + 2, 0);
  group.add(cover);
  for (const [bx, bz] of [[-10, -8], [-10, 8], [6, -8], [6, 8]]) {                              // 겉모양 돌기
    const nub = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.4, 12), dark);
    nub.position.set(BODY_X + bx, PH + 0.7, bz);
    group.add(nub);
  }

  // 양옆 구멍판 (세워서 붙임, 법선 = ±Z)
  const holeXs = lineXs(4), holeYs = [PH / 2 - PITCH / 2, PH / 2 + PITCH / 2];
  const plateHoles = holeXs.flatMap(x => holeYs.map(y => ({ x, z: y - cy })));
  const holes = [];
  for (const side of [-1, 1]) {
    const plate = new THREE.Mesh(flatPlateGeometry(PL, PH, plateHoles, 3, PT), dark);
    plate.rotation.x = Math.PI / 2;
    plate.position.set(0, cy, side * (PW / 2 - PT / 2));
    group.add(plate);
    for (const h of plateHoles) holes.push(holeMeta(h.x, cy + h.z, side * (PW / 2 - PT / 2), 0, 0, side, PT));
  }

  // 출력축 (spinner: 시뮬에서 몸체와 따로 회전)
  const faceX = BODY_X + BODY_L / 2;
  const spinner = new THREE.Group();
  spinner.position.set(faceX, cy, 0);
  const shaftMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.8, roughness: 0.3 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, SHAFT_LEN, 20), shaftMat);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = SHAFT_LEN / 2;
  spinner.add(shaft);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 1.0), new THREE.MeshBasicMaterial({ color: 0xe53935 }));
  mark.position.set(SHAFT_LEN * 0.55, 2, 0);
  spinner.add(mark);
  group.add(spinner);

  return {
    group, kind: 'motor', spinner, holes, ratedRpm: 250,
    output: { p: new THREE.Vector3(faceX + SHAFT_LEN / 2, cy, 0), n: new THREE.Vector3(1, 0, 0), len: SHAFT_LEN },
  };
}

// ── M4 볼트+너트 ──  로컬 +Y = 볼트 축
export function makeBolt() {
  const mat = boltMaterial();
  const group = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 2.4, 6), mat);
  head.position.y = 2.6;
  group.add(head);
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(1.95, 1.95, 7, 16), mat));
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 2.4, 6), mat);
  nut.position.y = -2.6;
  group.add(nut);
  return group;
}

// ── 스프링클립(기어 고정) / 베어링 표시 링 ──
export function makeClipRing(color = 0x444a52) {
  return new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.9, 8, 20),
    new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.5 })
  );
}
