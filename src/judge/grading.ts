/**
 * 측정값 하나를 등급과 감점으로 바꾸는 층.
 *
 * 규칙 A·B의 모든 항목이 같은 함수를 지나간다. 등급 경계는 constants.ts에만 있고
 * 이 파일에는 없다 — 여기 숫자가 하나라도 생기면 단일 출처가 깨진다(PRD F7).
 */

import { DEDUCTION, EPSILON } from "./constants";
import { round } from "./math";
import type { CriterionResult, Grade, MeasureUnit } from "./types";

export interface BandSpec {
  /** 등급이 갈리는 값들. 반드시 오름차순. */
  readonly boundaries: readonly number[];
  /** 구간별 감점. 길이는 boundaries.length + 1. */
  readonly deductions: readonly number[];
}

/**
 * 값이 어느 구간에 떨어지는가.
 * 경계값에 정확히 걸리면 위쪽 구간으로 보낸다. 다만 경계에 정확히 걸린 값은
 * 어차피 H4(ε)에 걸려 보류되므로, 이 규칙이 점수를 가르는 일은 거의 없다.
 */
export function bandIndex(value: number, boundaries: readonly number[]): number {
  for (let i = 0; i < boundaries.length; i++) {
    if (value < boundaries[i]) return i;
  }
  return boundaries.length;
}

export function deductionFor(value: number, spec: BandSpec): number {
  if (spec.deductions.length !== spec.boundaries.length + 1) {
    throw new Error("감점 구간 수가 경계 수 + 1이 아니다.");
  }
  return spec.deductions[bandIndex(value, spec.boundaries)];
}

export function gradeOf(deduction: number): Grade {
  if (deduction === DEDUCTION.none) return "pass";
  if (deduction === DEDUCTION.minor) return "minor";
  return "major";
}

/** 가장 가까운 경계까지의 거리. 경계가 없으면 Infinity. */
export function distanceToNearestBoundary(
  value: number,
  boundaries: readonly number[],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const b of boundaries) best = Math.min(best, Math.abs(value - b));
  return best;
}

/** 단위별 H4의 ε. 시간 ε는 PRD에 없고 이 구현이 더한 값이다(constants.ts 주석 참고). */
export function epsilonFor(unit: MeasureUnit): number {
  switch (unit) {
    case "deg":
      return EPSILON.deg;
    case "ratio":
      return EPSILON.ratio;
    case "s":
      return EPSILON.seconds;
    default:
      return 0;
  }
}

export interface ScoreItemInput {
  id: string;
  title: string;
  rule: string;
  measured: number;
  unit: MeasureUnit;
  spec: BandSpec;
  /** 소수 자리수. 출력이 부동소수점 끝자리로 흔들리지 않게 고정한다. */
  digits: number;
  atFrame: number | null;
  atTimeMs: number | null;
  /** 등급별 근거 문장을 만드는 함수. 값과 등급을 받아 한 줄을 돌려준다. */
  describe: (value: number, grade: Grade) => string;
}

/**
 * 측정값 하나를 채점 결과 한 줄로 바꾼다. H4(경계 근접 보류)도 여기서 적용한다.
 *
 * 경계에서 점수를 주고 나중에 "오차 범위였다"고 말하는 것보다,
 * 처음부터 재지 않았다고 말하는 편이 반박 가능하다 — 그것이 H4의 취지다.
 */
export function scoreItem(input: ScoreItemInput): CriterionResult {
  const { measured, spec, unit, digits } = input;

  if (!Number.isFinite(measured)) {
    return {
      id: input.id,
      title: input.title,
      rule: input.rule,
      measured: null,
      unit,
      boundaries: spec.boundaries,
      grade: "withheld",
      deduction: 0,
      note: "측정값을 계산할 수 없었다.",
      atFrame: input.atFrame,
      atTimeMs: input.atTimeMs,
      withholdReason: "필요한 관절이 겹쳐 있어 각도·비율을 낼 수 없었다.",
    };
  }

  const rounded = round(measured, digits);
  const eps = epsilonFor(unit);
  const gap = distanceToNearestBoundary(measured, spec.boundaries);

  if (eps > 0 && gap < eps) {
    return {
      id: input.id,
      title: input.title,
      rule: input.rule,
      measured: rounded,
      unit,
      boundaries: spec.boundaries,
      grade: "withheld",
      deduction: 0,
      note: `측정값 ${rounded}${unitSuffix(unit)} — 등급 경계에서 ${round(gap, digits)}${unitSuffix(unit)} 떨어져 있다.`,
      atFrame: input.atFrame,
      atTimeMs: input.atTimeMs,
      withholdReason: `등급 경계의 ±${eps}${unitSuffix(unit)} 안이라 검출 오차가 등급을 바꿀 수 있다. 이 항목은 총점에서 뺀다. (H4)`,
    };
  }

  const deduction = deductionFor(measured, spec);
  const grade = gradeOf(deduction);

  return {
    id: input.id,
    title: input.title,
    rule: input.rule,
    measured: rounded,
    unit,
    boundaries: spec.boundaries,
    grade,
    deduction,
    note: input.describe(rounded, grade),
    atFrame: input.atFrame,
    atTimeMs: input.atTimeMs,
  };
}

/** 구조적 판정(순서 위반처럼 잰 값이 없는 것). ε를 적용하지 않는다 — 잴 값이 없으니 경계도 없다. */
export function structuralItem(args: {
  id: string;
  title: string;
  rule: string;
  violated: boolean;
  deduction: number;
  note: string;
  atFrame: number | null;
  atTimeMs: number | null;
}): CriterionResult {
  return {
    id: args.id,
    title: args.title,
    rule: args.rule,
    measured: null,
    unit: "none",
    boundaries: [],
    grade: args.violated ? gradeOf(args.deduction) : "pass",
    deduction: args.violated ? args.deduction : 0,
    note: args.note,
    atFrame: args.atFrame,
    atTimeMs: args.atTimeMs,
  };
}

export function unitSuffix(unit: MeasureUnit): string {
  switch (unit) {
    case "deg":
      return "°";
    case "s":
      return "초";
    case "m":
      return "m";
    case "ratio":
      return "·S";
    default:
      return "";
  }
}
