/**
 * 표시 문턱과 항목 점수.
 *
 * **여기 있는 숫자는 판정 상수가 아니다.** 감점을 만들지 않고, 총점을 바꾸지 않으며,
 * `src/judge/constants.ts` 에 들어가지 않는다. 하는 일은 하나 — 화면에서
 * 어느 관절을 무슨 색으로 칠할지, 일치도를 몇으로 적을지 정한다.
 * 이 값을 전부 지워도 판정은 어제와 같은 점수를 낸다.
 *
 * 근거는 기존 규칙표다. A3가 8°/15°, A4가 10°/18°에서 등급을 가른다. 같은 대역을 쓰면
 * 오버레이의 빨강과 판정 카드의 빨강이 **대체로 같은 관절**을 가리킨다 —
 * 충돌을 피하는 대신 일치시키는 쪽이다(PRD-game 5.3).
 * 하한 6°는 H4의 ε(2°)의 세 배라, 검출 잡음이 색을 흔들지 못한다.
 */

import { EPSILON } from "../judge/constants";

export interface Band {
  /** 이 차이까지는 "맞음". */
  readonly ok: number;
  /** 이 차이까지는 "주의". 넘으면 "어긋남". */
  readonly warn: number;
}

/** 각도 지표의 기본 밴드. PRD-game 5.3이 정한 6°/15°. */
export const ANGLE_BAND: Band = { ok: 6, warn: 15 };

/**
 * 팔 각도는 1.5배로 넓힌다(9°/22°).
 *
 * 정면 카메라에서 앞으로 뻗은 팔은 짧아 보이고, x–y 평면에 투영한 팔꿈치 각은
 * 실제보다 굽어 보인다 — 몸통 안막기 기준 프레임에서 3D 88°가 투영 70.6°로 나온다.
 * 17°가 자세가 아니라 **깊이**에서 온다. 목표값을 투영값으로 두면 앞뒤는 맞지만
 * 깊이가 조금만 달라도 값이 크게 흔들리므로 밴드를 넓힌다.
 */
export const ARM_ANGLE_BAND: Band = { ok: 9, warn: 22 };

/**
 * 몸통 안막기 팔꿈치만 더 넓힌다. 이 자세에서 투영 문제가 가장 크다.
 * 대신 가중치를 낮춰, 흔들리는 값이 일치도를 끌고 다니지 못하게 한다.
 */
export const MOMTONG_ELBOW_BAND: Band = { ok: 20, warn: 40 };

/** 길이 지표(÷S)의 기본 밴드. */
export const LENGTH_BAND: Band = { ok: 0.15, warn: 0.35 };

/**
 * 발 간격만 예외로 넓다(0.30/0.60).
 *
 * A1의 합격대가 1.70~2.30(폭 0.60)이다. 여기에 0.15를 쓰면 **판정이 합격이라고 말한
 * 자세를 오버레이가 빨갛게 칠한다.** 한 화면에서 두 층이 서로 다른 말을 하는 것은
 * 색이 틀리는 것보다 나쁘다.
 */
export const FEET_GAP_BAND: Band = { ok: 0.3, warn: 0.6 };

/** 무릎 벌림비(발목 간격 대비). 비율의 비율이라 길이 밴드보다 좁다. */
export const KNEE_SPREAD_BAND: Band = { ok: 0.15, warn: 0.3 };

/** "맞음" 구간의 항목 점수. */
export const SCORE_OK = 100;
/** "주의" 구간이 끝나는 지점의 항목 점수. 즉 어긋남이 시작되는 값. */
export const SCORE_AT_WARN = 40;

/**
 * 어긋남 구간이 0점에 닿는 지점 = 주의 문턱의 이 배수.
 *
 * `docs/reference-poses.md` 4절은 "어긋남 40 → 0으로 선형 감소"라고만 적고
 * 0이 되는 지점을 정하지 않았다. 여기서 정한다 — **주의 문턱의 2배**다.
 * 주춤서기 무릎이면 30°, 발 간격이면 1.20·S 차이에서 0이 된다. 둘 다
 * "같은 자세로 볼 수 없다"에 해당하는 크기다. 표시 전용 값이고, 놀아 보고 고칠 값이다.
 */
export const OFF_ZERO_MULTIPLE = 2;

/** 밴드 정의가 말이 되는지 본다. 잘못된 밴드는 조용히 이상한 점수를 만든다. */
export function assertBand(band: Band, where: string): void {
  if (!(band.ok >= 0)) throw new Error(`${where}: 맞음 폭이 ${band.ok} 다. 0 이상이어야 한다.`);
  if (!(band.warn > band.ok)) {
    throw new Error(`${where}: 주의 폭 ${band.warn} 이 맞음 폭 ${band.ok} 보다 크지 않다.`);
  }
}

/**
 * 차이 하나를 0~100 점으로 바꾼다.
 *
 * ```
 * 맞음(≤ok)        100
 * 주의(ok~warn)    100 → 40 으로 선형
 * 어긋남(>warn)     40 → 0  으로 선형 (0이 되는 지점 = warn × 2)
 * ```
 *
 * 경계에서 이어진다 — d = ok 에서 100, d = warn 에서 40이 양쪽 식 모두에서 나온다.
 * 새 경계값을 만들지 않고 위 밴드만 쓴다(`docs/reference-poses.md` 4절).
 */
export function itemScore(diff: number, band: Band): number {
  if (!Number.isFinite(diff)) return 0;
  const d = Math.abs(diff);
  if (d <= band.ok) return SCORE_OK;
  if (d <= band.warn) {
    const t = (d - band.ok) / (band.warn - band.ok);
    return SCORE_OK - (SCORE_OK - SCORE_AT_WARN) * t;
  }
  const zeroAt = band.warn * OFF_ZERO_MULTIPLE;
  if (d >= zeroAt) return 0;
  return SCORE_AT_WARN * (1 - (d - band.warn) / (zeroAt - band.warn));
}

/** 차이 하나를 밴드 이름으로 바꾼다. 색은 화면이 정하고, 등급은 여기서 정한다. */
export function bandOf(diff: number, band: Band): "ok" | "warn" | "off" {
  const d = Math.abs(diff);
  if (d <= band.ok) return "ok";
  if (d <= band.warn) return "warn";
  return "off";
}

/**
 * 표시 문턱이 H4의 ε보다 충분히 큰가.
 *
 * 문턱이 ε에 가까우면 검출 잡음만으로 색이 깜빡인다. 각도 밴드의 하한 6°는
 * ε(2°)의 3배라는 근거를 코드에도 남겨 둔다 — 상수를 고치면 이 검사가 깨진다.
 */
export const ANGLE_OK_OVER_EPSILON = ANGLE_BAND.ok / EPSILON.deg;
