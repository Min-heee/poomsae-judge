/**
 * 규칙 A — 주춤서기 (PRD 5절).
 *
 * 정지 자세이므로 시간축에서 할 일은 하나다: "자세가 멈춰 있던 구간"을 찾는 것.
 * 그 구간을 찾은 다음에는 구간의 중앙값으로 채점한다. 평균이 아니라 중앙값을 쓰는 이유는
 * 구간 가장자리에 남는 전이 프레임 몇 개가 등급을 바꾸지 못하게 하기 위해서다.
 *
 * 구간을 찾는 조건(engaged*, settleSpeed*)과 채점 경계(feetGap*, kneeAngle*)는
 * constants.ts에서 이름으로 갈라 두었다. 둘이 섞이면 "경계값이 구간을 정하고
 * 구간이 경계값을 정하는" 순환이 생긴다.
 */

import { EPSILON, METRIC_LABEL, STANCE } from "./constants";
import {
  ankleGapX,
  hipElevation,
  kneeAngle,
  shoulderWidth,
  torsoTilt,
} from "./coords";
import { gradeOf, scoreItem, type BandSpec } from "./grading";
import { LEFT_LEG, RIGHT_LEG } from "./landmarks";
import { longestRun, median, movingAverage, round, stdDev } from "./math";
import type { PreparedFrame, PreparedSequence } from "./prepare";
import type { CriterionResult } from "./types";

interface StanceSeries {
  valid: boolean[];
  shoulder: number[];
  feetGap: number[];
  kneeLeft: number[];
  kneeRight: number[];
  /** 더 안 굽은 쪽. 나쁜 쪽으로 채점한다. */
  kneeWorst: number[];
  kneeDiff: number[];
  torso: number[];
  hipElev: number[];
}

function buildSeries(frames: readonly PreparedFrame[]): StanceSeries {
  const n = frames.length;
  const s: StanceSeries = {
    valid: new Array(n),
    shoulder: new Array(n),
    feetGap: new Array(n),
    kneeLeft: new Array(n),
    kneeRight: new Array(n),
    kneeWorst: new Array(n),
    kneeDiff: new Array(n),
    torso: new Array(n),
    hipElev: new Array(n),
  };

  for (let i = 0; i < n; i++) {
    const f = frames[i].landmarks;
    const S = shoulderWidth(f);
    const kl = kneeAngle(f, LEFT_LEG);
    const kr = kneeAngle(f, RIGHT_LEG);
    s.valid[i] = frames[i].valid && S > 0 && Number.isFinite(kl) && Number.isFinite(kr);
    s.shoulder[i] = S;
    s.feetGap[i] = S > 0 ? ankleGapX(f) / S : Number.NaN;
    s.kneeLeft[i] = kl;
    s.kneeRight[i] = kr;
    s.kneeWorst[i] = Math.max(kl, kr);
    s.kneeDiff[i] = Math.abs(kl - kr);
    s.torso[i] = torsoTilt(f);
    s.hipElev[i] = hipElevation(f);
  }
  return s;
}

/**
 * 엉덩이 높이의 상하 속도(m/s). 중앙차분, 양 끝은 한쪽 차분. 이웃이 무효면 판단 불가로 본다.
 * 속도를 재기 전에 평활한다 — 이유는 constants.ts의 settleSmoothingWindow 주석에 적었다.
 */
function hipSpeeds(frames: readonly PreparedFrame[], series: StanceSeries): number[] {
  const n = frames.length;
  const out = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
  const smoothed = movingAverage(
    series.hipElev.map((v, i) => (series.valid[i] && Number.isFinite(v) ? v : null)),
    STANCE.settleSmoothingWindow,
  );
  for (let i = 0; i < n; i++) {
    const lo = i > 0 ? i - 1 : i;
    const hi = i < n - 1 ? i + 1 : i;
    if (lo === hi) continue;
    const a = smoothed[lo];
    const b = smoothed[hi];
    if (a === null || b === null) continue;
    const dt = (frames[hi].timeMs - frames[lo].timeMs) / 1000;
    if (dt <= 0) continue;
    out[i] = Math.abs(b - a) / dt;
  }
  return out;
}

export interface StanceWindow {
  start: number;
  end: number;
  durationSeconds: number;
  /**
   * 구간 탐지 조건까지 만족했는가. false면 유효 프레임만으로 잡은 대체 구간이다.
   * A5가 이 값을 읽어 "멈춘 구간을 찾지 못했다"로 감점하고, judge.ts가 같은 값을
   * 읽어 전체 보류 H7을 건다 — 멈춘 적이 없으면 채점할 주춤서기가 없다는 뜻이므로.
   */
  settled: boolean;
}

/**
 * 이 프레임이 주춤서기를 "취하고 있는가". 구간 탐지용이고 채점이 아니다.
 *
 * 판정 코어(findStanceWindow)와 화면의 실시간 읽기(src/pose/readout.ts)가 **같은 이
 * 함수**를 부른다. 두 벌로 두면 화면이 "유지 2.1초"라고 세는 프레임을 판정은 세지
 * 않는 일이 생기고, 그때 화면과 판정 중 어느 쪽이 맞는지 아무도 말할 수 없다.
 *
 * 무릎은 **더 굽은 쪽**으로 본다(이유는 constants.ts engagedKneeAngleMax 주석).
 * 여기서 보지 않는 것이 하나 있다 — 자세가 멈췄는가. 그건 시계열이 있어야 재고,
 * findStanceWindow가 속도 문턱으로 따로 건다. 그래서 이 함수가 true인 프레임이
 * 곧바로 판정 구간에 들어가는 것은 아니다.
 */
export function isEngagedStancePose(
  feetGap: number,
  kneeLeftDeg: number,
  kneeRightDeg: number,
): boolean {
  if (!(feetGap >= STANCE.engagedFeetGapMin)) return false;
  return Math.min(kneeLeftDeg, kneeRightDeg) <= STANCE.engagedKneeAngleMax;
}

/**
 * 채점에 쓸 구간을 찾는다.
 * 1순위는 "멈춰 있는 주춤서기" 구간. 없으면 유효 프레임이 이어지는 가장 긴 구간으로 물러선다
 * (이 경우 A5는 자동으로 미충족이다 — 멈춘 적이 없다는 뜻이므로).
 */
export function findStanceWindow(
  prepared: PreparedSequence,
  precomputed?: StanceSeries,
): StanceWindow | null {
  const { frames } = prepared;
  const series = precomputed ?? buildSeries(frames);
  const speeds = hipSpeeds(frames, series);

  const settledFlags = frames.map((_, i) => {
    if (!series.valid[i]) return false;
    if (!isEngagedStancePose(series.feetGap[i], series.kneeLeft[i], series.kneeRight[i])) {
      return false;
    }
    return speeds[i] <= STANCE.settleSpeedMaxMps;
  });

  // 가장 긴 구간이 문턱에 못 미치면 다른 구간은 더 짧다 — 하나만 보면 된다.
  // 한 프레임으로 족하다고 두면, 앉았다 곧바로 일어나느라 지나가는 길에 스친
  // 한 프레임이 점수를 연다. 자세를 한 번도 유지하지 않은 사람이 받는 점수다.
  const settled = longestRun(settledFlags);
  if (settled !== null) {
    const durationSeconds = (frames[settled.end].timeMs - frames[settled.start].timeMs) / 1000;
    if (durationSeconds >= STANCE.settledMinSeconds) {
      return { ...settled, durationSeconds, settled: true };
    }
  }

  const fallback = longestRun(series.valid);
  if (fallback === null) return null;
  return {
    ...fallback,
    durationSeconds: (frames[fallback.end].timeMs - frames[fallback.start].timeMs) / 1000,
    settled: false,
  };
}

function slice(values: readonly number[], w: StanceWindow): number[] {
  return values.slice(w.start, w.end + 1).filter((v) => Number.isFinite(v));
}

const FEET_GAP_SPEC: BandSpec = {
  boundaries: STANCE.feetGapBoundaries,
  deductions: STANCE.feetGapDeductions,
};
const KNEE_SPEC: BandSpec = {
  boundaries: STANCE.kneeAngleBoundaries,
  deductions: STANCE.kneeAngleDeductions,
};
const SYMMETRY_SPEC: BandSpec = {
  boundaries: STANCE.symmetryBoundaries,
  deductions: STANCE.symmetryDeductions,
};
const TORSO_SPEC: BandSpec = {
  boundaries: STANCE.torsoTiltBoundaries,
  deductions: STANCE.torsoTiltDeductions,
};

export interface StanceOutcome {
  criteria: CriterionResult[];
  window: StanceWindow;
}

export function judgeStance(prepared: PreparedSequence): StanceOutcome | null {
  const { frames } = prepared;
  const series = buildSeries(frames);
  const window = findStanceWindow(prepared, series);
  if (window === null) return null;

  const mid = frames[Math.floor((window.start + window.end) / 2)];
  const at = { atFrame: mid.sourceIndex, atTimeMs: round(mid.timeMs, 1) };

  const feetGap = median(slice(series.feetGap, window));
  const kneeWorst = median(slice(series.kneeWorst, window));
  const kneeDiff = median(slice(series.kneeDiff, window));
  const torso = median(slice(series.torso, window));

  const criteria: CriterionResult[] = [
    scoreItem({
      id: "A1",
      title: "발 간격",
      rule: "좌우 발목의 수평거리 ÷ 어깨 너비 S. 합격 1.70~2.30.",
      measured: feetGap,
      unit: "ratio",
      spec: FEET_GAP_SPEC,
      digits: 2,
      ...at,
      describe: (v, g) =>
        g === "pass"
          ? `발 간격이 어깨 너비의 ${v}배다. 합격 구간 1.70~2.30 안에 있다.`
          : v < STANCE.feetGapBoundaries[2]
            ? `발 간격이 어깨 너비의 ${v}배로 좁다. 합격은 1.70부터다.`
            : `발 간격이 어깨 너비의 ${v}배로 넓다. 합격은 2.30까지다.`,
    }),
    scoreItem({
      id: "A2",
      title: "무릎 굽힘",
      rule: "엉덩이–무릎–발목 내각. 좌우 중 덜 굽은 쪽으로 채점. 합격 145° 이하.",
      measured: kneeWorst,
      unit: "deg",
      spec: KNEE_SPEC,
      digits: 1,
      ...at,
      describe: (v, g) =>
        g === "pass"
          ? `덜 굽은 쪽 무릎이 ${v}°다. 합격선 145° 안쪽이다.`
          : `덜 굽은 쪽 무릎이 ${v}°로 덜 앉았다. 합격선은 145°다.`,
    }),
    scoreItem({
      id: "A3",
      title: "좌우 대칭",
      rule: "좌우 무릎 내각의 차. 합격 8° 이하.",
      measured: kneeDiff,
      unit: "deg",
      spec: SYMMETRY_SPEC,
      digits: 1,
      ...at,
      describe: (v, g) =>
        g === "pass"
          ? `좌우 무릎 각도 차가 ${v}°다. 합격선 8° 안쪽이다.`
          : `좌우 무릎 각도 차가 ${v}°다. 한쪽으로 쏠려 있다. 합격선은 8°다.`,
    }),
    scoreItem({
      id: "A4",
      title: "상체 수직",
      rule: "엉덩이 중점 → 어깨 중점 벡터와 수직축의 각. 합격 10° 이하.",
      measured: torso,
      unit: "deg",
      spec: TORSO_SPEC,
      digits: 1,
      ...at,
      describe: (v, g) =>
        g === "pass"
          ? `상체가 수직에서 ${v}° 벗어나 있다. 합격선 10° 안쪽이다.`
          : `상체가 수직에서 ${v}° 기울어 있다. 합격선은 10°다.`,
    }),
    judgeHold(window, series, at),
  ];

  return { criteria, window };
}

/**
 * A5 — 유지와 흔들림.
 *
 * 두 축(구간 길이, 엉덩이 높이의 표준편차)을 함께 본다.
 * H4의 ε를 여기에도 적용하되, 흔들림 문턱은 그 자체가 0.03·S로 작아서
 * 비율 ε(0.05)를 절대값으로 쓰면 어떤 입력이든 보류가 된다. 그래서 상대 ε를 쓴다.
 */
function judgeHold(
  window: StanceWindow,
  series: StanceSeries,
  at: { atFrame: number | null; atTimeMs: number | null },
): CriterionResult {
  const rule = `자세가 멈춘 구간 ${STANCE.minHoldSeconds}초 이상, 그 구간 ${METRIC_LABEL.hipSway} ${STANCE.maxHipSwayRatio}·S 이하.`;
  const S = median(slice(series.shoulder, window));
  const elevations = slice(series.hipElev, window);
  const swayRatio = S > 0 ? stdDev(elevations) / S : Number.NaN;
  const duration = window.durationSeconds;
  const swayRounded = Number.isFinite(swayRatio) ? round(swayRatio, 4) : null;

  const base = {
    id: "A5",
    title: "유지·흔들림",
    rule,
    measured: swayRounded,
    unit: "ratio" as const,
    boundaries: [STANCE.maxHipSwayRatio],
    ...at,
  };

  if (!window.settled) {
    return {
      ...base,
      grade: gradeOf(STANCE.holdDeduction),
      deduction: STANCE.holdDeduction,
      note: `자세가 멈춘 구간을 찾지 못했다. 무릎·발 간격·정지 조건을 함께 만족한 구간이 ${STANCE.settledMinSeconds}초 이상 이어지지 않았다. 아래 값은 유효 프레임이 이어지는 ${round(duration, 2)}초 구간에서 읽은 것이다.`,
    };
  }

  // 구간 길이부터. 프레임 하나 차이로 갈리지 않게 시간 ε를 적용한다.
  if (Math.abs(duration - STANCE.minHoldSeconds) < EPSILON.seconds) {
    return {
      ...base,
      grade: "withheld",
      deduction: 0,
      note: `유지 시간이 ${round(duration, 2)}초로 기준 ${STANCE.minHoldSeconds}초 경계에 있다.`,
      withholdReason: `유지 시간이 기준의 ±${EPSILON.seconds}초 안이라 프레임 하나가 등급을 바꾼다. 이 항목은 총점에서 뺀다. (H4)`,
    };
  }
  if (duration < STANCE.minHoldSeconds) {
    return {
      ...base,
      grade: gradeOf(STANCE.holdDeduction),
      deduction: STANCE.holdDeduction,
      note: `자세를 ${round(duration, 2)}초만 유지했다. 기준은 ${STANCE.minHoldSeconds}초다.`,
    };
  }

  if (swayRounded === null) {
    return {
      ...base,
      grade: "withheld",
      deduction: 0,
      note: "흔들림을 계산할 수 없었다.",
      withholdReason: "어깨 너비 S를 구할 수 없어 흔들림을 정규화하지 못했다.",
    };
  }

  const threshold = STANCE.maxHipSwayRatio;
  if (Math.abs(swayRatio - threshold) < threshold * EPSILON.relative) {
    return {
      ...base,
      grade: "withheld",
      deduction: 0,
      note: `${round(duration, 2)}초 유지. 흔들림 ${swayRounded}·S로 기준 ${threshold}·S 경계에 있다.`,
      withholdReason: `흔들림이 기준의 ±${EPSILON.relative * 100}% 안이다. 이 항목은 총점에서 뺀다. (H4)`,
    };
  }

  if (swayRatio > threshold) {
    return {
      ...base,
      grade: gradeOf(STANCE.holdDeduction),
      deduction: STANCE.holdDeduction,
      note: `${round(duration, 2)}초 유지했지만 ${METRIC_LABEL.hipSway}가 ${swayRounded}·S였다. 기준은 ${threshold}·S다.`,
    };
  }

  return {
    ...base,
    grade: "pass",
    deduction: 0,
    note: `${round(duration, 2)}초 유지, 흔들림 ${swayRounded}·S. 기준 ${STANCE.minHoldSeconds}초 / ${threshold}·S를 모두 만족한다.`,
  };
}


