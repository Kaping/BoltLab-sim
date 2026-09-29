// 부품 인스턴스 + 체결 그래프 관리
// 연결 type: 'bolt'(구멍-구멍 고정) | 'pivot'(회전볼트: 구멍-구멍 회전) | 'clip'(기어-축 고정)
//            'bearing'(축-구멍 베어링) | 'drive'(모터 출력-축)

import * as THREE from 'three';
import { THICK } from './generators.js';

let nextPartId = 1;
let nextConnId = 1;

export class Assembly {
  constructor() {
    this.parts = new Map();     // partId -> { id, defId, root, holes, kind, axisLen?, gear?, spinner? }
    this.connections = [];      // { id, type, a, b, holeA, holeB, mesh }
    this.usedCount = new Map();
  }

  addPart(defId, made) {
    const id = nextPartId++;
    const part = {
      id, defId,
      root: made.group,
      holes: made.holes || [],
      kind: made.kind || 'plate',
      axisLen: made.axisLen,
      gear: made.gear,
      spinner: made.spinner,
      output: made.output,
      motorRpm: made.kind === 'motor' ? 60 : undefined,
    };
    part.root.traverse(o => { o.userData.partId = id; });
    part.root.userData.partId = id;
    this.parts.set(id, part);
    this.usedCount.set(defId, (this.usedCount.get(defId) || 0) + 1);
    return part;
  }

  removePart(id) {
    const part = this.parts.get(id);
    if (!part) return [];
    const removedMeshes = [];
    this.connections = this.connections.filter(c => {
      if (c.a === id || c.b === id) { removedMeshes.push(c.mesh); return false; }
      return true;
    });
    this.usedCount.set(part.defId, (this.usedCount.get(part.defId) || 1) - 1);
    this.parts.delete(id);
    return removedMeshes;
  }

  connect(type, a, b, holeA, holeB, mesh) {
    const conn = { id: nextConnId++, type, a, b, holeA, holeB, mesh };
    this.connections.push(conn);
    return conn;
  }

  disconnectByMesh(obj) {
    let g = obj;
    while (g && !g.userData.connId) g = g.parent;
    if (!g) return null;
    const idx = this.connections.findIndex(c => c.id === g.userData.connId);
    if (idx < 0) return null;
    const [conn] = this.connections.splice(idx, 1);
    return conn;
  }

  componentOf(id) {
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length) {
      const cur = queue.pop();
      for (const c of this.connections) {
        const nb = c.a === cur ? c.b : (c.b === cur ? c.a : null);
        if (nb !== null && !seen.has(nb)) { seen.add(nb); queue.push(nb); }
      }
    }
    return seen;
  }

  // 월드 좌표 구멍 목록 (t: 판 두께 포함)
  worldHoles(filter) {
    const out = [];
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (const part of this.parts.values()) {
      if (filter && !filter(part.id)) continue;
      part.root.updateMatrixWorld(true);
      part.holes.forEach((h, index) => {
        p.copy(h.p).applyMatrix4(part.root.matrixWorld);
        n.copy(h.n).transformDirection(part.root.matrixWorld);
        out.push({ partId: part.id, index, p: p.clone(), n: n.clone(), t: h.t || THICK, kind: part.kind });
      });
    }
    return out;
  }

  // 축 부품의 월드 축선 목록
  worldAxes(filter) {
    const out = [];
    for (const part of this.parts.values()) {
      if (part.kind !== 'axle') continue;
      if (filter && !filter(part.id)) continue;
      part.root.updateMatrixWorld(true);
      const dir = new THREE.Vector3(0, 1, 0).transformDirection(part.root.matrixWorld);
      out.push({ partId: part.id, origin: part.root.getWorldPosition(new THREE.Vector3()), dir, halfLen: part.axisLen / 2 });
    }
    return out;
  }

  // 축이 꽂히는 허브 목록: 기어 중심 + 모터 출력축
  worldHubs(filter) {
    const out = [];
    for (const part of this.parts.values()) {
      if (part.kind !== 'gear' && part.kind !== 'motor') continue;
      if (filter && !filter(part.id)) continue;
      part.root.updateMatrixWorld(true);
      if (part.kind === 'motor') {
        const p = part.output.p.clone().applyMatrix4(part.root.matrixWorld);
        const n = part.output.n.clone().transformDirection(part.root.matrixWorld);
        out.push({ partId: part.id, p, n, motor: true });
        continue;
      }
      const n = new THREE.Vector3(0, 1, 0).transformDirection(part.root.matrixWorld);
      out.push({ partId: part.id, p: part.root.getWorldPosition(new THREE.Vector3()), n, gear: part.gear });
    }
    return out;
  }

  hasConnection(type, pa, ia, pb, ib) {
    return this.connections.some(c => c.type === type && (
      (c.a === pa && c.holeA === ia && c.b === pb && c.holeB === ib) ||
      (c.a === pb && c.holeA === ib && c.b === pa && c.holeB === ia)));
  }

  hasLink(type, pa, pb) {
    return this.connections.some(c => c.type === type &&
      ((c.a === pa && c.b === pb) || (c.a === pb && c.b === pa)));
  }
}
