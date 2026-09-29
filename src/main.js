// BoltLab-sim — 메인
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CATALOG, findDef } from './catalog.js';
import { Assembly } from './assembly.js';
import { makeBolt, makeClipRing, THICK, PITCH } from './generators.js';

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

let selectedId = null;
let boltMode = false;
let drag = null;
let spawnIndex = 0;

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
  const def = findDef(defId);
  if (!def) return;
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
function select(id) {
  if (selectedId !== null) setEmissive(selectedId, 0x000000);
  selectedId = id;
  if (id !== null) setEmissive(id, 0x16408a);
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
      out.push({ type: 'bolt', A, B, n: B.n, mid: new THREE.Vector3().addVectors(A.p, B.p).multiplyScalar(0.5) });
    }
  }
  for (const ax of axes) {
    for (const hub of hubs) {
      if (Math.abs(ax.dir.dot(hub.n)) < PARALLEL) continue;
      const { point, t } = closestOnLine(ax.origin, ax.dir, hub.p);
      if (point.distanceTo(hub.p) > COAX_RADIAL || Math.abs(t) > ax.halfLen + 1) continue;
      if (assembly.hasLink('clip', ax.partId, hub.partId)) continue;
      out.push({ type: 'clip', axle: ax, other: hub, n: ax.dir, mid: hub.p.clone() });
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

const MARKER_COLOR = { bolt: 0xffd54a, clip: 0x4dd0e1, bearing: 0xda70d6 };

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
    ? `체결 가능 ${cands.length}곳 — 노랑=볼트, 하늘=클립(기어·축), 보라=베어링(축·판)`
    : '체결 가능한 지점이 없습니다. 구멍을 겹치거나 축을 관통시키세요.');
}

function addConnection(c) {
  let mesh, a, b, holeA = -1, holeB = -1;
  if (c.type === 'bolt') {
    mesh = makeBolt();
    mesh.position.copy(c.mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.n.clone().normalize());
    a = c.A.partId; b = c.B.partId; holeA = c.A.index; holeB = c.B.index;
  } else {
    mesh = makeClipRing(c.type === 'clip' ? 0x37474f : 0x7b4a8f);
    mesh.position.copy(c.mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), c.n.clone().normalize());
    a = c.axle.partId; b = c.other.partId;
    if (c.type === 'bearing') holeB = c.other.index;
  }
  scene.add(mesh);
  assembly.parts.get(b).root.attach(mesh);
  const conn = assembly.connect(c.type, a, b, holeA, holeB, mesh);
  mesh.userData.connId = conn.id;
  mesh.traverse(o => { o.userData.connId = conn.id; });
  refreshMarkers();
  const msg = { bolt: '볼트 체결', clip: '스프링클립 고정(기어↔축)', bearing: '베어링 연결(축↔판)' };
  setStatus(`${msg[c.type]} 완료.`);
}

// ── 드래그 & 스냅 ───────────────────────────────────────
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;

  if (boltMode) {
    setPointer(e);
    const mHits = raycaster.intersectObjects(markerGroup.children, false);
    if (mHits.length) { addConnection(mHits[0].object.userData.candidate); return; }
    const connMeshes = assembly.connections.map(c => c.mesh);
    const bHits = raycaster.intersectObjects(connMeshes, true);
    if (bHits.length) {
      const conn = assembly.disconnectByMesh(bHits[0].object);
      if (conn) { conn.mesh.parent.remove(conn.mesh); refreshMarkers(); setStatus('체결을 해제했습니다.'); }
    }
    return;
  }

  const hit = pickPart(e);
  if (!hit) { select(null); return; }
  select(hit.partId);
  const component = assembly.componentOf(hit.partId);
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
  drag = { component, basePos, plane, grabPoint: hit.point.clone(), vertical: e.shiftKey };
  controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  setPointer(e);
  const pt = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(drag.plane, pt)) return;
  const delta = new THREE.Vector3().subVectors(pt, drag.grabPoint);

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
  if (drag) { drag = null; snapRing.visible = false; controls.enabled = true; }
});

// ── 변환 조작 ───────────────────────────────────────────
function transformComponent(fn) {
  if (selectedId === null || !assembly.parts.has(selectedId)) return;
  const component = assembly.componentOf(selectedId);
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
  if (selectedId === null) return;
  const part = assembly.parts.get(selectedId);
  if (!part) return;
  for (const m of assembly.removePart(selectedId)) m.parent && m.parent.remove(m);
  partsRoot.remove(part.root);
  select(null);
  renderPalette();
  if (boltMode) refreshMarkers();
  setStatus('부품을 삭제했습니다.');
}
function toggleBoltMode() {
  boltMode = !boltMode;
  document.getElementById('btn-bolt').classList.toggle('active', boltMode);
  refreshMarkers();
  if (!boltMode) setStatus('볼트 모드 해제.');
}

// ── 회전 전달 (기어 트레인) ─────────────────────────────
// clip: 1:1 (축↔기어) / mesh: -tA/tB (맞물린 기어쌍, 동적 감지)
function spinEdges() {
  const edges = []; // {a, b, k}  ωb = ωa * k
  for (const c of assembly.connections) {
    if (c.type !== 'clip') continue;
    const na = axisOf(c.a), nb = axisOf(c.b);
    if (!na || !nb) continue;
    const s = Math.sign(na.dot(nb)) || 1;
    edges.push({ a: c.a, b: c.b, k: s }, { a: c.b, b: c.a, k: s });
  }
  const hubs = assembly.worldHubs();
  for (let i = 0; i < hubs.length; i++) for (let j = i + 1; j < hubs.length; j++) {
    const A = hubs[i], B = hubs[j];
    const dot = A.n.dot(B.n);
    if (Math.abs(dot) < PARALLEL) continue;
    const d = new THREE.Vector3().subVectors(B.p, A.p);
    if (Math.abs(d.dot(A.n)) > 3) continue; // 같은 평면
    const centerDist = d.clone().addScaledVector(A.n, -d.dot(A.n)).length();
    if (Math.abs(centerDist - (A.gear.pitchR + B.gear.pitchR)) > 1.5) continue;
    const s = Math.sign(dot) || 1;
    edges.push({ a: A.partId, b: B.partId, k: -s * A.gear.teeth / B.gear.teeth });
    edges.push({ a: B.partId, b: A.partId, k: -s * B.gear.teeth / A.gear.teeth });
  }
  return edges;
}
function axisOf(partId) {
  const part = assembly.parts.get(partId);
  if (!part || (part.kind !== 'axle' && part.kind !== 'gear')) return null;
  part.root.updateMatrixWorld(true);
  return new THREE.Vector3(0, 1, 0).transformDirection(part.root.matrixWorld);
}
function spin(delta) {
  if (selectedId === null) return;
  const start = assembly.parts.get(selectedId);
  if (!start || (start.kind !== 'axle' && start.kind !== 'gear')) {
    setStatus('축이나 기어를 선택한 뒤 , / . 키로 돌려보세요.');
    return;
  }
  const edges = spinEdges();
  const ang = new Map([[selectedId, delta]]);
  const queue = [selectedId];
  while (queue.length) {
    const cur = queue.shift();
    for (const e of edges) {
      if (e.a !== cur) continue;
      const expected = ang.get(cur) * e.k;
      if (ang.has(e.b)) {
        // 폐루프 모순 검출: 이미 정해진 각속도와 어긋나면 트레인 전체 잠김
        if (Math.abs(ang.get(e.b) - expected) > Math.abs(delta) * 1e-3) {
          setStatus('⚠ 기어 트레인 잠김 — 폐루프의 기어비가 서로 맞지 않습니다.');
          return;
        }
        continue;
      }
      ang.set(e.b, expected);
      queue.push(e.b);
    }
  }
  for (const [id, a] of ang) {
    const p = assembly.parts.get(id);
    if (p && p.spinner) p.spinner.rotation.y += a;
  }
  if (ang.size > 1) setStatus(`회전 전달: ${ang.size}개 부품 (감속비 반영)`);
}

// ── 입력 바인딩 ─────────────────────────────────────────
window.addEventListener('keydown', e => {
  switch (e.key.toLowerCase()) {
    case 'r': rotateSelected(new THREE.Vector3(0, 1, 0)); break;
    case 'f': rotateSelected(new THREE.Vector3(1, 0, 0)); break;
    case 'q': moveSelectedY(e.shiftKey ? -1 : -PITCH / 2); break;
    case 'e': moveSelectedY(e.shiftKey ? 1 : PITCH / 2); break;
    case 'b': toggleBoltMode(); break;
    case ',': spin(-0.12); break;
    case '.': spin(0.12); break;
    case 'delete': case 'backspace': case 'x': deleteSelected(); break;
  }
});
document.getElementById('btn-bolt').addEventListener('click', toggleBoltMode);
document.getElementById('btn-rotate').addEventListener('click', () => rotateSelected(new THREE.Vector3(0, 1, 0)));
document.getElementById('btn-tilt').addEventListener('click', () => rotateSelected(new THREE.Vector3(1, 0, 0)));
document.getElementById('btn-delete').addEventListener('click', deleteSelected);

// ── 루프 ────────────────────────────────────────────────
renderPalette();
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
