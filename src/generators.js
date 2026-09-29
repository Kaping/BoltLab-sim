// 파라메트릭 부품 생성기 (12.7mm 격자)
// 좌표계: 1 unit = 1mm. 판 부품: 길이=X, 두께=Y, 폭=Z. 회전 부품(축/기어): 축방향=로컬 +Y.
// 반환: { group, holes, kind, ... }
//   holes = [{ p: Vector3(로컬), n: Vector3(구멍 축), t: 그 지점의 판 두께 }]
//   kind  = 'plate' | 'axle' | 'gear'
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

// 구멍 뚫린 평판 지오메트리. holesXZ = [{x, z}] (3D 기준).
function flatPlateGeometry(L, W, holesXZ, cornerR, depth = THICK) {
  const shape = roundedRectShape(L, W, cornerR);
  for (const h of holesXZ) {
    const path = new THREE.Path();
    path.absarc(h.x, -h.z, HOLE_R, 0, Math.PI * 2, true); // shape y = -z 매핑 보정
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

// ── ㄷ형스트립-N ──  채널 단면, 벽 깊이 14.3 (실측)
export function makeChannel(n) {
  const W = STRIP_W;
  const H = 14.3;
  const L = stripLength(n, 5.5);
  const xs = lineXs(n);
  const holesXZ = xs.map(x => ({ x, z: 0 }));
  const group = new THREE.Group();

  const web = new THREE.Mesh(flatPlateGeometry(L, W, holesXZ, 1.5), steelMaterial());
  group.add(web);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(flatPlateGeometry(L, H, [], 1.0), steelMaterial());
    wall.rotation.x = Math.PI / 2;
    wall.position.set(0, H / 2, side * (W / 2 - THICK / 2));
    group.add(wall);
  }
  return { group, kind: 'plate', holes: xs.map(x => holeMeta(x, 0, 0, 0, 1, 0)) };
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
export function makeLBracket(nFoot = 1) {
  const W = STRIP_W, wallH = 10.7;
  const footL = nFoot === 1 ? 13.5 : 26.3;
  const group = new THREE.Group();

  const footHoleXs = [];
  for (let i = 0; i < nFoot; i++) footHoleXs.push(6.75 + i * PITCH);
  const footLocal = footHoleXs.map(x => ({ x: x - footL / 2, z: 0 }));
  const foot = new THREE.Mesh(flatPlateGeometry(footL, W, footLocal, 1.5), steelMaterial());
  foot.position.x = footL / 2;
  group.add(foot);

  const wall = new THREE.Mesh(flatPlateGeometry(wallH, W, [{ x: 0, z: 0 }], 1.5), steelMaterial());
  wall.rotation.z = Math.PI / 2;
  wall.position.set(0, wallH / 2, 0);
  group.add(wall);

  const holes = footHoleXs.map(x => holeMeta(x, 0, 0, 0, 1, 0));
  holes.push(holeMeta(0, wallH / 2, 0, 1, 0, 0));
  return { group, kind: 'plate', holes };
}

// ── ㄷ형브래킷 (13) ──  U자: 바닥(span) + 양쪽 날개(높이 15), 구멍 각 1개
export function makeUBracket(span = 12.5) {
  const W = STRIP_W, wingH = 15;
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
