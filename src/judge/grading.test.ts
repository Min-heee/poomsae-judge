import { describe, expect, it } from "vitest";

import { DEDUCTION, EPSILON, MAX_SCORE, STANCE } from "./constants";
import { finalScore } from "./judge";
import {
  bandIndex,
  deductionFor,
  distanceToNearestBoundary,
  epsilonFor,
  gradeOf,
  scoreItem,
  structuralItem,
  type BandSpec,
} from "./grading";

/** 규칙 A2와 같은 모양: 값이 커질수록 나빠진다. */
const KNEE_SPEC: BandSpec = {
  boundaries: STANCE.kneeAngleBoundaries,
  deductions: STANCE.kneeAngleDeductions,
};

/** 규칙 A1과 같은 모양: 합격 구간이 가운데 있고 양쪽으로 나빠진다. */
const GAP_SPEC: BandSpec = {
  boundaries: STANCE.feetGapBoundaries,
  deductions: STANCE.feetGapDeductions,
};

function item(measured: number, spec: BandSpec, unit: "deg" | "ratio" | "s") {
  return scoreItem({
    id: "T1",
    title: "시험",
    rule: "시험용",
    measured,
    unit,
    spec,
    digits: 3,
    atFrame: 7,
    atTimeMs: 233.3,
    describe: () => "설명",
  });
}

describe("bandIndex / deductionFor", () => {
  it("경계 바로 아래는 아래 구간", () => {
    expect(bandIndex(144.999, KNEE_SPEC.boundaries)).toBe(0);
    expect(deductionFor(144.999, KNEE_SPEC)).toBe(DEDUCTION.none);
  });

  it("경계값 자체는 위 구간으로 보낸다", () => {
    expect(bandIndex(145, KNEE_SPEC.boundaries)).toBe(1);
    expect(deductionFor(145, KNEE_SPEC)).toBe(DEDUCTION.minor);
  });

  it("경계 바로 위는 위 구간", () => {
    expect(deductionFor(145.001, KNEE_SPEC)).toBe(DEDUCTION.minor);
    expect(deductionFor(160.001, KNEE_SPEC)).toBe(DEDUCTION.major);
  });

  it("합격 구간이 가운데 있는 지표도 양쪽으로 갈린다", () => {
    expect(deductionFor(1.49, GAP_SPEC)).toBe(DEDUCTION.major);
    expect(deductionFor(1.6, GAP_SPEC)).toBe(DEDUCTION.minor);
    expect(deductionFor(2.0, GAP_SPEC)).toBe(DEDUCTION.none);
    expect(deductionFor(2.45, GAP_SPEC)).toBe(DEDUCTION.minor);
    expect(deductionFor(2.61, GAP_SPEC)).toBe(DEDUCTION.major);
  });

  it("감점 구간 수가 경계 수 + 1이 아니면 거부한다", () => {
    expect(() => deductionFor(1, { boundaries: [1, 2], deductions: [0, 0.1] })).toThrow();
  });
});

describe("gradeOf", () => {
  it("감점값이 등급 이름을 정한다", () => {
    expect(gradeOf(DEDUCTION.none)).toBe("pass");
    expect(gradeOf(DEDUCTION.minor)).toBe("minor");
    expect(gradeOf(DEDUCTION.major)).toBe("major");
  });
});

describe("distanceToNearestBoundary / epsilonFor", () => {
  it("가장 가까운 경계까지의 거리", () => {
    expect(distanceToNearestBoundary(150, [145, 160])).toBe(5);
    expect(distanceToNearestBoundary(1.55, [1.5, 1.7, 2.3, 2.6])).toBeCloseTo(0.05, 12);
  });

  it("경계가 없으면 무한대 — 구조적 판정에는 ε가 없다", () => {
    expect(distanceToNearestBoundary(3, [])).toBe(Number.POSITIVE_INFINITY);
  });

  it("단위마다 ε가 다르다", () => {
    expect(epsilonFor("deg")).toBe(EPSILON.deg);
    expect(epsilonFor("ratio")).toBe(EPSILON.ratio);
    expect(epsilonFor("s")).toBe(EPSILON.seconds);
    expect(epsilonFor("none")).toBe(0);
  });
});

describe("scoreItem — H4 경계 근접 보류", () => {
  it("경계에서 ε보다 멀면 채점한다", () => {
    const r = item(145 + EPSILON.deg + 0.001, KNEE_SPEC, "deg");
    expect(r.grade).toBe("minor");
    expect(r.deduction).toBe(DEDUCTION.minor);
    expect(r.withholdReason).toBeUndefined();
  });

  it("경계에서 ε 안이면 그 항목만 보류하고 감점하지 않는다", () => {
    const r = item(145 + EPSILON.deg - 0.001, KNEE_SPEC, "deg");
    expect(r.grade).toBe("withheld");
    expect(r.deduction).toBe(0);
    expect(r.withholdReason).toContain("H4");
  });

  it("경계 아래쪽으로 ε 안이어도 보류한다 — 합격 쪽이라고 봐주지 않는다", () => {
    const r = item(145 - EPSILON.deg + 0.001, KNEE_SPEC, "deg");
    expect(r.grade).toBe("withheld");
    expect(r.deduction).toBe(0);
  });

  it("보류해도 측정값은 남긴다 — 화면이 숫자를 보여 줄 수 있어야 한다", () => {
    const r = item(145.5, KNEE_SPEC, "deg");
    expect(r.grade).toBe("withheld");
    expect(r.measured).toBe(145.5);
    expect(r.boundaries).toEqual(STANCE.kneeAngleBoundaries);
  });

  it("측정 불가(NaN)는 0점이 아니라 보류다", () => {
    const r = item(Number.NaN, KNEE_SPEC, "deg");
    expect(r.grade).toBe("withheld");
    expect(r.measured).toBeNull();
    expect(r.deduction).toBe(0);
  });

  it("출력 숫자는 자리수가 고정된다", () => {
    const r = item(139.987654, KNEE_SPEC, "deg");
    expect(r.measured).toBe(139.988);
  });

  it("프레임 번호와 시각을 그대로 들고 나온다", () => {
    const r = item(120, KNEE_SPEC, "deg");
    expect(r.atFrame).toBe(7);
    expect(r.atTimeMs).toBe(233.3);
  });
});

describe("structuralItem", () => {
  it("위반이면 감점, 아니면 합격 — ε를 적용하지 않는다", () => {
    const base = {
      id: "B1",
      title: "순서",
      rule: "규칙",
      deduction: DEDUCTION.major,
      note: "메모",
      atFrame: 3,
      atTimeMs: 100,
    };
    expect(structuralItem({ ...base, violated: true }).deduction).toBe(DEDUCTION.major);
    expect(structuralItem({ ...base, violated: true }).grade).toBe("major");
    expect(structuralItem({ ...base, violated: false }).deduction).toBe(0);
    expect(structuralItem({ ...base, violated: false }).grade).toBe("pass");
    expect(structuralItem({ ...base, violated: true }).boundaries).toEqual([]);
  });
});

describe("finalScore — 점수 하한", () => {
  it("감점이 없으면 만점이다", () => {
    expect(finalScore(0)).toBe(MAX_SCORE);
  });

  it("감점을 그대로 뺀다", () => {
    expect(finalScore(0.3)).toBe(9.7);
    expect(finalScore(1.7)).toBe(8.3);
  });

  /**
   * 지금 규칙표에서는 최대 감점이 앞차기 1.7 / 주춤서기 1.3이라 하한이 실제로
   * 걸리지 않는다. 그래서 "하한은 0"이라는 PRD 의 보장을 규칙표가 아니라
   * 이 테스트가 지킨다 — 항목이 늘어 합이 10을 넘기는 날 음수 점수가 나오면 깨진다.
   */
  it("감점 합이 만점을 넘겨도 음수가 되지 않는다", () => {
    expect(finalScore(12)).toBe(0);
    expect(finalScore(MAX_SCORE)).toBe(0);
    expect(finalScore(MAX_SCORE + 0.1)).toBe(0);
  });

  it("부동소수점 끝자리로 흔들리지 않는다", () => {
    expect(finalScore(0.1 + 0.2)).toBe(9.7);
  });
});
