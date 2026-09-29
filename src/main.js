// BoltLab-sim — 메인
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATALOG, findDef } from './catalog.js';
import { Assembly } from './assembly.js';
import { makeBolt, makeClipRing, THICK, PITCH } from './generators.js';
import { KinematicModel } from './kinematics.js';

const SNAP_DIST = 6;      // 스냅 흡착 거리(mm)
const COAX_RADIAL = 1.0;  // 동축(축-구멍) 체결 허용 반경 오차
const PARALLEL = 0.95;    // 축 평행 판정 |dot|

// ── 씬 기본 구성 ─────────────────────────────────────────
const canvas = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1d21);

const camera = new THREE.PerspectiveCamera(50, 1, 1, 5000);
camera.position.set(160, 190, 240);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 10, 0);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(120, 250, 150);
scene.add(key);
const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
fill.position.set(-150, 100, -100);
scene.add(fill);

scene.add(new THREE.GridHelper(PITCH * 40, 40, 0x3a3f47, 0x2a2e34));

function resize() {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth;
  const h = canvas.clientHeight || canvas.parentElement.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ── 상태 ────────────────────────────────────────────────
const assembly = new Assembly();
const partsRoot = new THREE.Group();
scene.add(partsRoot);

let selectedId = null;          // 주 선택 (회전 기준, 모터 패널 등)
const selection = new Set();    // 다중 선택 (Ctrl+클릭, 그룹)
let boltMode = false;
let drag = null;
let spawnIndex = 0;
let pinnedPartId = null;

// 시뮬 상태: active = 시뮬 모드(편집 잠금), playing = 재생 중
const sim = { active: false, playing: false, model: null, meter: { t: 0, id: null, angle: 0 } };

const statusEl = document.getElementById('status');
const setStatus = t => { statusEl.textContent = t; };

const snapRing = ringMesh(0x38d178);
snapRing.visible = false;
scene.add(snapRing);

const markerGroup = new THREE.Group();
scene.add(markerGroup);

function ringMesh(color) {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(3.2, 0.6, 8, 24),
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 })
  );
  m.renderOrder = 10;
  return m;
}
function orientRing(ring, pos, normal) {
  ring.position.copy(pos);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
}
// 점 p에서 직선(origin,dir)의 최근접점
function closestOnLine(origin, dir, p) {
  const t = new THREE.Vector3().subVectors(p, origin).dot(dir);
  return { point: origin.clone().addScaledVector(dir, t), t };
}

// ── 팔레트 ──────────────────────────────────────────────
const paletteEl = document.getElementById('palette');
function renderPalette() {
  paletteEl.innerHTML = '';
  for (const g of CATALOG) {
    const gh = document.createElement('div');
    gh.className = 'pal-group';
    gh.textContent = g.group;
    paletteEl.appendChild(gh);
    for (const item of g.items) {
      const used = assembly.usedCount.get(item.id) || 0;
      const el = document.createElement('div');
      el.className = 'pal-item';
      const qty = document.createElement('span');
      qty.className = 'qty' + (used > item.qty ? ' over' : '');
      qty.textContent = `${used}/${item.qty}`;
      el.append(Object.assign(document.createElement('span'), { textContent: item.label }), qty);
      el.addEventListener('click', () => spawnPart(item.id));
      paletteEl.appendChild(el);
    }
  }
}

function spawnPart(defId) {
  if (sim.active) return;
  const def = findDef(defId);
  if (!def) return;
  pushUndo();
  const made = def.make();
  const part = assembly.addPart(defId, made);
  const col = spawnIndex % 4, row = Math.floor(spawnIndex / 4) % 5;
  spawnIndex++;
  const y = part.kind === 'axle' ? part.axisLen / 2 : (part.kind === 'gear' ? 2 : THICK / 2);
  part.root.position.set(col * 40 - 60, y, row * 30 - 60);
  partsRoot.add(part.root);
  select(part.id);
  renderPalette();
  setStatus(`${def.label} 추가됨 — 드래그 이동 (Shift: 세로), R/F 회전, B 볼트 모드`);
}

// ── 선택 ────────────────────────────────────────────────
function setEmissive(partId, hex) {
  const part = assembly.parts.get(partId);
  if (!part) return;
  part.root.traverse(o => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(hex); });
}
// 그룹에 속한 부품은 그룹 전체가 선택 단위
function expandGroup(id) {
  const p = assembly.parts.get(id);
  return p && p.group != null ? assembly.groupMembers(p.group) : [id];
}
function highlight() {
  for (const p of assembly.parts.values()) {
    setEmissive(p.id, !selection.has(p.id) ? 0x000000 : (p.id === selectedId ? 0x16408a : 0x0d2b5e));
  }
}
function select(id, toggle = false) {
  if (!toggle) selection.clear();
  if (id === null) {
    if (!toggle) selectedId = null;
  } else {
    const ids = expandGroup(id);
    const off = toggle && ids.every(i => selection.has(i));
    for (const i of ids) off ? selection.delete(i) : selection.add(i);
    selectedId = off ? ([...selection].at(-1) ?? null) : id;
  }
  highlight();
  refreshMotorPanel();
}
function selectMany(ids) {
  selection.clear();
  for (const i of ids) selection.add(i);
  selectedId = ids.length ? ids[ids.length - 1] : null;
  highlight();
  refreshMotorPanel();
}
// 선택된 부품들이 끌고 가는 전체 (볼트·그룹으로 이어진 것 포함)
function selectionComponent() {
  const out = new Set();
  for (const id of selection) for (const c of assembly.componentOf(id)) out.add(c);
  if (selectedId !== null) for (const c of assembly.componentOf(selectedId)) out.add(c);
  return out;
}

// ── 레이캐스트 ──────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function setPointer(e) {
  const r = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}
function pickPart(e) {
  setPointer(e);
  const hits = raycaster.intersectObjects(partsRoot.children, true);
  for (const h of hits) {
    let o = h.object;
    while (o && o.userData.partId === undefined) o = o.parent;
    if (o) return { partId: o.userData.partId, point: h.point };
  }
  return null;
}

// ── 체결 후보 탐색 ──────────────────────────────────────
// 1) bolt: 구멍-구멍 겹침  2) clip: 기어 허브에 축 관통  3) bearing: 판 구멍에 축 관통
function findCandidates() {
  const out = [];
  const holes = assembly.worldHoles();
  const axes = assembly.worldAxes();
  const hubs = assembly.worldHubs();

  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      const A = holes[i], B = holes[j];
      if (A.partId === B.partId) continue;
      if (Math.abs(A.n.dot(B.n)) < PARALLEL) continue;
      const d = new THREE.Vector3().subVectors(A.p, B.p);
      const axial = Math.abs(d.dot(B.n));
      const radial = d.clone().addScaledVector(B.n, -d.dot(B.n)).length();
      if (radial > COAX_RADIAL || axial > (A.t + B.t) / 2 + 0.6) continue;
      if (assembly.hasConnection('bolt', A.partId, A.index, B.partId, B.index)) continue;
      if (assembly.hasConnection('pivot', A.partId, A.index, B.partId, B.index)) continue;
      out.push({ type: 'bolt', A, B, n: B.n, mid: new THREE.Vector3().addVectors(A.p, B.p).multiplyScalar(0.5) });
    }
  }
  for (const ax of axes) {
    for (const hub of hubs) {
      if (Math.abs(ax.dir.dot(hub.n)) < PARALLEL) continue;
      const { point, t } = closestOnLine(ax.origin, ax.dir, hub.p);
      if (point.distanceTo(hub.p) > COAX_RADIAL || Math.abs(t) > ax.halfLen + 1) continue;
      const type = hub.motor ? 'drive' : 'clip';
      if (assembly.hasLink(type, ax.partId, hub.partId)) continue;
      out.push({ type, axle: ax, other: hub, n: ax.dir, mid: hub.p.clone() });
    }
    for (const h of holes) {
      if (h.kind === 'gear') continue; // 기어 볼트구멍은 베어링 대상 아님
      if (Math.abs(ax.dir.dot(h.n)) < PARALLEL) continue;
      const { point, t } = closestOnLine(ax.origin, ax.dir, h.p);
      if (point.distanceTo(h.p) > COAX_RADIAL || Math.abs(t) > ax.halfLen + 1) continue;
      if (assembly.hasConnection('bearing', ax.partId, -1, h.partId, h.index)) continue;
      out.push({ type: 'bearing', axle: ax, other: h, n: ax.dir, mid: h.p.clone() });
    }
  }
  return out;
}

const MARKER_COLOR = { bolt: 0xffd54a, clip: 0x4dd0e1, bearing: 0xda70d6, drive: 0x7cff6b };

function refreshMarkers() {
  markerGroup.clear();
  if (!boltMode) return;
  const cands = findCandidates();
  for (const c of cands) {
    const ring = ringMesh(MARKER_COLOR[c.type]);
    orientRing(ring, c.mid, c.n);
    ring.userData.candidate = c;
    markerGroup.add(ring);
  }
  setStatus(cands.length
    ? `체결 가능 ${cands.length}곳 — 노랑=볼트(Shift+클릭: 회전볼트), 하늘=클립, 보라=베어링, 초록=모터 연결`
    : '체결 가능한 지점이 없습니다. 구멍을 겹치거나 축을 관통시키세요.');
}

function makeConnMesh(type) {
  if (type === 'bolt' || type === 'pivot') {
    const mesh = makeBolt();
    if (type === 'pivot') mesh.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.setHex(0xff8a3d); } });
    return mesh;
  }
  return makeClipRing({ clip: 0x37474f, bearing: 0x7b4a8f, drive: 0x2e7d32 }[type]);
}
function registerConnection(type, a, b, holeA, holeB, mesh) {
  const conn = assembly.connect(type, a, b, holeA, holeB, mesh);
  mesh.userData.connId = conn.id;
  mesh.traverse(o => { o.userData.connId = conn.id; });
  return conn;
}

function addConnection(c, pivot = false) {
  let mesh, a, b, holeA = -1, holeB = -1;
  let type = c.type;
  pushUndo();
  if (c.type === 'bolt') {
    if (pivot) type = 'pivot';
    mesh = makeConnMesh(type);
    mesh.position.copy(c.mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.n.clone().normalize());
    a = c.A.partId; b = c.B.partId; holeA = c.A.index; holeB = c.B.index;
  } else {
    mesh = makeConnMesh(c.type);
    mesh.position.copy(c.mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), c.n.clone().normalize());
    a = c.axle.partId; b = c.other.partId;
    if (c.type === 'bearing') holeB = c.other.index;
  }
  scene.add(mesh);
  assembly.parts.get(b).root.attach(mesh);
  registerConnection(type, a, b, holeA, holeB, mesh);
  refreshMarkers();
  const msg = { bolt: '볼트 고정', pivot: '회전볼트 체결(두 부품이 이 구멍을 축으로 돌 수 있음)', clip: '스프링클립 고정(기어↔축)', bearing: '베어링 연결(축↔판)', drive: '모터 연결(모터가 이 축을 돌림)' };
  setStatus(`${msg[type]} 완료.`);
}

// ── 드래그 & 스냅 ───────────────────────────────────────
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;

  if (sim.active) { // 시뮬 중에는 선택만
    const hit = pickPart(e);
    select(hit ? hit.partId : null);
    return;
  }
  const multi = e.ctrlKey || e.metaKey;

  if (boltMode) {
    setPointer(e);
    const mHits = raycaster.intersectObjects(markerGroup.children, false);
    if (mHits.length) { addConnection(mHits[0].object.userData.candidate, e.shiftKey); return; }
    const connMeshes = assembly.connections.map(c => c.mesh);
    const bHits = raycaster.intersectObjects(connMeshes, true);
    if (bHits.length) {
      pushUndo();
      const conn = assembly.disconnectByMesh(bHits[0].object);
      if (conn) { conn.mesh.parent.remove(conn.mesh); refreshMarkers(); setStatus('체결을 해제했습니다.'); }
    }
    return;
  }

  const hit = pickPart(e);
  if (multi) { if (hit) select(hit.partId, true); return; } // Ctrl+클릭: 선택 추가/해제
  if (!hit) { select(null); return; }
  if (!selection.has(hit.partId)) select(hit.partId);
  else { selectedId = hit.partId; highlight(); refreshMotorPanel(); }
  const component = selectionComponent();
  const basePos = new Map();
  for (const id of component) basePos.set(id, assembly.parts.get(id).root.position.clone());

  // Shift: 세로 이동 — 카메라를 향한 수직 평면에서 드래그
  let plane;
  if (e.shiftKey) {
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    camDir.y = 0;
    if (camDir.lengthSq() < 1e-6) camDir.set(0, 0, 1);
    camDir.normalize();
    plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, hit.point);
  } else {
    plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y);
  }
  drag = { component, basePos, plane, grabPoint: hit.point.clone(), vertical: e.shiftKey, snap: serialize(), moved: false };
  controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  setPointer(e);
  const pt = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(drag.plane, pt)) return;
  const delta = new THREE.Vector3().subVectors(pt, drag.grabPoint);
  if (delta.lengthSq() > 0.01) drag.moved = true;

  for (const id of drag.component) {
    assembly.parts.get(id).root.position.copy(drag.basePos.get(id)).add(delta);
  }

  // ── 스냅 후보 계산 ──
  const inComp = id => drag.component.has(id);
  const outComp = id => !drag.component.has(id);
  const mHoles = assembly.worldHoles(inComp);
  const fHoles = assembly.worldHoles(outComp);
  const mAxes = assembly.worldAxes(inComp);
  const fAxes = assembly.worldAxes(outComp);
  const mHubs = assembly.worldHubs(inComp);
  const fHubs = assembly.worldHubs(outComp);

  let best = null;
  const consider = (dist, offset, at, n) => {
    if (dist < SNAP_DIST && (!best || dist < best.dist)) best = { dist, offset, at, n };
  };

  // 1) 구멍 ↔ 구멍 (면접촉: 두께의 절반씩 오프셋)
  for (const m of mHoles) for (const f of fHoles) {
    if (Math.abs(m.n.dot(f.n)) < PARALLEL) continue;
    const side = new THREE.Vector3().subVectors(m.p, f.p).dot(f.n) >= 0 ? 1 : -1;
    const target = f.p.clone().addScaledVector(f.n, side * (m.t + f.t) / 2);
    consider(target.distanceTo(m.p), new THREE.Vector3().subVectors(target, m.p), f.p, f.n);
  }
  // 2) (이동측) 구멍·허브 ↔ (고정측) 축선: 축에 꿰기
  for (const m of [...mHoles, ...mHubs]) {
    for (const ax of fAxes) {
      if (Math.abs(m.n.dot(ax.dir)) < PARALLEL) continue;
      const { point, t } = closestOnLine(ax.origin, ax.dir, m.p);
      if (Math.abs(t) > ax.halfLen + 2) continue;
      consider(point.distanceTo(m.p), new THREE.Vector3().subVectors(point, m.p), point, ax.dir);
    }
  }
  // 3) (이동측) 축선 ↔ (고정측) 구멍·허브
  for (const ax of mAxes) {
    for (const f of [...fHoles, ...fHubs]) {
      if (Math.abs(ax.dir.dot(f.n)) < PARALLEL) continue;
      const { point, t } = closestOnLine(ax.origin, ax.dir, f.p);
      if (Math.abs(t) > ax.halfLen + 2) continue;
      consider(point.distanceTo(f.p), new THREE.Vector3().subVectors(f.p, point), f.p, f.n);
    }
  }

  if (best) {
    for (const id of drag.component) assembly.parts.get(id).root.position.add(best.offset);
    orientRing(snapRing, best.at, best.n);
    snapRing.visible = true;
  } else {
    snapRing.visible = false;
  }
});

canvas.addEventListener('pointerup', () => {
  if (drag) {
    if (drag.moved) pushUndo(drag.snap);
    drag = null; snapRing.visible = false; controls.enabled = true;
  }
});

// ── 변환 조작 ───────────────────────────────────────────
function transformComponent(fn) {
  if (sim.active) return;
  if (selectedId === null || !assembly.parts.has(selectedId)) return;
  pushUndo();
  const component = selectionComponent();
  const pivot = assembly.parts.get(selectedId).root.position.clone();
  for (const id of component) fn(assembly.parts.get(id).root, pivot);
  if (boltMode) refreshMarkers();
}
function rotateSelected(axis) {
  const q = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2);
  transformComponent((root, pivot) => {
    root.position.sub(pivot).applyQuaternion(q).add(pivot);
    root.quaternion.premultiply(q);
  });
}
function moveSelectedY(dy) {
  transformComponent(root => { root.position.y += dy; });
}
function deleteSelected() {
  if (sim.active || selection.size === 0) return;
  pushUndo();
  const ids = [...selection];
  for (const id of ids) {
    const part = assembly.parts.get(id);
    if (!part) continue;
    for (const m of assembly.removePart(id)) m.parent && m.parent.remove(m);
    partsRoot.remove(part.root);
    if (pinnedPartId === id) pinnedPartId = null;
  }
  select(null);
  renderPalette();
  if (boltMode) refreshMarkers();
  setStatus(`부품 ${ids.length}개를 삭제했습니다. (Ctrl+Z 되돌리기)`);
}
function toggleBoltMode() {
  if (sim.active) return;
  boltMode = !boltMode;
  document.getElementById('btn-bolt').classList.toggle('active', boltMode);
  refreshMarkers();
  if (!boltMode) setStatus('볼트 모드 해제.');
}

// ── 직렬화 (되돌리기·복사 공용) ─────────────────────────
// ids 가 주어지면 그 부품들과 그 사이 연결만 담음
function serialize(ids = null) {
  const list = ids ? [...ids].filter(id => assembly.parts.has(id)) : [...assembly.parts.keys()];
  const index = new Map(list.map((id, i) => [id, i]));
  const parts = list.map(id => {
    const p = assembly.parts.get(id);
    return { defId: p.defId, pos: p.root.position.toArray(), quat: p.root.quaternion.toArray(), rpm: p.motorRpm, group: p.group };
  });
  // 일부만 담을 때 그룹은 2개 이상 들어온 경우만 유지
  const gCount = new Map();
  for (const q of parts) if (q.group != null) gCount.set(q.group, (gCount.get(q.group) || 0) + 1);
  for (const q of parts) if (q.group != null && gCount.get(q.group) < 2) q.group = null;
  const conns = assembly.connections
    .filter(c => index.has(c.a) && index.has(c.b))
    .map(c => ({ type: c.type, a: index.get(c.a), b: index.get(c.b), holeA: c.holeA, holeB: c.holeB,
      mp: c.mesh.position.toArray(), mq: c.mesh.quaternion.toArray() }));
  return { parts, conns, pinned: index.has(pinnedPartId) ? index.get(pinnedPartId) : null };
}

// replace: 전체 교체(되돌리기) / 아니면 추가(붙여넣기, offset 만큼 이동)
function deserialize(data, { replace = false, offset = null } = {}) {
  if (replace) {
    for (const p of assembly.parts.values()) partsRoot.remove(p.root);
    assembly.clear();
    selection.clear(); selectedId = null; pinnedPartId = null;
  }
  const ids = [];
  const groupMap = new Map();
  for (const q of data.parts) {
    const def = findDef(q.defId);
    const part = assembly.addPart(q.defId, def.make());
    part.root.position.fromArray(q.pos);
    if (offset) part.root.position.add(offset);
    part.root.quaternion.fromArray(q.quat);
    if (q.rpm !== undefined) part.motorRpm = q.rpm;
    partsRoot.add(part.root);
    ids.push(part.id);
    if (q.group != null) {
      if (!groupMap.has(q.group)) groupMap.set(q.group, []);
      groupMap.get(q.group).push(part.id);
    }
  }
  for (const members of groupMap.values()) assembly.setGroup(members);
  for (const c of data.conns) {
    const mesh = makeConnMesh(c.type);
    mesh.position.fromArray(c.mp);
    mesh.quaternion.fromArray(c.mq);
    assembly.parts.get(ids[c.b]).root.add(mesh); // 연결 메시는 b 부품 기준 로컬 좌표
    registerConnection(c.type, ids[c.a], ids[c.b], c.holeA, c.holeB, mesh);
  }
  if (replace && data.pinned != null) pinnedPartId = ids[data.pinned];
  renderPalette();
  if (boltMode) refreshMarkers();
  return ids;
}

// ── 되돌리기 / 다시하기 ─────────────────────────────────
const undoStack = [], redoStack = [];
const UNDO_MAX = 100;
function pushUndo(snap = serialize()) {
  undoStack.push(snap);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack.length = 0;
}
function undo() {
  if (sim.active) { setStatus('시뮬 중에는 되돌릴 수 없어요. Esc로 먼저 원위치.'); return; }
  if (!undoStack.length) { setStatus('더 되돌릴 작업이 없습니다.'); return; }
  redoStack.push(serialize());
  deserialize(undoStack.pop(), { replace: true });
  select(null);
  setStatus(`되돌렸습니다. (남은 기록 ${undoStack.length}개 · Ctrl+Y 다시하기)`);
}
function redo() {
  if (sim.active || !redoStack.length) return;
  undoStack.push(serialize());
  deserialize(redoStack.pop(), { replace: true });
  select(null);
  setStatus('다시 실행했습니다.');
}

// ── 복사 / 붙여넣기 ─────────────────────────────────────
let clipboard = null;
function copySelection() {
  if (selection.size === 0) { setStatus('복사할 부품을 선택하세요.'); return false; }
  clipboard = { data: serialize(selection), pastes: 0 };
  setStatus(`부품 ${selection.size}개 복사됨 — Ctrl+V 붙여넣기`);
  return true;
}
function paste() {
  if (sim.active || !clipboard) return;
  pushUndo();
  clipboard.pastes++;
  const step = PITCH * 2 * clipboard.pastes; // 격자 2칸씩 비켜서 붙임
  const ids = deserialize(clipboard.data, { offset: new THREE.Vector3(step, 0, step) });
  selectMany(ids);
  setStatus(`부품 ${ids.length}개 붙여넣음 — 드래그로 옮기세요`);
}
function cutSelection() {
  if (sim.active) return;
  if (copySelection()) { clipboard.pastes = -1; deleteSelected(); } // 잘라낸 자리에 그대로 붙게
}

// ── 그룹 (볼트 없이 한 덩어리로 고정) ───────────────────
function groupSelection() {
  if (sim.active) return;
  if (selection.size < 2) { setStatus('Ctrl+클릭으로 2개 이상 선택한 뒤 Ctrl+G'); return; }
  pushUndo();
  assembly.setGroup([...selection]);
  selectMany(assembly.groupMembers(assembly.parts.get(selectedId).group));
  setStatus(`그룹으로 고정했습니다 (${selection.size}개). 함께 움직이고 시뮬에서도 한 덩어리 · Ctrl+Shift+G 해제`);
}
function ungroupSelection() {
  if (sim.active || selection.size === 0) return;
  pushUndo();
  const n = assembly.ungroup([...selection]);
  setStatus(n ? '그룹을 해제했습니다.' : '선택한 부품은 그룹이 아닙니다.');
  if (!n) undoStack.pop();
  select(selectedId);
}
function selectAll() {
  if (sim.active) return;
  selectMany([...assembly.parts.keys()]);
}

// ── 동작 시뮬레이션 ───────────────────────────────────
const btnPlay = document.getElementById('btn-play');
const motorPanel = document.getElementById('motor-panel');
const rpmInput = document.getElementById('rpm');
const rpmLabel = document.getElementById('rpm-label');

function startSim() {
  if (boltMode) toggleBoltMode();
  drag = null;
  sim.model = new KinematicModel(assembly, {
    pinnedPart: pinnedPartId,
    motorRpm: id => assembly.parts.get(id)?.motorRpm ?? 0,
  });
  sim.active = true;
  document.body.classList.add('sim');
  const m = sim.model.summary();
  setStatus(`시뮬 시작 — 강체 ${m.bodies} · 회전축 ${m.joints} · 자유도 ${m.dof} · 폐루프 ${m.loops} · 모터 ${m.motors} · 기어쌍 ${m.gears}`
    + (m.motors ? '' : '  |  모터가 없어요: 축·기어를 선택하고 , / . 로 손으로 돌려보세요'));
}
function togglePlay() {
  if (!sim.active) startSim();
  sim.playing = !sim.playing;
  btnPlay.textContent = sim.playing ? '⏸ 일시정지' : '▶ 재생';
  btnPlay.classList.toggle('active', sim.playing);
}
function resetSim() {
  if (!sim.active) return;
  sim.model.restore();
  sim.model = null;
  sim.active = false;
  sim.playing = false;
  btnPlay.textContent = '▶ 재생';
  btnPlay.classList.remove('active');
  document.body.classList.remove('sim');
  setStatus('원위치로 되돌렸습니다. 다시 편집할 수 있어요.');
}
function handCrank(delta) {
  if (selectedId === null) { setStatus('돌릴 축·기어·부품을 먼저 선택하세요.'); return; }
  if (!sim.active) startSim();
  if (!sim.model.nudge(selectedId, delta)) { setStatus('이 부품은 고정 강체라 돌릴 수 없어요.'); return; }
  if (!sim.playing) { sim.model.step(0); sim.model.apply(); }
}
function togglePin() {
  if (selectedId === null) return;
  pinnedPartId = pinnedPartId === selectedId ? null : selectedId;
  setStatus(pinnedPartId === null ? '고정 해제 — 시뮬 시 프레임을 자동으로 고릅니다.'
    : '📌 이 부품이 붙은 덩어리를 바닥(고정)으로 씁니다. (다음 시뮬부터 적용)');
}
function refreshMotorPanel() {
  const part = selectedId !== null ? assembly.parts.get(selectedId) : null;
  const isMotor = part && part.kind === 'motor';
  motorPanel.hidden = !isMotor;
  if (isMotor) { rpmInput.value = part.motorRpm; rpmLabel.textContent = `${part.motorRpm} rpm`; }
}
function setMotorRpm(v) {
  const part = selectedId !== null ? assembly.parts.get(selectedId) : null;
  if (!part || part.kind !== 'motor') return;
  part.motorRpm = Math.max(-120, Math.min(120, Math.round(v)));
  refreshMotorPanel();
}
rpmInput.addEventListener('input', () => setMotorRpm(Number(rpmInput.value)));
document.getElementById('btn-reverse').addEventListener('click', () => {
  const part = assembly.parts.get(selectedId);
  if (part && part.kind === 'motor') setMotorRpm(-part.motorRpm);
});

// 선택 부품 회전속도 측정 (0.25초마다)
function updateMeter(dt) {
  const m = sim.meter;
  m.t += dt;
  if (m.t < 0.25) return;
  const ang = selectedId !== null ? sim.model.angleOfPart(selectedId) : null;
  if (m.id === selectedId && ang !== null && !sim.model.stalled) {
    const rpm = ((ang - m.angle) / m.t) / (2 * Math.PI) * 60;
    const part = assembly.parts.get(selectedId);
    const label = findDef(part.defId)?.label ?? '';
    setStatus(`▶ ${label}: ${Math.abs(rpm) < 0.05 ? '정지' : `${rpm.toFixed(1)} rpm`}  (연결된 부모 부품 기준)`);
  }
  m.t = 0; m.id = selectedId; m.angle = ang ?? 0;
}

// ── 입력 바인딩 ─────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    const act = {
      c: copySelection, v: paste, x: cutSelection, a: selectAll,
      z: e.shiftKey ? redo : undo, y: redo,
      g: e.shiftKey ? ungroupSelection : groupSelection,
    }[k];
    if (act) { e.preventDefault(); act(); }
    return;
  }
  switch (e.key.toLowerCase()) {
    case 'r': rotateSelected(new THREE.Vector3(0, 1, 0)); break;
    case 'f': rotateSelected(new THREE.Vector3(1, 0, 0)); break;
    case 'q': moveSelectedY(e.shiftKey ? -1 : -PITCH / 2); break;
    case 'e': moveSelectedY(e.shiftKey ? 1 : PITCH / 2); break;
    case 'b': toggleBoltMode(); break;
    case ',': handCrank(-0.12); break;
    case '.': handCrank(0.12); break;
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'escape': resetSim(); break;
    case 'g': togglePin(); break;
    case '[': { const p = assembly.parts.get(selectedId); if (p?.kind === 'motor') setMotorRpm(p.motorRpm - 10); break; }
    case ']': { const p = assembly.parts.get(selectedId); if (p?.kind === 'motor') setMotorRpm(p.motorRpm + 10); break; }
    case 'delete': case 'backspace': case 'x': deleteSelected(); break;
  }
});
document.getElementById('btn-bolt').addEventListener('click', toggleBoltMode);
document.getElementById('btn-rotate').addEventListener('click', () => rotateSelected(new THREE.Vector3(0, 1, 0)));
document.getElementById('btn-tilt').addEventListener('click', () => rotateSelected(new THREE.Vector3(1, 0, 0)));
document.getElementById('btn-delete').addEventListener('click', deleteSelected);
btnPlay.addEventListener('click', togglePlay);
document.getElementById('btn-reset').addEventListener('click', resetSim);
document.getElementById('btn-pin').addEventListener('click', togglePin);

// ── 루프 ────────────────────────────────────────────────
renderPalette();
resize();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  if (sim.active && sim.playing) {
    const wasStalled = sim.model.stalled;
    sim.model.step(dt);
    sim.model.apply();
    if (sim.model.stalled && !wasStalled) setStatus('⚠ 기구 잠김 — 이 자세에서 더 못 움직여요 (링크 길이·기어비·고정 상태 확인). Esc로 원위치.');
    if (!sim.model.stalled) updateMeter(dt);
  }
  controls.update();
  renderer.render(scene, camera);
});

// 디버그/자동 테스트용 훅: ?debug 로 열었을 때만 노출
if (new URLSearchParams(location.search).has('debug')) {
  window.__boltlab = { THREE, camera, canvas, assembly, sim, selection, getSelected: () => selectedId, spawnPart, findCandidates, addConnection, select, togglePlay, resetSim };
}
