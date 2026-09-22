import { describe, expect, it } from "vitest";

import { FRONT_KICK } from "./constants";
import { findKickPhases } from "./frontKick";
import { judgeSequence } from "./judge";
import { prepareSequence } from "./prepare";
import type { CriterionResult, Grade } from "./types";
import { kickSequence, staticStanceSequence, type KickFixtureOptions } from "../samples/fixtures";

function criterion(id: string, opts: KickFixtureOptions = {}): CriterionResult {
  const judgement = judgeSequence(kickSequence(opts));
  const found = judgement.criteria.find((c) => c.id === id);
  if (found === undefined) throw new Error(`항목 ${id}이 결과에 없다.`);
  return found;
}

function grade(id: string, opts: KickFixtureOptions = {}): Grade {
  return criterion(id, opts).grade;
}

describe("상태 기계", () => {
  it("차는 다리를 데이터에서 정한다 — 사용자가 고르게 하지 않는다", () => {
    const phases = findKickPhases(prepareSequence(kickSequence()));
    expect(phases?.kicking.side).toBe("right");
    expect(phases?.support.side).toBe("left");
  });

  it("들기 → 정점 → 회수 → 착지 순서로 프레임이 잡힌다", () => {
    const p = findKickPhases(prepareSequence(kickSequence()));
    expect(p).not.toBeNull();
    const phases = p!;
    expect(phases.chamber).not.toBeNull();
    expect(phases.chamber!).toBeLessThan(phases.extension);
    expect(phases.retract).not.toBeNull();
    expect(phases.extension).toBeLessThan(phases.retract!);
    expect(phases.retract!).toBeLessThanOrEqual(phases.landing!);
  });

  it("차는 방향을 데이터에서 읽는다", () => {
    const phases = findKickPhases(prepareSequence(kickSequence()));
    expect(phases?.forwardSign).toBe(1);
  });

  it("발이 올라가지 않으면 앞차기로 보지 않는다", () => {
    // 서 있기만 한 시퀀스를 앞차기라고 주면, 들어 올린 구간이 없으므로 아무것도 찾지 못한다.
    const standing = { ...staticStanceSequence({ frames: 40 }), motion: "frontKick" as const };
    expect(findKickPhases(prepareSequence(standing))).toBeNull();
  });

  it("차기를 못 찾으면 0점이 아니라 보류다", () => {
    const standing = { ...staticStanceSequence({ frames: 40 }), motion: "frontKick" as const };
    const j = judgeSequence(standing);
    expect(j.status).toBe("withheld");
    expect(j.score).toBeNull();
    expect(j.withheld.map((w) => w.code)).toContain("H2");
  });
});

describe("B1 순서 위반", () => {
  it("무릎을 접어 올리면 합격", () => {
    expect(grade("B1", { chamber: true })).toBe("pass");
  });

  it("들기 없이 다리째 올리면 0.3 감점", () => {
    const c = criterion("B1", { chamber: false });
    expect(c.deduction).toBe(FRONT_KICK.orderViolationDeduction);
    expect(c.note).toContain("허리");
  });

  it("구조적 판정이라 ε를 적용하지 않는다 — 경계가 없다", () => {
    expect(criterion("B1", { chamber: false }).boundaries).toEqual([]);
  });

  it("무릎을 어중간하게만 접은 것은 '들기'로 치지 않는다", () => {
    // 내각 95도 → 들기로 인정. 내각 120도 → 인정하지 않는다(문턱 100도).
    expect(grade("B1", { chamberKneeFlexDeg: 85 })).toBe("pass");
    expect(grade("B1", { chamberKneeFlexDeg: 60 })).toBe("major");
  });
});

describe("B2 회수", () => {
  it("무릎을 다시 접으면 합격", () => {
    expect(grade("B2", { retract: true })).toBe("pass");
  });

  it("뻗은 채로 내리면 0.3 감점", () => {
    const c = criterion("B2", { retract: false });
    expect(c.deduction).toBe(FRONT_KICK.noRetractDeduction);
    expect(c.note).toContain("회수");
  });
});

describe("B3 높이", () => {
  it("발목이 엉덩이보다 높으면 합격", () => {
    expect(grade("B3", { apexHipDeg: 110 })).toBe("pass");
  });

  it("엉덩이 높이에 못 미치면 감점한다", () => {
    expect(criterion("B3", { apexHipDeg: 80 }).deduction).toBe(0.3);
  });

  it("측정값은 S로 나눈 비율이고 경계값을 함께 낸다", () => {
    const c = criterion("B3", { apexHipDeg: 110 });
    expect(c.unit).toBe("ratio");
    expect(c.boundaries).toEqual(FRONT_KICK.kickHeightBoundaries);
    expect(c.measured).toBeGreaterThan(0);
  });
});

describe("B4 펴짐", () => {
  it("정점 무릎 내각이 곧 측정값이다", () => {
    expect(criterion("B4", { apexKneeFlexDeg: 12 }).measured).toBe(168);
    expect(criterion("B4", { apexKneeFlexDeg: 30 }).measured).toBe(150);
  });

  it("경계 바로 위/아래가 갈린다", () => {
    // 내각 = 180 - 굴곡. 158 / 150 / 140.
    expect(grade("B4", { apexKneeFlexDeg: 22 })).toBe("pass");
    expect(grade("B4", { apexKneeFlexDeg: 30 })).toBe("minor");
    expect(grade("B4", { apexHipDeg: 125, apexKneeFlexDeg: 40 })).toBe("major");
  });

  it("경계 ±2도 안이면 보류한다", () => {
    // 내각 156 → 경계 155에서 1도.
    expect(grade("B4", { apexKneeFlexDeg: 24 })).toBe("withheld");
    expect(criterion("B4", { apexKneeFlexDeg: 24 }).deduction).toBe(0);
  });
});

describe("정점 고르기", () => {
  it("무릎을 접은 채 더 높이 올린 프레임을 정점으로 삼지 않는다", () => {
    // 찬 뒤에 무릎을 접어 더 높이 올리는 습관이 있으면 발목 높이만으로는 정점이 그쪽으로 밀린다.
    // 다리가 펴진 프레임만 후보로 두기 때문에 B4는 여전히 '뻗었다'를 읽는다.
    const c = criterion("B4", { postApexHighFold: true });
    expect(c.measured!).toBeGreaterThanOrEqual(155);
    expect(c.grade).toBe("pass");
  });

  it("정점은 들기보다 뒤, 회수보다 앞이다", () => {
    for (const opts of [{}, { postApexHighFold: true }, { apexKneeFlexDeg: 30 }]) {
      const phases = findKickPhases(prepareSequence(kickSequence(opts)))!;
      expect(phases.chamber!).toBeLessThan(phases.extension);
      expect(phases.extension).toBeLessThan(phases.retract!);
    }
  });
});

describe("B5 상체 젖힘", () => {
  it("설계한 젖힘 각이 그대로 측정된다", () => {
    expect(criterion("B5", { apexLeanDeg: 20 }).measured).toBe(20);
  });

  it("경계 바로 위/아래가 갈린다", () => {
    expect(grade("B5", { apexLeanDeg: 10 })).toBe("pass");
    expect(grade("B5", { apexLeanDeg: 20 })).toBe("minor");
    expect(grade("B5", { apexLeanDeg: 30 })).toBe("major");
  });

  it("경계 ±2도 안이면 보류", () => {
    expect(grade("B5", { apexLeanDeg: 16 })).toBe("withheld");
    expect(grade("B5", { apexLeanDeg: 24 })).toBe("withheld");
  });

  it("앞으로 숙인 것은 이 규칙이 잡는 오류가 아니다", () => {
    const c = criterion("B5", { apexLeanDeg: -12 });
    expect(c.measured).toBe(0);
    expect(c.grade).toBe("pass");
  });
});

describe("B6 축발 흔들림", () => {
  it("축발이 거의 안 움직이면 합격", () => {
    expect(grade("B6", { driftDeg: 1 })).toBe("pass");
  });

  it("많이 밀리면 0.1 감점", () => {
    const c = criterion("B6", { driftDeg: 35 });
    expect(c.measured).toBeGreaterThan(0.25);
    expect(c.deduction).toBe(0.1);
  });

  it("경계 ±0.05 안이면 보류", () => {
    expect(grade("B6", { driftDeg: 20 })).toBe("withheld");
  });
});

describe("B7 뻗기 지연", () => {
  it("빠르게 뻗으면 합격", () => {
    expect(grade("B7", { chamberToApexSeconds: 0.2 })).toBe("pass");
  });

  it("0.5초를 넘으면 0.1 감점", () => {
    const c = criterion("B7", { chamberToApexSeconds: 0.6 });
    expect(c.measured).toBeGreaterThan(0.5);
    expect(c.deduction).toBe(0.1);
  });

  it("들기가 없으면 시작점이 없으므로 '측정 안 함'이다 — 0점이 아니다", () => {
    const c = criterion("B7", { chamber: false });
    expect(c.grade).toBe("unmeasured");
    expect(c.measured).toBeNull();
    expect(c.deduction).toBe(0);
  });
});

describe("총점", () => {
  it("전부 합격이면 만점", () => {
    const j = judgeSequence(kickSequence());
    expect(j.status).toBe("judged");
    expect(j.score).toBe(10);
  });

  it("여러 항목이 걸리면 합쳐서 깎는다", () => {
    // B2 회수 생략 0.3 + B5 상체 젖힘 0.3
    const j = judgeSequence(kickSequence({ retract: false, apexLeanDeg: 30 }));
    expect(j.totalDeduction).toBe(0.6);
    expect(j.score).toBe(9.4);
  });

  it("측정하지 않기로 한 것을 이유와 함께 낸다", () => {
    const j = judgeSequence(kickSequence());
    expect(j.notMeasured.map((n) => n.title)).toContain("타격 부위(앞축)");
  });

  it("항목마다 어느 프레임에서 잰 값인지 남긴다", () => {
    const j = judgeSequence(kickSequence());
    for (const c of j.criteria) {
      expect(c.atFrame).not.toBeNull();
      expect(c.atTimeMs).not.toBeNull();
    }
  });
});
