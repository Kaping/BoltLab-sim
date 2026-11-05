// BoltLab-sim — 메인
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATALOG, findDef } from './catalog.js';
import { Assembly } from './assembly.js';
import { makeBolt, makeClipRing, makeTireMesh, THICK, PITCH } from './generators.js';
import { KinematicModel } from './kinematics.js';
import { makeChainMesh, updateChainMesh, makeBeltMesh, updateBeltMesh } from './chain.js';
import { encodePreset, decodePreset, toPresetObject } from './preset.js';

const SNAP_DIST = 6;      // 스냅 흡착 거리(mm)
const COAX_RADIAL = 1.0;  // 동축(축-구멍) 체결 허용 반경 오차
const PARALLEL = 0.95;    // 축 평행 판정 |dot|
const CHAIN_PLANE_TOL = 3;   // 체인기어 두 개가 같은 평면으로 볼 축방향 어긋남(mm)
const MOTOR_ALIGN_DIST = 12; // 기어·축을 모터 출력축에 자동 정렬해 붙이는 거리(드래그 평면 기준, mm)

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
const sim = { active: false, playing: false, blocked: false, model: null, meter: { t: 0, id: null, angle: 0 } };

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
  if (toggle && !sim.active) { // 체인기어/풀리 두 개를 고르면 체인·고무줄 연결 안내
    const hubs = assembly.worldHubs(i => selection.has(i));
    const type = hubs.length === 2 ? wrapTypeOf(hubs[0], hubs[1]) : null;
    if (selection.size === 2 && type && !assembly.hasLink(type, hubs[0].partId, hubs[1].partId)) {
      const { why } = wrapCheck(hubs[0], hubs[1]);
      const nm = type === 'chain' ? '체인기어' : '풀리';
      setStatus(why ? `${nm} 2개 선택됨 — 아직 ${WRAP_LABEL[type]}을 못 걸어요: ${why}` : `${nm} 2개 선택됨 — C 를 누르면 ${WRAP_LABEL[type]}이 연결돼요.`);
    }
  }
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
  // 기어 허브를 모터 출력축에 직접 끼움 → 'drive' (a = 기어, b = 모터)
  for (const ax of axes) {
    if (!ax.motor) continue;
    for (const hub of hubs) {
      if (!hub.gear) continue;
      if (Math.abs(ax.dir.dot(hub.n)) < PARALLEL) continue;
      const { point, t } = closestOnLine(ax.origin, ax.dir, hub.p);
      if (point.distanceTo(hub.p) > COAX_RADIAL || Math.abs(t) > ax.halfLen + 3) continue;
      if (assembly.hasLink('drive', hub.partId, ax.partId)) continue;
      out.push({ type: 'drive', axle: { partId: hub.partId }, other: { partId: ax.partId }, n: ax.dir, mid: hub.p.clone() });
    }
  }
  // 장공 볼트: 다른 부품의 구멍이 장공 중심선 위에 겹침 → 'slot' (미끄럼 + 회전)
  for (const S of assembly.worldSlots()) {
    for (const H of holes) {
      if (H.partId === S.partId || Math.abs(S.n.dot(H.n)) < PARALLEL) continue;
      const d = new THREE.Vector3().subVectors(H.p, S.a);
      const axial = Math.abs(d.dot(S.n));
      const along = d.dot(S.u);
      const radial = d.addScaledVector(S.u, -along).addScaledVector(S.n, -d.dot(S.n)).length();
      if (radial > COAX_RADIAL || along < -0.5 || along > S.len + 0.5 || axial > (S.t + H.t) / 2 + 0.6) continue;
      if (assembly.hasConnection('slot', S.partId, S.index, H.partId, H.index)) continue;
      out.push({ type: 'slot', S, H, n: H.n, mid: H.p.clone() });
    }
  }
  // 체인(체인기어 두 개) / 고무줄(풀리 두 개): 같은 평면·평행
  const wheels = hubs.filter(h => h.gear?.chain || h.gear?.belt);
  for (let i = 0; i < wheels.length; i++) for (let k = i + 1; k < wheels.length; k++) {
    const A = wheels[i], B = wheels[k];
    const { type, why } = wrapCheck(A, B);
    if (!type || why || A.partId === B.partId || assembly.hasLink(type, A.partId, B.partId)) continue;
    out.push({ type, axle: { partId: A.partId }, other: { partId: B.partId }, n: A.n, mid: A.p.clone().add(B.p).multiplyScalar(0.5) });
  }
  for (const ax of axes) {
    if (ax.motor) continue;
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

const MARKER_COLOR = { bolt: 0xffd54a, clip: 0x4dd0e1, bearing: 0xda70d6, drive: 0x7cff6b, chain: 0xff5c8a, belt: 0xffa040, slot: 0xc6ff00 };

// ── 감기 전동: 체인(체인기어↔체인기어) / 고무줄(풀리↔풀리) ──
const WRAP = new Set(['chain', 'belt']);
const WRAP_LABEL = { chain: '체인', belt: '고무줄' };
function wrapTypeOf(A, B) {
  if (A.gear?.chain && B.gear?.chain) return 'chain';
  if (A.gear?.belt && B.gear?.belt) return 'belt';
  return null;
}
// 두 허브(worldHubs 항목)를 감을 수 있는지 → { type, why } (why = 문제 이유, 괜찮으면 null)
function wrapCheck(A, B) {
  const type = wrapTypeOf(A, B);
  if (!type) return { type, why: '체인기어끼리(체인) 또는 풀리끼리(고무줄)만 이을 수 있어요' };
  const nm = type === 'chain' ? '체인기어' : '풀리';
  const why = (() => {
    if (type === 'belt' && (assembly.parts.get(A.partId)?.tire || assembly.parts.get(B.partId)?.tire)) return '타이어를 씌운 풀리엔 고무줄을 못 걸어요 (T 로 타이어 벗기기)';
    if (Math.abs(A.n.dot(B.n)) < PARALLEL) return `두 ${nm}의 축 방향이 달라요 (R/F 로 같은 방향으로)`;
    const d = new THREE.Vector3().subVectors(B.p, A.p);
    if (Math.abs(d.dot(A.n)) > CHAIN_PLANE_TOL) return `두 ${nm}가 같은 평면에 있지 않아요 (축방향 ${Math.abs(d.dot(A.n)).toFixed(1)}mm 어긋남, Q/E 로 맞추기)`;
    const cd = d.addScaledVector(A.n, -d.dot(A.n)).length();
    const rA = A.gear.outerR ?? A.gear.pitchR, rB = B.gear.outerR ?? B.gear.pitchR;
    if (cd < rA + rB + 3) return `두 ${nm}가 너무 가까워요`;
    return null;
  })();
  return { type, why };
}
function connectChainSelected() {
  if (sim.active) return;
  const hubs = assembly.worldHubs(id => selection.has(id));
  if (hubs.length !== 2) { setStatus('체인기어 두 개(체인) 또는 풀리 두 개(고무줄)를 Ctrl+클릭으로 선택한 뒤 C 를 누르세요.'); return; }
  const [A, B] = hubs;
  const { type, why } = wrapCheck(A, B);
  if (why) { setStatus(`${type ? WRAP_LABEL[type] : '연결'} 불가 — ${why}`); return; }
  if (assembly.hasLink(type, A.partId, B.partId)) { setStatus(`이미 ${WRAP_LABEL[type]}로 연결돼 있어요.`); return; }
  addConnection({ type, axle: { partId: A.partId }, other: { partId: B.partId } });
}
// 체인 링크·고무줄을 현재 바퀴 위치(+시뮬 중이면 흐른 거리)에 맞춰 다시 배치
function updateChains() {
  for (const c of assembly.connections) {
    if (!WRAP.has(c.type)) continue;
    const A = assembly.parts.get(c.a), B = assembly.parts.get(c.b);
    if (!A || !B) continue;
    const cA = A.root.getWorldPosition(new THREE.Vector3()), cB = B.root.getWorldPosition(new THREE.Vector3());
    const n = new THREE.Vector3(0, 1, 0).transformDirection(A.root.matrixWorld);
    const phase = sim.active && sim.model ? sim.model.chainPhase(c.id) : 0;
    (c.type === 'chain' ? updateChainMesh : updateBeltMesh)(c.mesh, cA, A.gear.pitchR, cB, B.gear.pitchR, n, phase);
  }
}

// ── 타이어 (T): 풀리에 고무 타이어를 씌워 바퀴로 ──
function setTire(part, on) {
  if (on && !part.tire) {
    part.tire = makeTireMesh(part.tireSpec, part.gear.outerR);
    part.tire.traverse(o => { o.userData.partId = part.id; });
    part.spinner.add(part.tire);
  } else if (!on && part.tire) {
    part.spinner.remove(part.tire);
    part.tire = null;
  }
}
function toggleTire() {
  if (sim.active) return;
  const pulleys = [...selection].map(id => assembly.parts.get(id)).filter(p => p && p.tireSpec !== undefined);
  if (!pulleys.length) { setStatus('타이어: 풀리를 선택하고 T 를 누르세요.'); return; }
  const fit = pulleys.filter(p => p.tireSpec);
  if (!fit.length) { setStatus('풀리(대) Ø76 에 맞는 타이어는 6호에 없어요 (풀리 중·소·타이어풀리에 씌울 수 있어요).'); return; }
  const on = !fit[0].tire; // 첫 풀리 기준으로 일괄 씌우기/벗기기
  const belted = fit.filter(p => assembly.connections.some(c => c.type === 'belt' && (c.a === p.id || c.b === p.id)));
  if (on && belted.length) { setStatus('고무줄이 걸린 풀리엔 타이어를 못 씌워요 — B 모드에서 고무줄을 먼저 풀어 주세요.'); return; }
  pushUndo();
  for (const p of fit) setTire(p, on);
  setStatus(on ? `타이어 씌움 — ${[...new Set(fit.map(p => p.tireSpec.name))].join(', ')} (T 다시 누르면 벗김)` : '타이어를 벗겼어요.');
}

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
    ? `체결 가능 ${cands.length}곳 — 노랑=볼트(Shift+클릭: 회전볼트), 하늘=클립, 보라=베어링, 초록=모터 연결, 분홍=체인, 주황=고무줄, 라임=장공(미끄럼)`
    : '체결 가능한 지점이 없습니다. 구멍을 겹치거나 축을 관통시키세요.');
}

function makeConnMesh(type) {
  if (type === 'chain') return makeChainMesh();
  if (type === 'belt') return makeBeltMesh();
  if (type === 'bolt' || type === 'pivot') {
    const mesh = makeBolt();
    if (type === 'pivot') mesh.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.setHex(0xff8a3d); } });
    return mesh;
  }
  if (type === 'slot') { // 장공 속 볼트: 라임색
    const mesh = makeBolt();
    mesh.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.setHex(0x9ccc28); } });
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
  } else if (c.type === 'slot') { // 볼트는 구멍 쪽(b) 부품에 붙어서 장공을 따라 움직임
    mesh = makeConnMesh('slot');
    mesh.position.copy(c.mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.n.clone().normalize());
    a = c.S.partId; holeA = c.S.index; b = c.H.partId; holeB = c.H.index;
  } else if (WRAP.has(c.type)) { // 체인·고무줄 메시는 월드 좌표(씬 직속), updateChains 가 배치
    mesh = makeConnMesh(c.type);
    a = c.axle.partId; b = c.other.partId;
  } else {
    mesh = makeConnMesh(c.type);
    mesh.position.copy(c.mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), c.n.clone().normalize());
    a = c.axle.partId; b = c.other.partId;
    if (c.type === 'bearing') holeB = c.other.index;
  }
  scene.add(mesh);
  if (!WRAP.has(type)) assembly.parts.get(b).root.attach(mesh);
  registerConnection(type, a, b, holeA, holeB, mesh);
  if (WRAP.has(type)) updateChains();
  refreshMarkers();
  const msg = { bolt: '볼트 고정', pivot: '회전볼트 체결(두 부품이 이 구멍을 축으로 돌 수 있음)', clip: '스프링클립 고정 — 이제 기어가 이 축과 같이 돌아요', bearing: '베어링 연결 — 축은 판 구멍에서 자유롭게 돌아요(위치만 잡음)', drive: '모터 축에 고정 — 모터가 이걸 돌립니다', chain: '체인 연결 — 두 체인기어가 같은 방향으로 잇수비만큼 돌아요', belt: '고무줄 연결 — 두 풀리가 같은 방향으로 지름비만큼 돌아요', slot: '장공 볼트 — 볼트가 장공을 따라 미끄러지고 돌 수 있어요 (볼트 2개면 직선으로만 미끄러짐: 피스톤)' };
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
  const baseQuat = new Map();
  for (const id of component) {
    basePos.set(id, assembly.parts.get(id).root.position.clone());
    baseQuat.set(id, assembly.parts.get(id).root.quaternion.clone());
  }

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
  drag = { component, basePos, baseQuat, lead: hit.partId, plane, grabPoint: hit.point.clone(), vertical: e.shiftKey, snap: serialize(), moved: false };
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
    const root = assembly.parts.get(id).root;
    root.position.copy(drag.basePos.get(id)).add(delta);
    root.quaternion.copy(drag.baseQuat.get(id)); // 모터 축 자동 정렬은 매 프레임 새로 계산
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
  const mSlots = assembly.worldSlots(inComp);
  const fSlots = assembly.worldSlots(outComp);

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
  // 1b) 구멍 ↔ 장공: 장공 중심선 위 가장 가까운 점으로 (면접촉 오프셋)
  const onSeg = (S, p) => S.a.clone().addScaledVector(S.u, Math.min(S.len, Math.max(0, new THREE.Vector3().subVectors(p, S.a).dot(S.u))));
  for (const m of mHoles) for (const f of fSlots) {
    if (Math.abs(m.n.dot(f.n)) < PARALLEL) continue;
    const q = onSeg(f, m.p);
    const side = new THREE.Vector3().subVectors(m.p, q).dot(f.n) >= 0 ? 1 : -1;
    const target = q.clone().addScaledVector(f.n, side * (m.t + f.t) / 2);
    consider(target.distanceTo(m.p), new THREE.Vector3().subVectors(target, m.p), q, f.n);
  }
  for (const m of mSlots) for (const f of fHoles) {
    if (Math.abs(m.n.dot(f.n)) < PARALLEL) continue;
    const q = onSeg(m, f.p);
    const side = new THREE.Vector3().subVectors(q, f.p).dot(f.n) >= 0 ? 1 : -1;
    const target = f.p.clone().addScaledVector(f.n, side * (m.t + f.t) / 2);
    consider(target.distanceTo(q), new THREE.Vector3().subVectors(target, q), f.p, f.n);
  }
  // 2) (이동측) 구멍·허브 ↔ (고정측) 축선: 축에 꿰기
  for (const m of [...mHoles, ...mHubs]) {
    for (const ax of fAxes) {
      if (ax.motor && (m.index !== undefined || m.motor)) continue; // 모터 축엔 기어 허브만
      if (Math.abs(m.n.dot(ax.dir)) < PARALLEL) continue;
      const { point, t } = closestOnLine(ax.origin, ax.dir, m.p);
      if (Math.abs(t) > ax.halfLen + 2) continue;
      consider(point.distanceTo(m.p), new THREE.Vector3().subVectors(point, m.p), point, ax.dir);
    }
  }
  // 3) (이동측) 축선 ↔ (고정측) 구멍·허브
  for (const ax of mAxes) {
    for (const f of [...fHoles, ...fHubs]) {
      if (ax.motor && !f.gear) continue; // 움직이는 모터 축은 기어 허브에만 스냅
      if (Math.abs(ax.dir.dot(f.n)) < PARALLEL) continue;
      const { point, t } = closestOnLine(ax.origin, ax.dir, f.p);
      if (Math.abs(t) > ax.halfLen + 2) continue;
      consider(point.distanceTo(f.p), new THREE.Vector3().subVectors(f.p, point), f.p, f.n);
    }
  }

  // 4) 잡은 기어·축 ↔ (고정측) 모터 출력축: 방향이 달라도 자동으로 눕혀/세워 끼움.
  //    모터 축은 가로·높은 위치라, 드래그 평면 위 거리만 보고(높이차 무시) 축 높이로 끌어올린다.
  let align = null;
  const lead = assembly.parts.get(drag.lead);
  if (lead && (lead.kind === 'gear' || lead.kind === 'axle')) {
    lead.root.updateMatrixWorld(true);
    const P = lead.root.getWorldPosition(new THREE.Vector3());
    const n = new THREE.Vector3(0, 1, 0).transformDirection(lead.root.matrixWorld);
    for (const ax of fAxes) {
      if (!ax.motor || Math.abs(n.dot(ax.dir)) >= PARALLEL) continue; // 평행이면 위 1)~3)이 처리
      const { point, t } = closestOnLine(ax.origin, ax.dir, P);
      if (Math.abs(t) > ax.halfLen + 2) continue;
      const diff = new THREE.Vector3().subVectors(point, P);
      const planar = diff.clone().addScaledVector(drag.plane.normal, -diff.dot(drag.plane.normal)).length();
      if (planar < MOTOR_ALIGN_DIST && (!align || planar < align.dist)) align = { dist: planar, ax, point, P, n };
    }
  }
  if (align) {
    const { ax, point, P, n } = align;
    const q = new THREE.Quaternion().setFromUnitVectors(n, n.dot(ax.dir) >= 0 ? ax.dir : ax.dir.clone().negate());
    for (const id of drag.component) { // P(잡은 부품 중심) 기준 회전 후 축선 위로 이동
      const root = assembly.parts.get(id).root;
      root.position.sub(P).applyQuaternion(q).add(point);
      root.quaternion.premultiply(q);
    }
    orientRing(snapRing, point, ax.dir);
    snapRing.visible = true;
  } else if (best) {
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
    return { defId: p.defId, pos: p.root.position.toArray(), quat: p.root.quaternion.toArray(), rpm: p.motorRpm, group: p.group, tire: p.tire ? 1 : undefined };
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
    for (const c of assembly.connections) if (WRAP.has(c.type)) c.mesh.parent?.remove(c.mesh);
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
    if (q.tire && part.tireSpec) setTire(part, true);
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
    if (WRAP.has(c.type)) scene.add(mesh); // 체인·고무줄은 월드 좌표, 매 프레임 재배치
    else assembly.parts.get(ids[c.b]).root.add(mesh); // 연결 메시는 b 부품 기준 로컬 좌표
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
  sim.blocked = sim.model.warnings.some(w => w.blocking);
  setStatus(`시뮬 시작 — 강체 ${m.bodies} · 회전축 ${m.joints} · 자유도 ${m.dof} · 폐루프 ${m.loops} · 모터 ${m.motors} · 기어쌍 ${m.gears} · 체인/고무줄 ${m.chains}`
    + (m.motors ? '' : '  |  모터가 없어요: 축·기어를 선택하고 , / . 로 손으로 돌려보세요')
    + (sim.model.warnings.some(w => w.type === 'mesh-no-carrier' && !w.blocking) ? '  |  ⚠ 맞물렸지만 받침(프레임)이 이어지지 않은 기어쌍이 있어 그 기어는 연동 안 됨' : '')
    + (sim.model.warnings.some(w => w.type === 'chain-separate-ground') ? '  |  ℹ 체인/고무줄 양쪽(모터·프레임)이 볼트로 안 이어져 있어 둘 다 바닥에 고정된 것으로 보고 돌려요 — 실물에선 볼트로 묶어야 해요' : ''));
}
function togglePlay() {
  if (!sim.active) startSim();
  if (sim.blocked) {
    const w = sim.model.warnings.find(x => x.blocking);
    resetSim();
    if (w.type === 'chain-no-carrier') {
      setStatus('⚠ 체인/고무줄로 이은 두 바퀴가 같은 프레임에 받쳐져 있지 않아요 — 각 체인기어·풀리의 축을 같은 프레임 구멍에 베어링(보라)으로 꽂고, 바퀴는 축에 클립(하늘)으로 고정하세요.');
      return;
    }
    setStatus(w.type === 'mesh-no-carrier'
      ? '⚠ 모터가 프레임에 고정되어 있지 않아요 — 모터 축의 기어와 맞물린 기어가 있는데 둘을 잇는 프레임이 없어서 기어가 안 돌아요. B → 모터 받침판 구멍을 프레임 구멍에 볼트(노랑)로 체결하거나 Ctrl+G 로 그룹 고정하세요.'
      : '⚠ 모터가 프레임에 고정되어 있지 않아요 — 이대로면 모터 대신 프레임이 통째로 돌아요. B → 모터 받침판 구멍을 프레임 구멍에 볼트(노랑)로 체결하거나 Ctrl+G 로 그룹 고정하세요.');
    return;
  }
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
  sim.blocked = false;
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
  if (e.target.closest?.('input, textarea, dialog')) return; // 코드 입력·대화상자 안에서는 단축키 끔
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
    case 'c': connectChainSelected(); break;
    case 'h': toggleHelp(); break;
    case 't': toggleTire(); break;
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
document.getElementById('btn-chain').addEventListener('click', connectChainSelected);
document.getElementById('btn-help').addEventListener('click', () => toggleHelp());
document.getElementById('btn-export').addEventListener('click', openExport);
document.getElementById('btn-import').addEventListener('click', openImport);
document.getElementById('btn-rotate').addEventListener('click', () => rotateSelected(new THREE.Vector3(0, 1, 0)));
document.getElementById('btn-tilt').addEventListener('click', () => rotateSelected(new THREE.Vector3(1, 0, 0)));
document.getElementById('btn-delete').addEventListener('click', deleteSelected);
btnPlay.addEventListener('click', togglePlay);
document.getElementById('btn-reset').addEventListener('click', resetSim);
document.getElementById('btn-pin').addEventListener('click', togglePin);

// ── 도움말 접기 (기본: 접힘, 브라우저에 기억) ──────────────
const helpEl = document.getElementById('help');
const btnHelp = document.getElementById('btn-help');
function toggleHelp(open = helpEl.hidden) {
  helpEl.hidden = !open;
  btnHelp.classList.toggle('active', open);
  btnHelp.textContent = open ? '✕ 도움말 닫기' : '❔ 도움말';
  try { localStorage.setItem('boltlab.help', open ? '1' : '0'); } catch {}
}
{ let open = false; try { open = localStorage.getItem('boltlab.help') === '1'; } catch {} toggleHelp(open); }

// ── 내보내기 / 불러오기 ─────────────────────────────────
const ioDialog = document.getElementById('io-dialog');
const ioText = document.getElementById('io-text');
const ioMsg = document.getElementById('io-msg');
const ioFileInput = document.getElementById('io-file-input');
const ioShow = (id, on) => { document.getElementById(id).hidden = !on; };
const setIoMsg = (t, err = false) => { ioMsg.textContent = t; ioMsg.classList.toggle('err', err); };

async function openExport() {
  if (assembly.parts.size === 0) { setStatus('내보낼 부품이 없어요.'); return; }
  const data = serialize();
  ioDialog.dataset.mode = 'export';
  document.getElementById('io-title').textContent = '📤 구조물 내보내기';
  document.getElementById('io-desc').textContent = '아래 코드를 복사해 두거나 파일로 저장하세요. 나중에 📥 불러오기에 붙여넣거나 파일을 열면 그대로 복원돼요.';
  ioShow('io-copy', true); ioShow('io-save', true); ioShow('io-file', false); ioShow('io-load', false);
  ioText.readOnly = true;
  ioText.value = '코드 만드는 중…';
  setIoMsg('');
  ioDialog.showModal();
  ioText.value = await encodePreset(data);
  setIoMsg(`부품 ${data.parts.length}개 · 체결 ${data.conns.length}개 · 코드 ${ioText.value.length.toLocaleString()}자`);
  ioText.select();
}
function openImport() {
  if (sim.active) resetSim();
  ioDialog.dataset.mode = 'import';
  document.getElementById('io-title').textContent = '📥 구조물 불러오기';
  document.getElementById('io-desc').textContent = '내보내기 코드(BL1.…)를 붙여넣거나 저장한 파일을 고르세요. 지금 화면의 구조물은 바뀌고, Ctrl+Z 로 되돌릴 수 있어요.';
  ioShow('io-copy', false); ioShow('io-save', false); ioShow('io-file', true); ioShow('io-load', true);
  ioText.readOnly = false;
  ioText.value = '';
  ioText.placeholder = 'BL1.… 코드를 여기에 붙여넣기';
  setIoMsg('');
  ioDialog.showModal();
  ioText.focus();
}
// 부품 정의별 구멍·장공 개수 (불러오기 검사용, 모르는 부품이면 null)
const holeCounts = new Map();
function holeCountOf(defId) {
  if (!holeCounts.has(defId)) {
    const def = findDef(defId), made = def?.make();
    holeCounts.set(defId, made ? { holes: (made.holes || []).length, slots: (made.slots || []).length } : null);
  }
  return holeCounts.get(defId);
}
// 텍스트(코드 또는 파일 JSON) → 장면 교체. 성공하면 true.
async function importPresetText(text, source = '코드') {
  let data;
  try { data = await decodePreset(text, holeCountOf); } catch (err) { return { ok: false, msg: err.message }; }
  if (data.parts.length === 0) return { ok: false, msg: '불러올 부품이 없어요' };
  if (sim.active) resetSim();
  pushUndo();
  const ids = deserialize(data, { replace: true });
  selectMany([]);
  const extra = data.skipped.length ? ` (모르는 부품 ${data.skipped.length}개는 건너뜀: ${[...new Set(data.skipped)].join(', ')})` : '';
  setStatus(`${source}에서 부품 ${ids.length}개 · 체결 ${data.conns.length}개를 불러왔어요${extra}. Ctrl+Z 로 되돌리기.`);
  return { ok: true };
}
async function importFile(file) {
  if (!file) return;
  if (file.size > 5e6) { setStatus('파일이 너무 커요 (5MB 이하).'); return { ok: false, msg: '파일이 너무 커요 (5MB 이하)' }; }
  const res = await importPresetText(await file.text(), `파일 ${file.name}`);
  if (!res.ok) setStatus(`불러오기 실패 — ${res.msg}`);
  return res;
}
document.getElementById('io-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(ioText.value); setIoMsg('복사했어요 ✓'); }
  catch { ioText.select(); setIoMsg('자동 복사가 막혔어요 — 선택된 코드를 Ctrl+C 로 복사하세요', true); }
});
document.getElementById('io-save').addEventListener('click', () => {
  const json = JSON.stringify(toPresetObject(serialize()), null, 1);
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  const name = `boltlab-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.boltlab.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setIoMsg(`${name} 로 저장했어요 ✓`);
});
document.getElementById('io-file').addEventListener('click', () => ioFileInput.click());
ioFileInput.addEventListener('change', async () => {
  const res = await importFile(ioFileInput.files[0]);
  ioFileInput.value = '';
  if (res?.ok) ioDialog.close(); else if (res) setIoMsg(res.msg, true);
});
document.getElementById('io-load').addEventListener('click', async () => {
  if (!ioText.value.trim()) { setIoMsg('코드를 붙여넣어 주세요', true); return; }
  const res = await importPresetText(ioText.value);
  if (res.ok) ioDialog.close(); else setIoMsg(res.msg, true);
});
document.getElementById('io-close').addEventListener('click', () => ioDialog.close());
// 파일을 화면에 끌어놓기
const mainEl = document.getElementById('main');
mainEl.addEventListener('dragover', e => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault(); document.body.classList.add('drop-hover');
});
mainEl.addEventListener('dragleave', e => { if (!mainEl.contains(e.relatedTarget)) document.body.classList.remove('drop-hover'); });
mainEl.addEventListener('drop', e => {
  e.preventDefault(); document.body.classList.remove('drop-hover');
  importFile(e.dataTransfer.files[0]);
});

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
  updateChains();
  controls.update();
  renderer.render(scene, camera);
});

// 디버그/자동 테스트용 훅: ?debug 로 열었을 때만 노출
if (new URLSearchParams(location.search).has('debug')) {
  window.__boltlab = { THREE, camera, canvas, assembly, sim, selection, getSelected: () => selectedId, spawnPart, findCandidates, addConnection, select, togglePlay, resetSim };
}
