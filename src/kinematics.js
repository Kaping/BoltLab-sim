// 기구학(동작) 시뮬레이션
//
// 모델
//  - 강체(body): bolt / clip 으로 묶인 부품 덩어리 (union-find)
//  - 회전 조인트: bearing(축↔판) / pivot(회전볼트, 판↔판) / drive(모터 출력↔축)
//  - 구속: 폐루프 조인트(점 일치 + 축 평행), 모터 목표각, 기어 맞물림(잇수비), 손 구동
//
// 풀이
//  - 조인트 그래프의 신장 트리 조인트 각도 q 가 변수, 나머지 조인트는 폐루프 구속
//  - 모든 구속을 잔차 벡터로 두고 감쇠 최소자승(LM, 수치 야코비안)으로 매 스텝 풀이
//  - 잔차가 안 줄면 "잠김" → 이번 스텝 되돌림
//
// 좌표 규약: D[body] = 시뮬 시작(휴지) 자세 → 현재 자세로 가는 변위 행렬(월드).
//            부품 월드 행렬 = D[body] · rest[part]

import * as THREE from 'three';

const RIGID = new Set(['bolt', 'clip']);
const JOINT = new Set(['bearing', 'pivot', 'drive']);
const W_AXIS = 30;       // 축 평행 잔차 가중치 (mm 환산)
const W_ANG = 40;        // 각도 잔차 가중치 (mm/rad)
const STALL_TOL = 0.25;  // 잠김 판정 잔차(mm)
const PARALLEL = 0.95;

// ── 작은 선형대수 ──
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) continue;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const maxAbs = r => r.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

function anyPerp(n) {
  const u = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  return u.sub(n.clone().multiplyScalar(u.dot(n))).normalize();
}

// 점 p, 방향 n 인 축 둘레 θ 회전(월드) 행렬
function rotAbout(out, p, n, theta) {
  out.makeRotationAxis(n, theta);
  const e = out.elements;
  const rx = e[0] * p.x + e[4] * p.y + e[8] * p.z;
  const ry = e[1] * p.x + e[5] * p.y + e[9] * p.z;
  const rz = e[2] * p.x + e[6] * p.y + e[10] * p.z;
  out.setPosition(p.x - rx, p.y - ry, p.z - rz);
  return out;
}

export class KinematicModel {
  // opts: { pinnedPart, motorRpm(partId) }
  constructor(assembly, opts = {}) {
    this.assembly = assembly;
    this.opts = opts;
    this.time = 0;
    this.stalled = false;
    this.substeps = 1;
    this.manual = new Map(); // bodyIndex -> { joint, target, meas }
    this._build();
  }

  // ── 모델 구성 ──
  _build() {
    const asm = this.assembly;
    const ids = [...asm.parts.keys()];

    // 휴지 자세 저장
    this.rest = new Map();
    for (const id of ids) {
      const r = asm.parts.get(id).root;
      r.updateMatrixWorld(true);
      this.rest.set(id, r.matrixWorld.clone());
    }

    // 강체 묶기 (union-find)
    const parent = new Map(ids.map(i => [i, i]));
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const c of asm.connections) if (RIGID.has(c.type)) parent.set(find(c.a), find(c.b));

    const rootToBody = new Map();
    this.bodies = [];            // [{ parts: [partId] }]
    this.bodyOf = new Map();     // partId -> bodyIndex
    for (const id of ids) {
      const r = find(id);
      if (!rootToBody.has(r)) { rootToBody.set(r, this.bodies.length); this.bodies.push({ parts: [] }); }
      const b = rootToBody.get(r);
      this.bodies[b].parts.push(id);
      this.bodyOf.set(id, b);
    }

    // 조인트
    this.joints = [];
    const worldHole = (partId, idx) => {
      const h = asm.parts.get(partId).holes[idx];
      const m = this.rest.get(partId);
      return { p: h.p.clone().applyMatrix4(m), n: h.n.clone().transformDirection(m) };
    };
    const axleAxis = partId => {
      const m = this.rest.get(partId);
      return { o: new THREE.Vector3().setFromMatrixPosition(m), n: new THREE.Vector3(0, 1, 0).transformDirection(m) };
    };
    for (const c of asm.connections) {
      if (!JOINT.has(c.type)) continue;
      let a, b, p, n;
      if (c.type === 'bearing') {
        const hole = worldHole(c.b, c.holeB);
        const ax = axleAxis(c.a);
        a = this.bodyOf.get(c.b); b = this.bodyOf.get(c.a); // 판 → 축
        n = ax.n; p = ax.o.clone().addScaledVector(n, hole.p.clone().sub(ax.o).dot(n));
      } else if (c.type === 'pivot') {
        const A = worldHole(c.a, c.holeA), B = worldHole(c.b, c.holeB);
        a = this.bodyOf.get(c.a); b = this.bodyOf.get(c.b);
        p = A.p.clone().add(B.p).multiplyScalar(0.5); n = B.n.clone().normalize();
      } else { // drive: c.a = 축, c.b = 모터
        const motor = asm.parts.get(c.b);
        const m = this.rest.get(c.b);
        a = this.bodyOf.get(c.b); b = this.bodyOf.get(c.a); // 모터 → 축
        p = motor.output.p.clone().applyMatrix4(m);
        n = motor.output.n.clone().transformDirection(m);
      }
      if (a === b) continue; // 같은 강체 안: 의미 없음
      this.joints.push({ type: c.type, conn: c, a, b, p, n: n.normalize(), motorPart: c.type === 'drive' ? c.b : null });
    }

    // 신장 트리 (조인트 그래프)
    const adj = this.bodies.map(() => []);
    this.joints.forEach((j, k) => { adj[j.a].push(k); adj[j.b].push(k); });
    const pinnedBody = this.opts.pinnedPart != null ? this.bodyOf.get(this.opts.pinnedPart) : undefined;
    const visited = new Array(this.bodies.length).fill(false);
    this.order = [];   // [{ parent, child, joint, sign, v }]
    this.roots = [];
    this.loopJoints = [];
    const treeJoint = new Set();
    let nv = 0;

    const comps = [];
    {
      const seen = new Array(this.bodies.length).fill(false);
      for (let s = 0; s < this.bodies.length; s++) {
        if (seen[s]) continue;
        const comp = []; const st = [s]; seen[s] = true;
        while (st.length) {
          const x = st.pop(); comp.push(x);
          for (const k of adj[x]) { const j = this.joints[k]; const y = j.a === x ? j.b : j.a; if (!seen[y]) { seen[y] = true; st.push(y); } }
        }
        comps.push(comp);
      }
    }
    for (const comp of comps) {
      // 루트(고정) 우선순위: 사용자 고정 > 모터 몸체가 붙은 강체 > 조인트가 가장 많은 강체 > 부품 수
      const hasMotor = x => this.bodies[x].parts.some(id => asm.parts.get(id).kind === 'motor');
      const score = x => (hasMotor(x) ? 1e6 : 0) + adj[x].length * 1e3 + this.bodies[x].parts.length;
      const root = comp.includes(pinnedBody) ? pinnedBody
        : comp.reduce((best, x) => (score(x) > score(best) ? x : best), comp[0]);
      this.roots.push(root);
      visited[root] = true;
      const queue = [root];
      while (queue.length) {
        const x = queue.shift();
        for (const k of adj[x]) {
          if (treeJoint.has(k)) continue;
          const j = this.joints[k];
          const y = j.a === x ? j.b : j.a;
          if (visited[y]) continue;
          visited[y] = true;
          treeJoint.add(k);
          this.order.push({ parent: x, child: y, joint: k, sign: j.a === x ? 1 : -1, v: nv++ });
          queue.push(y);
        }
      }
    }
    this.joints.forEach((j, k) => { if (!treeJoint.has(k)) this.loopJoints.push(k); });
    this.treeParentJoint = new Map(this.order.map(o => [o.child, o]));
    this.q = new Array(nv).fill(0);

    // 각도 측정 항목 (펼침 기준값 refs)
    this.meas = [];      // [{ body, carrier, n, u }]
    const addMeas = (body, carrier, n, p) => {
      this.meas.push({ body, carrier, n: n.clone(), u: anyPerp(n), p: p.clone() });
      return this.meas.length - 1;
    };

    // 모터
    this.drives = this.joints.filter(j => j.type === 'drive').map(j => ({
      joint: j, meas: addMeas(j.b, j.a, j.n, j.p), target: 0,
    }));

    // 기어 맞물림
    this.gears = [];
    const gearParts = [...asm.parts.values()].filter(p => p.kind === 'gear');
    const gInfo = gearParts.map(g => {
      const m = this.rest.get(g.id);
      return { id: g.id, body: this.bodyOf.get(g.id), c: new THREE.Vector3().setFromMatrixPosition(m),
        n: new THREE.Vector3(0, 1, 0).transformDirection(m), gear: g.gear };
    });
    const carriersOf = G => {
      const out = new Set([G.body]);
      for (const j of this.joints) {
        if (j.a !== G.body && j.b !== G.body) continue;
        if (Math.abs(j.n.dot(G.n)) < PARALLEL) continue;
        const d = G.c.clone().sub(j.p);
        if (d.addScaledVector(j.n, -d.dot(j.n)).length() > 1.0) continue; // 동축 아님
        out.add(j.a === G.body ? j.b : j.a);
      }
      return out;
    };
    for (let i = 0; i < gInfo.length; i++) for (let k = i + 1; k < gInfo.length; k++) {
      const A = gInfo[i], B = gInfo[k];
      const dot = A.n.dot(B.n);
      if (Math.abs(dot) < PARALLEL) continue;
      const d = B.c.clone().sub(A.c);
      if (Math.abs(d.dot(A.n)) > 3) continue;
      const cd = d.clone().addScaledVector(A.n, -d.dot(A.n)).length();
      if (Math.abs(cd - (A.gear.pitchR + B.gear.pitchR)) > 1.5) continue;
      if (A.body === B.body) continue;
      const cA = carriersOf(A), cB = carriersOf(B);
      const common = [...cA].filter(x => cB.has(x) && x !== A.body && x !== B.body);
      let carrier = common[0];
      if (carrier === undefined) {
        if (cB.has(A.body)) carrier = A.body; else if (cA.has(B.body)) carrier = B.body;
      }
      if (carrier === undefined) continue; // 받침이 정의 안 된 떠 있는 기어
      this.gears.push({
        tA: A.gear.teeth, tB: B.gear.teeth, s: Math.sign(dot) || 1,
        mA: A.body === carrier ? -1 : addMeas(A.body, carrier, A.n, A.c),
        mB: B.body === carrier ? -1 : addMeas(B.body, carrier, B.n, B.c),
        parts: [A.id, B.id],
      });
    }
    this.refs = new Array(this.meas.length).fill(0);

    this.D = this.bodies.map(() => new THREE.Matrix4());
    this._tmp = new THREE.Matrix4();
    this._inv = new THREE.Matrix4();
  }

  // ── 순기구학 ──
  _fk(q) {
    for (const r of this.roots) this.D[r].identity();
    for (const o of this.order) {
      const j = this.joints[o.joint];
      rotAbout(this._tmp, j.p, j.n, o.sign * q[o.v]);
      this.D[o.child].multiplyMatrices(this.D[o.parent], this._tmp);
    }
  }

  // body 의 carrier 기준 상대 회전각 (축 n 둘레), refs 기준으로 펼침
  _angle(k) {
    if (k < 0) return 0;
    const m = this.meas[k];
    this._inv.copy(this.D[m.carrier]).invert().multiply(this.D[m.body]);
    const v = m.u.clone().transformDirection(this._inv);
    const raw = Math.atan2(m.n.dot(new THREE.Vector3().crossVectors(m.u, v)), m.u.dot(v));
    return this.refs[k] + wrap(raw - this.refs[k]);
  }

  _residual(q) {
    this._fk(q);
    const r = [];
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), na = new THREE.Vector3(), nb = new THREE.Vector3();
    for (const k of this.loopJoints) {
      const j = this.joints[k];
      pa.copy(j.p).applyMatrix4(this.D[j.a]);
      pb.copy(j.p).applyMatrix4(this.D[j.b]);
      r.push(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
      na.copy(j.n).transformDirection(this.D[j.a]);
      nb.copy(j.n).transformDirection(this.D[j.b]);
      const c = na.cross(nb);
      r.push(c.x * W_AXIS, c.y * W_AXIS, c.z * W_AXIS);
    }
    for (const d of this.drives) r.push(W_ANG * (this._angle(d.meas) - d.target));
    for (const m of this.manual.values()) r.push(W_ANG * (this._angle(m.meas) - m.target));
    for (const g of this.gears) {
      r.push(W_ANG * (g.tA * this._angle(g.mA) + g.s * g.tB * this._angle(g.mB)) / Math.max(g.tA, g.tB));
    }
    return r;
  }

  _solve() {
    const n = this.q.length;
    let q = this.q.slice();
    let r = this._residual(q);
    if (n === 0 || r.length === 0) return { q, err: maxAbs(r) };
    const h = 1e-5;
    let lambda = 1e-3;
    for (let it = 0; it < 25 && maxAbs(r) > 1e-4; it++) {
      const J = [];
      for (let v = 0; v < n; v++) {
        const qp = q.slice(); qp[v] += h;
        const rp = this._residual(qp);
        J.push(rp.map((x, i) => (x - r[i]) / h)); // J[v][i]
      }
      const A = Array.from({ length: n }, () => new Array(n).fill(0));
      const g = new Array(n).fill(0);
      for (let a = 0; a < n; a++) {
        for (let b = a; b < n; b++) {
          let s = 0; for (let i = 0; i < r.length; i++) s += J[a][i] * J[b][i];
          A[a][b] = A[b][a] = s;
        }
        let s = 0; for (let i = 0; i < r.length; i++) s += J[a][i] * r[i];
        g[a] = -s;
      }
      const cost = r.reduce((s, x) => s + x * x, 0);
      let improved = false;
      for (let tries = 0; tries < 6; tries++) {
        const Ad = A.map((row, i) => row.map((x, k) => (i === k ? x + lambda * (1 + x) : x)));
        const dq = solveLinear(Ad, g);
        const qn = q.map((x, i) => x + dq[i]);
        const rn = this._residual(qn);
        if (rn.reduce((s, x) => s + x * x, 0) < cost) {
          q = qn; r = rn; lambda = Math.max(lambda / 3, 1e-7); improved = true; break;
        }
        lambda *= 10;
      }
      if (!improved) break;
    }
    return { q, err: maxAbs(this._residual(q)) };
  }

  _commitRefs() {
    this._fk(this.q);
    for (let k = 0; k < this.meas.length; k++) this.refs[k] = this._angle(k);
  }

  // ── 한 프레임 진행 ──
  step(dt) {
    const rpmOf = this.opts.motorRpm || (() => 60);
    let worstJump = 0;
    const n = this.substeps;
    for (let s = 0; s < n; s++) {
      const sdt = dt / n;
      const prevTargets = this.drives.map(d => d.target);
      for (const d of this.drives) d.target += (rpmOf(d.joint.motorPart) / 60) * 2 * Math.PI * sdt;
      const before = this.refs.slice();
      const res = this._solve();
      if (res.err > STALL_TOL) {
        this.drives.forEach((d, i) => { d.target = prevTargets[i]; });
        this.stalled = true;
        this._fk(this.q);
        return false;
      }
      this.q = res.q;
      this._commitRefs();
      for (let k = 0; k < this.refs.length; k++) worstJump = Math.max(worstJump, Math.abs(this.refs[k] - before[k]));
    }
    this.stalled = false;
    this.time += dt;
    // 빠른 회전은 펼침이 어긋나지 않게 스텝 분할
    if (worstJump > 0.8 && this.substeps < 16) this.substeps *= 2;
    else if (worstJump < 0.2 && this.substeps > 1) this.substeps /= 2;
    return true;
  }

  // 손으로 돌리기: 부품이 속한 강체를 트리 부모 기준으로 delta 만큼
  nudge(partId, delta) {
    const b = this.bodyOf.get(partId);
    if (b === undefined) return false;
    let m = this.manual.get(b);
    if (!m) {
      const o = this.treeParentJoint.get(b);
      if (!o) return false;
      const j = this.joints[o.joint];
      const k = this.meas.length;
      this.meas.push({ body: b, carrier: o.parent, n: j.n.clone(), u: anyPerp(j.n), p: j.p.clone() });
      this._fk(this.q);
      this.refs.push(0);
      this.refs[k] = this._angle(k);
      m = { meas: k, target: this.refs[k] };
      this.manual.set(b, m);
    }
    m.target += delta;
    return true;
  }

  // 부품의 부모 강체 기준 현재 회전각 (rpm 표시용)
  angleOfPart(partId) {
    const b = this.bodyOf.get(partId);
    const o = this.treeParentJoint.get(b);
    if (!o) return null;
    return o.sign * this.q[o.v];
  }

  // 부품 월드 자세 반영
  apply() {
    this._fk(this.q);
    const m = new THREE.Matrix4();
    for (const [id, part] of this.assembly.parts) {
      const b = this.bodyOf.get(id);
      if (b === undefined) continue;
      m.multiplyMatrices(this.D[b], this.rest.get(id));
      m.decompose(part.root.position, part.root.quaternion, part.root.scale);
    }
  }

  restore() {
    for (const [id, part] of this.assembly.parts) {
      const r = this.rest.get(id);
      if (r) r.decompose(part.root.position, part.root.quaternion, part.root.scale);
    }
  }

  summary() {
    return {
      bodies: this.bodies.length, joints: this.joints.length, dof: this.q.length,
      loops: this.loopJoints.length, motors: this.drives.length, gears: this.gears.length,
    };
  }
}
