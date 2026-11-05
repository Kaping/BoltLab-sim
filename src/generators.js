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
// 날개는 바닥에 수직(ㄷ자, 실물 확인). 날개 구멍 위치(꺾임선에서 7mm)는 이미지에서 읽은 추정치.
const CHANNEL_TAB_L = 14.3;
const CHANNEL_TAB_LEAN = 0;   // 날개는 바닥에 수직(ㄷ자). 처음엔 이미지 원근 때문에 바깥으로 20° 벌어진 줄 알고 잘못 만들었음
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

// ── 워엄기어 (37) ──  Ø14 × 26 (상품 이미지): 노란 한 줄 나사선 + 아래쪽 금속 허브(멈춤나사). 축 = 로컬 +Y.
// 평기어(소)와 같은 모듈(0.668): 축방향 피치 π·m = 2.1, 피치 반지름 = 6.35(=OD 14 에서 이끝 높이 m 뺀 값) →
// 57T 평기어와 중심거리 25.4(격자 2칸) — 피니언과 똑같이 격자에 맞음. 나사 방향은 오른나사 가정(gear.hand).
// 허브 길이 8·나사산 길이 18·단면 치수는 이미지 비율 추정. 원점 = 나사산 중앙.
function helixThreadGeometry(rRoot, rTip, pitch, length, hwRoot, hwTip, seg = 28) {
  const turns = length / pitch, steps = Math.ceil(turns * seg);
  const prof = [[rRoot, -hwRoot], [rTip, -hwTip], [rTip, hwTip], [rRoot, hwRoot]];
  const pos = [], idx = [];
  for (let i = 0; i <= steps; i++) {
    const phi = (i / steps) * turns * Math.PI * 2;
    const y0 = -length / 2 + (phi / (Math.PI * 2)) * pitch;           // 각도(+Y 둘레 +방향)가 늘면 +Y 로 전진 = 오른나사
    for (const [r, dy] of prof) pos.push(r * Math.cos(phi), y0 + dy, -r * Math.sin(phi));
  }
  for (let i = 0; i < steps; i++) for (let k = 0; k < 4; k++) {
    const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = (i + 1) * 4 + k, d = (i + 1) * 4 + (k + 1) % 4;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
export const WORM_LEN = 18;           // 나사산 길이
export function makeWormGear() {
  const pitch = Math.PI * GEAR_MODULE, rTip = 7, rRoot = 5.5, hubR = 4.5, hubH = 8;
  const spinner = new THREE.Group();
  const yellow = plasticMaterial(0xe8b90f);
  yellow.side = THREE.DoubleSide;
  spinner.add(new THREE.Mesh(helixThreadGeometry(rRoot, rTip, pitch, WORM_LEN - 1.7, 0.85, 0.25), yellow));   // 나사산 끝(±0.85)까지 포함해 전체 18
  const core = new THREE.Mesh(new THREE.CylinderGeometry(rRoot - 0.05, rRoot - 0.05, WORM_LEN, 32), plasticMaterial(0xe8b90f));
  spinner.add(core);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, hubH, 24), steelMaterial());
  hub.position.y = -WORM_LEN / 2 - hubH / 2;
  spinner.add(hub);
  const screw = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 1.2, 12), boltMaterial());   // 멈춤나사
  screw.rotation.z = Math.PI / 2;
  screw.position.set(hubR, hub.position.y, 0);
  spinner.add(screw);
  const group = new THREE.Group();
  group.add(spinner);
  return {
    group, kind: 'gear', holes: [], spinner,
    gear: { worm: true, starts: 1, hand: 1, pitchR: PITCH / 2, thick: WORM_LEN, len: WORM_LEN },   // 6.35 (= 7 - 모듈 0.67 ≈ 6.33)
  };
}

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
// layout: 'none' = 속이 찬 원판(소·타이어풀리) / 'ring8' = 구멍 8개(중, 휠판-8 과 같은 R12.7 원) /
// 'cross' = 십자 장공 4 + 대각선 구멍 8(대, 면판휠과 같은 배치). 대·중은 상품 이미지상 납작한 원판에 구멍이 뚫려 있고
// 가장자리에만 고무줄·타이어용 홈이 파여 있다 — 얇은 판+두꺼운 림이 아님. 노란 플라스틱 원판 + 회색 금속 허브.
function makePulley(D, W, H, tire = null, layout = 'none') {
  const R = D / 2;
  const yellow = plasticMaterial(0xe8b90f);
  yellow.side = THREE.DoubleSide;
  const spinner = new THREE.Group();
  const holes = [], slots = [];
  if (layout === 'none') {
    spinner.add(new THREE.Mesh(new THREE.LatheGeometry(pulleyProfile(R, W, H, Math.min(5, R - 1.5)), 40), yellow));
  } else {
    const Ri = R - 2.2;                                     // 림(홈이 파인 고리)과 구멍 뚫린 판의 경계
    const rim = [[Ri - 0.01, -W / 2], [R, -W / 2], [R - PULLEY_GROOVE, 0], [R, W / 2], [Ri - 0.01, W / 2]].map(([r, y]) => new THREE.Vector2(r, y));
    spinner.add(new THREE.Mesh(new THREE.LatheGeometry(rim, 48), yellow));
    const shape = new THREE.Shape();
    shape.absarc(0, 0, Ri, 0, Math.PI * 2, false);
    const bore = new THREE.Path(); bore.absarc(0, 0, 2.05, 0, Math.PI * 2, true); shape.holes.push(bore);
    const ringAt = (rad, angs) => {
      for (const ang of angs) {
        const sx = rad * Math.cos(ang), sy = rad * Math.sin(ang);
        const p = new THREE.Path(); p.absarc(sx, sy, HOLE_R, 0, Math.PI * 2, true); shape.holes.push(p);
        holes.push(holeMeta(sx, 0, -sy, 0, 1, 0, W));
      }
    };
    const diag = [1, 3, 5, 7].map(i => i * Math.PI / 4), all8 = [0, 1, 2, 3, 4, 5, 6, 7].map(i => i * Math.PI / 4);
    if (layout === 'ring8') ringAt(PITCH, all8);
    else {
      ringAt(PITCH, diag); ringAt(2 * PITCH, diag);
      for (let i = 0; i < 4; i++) {
        const ux = Math.cos(i * Math.PI / 2), uy = Math.sin(i * Math.PI / 2);
        shape.holes.push(stadiumPath(ux * PITCH, uy * PITCH, ux * 2 * PITCH, uy * 2 * PITCH, HOLE_R));
        slots.push({ a: new THREE.Vector3(ux * PITCH, 0, -uy * PITCH), b: new THREE.Vector3(ux * 2 * PITCH, 0, -uy * 2 * PITCH), n: new THREE.Vector3(0, 1, 0), t: W });
      }
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false, curveSegments: 48 });
    geo.translate(0, 0, -W / 2);
    geo.rotateX(-Math.PI / 2);
    spinner.add(new THREE.Mesh(geo, yellow));
    const hubR = 5;                                         // 허브: 판 위로 H-W 만큼 솟고 가운데 축 구멍
    const hub = [[2.05, W / 2], [hubR, W / 2], [hubR, H - W / 2], [2.05, H - W / 2], [2.05, W / 2]].map(([r, y]) => new THREE.Vector2(r, y));
    const hubMat = steelMaterial(); hubMat.side = THREE.DoubleSide;
    spinner.add(new THREE.Mesh(new THREE.LatheGeometry(hub, 28), hubMat));
  }
  // 회전 확인용 표식 (림 옆면 작은 점)
  const dot = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), new THREE.MeshBasicMaterial({ color: 0xe53935 }));
  dot.position.set(R - PULLEY_GROOVE - 1.4, W / 2 + 0.2, 0);
  spinner.add(dot);
  const group = new THREE.Group();
  group.add(spinner);
  return {
    group, kind: 'gear', holes, spinner, ...(slots.length ? { slots } : {}),
    // pitchR = 고무줄이 감기는 홈 반지름. belt: 이빨 맞물림 없음, 고무줄로만 연동
    gear: { pitchR: R - PULLEY_GROOVE * 0.6, thick: W, belt: true, outerR: R },
    tireSpec: tire, // { od, w } — 씌울 수 있는 타이어 (없으면 null)
  };
}
export const makePulleyL = () => makePulley(76, 6, 14, null, 'cross');
export const makePulleyM = () => makePulley(38, 6, 14, { od: 50, w: 10, name: '타이어(대)' }, 'ring8');
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
// 구멍(사용자 제보로 보정): 양옆 판 구멍 3칸×2줄 / 바닥 3×3 격자 중 가운데 줄(z=0, 축 방향 줄)을 뺀 6곳 — 아래에서 볼트 체결 가능.
// 옆판·몸체 길이 = 구멍 3칸(38.1). 여기에 출력축 14 를 더하면 외형 52 와 맞는다(52 = 몸체 + 튀어나온 축).
// 몸체 높이·축 길이는 추정치.
export function makeGearedMotor() {
  const PL = 3 * PITCH, PW = 35, PT = 2, PH = 25.4;     // 구멍판 길이·바깥 폭·두께·높이
  const BODY_L = PL, BODY_X = 0;                        // 몸체 길이(옆판과 같음), 중심 x
  const SHAFT_LEN = 14;
  const Y0 = -1, Y1 = Y0 + PH;                          // 바닥판 중심이 y=0 (다른 판 부품과 같은 기준)
  const cy = (Y0 + Y1) / 2;                             // 옆판 중심 = 출력축 높이
  const group = new THREE.Group();
  const dark = plasticMaterial(0x34373c);

  const body = new THREE.Mesh(new THREE.BoxGeometry(BODY_L, Y1 - (Y0 + 2), PW - 2 * PT), dark);
  body.position.set(BODY_X, (Y0 + 2 + Y1) / 2, 0);
  group.add(body);
  const cover = new THREE.Mesh(new THREE.BoxGeometry(BODY_L - 12, 4, PW - 2 * PT - 8), dark);   // 윗면 기어박스 덮개
  cover.position.set(BODY_X - 2, Y1 + 2, 0);
  group.add(cover);
  for (const [bx, bz] of [[-10, -8], [-10, 8], [6, -8], [6, 8]]) {                              // 겉모양 돌기
    const nub = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.4, 12), dark);
    nub.position.set(BODY_X + bx, Y1 + 0.7, bz);
    group.add(nub);
  }

  // 바닥판: 3×3 격자(12.7) 중 가운데 줄(z=0, 축 방향)은 막혀 있고 좌우 두 줄(z=±12.7) 6곳에 구멍
  const holes = [];
  const baseHoles = [];
  for (const z of [-PITCH, PITCH]) for (const x of lineXs(3)) baseHoles.push({ x, z });
  const base = new THREE.Mesh(flatPlateGeometry(BODY_L, PW - 2 * PT, baseHoles, 1.5, 2), dark);
  group.add(base);
  for (const h of baseHoles) holes.push(holeMeta(h.x, 0, h.z, 0, -1, 0, 2));

  // 양옆 구멍판 (세워서 붙임, 법선 = ±Z), 구멍 3칸 × 2줄
  const holeYs = [-PITCH / 2, PITCH / 2];
  const plateHoles = lineXs(3).flatMap(x => holeYs.map(z => ({ x, z })));
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

// ════════════════════════════════════════════════════════════════════════
// 2026-11-05 추가 부품 (상품 이미지 확인): 지지판 · 역각브래킷 · 모서리브래킷 · 조향브래킷 · 상자형베어링 · 플랜지판 ·
// 반원판 · 바퀴평판 · 곡면스트립 · 양팔크랭크 · 면판휠 · 크라운기어 · 2단평기어
// ════════════════════════════════════════════════════════════════════════

// 모서리별 반지름이 다른 둥근 사각형 Shape. rs = [r(+x,+z), r(+x,-z), r(-x,-z), r(-x,+z)] — 판 로컬 좌표 기준
// (shape y = -z 이므로 shape 의 (+x,-y) 모서리가 로컬 (+x,+z)). ox, oy: shape 좌표 중심 이동
function cornerShape(L, W, rs, ox = 0, oy = 0) {
  const hx = L / 2, hy = W / 2;
  const [r1, r2, r3, r4] = rs.map(r => Math.min(r, hx, hy));
  const s = new THREE.Shape();
  s.moveTo(ox - hx + r4, oy - hy);
  s.lineTo(ox + hx - r1, oy - hy);
  if (r1 > 0) s.absarc(ox + hx - r1, oy - hy + r1, r1, -Math.PI / 2, 0, false);
  s.lineTo(ox + hx, oy + hy - r2);
  if (r2 > 0) s.absarc(ox + hx - r2, oy + hy - r2, r2, 0, Math.PI / 2, false);
  s.lineTo(ox - hx + r3, oy + hy);
  if (r3 > 0) s.absarc(ox - hx + r3, oy + hy - r3, r3, Math.PI / 2, Math.PI, false);
  s.lineTo(ox - hx, oy - hy + r4);
  if (r4 > 0) s.absarc(ox - hx + r4, oy - hy + r4, r4, Math.PI, Math.PI * 1.5, false);
  return s;
}

// 꺾인 판 부품 조립용: 판 한 장을 3D 임의 자세로 놓는다.
// o = 판의 시작 변 중점, u = 길이 방향, n = 판 법선(구멍 축), 폭 방향 w = u × n. 길이 L(시작 변부터), 폭 W.
// ext = [시작쪽, 끝쪽] 연장(꺾임부 겹침용). holes = [{s, z}] (s: o 에서 u 로 잰 거리, z: w 방향), slots = [{s1, s2, z}]
function bentAcc() { return { group: new THREE.Group(), holes: [], slots: [] }; }
function planeSeg(acc, { o, u, n, L, W = STRIP_W, rs = [1, 1, 1, 1], holes = [], slots = [], ext = [0, 0], t = THICK }) {
  const O = new THREE.Vector3(...o), U = new THREE.Vector3(...u).normalize(), N = new THREE.Vector3(...n).normalize();
  const Wv = new THREE.Vector3().crossVectors(U, N);
  const Lt = L + ext[0] + ext[1], cx = -ext[0] + Lt / 2;
  const hXZ = holes.map(h => ({ x: h.s - cx, z: h.z ?? 0 }));
  const sXZ = slots.map(s => ({ x1: s.s1 - cx, x2: s.s2 - cx, z: s.z ?? 0 }));
  const mesh = new THREE.Mesh(flatPlateGeometry(cornerShape(Lt, W, rs), 0, hXZ, 0, t, sXZ), steelMaterial());
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(U, N, Wv));
  mesh.position.copy(O).addScaledVector(U, cx);
  acc.group.add(mesh);
  const at = (s, z) => O.clone().addScaledVector(U, s).addScaledVector(Wv, z);
  for (const h of holes) acc.holes.push({ p: at(h.s, h.z ?? 0), n: N.clone(), t });
  for (const s of slots) acc.slots.push({ a: at(s.s1, s.z ?? 0), b: at(s.s2, s.z ?? 0), n: N.clone(), t });
}
// 옆모습(XY 평면) 판: 점 a→b, 폭은 z. 법선 = (-uy, ux)
function seg2(acc, a, b, opts) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  planeSeg(acc, { o: [a[0], a[1], 0], u: [dx, dy, 0], n: [-dy, dx, 0], L: len, ...opts });
}
function bentResult(acc) {
  const r = { group: acc.group, kind: 'plate', holes: acc.holes };
  if (acc.slots.length) r.slots = acc.slots;
  return r;
}
const FOOT_R = STRIP_W / 2;   // 폭 12.7 판 끝의 완전 반원

// ── 지지판 (46) ──  모자(Ω)형: 위판 15, 전체 높이 13.8, 발끝 사이 36.4, 폭 12.7. 위판 구멍 1 + 양쪽 벽 구멍 1씩 + 양쪽 발 구멍 1씩(상품 이미지).
// 발은 바깥쪽 끝이 반원. 벽 구멍은 높이 가운데(추정).
export function makeSupportPlate() {
  const acc = bentAcc();
  const HW = 6.9, H = 13.8 - THICK, X = 36.4 / 2;           // 벽 중심선 x, 위판 중심 높이, 발끝 x
  seg2(acc, [-X, 0], [-HW, 0], { L: X - HW, rs: [0, 0, FOOT_R, FOOT_R], holes: [{ s: FOOT_R }], ext: [0, 0.6] });
  seg2(acc, [HW, 0], [X, 0], { L: X - HW, rs: [FOOT_R, FOOT_R, 0, 0], holes: [{ s: X - HW - FOOT_R }], ext: [0.6, 0] });
  seg2(acc, [-HW, 0], [-HW, H], { L: H, rs: [0.5, 0.5, 0.5, 0.5], holes: [{ s: H / 2 }], ext: [0.6, 0.6] });
  seg2(acc, [HW, H], [HW, 0], { L: H, rs: [0.5, 0.5, 0.5, 0.5], holes: [{ s: H / 2 }], ext: [0.6, 0.6] });
  seg2(acc, [-HW, H], [HW, H], { L: 2 * HW, rs: [1, 1, 1, 1], holes: [{ s: HW }], ext: [0.6, 0.6] });
  return bentResult(acc);
}

// ── 역각브래킷 (70) ──  Z 모양: 아래 발(장공, 13.7) + 벽(14.4, 세로 장공) + 위 발(반대쪽, 12, 둥근 구멍). 폭 12.7.
// 장공 길이·위치는 이미지 비율 추정.
export function makeReverseAngleBracket() {
  const acc = bentAcc();
  const H = 14.4 - THICK;
  seg2(acc, [-13.1, 0], [0, 0], { L: 13.1, rs: [0, 0, FOOT_R, FOOT_R], slots: [{ s1: 4.1, s2: 8.1 }], ext: [0, 0.6] });
  seg2(acc, [0, 0], [0, H], { L: H, rs: [0.5, 0.5, 0.5, 0.5], slots: [{ s1: 5.0, s2: 8.2 }], ext: [0.6, 0.6] });
  seg2(acc, [0, H], [11.4, H], { L: 11.4, rs: [FOOT_R, FOOT_R, 0, 0], holes: [{ s: 11.4 - FOOT_R }], ext: [0.6, 0] });
  return bentResult(acc);
}

// ── 모서리브래킷 좌(74)/우(75) ──  12.7 × 12.7 판 3장: 가운데 수평판(반원 끝, 둥근 구멍) + 한쪽 가장자리에서 위로 선 판(장공, 끝 반원)
// + 인접 가장자리에서 아래로 내려온 작은 판(구멍 1). 좌/우는 거울상. (이미지가 모호해서 형태는 추정 — 보고 보정할 것)
export function makeCornerBracket(hand) {
  const acc = bentAcc();
  const h = hand, hw = PITCH / 2;
  planeSeg(acc, { o: [-hw * h, 0, 0], u: [h, 0, 0], n: [0, 1, 0], L: PITCH, rs: [hw, hw, 0, 0], holes: [{ s: hw }] });
  planeSeg(acc, { o: [-hw * h, 0, 0], u: [0, 1, 0], n: [-h, 0, 0], L: PITCH, rs: [hw, hw, 0, 0], slots: [{ s1: 3.6, s2: 8.0 }], ext: [0.6, 0] });
  planeSeg(acc, { o: [-hw * h / 2, 0, hw], u: [0, -1, 0], n: [0, 0, 1], L: PITCH, W: hw, rs: [1.5, 1.5, 0, 0], holes: [{ s: hw }], ext: [0.6, 0] });
  return bentResult(acc);
}

// ── 조향브래킷 (133) ──  십자형 바닥(구멍 4: 가운데·좌·우·앞, 12.7 간격, 가로 36.4 × 세로 24.5) + 뒤쪽 가장자리에서 선 벽(폭 12.7, 높이 17.5)
// + 벽 위에서 앞으로 나온 발(12, 반원 끝, 구멍 1). 벽에도 구멍 1(추정).
export function makeSteeringBracket() {
  const acc = bentAcc();
  const R = 5.5, hw = PITCH / 2, depth = THICK;
  const circ = (x, y) => { const p = new THREE.Path(); p.absarc(x, y, HOLE_R, 0, Math.PI * 2, true); return p; };
  const horiz = cornerShape(2 * (PITCH + R), 2 * R, [R, R, R, R]);
  const vert = cornerShape(2 * R, hw + PITCH + R, [R, 0, 0, R], 0, -(PITCH + R - hw) / 2);   // z ∈ [-6.35, 18.2] (shape y = -z)
  horiz.holes.push(circ(-PITCH, 0), circ(0, 0), circ(PITCH, 0));
  vert.holes.push(circ(0, 0), circ(0, -PITCH));
  const geo = new THREE.ExtrudeGeometry([horiz, vert], { depth, bevelEnabled: false, curveSegments: 16 });
  geo.translate(0, 0, -depth / 2);
  geo.rotateX(-Math.PI / 2);
  acc.group.add(new THREE.Mesh(geo, steelMaterial()));
  for (const [x, z] of [[-PITCH, 0], [0, 0], [PITCH, 0], [0, PITCH]]) acc.holes.push({ p: new THREE.Vector3(x, 0, z), n: new THREE.Vector3(0, 1, 0), t: THICK });
  const H = 17.5 - THICK;
  planeSeg(acc, { o: [0, 0, -hw], u: [0, 1, 0], n: [0, 0, -1], L: H, rs: [1, 1, 0, 0], holes: [{ s: 8.5 }], ext: [0.6, 0.6] });
  planeSeg(acc, { o: [0, H, -hw], u: [0, 0, 1], n: [0, 1, 0], L: 12, rs: [hw, hw, 0, 0], holes: [{ s: 12 - hw }], ext: [0.6, 0] });
  return bentResult(acc);
}

// ── 상자형베어링 (76) ──  U자 홈통: 바닥판 37.5 × 14 + 양쪽 벽 37.5 × 26.5(바깥 간격 14). 벽마다 구멍 3칸 × 2줄(12.7 간격)이 서로 마주 봄 → 축을 양쪽 벽에 꽂는 베어링.
export function makeBoxBearing() {
  const L = 37.5, Ht = 26.5, GAP = 14, group = new THREE.Group(), holes = [];
  group.add(new THREE.Mesh(flatPlateGeometry(L, GAP, [], 1.0), steelMaterial()));
  const cy = -THICK / 2 + Ht / 2;
  const wallHoles = lineXs(3).flatMap(x => [-PITCH / 2, PITCH / 2].map(z => ({ x, z })));
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(flatPlateGeometry(cornerShape(L, Ht, [0, 5, 5, 0]), 0, wallHoles, 0, THICK), steelMaterial());
    wall.rotation.x = Math.PI / 2;
    wall.position.set(0, cy, side * (GAP / 2 - THICK / 2));
    group.add(wall);
    for (const h of wallHoles) holes.push(holeMeta(h.x, cy + h.z, side * (GAP / 2 - THICK / 2), 0, 0, side));
  }
  return { group, kind: 'plate', holes };
}

// ── 플랜지판 (50·51·168·169) ──  바닥판(구멍이 지그재그: 홀수 줄 cols개, 짝수 줄 cols-1개 반 칸 어긋남) + 양 끝에서 위로 꺾인 날개.
// 50: 5×3 (62 × 36.6, 날개 높이 13.5, 날개에 세로 장공) / 51: 7×5 / 168: 2×5 (62.8 × 25.4, 날개 14.3, 날개 구멍 둥근 2개) / 169: 2×7 (88.2).
// 구멍 배치는 이미지(원근)에서 읽은 추정: 앞쪽(+z) 줄이 cols개.
function makeFlangedPlate({ cols, rows, margin, width, flangeH, flangeSlots, flangeR = 6.35 }) {
  const acc = bentAcc();
  const Lb = (cols - 1) * PITCH + 2 * margin, Wb = width ?? (rows - 1) * PITCH + 2 * margin;
  const zs = lineXs(rows).reverse();                       // zs[0] = +z 쪽 줄
  const baseHoles = [];
  zs.forEach((z, k) => {
    const xs = k % 2 === 0 ? lineXs(cols) : lineXs(cols - 1);
    for (const x of xs) baseHoles.push({ x, z });
  });
  acc.group.add(new THREE.Mesh(flatPlateGeometry(Lb, Wb, baseHoles, 1.0), steelMaterial()));
  for (const h of baseHoles) acc.holes.push({ p: new THREE.Vector3(h.x, 0, h.z), n: new THREE.Vector3(0, 1, 0), t: THICK });
  const fz = lineXs(rows);                                  // 날개 구멍 줄(바닥 줄 수와 같음)
  const hMid = flangeH / 2;
  for (const side of [-1, 1]) {
    const x = side * (Lb / 2 - THICK / 2);
    const opts = flangeSlots
      ? { slots: fz.map(z => ({ s1: hMid - 2.2, s2: hMid + 2.2, z })) }
      : { holes: fz.map(z => ({ s: hMid, z })) };
    // 왼쪽 날개: 아래(-0.6)→위, 오른쪽: 위→아래 (바깥쪽이 법선)
    if (side < 0) planeSeg(acc, { o: [x, -THICK / 2, 0], u: [0, 1, 0], n: [-1, 0, 0], L: flangeH, W: Wb, rs: [flangeR, flangeR, 0, 0], ...opts });
    else planeSeg(acc, { o: [x, flangeH - THICK / 2, 0], u: [0, -1, 0], n: [1, 0, 0], L: flangeH, W: Wb, rs: [0, 0, flangeR, flangeR], ...opts });
  }
  return bentResult(acc);
}
export const makeFlangePlateS = () => makeFlangedPlate({ cols: 5, rows: 3, margin: 5.6, flangeH: 13.5, flangeSlots: true });
export const makeFlangePlateL = () => makeFlangedPlate({ cols: 7, rows: 5, margin: 5.6, flangeH: 13.5, flangeSlots: true });
export const makeFlangePlate2x5 = () => makeFlangedPlate({ cols: 5, rows: 2, margin: 6, width: 25.4, flangeH: 14.3, flangeSlots: false });
export const makeFlangePlate2x7 = () => makeFlangedPlate({ cols: 7, rows: 2, margin: 6, width: 25.4, flangeH: 14.3, flangeSlots: false });

// ── 반원판 (87) ──  지름 74.8 / 높이 37.4 반원, 아래 두 모서리 R6. 구멍: 아랫줄 5 + 가운데 세로 2 더(12.7 격자, 이미지 비율로 확인).
// 윤곽은 바닥 중심 기준 반원 + 모서리 라운드의 근사. 원점 = 윤곽 상자 중심.
export function makeHalfDisc() {
  const R = 37.4, r = 6, y0 = -R / 2, N = 40;
  const pts = [];
  const arc = (cx, cy, rad, a0, a1, n) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]); } };
  arc(R - r, y0 + r, r, -Math.PI / 2, 0, 6);
  const th0 = Math.asin(r / R);
  arc(0, y0, R, th0, Math.PI - th0, N);
  arc(-R + r, y0 + r, r, Math.PI, Math.PI * 1.5, 6);
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const rowY = y0 + 6.35;
  const holesXZ = [...lineXs(5).map(x => ({ x, y: rowY })), { x: 0, y: rowY + PITCH }, { x: 0, y: rowY + 2 * PITCH }].map(h => ({ x: h.x, z: -h.y }));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(flatPlateGeometry(shape, 0, holesXZ, 0, THICK), steelMaterial()));
  return { group, kind: 'plate', holes: holesXZ.map(h => holeMeta(h.x, 0, h.z, 0, 1, 0)) };
}

// ── 바퀴평판 (131) ──  63.5 × 63.5 안에 ㄴ자: 가로 다리 5×2 + 세로 다리 2×5(폭 25.4), 안쪽 모서리는 Ø63.5 원호로 채움(원 중심 = 구멍 하나).
// 구멍 17개: 가로 다리 10 + 세로 다리 위쪽 6 + 안쪽 모서리 어긋난 1(이미지). 원점 = 상자 중심, 그림에서 위쪽 = -z.
export function makeWheelFlatPlate() {
  const S = 63.5, C = S / 2, r = 6.35, Rc = 31.75, cx0 = 44.45, cy0 = 31.75;
  const shape = new THREE.Shape();
  const mv = (x, y) => shape.moveTo(x - C, y - C), ln = (x, y) => shape.lineTo(x - C, y - C);
  const ar = (x, y, rad, a0, a1) => shape.absarc(x - C, y - C, rad, a0, a1, false);
  const th1 = Math.PI + Math.asin(r / Rc);
  mv(r, 0); ln(S - r, 0); ar(S - r, r, r, -Math.PI / 2, 0);
  ln(S, S - r); ar(S - r, S - r, r, 0, Math.PI / 2);
  ln(cx0, S); ar(cx0, cy0, Rc, Math.PI / 2, th1);
  ln(r, 2 * PITCH); ar(r, 2 * PITCH - r, r, Math.PI / 2, Math.PI);
  ln(0, r); ar(r, r, r, Math.PI, Math.PI * 1.5);
  const pts = [];
  for (let i = 0; i < 5; i++) for (const y of [r, r + PITCH]) pts.push([r + i * PITCH, y]);
  for (const x of [cx0, cx0 + PITCH]) for (const y of [r + 2 * PITCH, r + 3 * PITCH, r + 4 * PITCH]) pts.push([x, y]);
  pts.push([cx0 - r, 2 * PITCH]);                          // 안쪽 모서리의 어긋난 구멍
  const holesXZ = pts.map(([x, y]) => ({ x: x - C, z: -(y - C) }));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(flatPlateGeometry(shape, 0, holesXZ, 0, THICK), steelMaterial()));
  return { group, kind: 'plate', holes: holesXZ.map(h => holeMeta(h.x, 0, h.z, 0, 1, 0)) };
}

// ── 곡면스트립 (88) ──  폭 12.7, 길이 69(중심선 호 + 양 끝 반원), 바깥 지름 Ø88 원의 일부(4개로 원). 양 끝은 곡선 장공, 아래쪽 가까이 둥근 구멍 1.
// 곡선 장공은 장공 조인트(직선 이동)로 못 쓰므로 slots 메타는 없고, 장공 가운데에 고정용 구멍만 둔다. 원점 = 호의 꼭대기.
const CURVED_RC = 44 - STRIP_W / 2;
function arcStadiumPts(Rc, hw, t1, t2, n = 20) {          // 중심선 호(각 t1<t2) 둘레로 반폭 hw 인 스타디움 윤곽점 (원 중심 (0,-Rc))
  const P = (r, t) => [r * Math.sin(t), -Rc + r * Math.cos(t)];
  const out = [];
  for (let i = 0; i <= n; i++) out.push(P(Rc + hw, t1 + (t2 - t1) * i / n));
  const c2 = P(Rc, t2), er2 = [Math.sin(t2), Math.cos(t2)], tg2 = [Math.cos(t2), -Math.sin(t2)];
  for (let i = 1; i < 12; i++) { const f = Math.PI * i / 12; out.push([c2[0] + hw * (Math.cos(f) * er2[0] + Math.sin(f) * tg2[0]), c2[1] + hw * (Math.cos(f) * er2[1] + Math.sin(f) * tg2[1])]); }
  for (let i = 0; i <= n; i++) out.push(P(Rc - hw, t2 + (t1 - t2) * i / n));
  const c1 = P(Rc, t1), er1 = [Math.sin(t1), Math.cos(t1)], tg1 = [-Math.cos(t1), Math.sin(t1)];
  for (let i = 1; i < 12; i++) { const f = Math.PI * i / 12; out.push([c1[0] + hw * (-Math.cos(f) * er1[0] + Math.sin(f) * tg1[0]), c1[1] + hw * (-Math.cos(f) * er1[1] + Math.sin(f) * tg1[1])]); }
  return out;
}
export function makeCurvedStrip() {
  const Rc = CURVED_RC, hw = STRIP_W / 2, total = 69.1;
  const alpha = (total - STRIP_W) / (2 * Rc);
  const fill = (pts, S) => { S.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) S.lineTo(pts[i][0], pts[i][1]); S.closePath(); return S; };
  const shape = fill(arcStadiumPts(Rc, hw, -alpha, alpha), new THREE.Shape());
  const thOf = s => alpha - (s - hw) / Rc;                 // 끝(+각) 가장자리에서 중심선을 따라 잰 거리 s → 각
  const slotSpan = [[thOf(15.95), thOf(4.05)]];
  slotSpan.push([-slotSpan[0][1], -slotSpan[0][0]]);
  for (const [a, b] of slotSpan) shape.holes.push(fill(arcStadiumPts(Rc, HOLE_R, a, b, 12), new THREE.Path()));
  const hole = t => ({ x: Rc * Math.sin(t), z: Rc * (1 - Math.cos(t)) });
  const round = hole(thOf(44.2));
  const rp = new THREE.Path(); rp.absarc(round.x, -round.z, HOLE_R, 0, Math.PI * 2, true); shape.holes.push(rp);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(flatPlateGeometry(shape, 0, [], 0, THICK), steelMaterial()));
  const centers = [...slotSpan.map(([a, b]) => hole((a + b) / 2)), round];
  return { group, kind: 'plate', holes: centers.map(h => holeMeta(h.x, 0, h.z, 0, 1, 0)) };
}

// ── 양팔크랭크 (53) ──  38 × 12.7 판(양 끝 반원) + 가운데 황동 보스(축·멈춤나사). 한쪽 끝 둥근 구멍(−12.7), 반대쪽 끝 장공(+12.7, 길이 방향).
// 축에 끼워 돌리면 구멍/장공이 링크 핀 자리가 된다. 보스 Ø9×7·판 두께 1.5 는 추정.
export function makeDoubleCrank() {
  const L = 38, T = 1.5, hubR = 4.5, hubH = 7;
  const slot = { x1: PITCH - 2.4, x2: PITCH + 2.4, z: 0 };
  const geo = flatPlateGeometry(L, STRIP_W, [{ x: -PITCH, z: 0 }], STRIP_W / 2, T, [slot]);
  const spinner = new THREE.Group();
  spinner.add(new THREE.Mesh(geo, steelMaterial()));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, hubH, 24), new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.7, roughness: 0.35 }));
  hub.position.y = T / 2 + hubH / 2;
  spinner.add(hub);
  const dot = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), new THREE.MeshBasicMaterial({ color: 0xe53935 }));
  dot.position.set(-L / 2 + 3, T / 2 + 0.2, 0);
  spinner.add(dot);
  const group = new THREE.Group();
  group.add(spinner);
  return {
    group, kind: 'gear', spinner,
    holes: [holeMeta(-PITCH, 0, 0, 0, 1, 0, T)],
    slots: [{ a: new THREE.Vector3(slot.x1, 0, 0), b: new THREE.Vector3(slot.x2, 0, 0), n: new THREE.Vector3(0, 1, 0), t: T }],
    gear: { pitchR: PITCH, thick: T, noMesh: true },
  };
}

// ── 면판휠 (64) ──  Ø63 원판 + 가운데 황동 보스. 십자 방향 장공 4개(중심에서 12.7~25.4) + 대각선 둥근 구멍 8개(R12.7, R25.4 각 4개). 이빨·홈 없음.
// 장공 구간·대각선 구멍 반지름은 이미지 비율로 12.7 격자에 맞춰 읽은 값. 보스·두께는 휠판-8 과 같은 추정치.
export function makeFacePlateWheel() {
  const R = 31.5, T = 1.5, hubR = 4.5, hubH = 9;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, R, 0, Math.PI * 2, false);
  const hubHole = new THREE.Path(); hubHole.absarc(0, 0, 2.05, 0, Math.PI * 2, true); shape.holes.push(hubHole);
  const holes = [], slots = [];
  for (const rad of [PITCH, 2 * PITCH]) for (let i = 0; i < 4; i++) {
    const ang = Math.PI / 4 + i * Math.PI / 2, sx = rad * Math.cos(ang), sy = rad * Math.sin(ang);
    const p = new THREE.Path(); p.absarc(sx, sy, HOLE_R, 0, Math.PI * 2, true); shape.holes.push(p);
    holes.push(holeMeta(sx, 0, -sy, 0, 1, 0, T));
  }
  for (let i = 0; i < 4; i++) {
    const ang = i * Math.PI / 2, ux = Math.cos(ang), uy = Math.sin(ang);
    shape.holes.push(stadiumPath(ux * PITCH, uy * PITCH, ux * 2 * PITCH, uy * 2 * PITCH, HOLE_R));
    slots.push({ a: new THREE.Vector3(ux * PITCH, 0, -uy * PITCH), b: new THREE.Vector3(ux * 2 * PITCH, 0, -uy * 2 * PITCH), n: new THREE.Vector3(0, 1, 0), t: T });
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 48 });
  geo.translate(0, 0, -T / 2);
  geo.rotateX(-Math.PI / 2);
  const spinner = new THREE.Group();
  spinner.add(new THREE.Mesh(geo, steelMaterial()));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, hubH, 24), new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.7, roughness: 0.35 }));
  hub.position.y = T / 2 + hubH / 2;
  spinner.add(hub);
  const dot = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), new THREE.MeshBasicMaterial({ color: 0xe53935 }));
  dot.position.set(R - 2.2, T / 2 + 0.2, 0);
  spinner.add(dot);
  const group = new THREE.Group();
  group.add(spinner);
  return { group, kind: 'gear', holes, slots, spinner, gear: { pitchR: 2 * PITCH, thick: T, noMesh: true } };
}

// ── 크라운기어 (36) ──  50T, Ø36.2, 높이 15. 원판 가장자리 한 면(−Y)에 축 방향 이빨 → 피니언·평기어와 직각으로 맞물림.
// 모듈은 다른 기어와 같음(0.668) → 피치 반지름 16.7. 원판 구멍 8개(R10.5)·허브(+Y, Ø9)·원판 두께 1.5·이빨 높이 1.6 은 이미지 비율 추정.
// 맞물림은 kinematics.js 의 crown 분기: 상대 기어 축이 크라운 축에 직각으로 만나고(반지름 방향), 피치원이 이빨 면 아래에 접함.
export const CROWN_TEETH = 50;
export function makeCrownGear() {
  const mod = GEAR_MODULE, R = 18.1, T = 1.5, toothH = 1.6, pitchR = mod * CROWN_TEETH / 2;
  const disc = new THREE.Shape();
  disc.absarc(0, 0, R, 0, Math.PI * 2, false);
  const hubHole = new THREE.Path(); hubHole.absarc(0, 0, 2.05, 0, Math.PI * 2, true); disc.holes.push(hubHole);
  const holes = [];
  for (let i = 0; i < 8; i++) {
    const ang = i * Math.PI / 4, sx = 10.5 * Math.cos(ang), sy = 10.5 * Math.sin(ang);
    const p = new THREE.Path(); p.absarc(sx, sy, HOLE_R, 0, Math.PI * 2, true); disc.holes.push(p);
    holes.push(holeMeta(sx, 0, -sy, 0, 1, 0, T));
  }
  const discGeo = new THREE.ExtrudeGeometry(disc, { depth: T, bevelEnabled: false, curveSegments: 48 });
  discGeo.translate(0, 0, -T / 2);
  discGeo.rotateX(-Math.PI / 2);

  const rt = pitchR + 0.7, rg = pitchR - 1.3, Tt = (Math.PI * 2) / CROWN_TEETH;
  const ring = new THREE.Shape();
  for (let i = 0; i < CROWN_TEETH; i++) {
    for (const [r, f] of [[rg, 0], [rg, 0.2], [rt, 0.3], [rt, 0.7], [rg, 0.8]]) {
      const a = (i + f) * Tt, x = r * Math.cos(a), y = r * Math.sin(a);
      if (i === 0 && f === 0) ring.moveTo(x, y); else ring.lineTo(x, y);
    }
  }
  ring.closePath();
  const inner = new THREE.Path(); inner.absarc(0, 0, rg - 1.0, 0, Math.PI * 2, true); ring.holes.push(inner);
  const ringGeo = new THREE.ExtrudeGeometry(ring, { depth: toothH, bevelEnabled: false, curveSegments: 4 });
  ringGeo.translate(0, 0, T / 2);                          // 압출 +z → 회전 후 -Y 방향으로 돌출하도록 아래에서 반전
  ringGeo.rotateX(Math.PI / 2);                            // (x,y,z) → (x,-z,y): 이빨이 원판 아래(-Y)로 자란다 (shape y → +z)

  const spinner = new THREE.Group();
  const yellow = plasticMaterial(0xe8b90f);
  spinner.add(new THREE.Mesh(discGeo, yellow), new THREE.Mesh(ringGeo, yellow));
  const hubH = 15 - toothH - T;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, hubH, 24), steelMaterial());
  hub.position.y = T / 2 + hubH / 2;
  spinner.add(hub);
  const group = new THREE.Group();
  group.add(spinner);
  return {
    group, kind: 'gear', holes, spinner,
    gear: { teeth: CROWN_TEETH, pitchR, thick: T, crown: { pitchY: -T / 2 - toothH / 2 } },
  };
}

// ── 2단 평기어(소) (140) ──  57T(Ø39.4, 구멍 8개 R12.7) 위에 19T 피니언(Ø14)이 한 몸으로 붙은 기어, 위에 금속 허브. 총 높이 20.4.
// 한 부품에 맞물림 단이 둘: gear.stages = [{teeth, pitchR, y}] — kinematics 가 단마다 따로 맞물림을 찾는다(y = 원점에서 축 방향 위치).
// 피니언 길이 7·허브 반경 4.5 는 이미지 비율 추정.
function gearExtrude(teeth, depth, y0, ringHoles = []) {
  const shape = gearShape(teeth, GEAR_MODULE);
  const hubHole = new THREE.Path(); hubHole.absarc(0, 0, 2.05, 0, Math.PI * 2, true); shape.holes.push(hubHole);
  for (const [sx, sy] of ringHoles) { const p = new THREE.Path(); p.absarc(sx, sy, HOLE_R, 0, Math.PI * 2, true); shape.holes.push(p); }
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  geo.translate(0, 0, y0);
  geo.rotateX(-Math.PI / 2);
  return geo;
}
export function makeTwoStageGear() {
  const mod = GEAR_MODULE, T = 4, pinionLen = 7, topY = 20.4 - T / 2;
  const ring = [], holes = [];
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, sx = PITCH * Math.cos(a), sy = PITCH * Math.sin(a); ring.push([sx, sy]); holes.push(holeMeta(sx, 0, -sy, 0, 1, 0, T)); }
  const black = plasticMaterial(0x2b2d31);
  const spinner = new THREE.Group();
  spinner.add(new THREE.Mesh(gearExtrude(57, T, -T / 2, ring), black));
  spinner.add(new THREE.Mesh(gearExtrude(19, pinionLen, T / 2), black));
  const hubH = topY - (T / 2 + pinionLen);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, hubH, 24), steelMaterial());
  hub.position.y = T / 2 + pinionLen + hubH / 2;
  spinner.add(hub);
  const group = new THREE.Group();
  group.add(spinner);
  return {
    group, kind: 'gear', holes, spinner,
    gear: {
      teeth: 57, pitchR: mod * 57 / 2, thick: T,
      stages: [
        { teeth: 57, pitchR: mod * 57 / 2, y: 0 },
        { teeth: 19, pitchR: mod * 19 / 2, y: T / 2 + pinionLen / 2 },
      ],
    },
  };
}
