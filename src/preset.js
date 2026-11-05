// 구조물 프리셋 내보내기/불러오기 — serialize() 결과 ↔ 공유용 코드 문자열 / 파일 JSON
//
// 코드 형식: 'BL1.' + base64url(deflate-raw(JSON))   (압축 미지원 브라우저는 'BL0.' + base64url(JSON))
// 파일 형식: { app: 'BoltLab-sim', version: 1, parts, conns, pinned }  — 사람이 읽을 수 있는 JSON
// 불러올 때는 코드 / 파일 JSON / 둘러싼 공백·줄바꿈 모두 받음.

export const PRESET_VERSION = 1;
const APP = 'BoltLab-sim';

const CONN_TYPES = new Set(['bolt', 'pivot', 'clip', 'bearing', 'drive', 'chain', 'belt', 'slot']);
const r4 = v => Math.round(v * 1e4) / 1e4; // 0.1µm 단위 반올림 → 코드 길이 단축

export function toPresetObject(data) {
  return {
    app: APP, version: PRESET_VERSION,
    parts: data.parts.map(p => ({ ...p, pos: p.pos.map(r4), quat: p.quat.map(r4) })),
    conns: data.conns.map(c => ({ ...c, mp: c.mp.map(r4), mq: c.mq.map(r4) })),
    pinned: data.pinned,
  };
}

function bytesToB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodePreset(data) {
  const json = JSON.stringify(toPresetObject(data));
  const raw = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'function') {
    return 'BL1.' + bytesToB64url(await pipe(raw, new CompressionStream('deflate-raw')));
  }
  return 'BL0.' + bytesToB64url(raw);
}

// 코드 또는 JSON 텍스트 → 프리셋 객체. 형식이 틀리면 사람이 읽을 메시지로 throw.
export async function decodePreset(text, knownDef = null) {
  const t = String(text).trim().replace(/\s+/g, '');
  let obj;
  if (t.startsWith('{')) {
    try { obj = JSON.parse(String(text)); } catch { throw new Error('JSON 형식이 깨졌어요'); }
  } else {
    const m = /^BL([01])\.([A-Za-z0-9_-]+)$/.exec(t);
    if (!m) throw new Error('BoltLab 코드가 아니에요 (BL1. 로 시작해야 해요)');
    let bytes;
    try { bytes = b64urlToBytes(m[2]); } catch { throw new Error('코드가 잘렸거나 글자가 바뀌었어요'); }
    if (m[1] === '1') {
      if (typeof DecompressionStream !== 'function') throw new Error('이 브라우저는 압축 코드를 못 풀어요 — 파일로 불러오세요');
      try { bytes = await pipe(bytes, new DecompressionStream('deflate-raw')); } catch { throw new Error('코드가 잘렸거나 글자가 바뀌었어요'); }
    }
    try { obj = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('코드 내용을 읽을 수 없어요'); }
  }
  return validatePreset(obj, knownDef);
}

// 구조 검사 + 정리. knownDef(defId) → { holes, slots } 개수(숫자면 구멍 개수), 모르는 부품이면 null.
// 모르는 부품은 빼고, 그 부품에 걸린 연결·범위 밖 구멍 번호를 쓴 연결도 뺌.
export function validatePreset(obj, knownDef = null) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.parts) || !Array.isArray(obj.conns)) {
    throw new Error('부품 목록이 없는 데이터예요');
  }
  if (obj.version > PRESET_VERSION) throw new Error(`더 새 버전(v${obj.version})에서 만든 코드예요`);
  const isVec = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
  const keep = [];      // 원래 인덱스 → 새 인덱스
  const parts = [];
  const skipped = [];
  obj.parts.forEach((p, i) => {
    const ok = p && typeof p.defId === 'string' && isVec(p.pos, 3) && isVec(p.quat, 4) && (!knownDef || knownDef(p.defId) != null);
    if (ok) { keep[i] = parts.length; parts.push(p); } else skipped.push(p?.defId ?? '?');
  });
  const countOf = (i, key) => {
    const k = knownDef ? knownDef(obj.parts[i].defId) : null;
    if (k == null) return Infinity;
    return typeof k === 'number' ? (key === 'holes' ? k : Infinity) : k[key];
  };
  const holeOk = (i, h, key = 'holes') => h === -1 || (Number.isInteger(h) && h >= 0 && h < countOf(i, key));
  const conns = obj.conns.filter(c => c && CONN_TYPES.has(c.type) && keep[c.a] !== undefined && keep[c.b] !== undefined
    && c.a !== c.b && holeOk(c.a, c.holeA, c.type === 'slot' ? 'slots' : 'holes') && holeOk(c.b, c.holeB) && isVec(c.mp, 3) && isVec(c.mq, 4))
    .map(c => ({ ...c, a: keep[c.a], b: keep[c.b] }));
  const pinned = obj.pinned != null && keep[obj.pinned] !== undefined ? keep[obj.pinned] : null;
  return { parts, conns, pinned, skipped };
}
