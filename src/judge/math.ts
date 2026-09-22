/**
 * 판정에 쓰는 계산 도구.
 *
 * 전부 순수 함수다 — Date.now()도 Math.random()도 쓰지 않는다.
 * 같은 입력이면 같은 출력이라는 약속(PRD 원칙 2)이 여기서 시작한다.
 */

import type { Landmark } from "./types";

export interface Vec2 {
  x: number;
  y: number;
}

const RAD_TO_DEG = 180 / Math.PI;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 소수점 자리수를 고정한다.
 * 부동소수점 끝자리가 흔들리면 골든 스냅샷이 이유 없이 깨지므로,
 * 출력에 들어가는 모든 수는 이 함수를 통과시킨다.
 */
export function round(value: number, digits: number): number {
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  // -0 을 0 으로 접는다. JSON.stringify가 -0을 0으로 쓰는 것과 어긋나지 않게.
  return Object.is(r, -0) ? 0 : r;
}

/** 3차원 거리. 기준 길이 S처럼 자세·방향에 무관해야 하는 값에만 쓴다. */
export function distance3(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 화면 평면(x–y) 거리. 깊이에 의존하지 않아야 하는 지표는 전부 이쪽이다. */
export function distanceXY(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 세 점이 이루는 내각(도). 꼭짓점은 vertex.
 * x–y 평면에서만 계산한다 — 단일 카메라의 z를 각도에 넣지 않기로 했다(PRD 8절).
 */
export function angleAtVertexXY(a: Landmark, vertex: Landmark, b: Landmark): number {
  const v1x = a.x - vertex.x;
  const v1y = a.y - vertex.y;
  const v2x = b.x - vertex.x;
  const v2y = b.y - vertex.y;
  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  if (n1 === 0 || n2 === 0) return Number.NaN;
  const cos = clamp((v1x * v2x + v1y * v2y) / (n1 * n2), -1, 1);
  return Math.acos(cos) * RAD_TO_DEG;
}

/**
 * 벡터가 수직축과 이루는 각(도). 0이면 완전히 수직, 90이면 수평.
 * 위를 향하든 아래를 향하든 같은 값을 준다.
 */
export function tiltFromVerticalXY(dx: number, dy: number): number {
  const n = Math.hypot(dx, dy);
  if (n === 0) return Number.NaN;
  return Math.acos(clamp(Math.abs(dy) / n, 0, 1)) * RAD_TO_DEG;
}

/**
 * 부호 있는 기울기(도). forwardSign이 +1이면 +x가 앞이다.
 * 반환값이 양수면 "앞의 반대쪽으로 젖혀졌다"는 뜻이고, 앞으로 숙였으면 음수다.
 * 앞차기 B5(상체 젖힘)가 뒤로 젖힌 것만 잡아야 하므로 부호가 필요하다.
 */
export function signedBackwardTiltXY(dx: number, dy: number, forwardSign: number): number {
  const magnitude = tiltFromVerticalXY(dx, dy);
  if (Number.isNaN(magnitude)) return Number.NaN;
  // dx가 앞 방향이면 앞으로 숙인 것 → 음수.
  return dx * forwardSign > 0 ? -magnitude : magnitude;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * 중앙값. 구간 대표값은 평균이 아니라 중앙값을 쓴다 —
 * 구간 가장자리에 남는 전이 프레임 몇 개가 등급을 바꾸지 못하게 하려는 것이다.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 모표준편차(N으로 나눈다). 표본이 아니라 관측한 구간 전체를 보는 것이므로. */
export function stdDev(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  return Math.sqrt(acc / values.length);
}

/**
 * 가운데 정렬 이동평균. window는 홀수여야 한다.
 * null(=무효 프레임)은 창에서 빼고 평균을 낸다. 창 안에 유효값이 하나도 없으면 null.
 * 이렇게 하면 무효 프레임이 이웃 값을 0으로 끌어내리지 않는다.
 */
export function movingAverage(
  values: readonly (number | null)[],
  window: number,
): (number | null)[] {
  if (window < 1 || window % 2 === 0) {
    throw new Error(`이동평균 창은 1 이상의 홀수여야 한다: ${window}`);
  }
  const half = (window - 1) / 2;
  const out: (number | null)[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let n = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k < 0 || k >= values.length) continue;
      const v = values[k];
      if (v === null || Number.isNaN(v)) continue;
      sum += v;
      n++;
    }
    out[i] = n === 0 ? null : sum / n;
  }
  return out;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 랜드마크 하나를 선형 보간. visibility는 낮은 쪽을 따른다(보수적으로). */
export function lerpLandmark(a: Landmark, b: Landmark, t: number): Landmark {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    visibility: Math.min(a.visibility, b.visibility),
  };
}

/** 프레임 하나를 통째로 선형 보간. 결손 프레임을 메울 때 쓴다. */
export function lerpFrame(
  a: readonly Landmark[],
  b: readonly Landmark[],
  t: number,
): Landmark[] {
  if (a.length !== b.length) {
    throw new Error(`보간할 두 프레임의 랜드마크 수가 다르다: ${a.length} vs ${b.length}`);
  }
  const out: Landmark[] = new Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = lerpLandmark(a[i], b[i], t);
  return out;
}

/** 연속한 true 구간 중 가장 긴 것. [start, end] (둘 다 포함). 없으면 null. */
export function longestRun(flags: readonly boolean[]): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  let runStart = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i];
    if (on && runStart === -1) runStart = i;
    if (!on && runStart !== -1) {
      const len = i - runStart;
      if (best === null || len > best.end - best.start + 1) {
        best = { start: runStart, end: i - 1 };
      }
      runStart = -1;
    }
  }
  return best;
}
