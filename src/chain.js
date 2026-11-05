// 체인(감기 전동) — 두 체인기어를 감는 경로 계산 + 링크 표시
//
// 경로(열린 벨트): 두 피치원에 대한 외접선 2개 + 원호 2개. 평면 법선 n = 체인기어 A 의 축.
// 진행 방향 = n 둘레 +회전 방향. A 가 +θ 돌면 체인은 θ·rA 만큼 흐른다.

import * as THREE from 'three';
import { CHAIN_PITCH, SPROCKET_DISC } from './generators.js';

const MAX_LINKS = 400;

// cA, cB: 월드 중심 / rA, rB: 피치원 반지름 / n: 평면 법선(단위)
// 반환 { length, at(s) → { p, t } } (s 는 0..length, t = 진행 방향 접선). 두 원이 겹치면 null.
export function chainPath(cA, rA, cB, rB, n) {
  const d3 = new THREE.Vector3().subVectors(cB, cA);
  d3.addScaledVector(n, -d3.dot(n));            // B 를 A 평면에 투영
  const d = d3.length();
  if (d <= Math.abs(rA - rB) + 1e-6 || d < 1e-6) return null;
  const e = d3.clone().divideScalar(d);
  const f = new THREE.Vector3().crossVectors(n, e);
  const cB2 = cA.clone().add(d3);
  const beta = Math.asin((rA - rB) / d);
  const straight = Math.sqrt(d * d - (rA - rB) ** 2);
  // (e,f) 기준 각도. 위쪽 접점 각 = π/2-β, 아래쪽 = -(π/2-β)
  const up = Math.PI / 2 - beta;
  const arcA = rA * (Math.PI + 2 * beta);       // A: up → 2π-up (뒤쪽으로 감음)
  const arcB = rB * (Math.PI - 2 * beta);       // B: -up → up (앞쪽)
  const dir = a => e.clone().multiplyScalar(Math.cos(a)).addScaledVector(f, Math.sin(a));
  const onCircle = (c, r, a) => ({ p: c.clone().addScaledVector(dir(a), r), t: dir(a + Math.PI / 2) });
  const TA_l = cA.clone().addScaledVector(dir(-up), rA), TB_l = cB2.clone().addScaledVector(dir(-up), rB);
  const TB_u = cB2.clone().addScaledVector(dir(up), rB), TA_u = cA.clone().addScaledVector(dir(up), rA);
  const tLow = new THREE.Vector3().subVectors(TB_l, TA_l).normalize();
  const tUp = new THREE.Vector3().subVectors(TA_u, TB_u).normalize();
  const L = arcA + straight + arcB + straight;
  const at = s => {
    s = ((s % L) + L) % L;
    if (s < arcA) return onCircle(cA, rA, up + s / rA);
    s -= arcA;
    if (s < straight) return { p: TA_l.clone().addScaledVector(tLow, s), t: tLow.clone() };
    s -= straight;
    if (s < arcB) return onCircle(cB2, rB, -up + s / rB);
    s -= arcB;
    return { p: TB_u.clone().addScaledVector(tUp, s), t: tUp.clone() };
  };
  return { length: L, at, center: cA.clone().add(cB2).multiplyScalar(0.5) };
}

// 체인 연결 메시: 월드 좌표에 놓이는 그룹. 링크 위치는 updateChainMesh 로 매 프레임 갱신.
export function makeChainMesh() {
  const group = new THREE.Group();
  const plateGeo = new THREE.BoxGeometry(CHAIN_PITCH * 1.05, 2.2, 1); // x = 진행 방향, y = 반지름, z = 축(두께는 아래서 배치)
  const rollerGeo = new THREE.CylinderGeometry(1.9, 1.9, SPROCKET_DISC + 0.6, 10);
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x8d949c, metalness: 0.7, roughness: 0.35 });
  const rollerMat = new THREE.MeshStandardMaterial({ color: 0x5b6168, metalness: 0.6, roughness: 0.45 });
  const plates = new THREE.InstancedMesh(plateGeo, plateMat, MAX_LINKS * 2);
  const rollers = new THREE.InstancedMesh(rollerGeo, rollerMat, MAX_LINKS);
  plates.count = 0; rollers.count = 0;
  plates.frustumCulled = false; rollers.frustumCulled = false;
  group.add(plates, rollers);
  group.userData.chain = { plates, rollers };
  return group;
}

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);

// phase: 체인이 흐른 거리(mm). 링크 수는 경로 길이를 피치로 나눠 반올림(실물처럼 정수 링크).
export function updateChainMesh(group, cA, rA, cB, rB, n, phase = 0) {
  const { plates, rollers } = group.userData.chain;
  const path = chainPath(cA, rA, cB, rB, n);
  if (!path) { plates.count = rollers.count = 0; group.visible = false; return null; }
  group.visible = true;
  const N = Math.min(MAX_LINKS, Math.max(4, Math.round(path.length / CHAIN_PITCH)));
  const step = path.length / N;
  const pts = [];
  for (let i = 0; i < N; i++) pts.push(path.at(phase + i * step).p);
  const half = SPROCKET_DISC / 2 + 0.6;
  _q.setFromUnitVectors(_up, n);
  for (let i = 0; i < N; i++) {
    _m.compose(pts[i], _q, _one);
    rollers.setMatrixAt(i, _m);
    // 링크판: 롤러 i → i+1 현 방향, 디스크 양옆 두 장
    const a = pts[i], b = pts[(i + 1) % N];
    _x.subVectors(b, a).normalize();
    _y.crossVectors(n, _x);
    _m.makeBasis(_x, _y, n);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    for (const side of [-1, 1]) {
      _m.setPosition(mid.x + n.x * side * half, mid.y + n.y * side * half, mid.z + n.z * side * half);
      plates.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), _m);
    }
  }
  rollers.count = N; plates.count = N * 2;
  rollers.instanceMatrix.needsUpdate = true;
  plates.instanceMatrix.needsUpdate = true;
  rollers.computeBoundingSphere(); plates.computeBoundingSphere();
  return path;
}

// ── 고무줄(벨트) ──  풀리 홈을 감는 고무 끈. 짧은 원통 조각을 경로에 늘어놓고, 몇 조각마다 색을 달리해 흐름이 보이게.
const BELT_SEG = 2.0;   // 조각 길이(mm)
const BELT_R = 0.9;     // 고무줄 단면 반지름
const MAX_SEGS = 1200;
export function makeBeltMesh(color = 0xff8a2a) {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(BELT_R, BELT_R, BELT_SEG * 1.08, 8);
  geo.rotateZ(Math.PI / 2); // 길이 = 로컬 X
  const segs = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), MAX_SEGS);
  const base = new THREE.Color(color), dark = base.clone().multiplyScalar(0.6);
  for (let i = 0; i < MAX_SEGS; i++) segs.setColorAt(i, i % 8 === 0 ? dark : base);
  segs.count = 0;
  segs.frustumCulled = false;
  group.add(segs);
  group.userData.belt = { segs };
  return group;
}
export function updateBeltMesh(group, cA, rA, cB, rB, n, phase = 0) {
  const { segs } = group.userData.belt;
  const path = chainPath(cA, rA + BELT_R, cB, rB + BELT_R, n); // 홈 바닥 위에 단면 반지름만큼 떠서 감김
  if (!path) { segs.count = 0; group.visible = false; return null; }
  group.visible = true;
  const N = Math.min(MAX_SEGS, Math.max(8, Math.round(path.length / BELT_SEG)));
  const step = path.length / N;
  for (let i = 0; i < N; i++) {
    const { p, t } = path.at(phase + i * step);
    _y.crossVectors(n, t);
    _m.makeBasis(t, _y, n).setPosition(p);
    segs.setMatrixAt(i, _m);
  }
  segs.count = N;
  segs.instanceMatrix.needsUpdate = true;
  segs.computeBoundingSphere();
  return path;
}
