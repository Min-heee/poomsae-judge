import { describe, expect, it } from "vitest";

import { EPSILON, METRIC_LABEL, STANCE } from "./constants";
import { judgeSequence } from "./judge";
import type { CriterionResult, Grade, LandmarkSequence } from "./types";
import { staticStanceSequence, type StanceFixtureOptions } from "../samples/fixtures";

function criterion(id: string, opts: StanceFixtureOptions = {}): CriterionResult {
  const judgement = judgeSequence(staticStanceSequence(opts));
  const found = judgement.criteria.find((c) => c.id === id);
  if (found === undefined) throw new Error(`항목 ${id}이 결과에 없다.`);
  return found;
}

function grade(id: string, opts: StanceFixtureOptions = {}): Grade {
  return criterion(id, opts).grade;
}

describe("A1 발 간격", () => {
  it("합격 구간 안이면 감점 없음", () => {
    expect(grade("A1", { gapRatio: 2.0 })).toBe("pass");
  });

  it("합격 경계에서 ε보다 안쪽으로 들어오면 합격", () => {
    // 합격은 1.70부터. ε(0.05)보다 멀리 떨어져야 채점된다.
    expect(grade("A1", { gapRatio: 1.7 + EPSILON.ratio + 0.01 })).toBe("pass");
    expect(grade("A1", { gapRatio: 2.3 - EPSILON.ratio - 0.01 })).toBe("pass");
  });

  it("좁으면 0.1, 더 좁으면 0.3", () => {
    expect(criterion("A1", { gapRatio: 1.6 }).deduction).toBe(0.1);
    expect(criterion("A1", { gapRatio: 1.4 }).deduction).toBe(0.3);
  });

  it("넓어도 같은 방식으로 감점한다", () => {
    expect(criterion("A1", { gapRatio: 2.45 }).deduction).toBe(0.1);
    expect(criterion("A1", { gapRatio: 2.8 }).deduction).toBe(0.3);
  });

  it("경계 ±0.05 안이면 그 항목만 보류한다", () => {
    expect(grade("A1", { gapRatio: 1.71 })).toBe("withheld");
    expect(grade("A1", { gapRatio: 1.68 })).toBe("withheld");
    expect(criterion("A1", { gapRatio: 1.71 }).deduction).toBe(0);
  });

  it("측정값이 설계값과 같다 — 기준 길이 S로 정규화되므로", () => {
    expect(criterion("A1", { gapRatio: 2.0 }).measured).toBe(2);
    expect(criterion("A1", { gapRatio: 1.35 }).measured).toBe(1.35);
  });
});

describe("A2 무릎 굽힘", () => {
  it("합격선 안쪽이면 감점 없음", () => {
    expect(grade("A2", { kneeLeftDeg: 138, kneeRightDeg: 140 })).toBe("pass");
  });

  it("덜 굽은 쪽으로 채점한다", () => {
    // 한쪽은 합격인데 다른 쪽이 152면 152로 매긴다.
    const c = criterion("A2", { kneeLeftDeg: 138, kneeRightDeg: 152 });
    expect(c.measured).toBe(152);
    expect(c.grade).toBe("minor");
  });

  it("경계 바로 위/아래가 갈린다", () => {
    expect(grade("A2", { kneeLeftDeg: 142, kneeRightDeg: 142 })).toBe("pass");
    expect(grade("A2", { kneeLeftDeg: 148, kneeRightDeg: 148 })).toBe("minor");
    expect(grade("A2", { kneeLeftDeg: 165, kneeRightDeg: 165 })).toBe("major");
  });

  it("경계 ±2도 안이면 보류한다", () => {
    expect(grade("A2", { kneeLeftDeg: 146, kneeRightDeg: 145 })).toBe("withheld");
    expect(grade("A2", { kneeLeftDeg: 159, kneeRightDeg: 159 })).toBe("withheld");
  });
});

describe("A3 좌우 대칭", () => {
  it("차이가 작으면 합격", () => {
    expect(criterion("A3", { kneeLeftDeg: 138, kneeRightDeg: 140 }).measured).toBe(2);
    expect(grade("A3", { kneeLeftDeg: 138, kneeRightDeg: 140 })).toBe("pass");
  });

  it("8도를 넘으면 0.1, 15도를 넘으면 0.3", () => {
    expect(criterion("A3", { kneeLeftDeg: 138, kneeRightDeg: 150 }).deduction).toBe(0.1);
    expect(criterion("A3", { kneeLeftDeg: 138, kneeRightDeg: 158 }).deduction).toBe(0.3);
  });

  it("경계 근처는 보류", () => {
    expect(grade("A3", { kneeLeftDeg: 138, kneeRightDeg: 145.5 })).toBe("withheld");
  });

  it("좌우를 뒤집어도 같은 값이 나온다 — 부호가 아니라 차이를 잰다", () => {
    const a = criterion("A3", { kneeLeftDeg: 138, kneeRightDeg: 150 }).measured;
    const b = criterion("A3", { kneeLeftDeg: 150, kneeRightDeg: 138 }).measured;
    expect(a).toBe(b);
  });
});

describe("A4 상체 수직", () => {
  it("경계 바로 위/아래가 갈린다", () => {
    expect(grade("A4", { torsoTiltDeg: 5 })).toBe("pass");
    expect(grade("A4", { torsoTiltDeg: 14 })).toBe("minor");
    expect(grade("A4", { torsoTiltDeg: 22 })).toBe("major");
  });

  it("경계 ±2도 안이면 보류", () => {
    expect(grade("A4", { torsoTiltDeg: 11 })).toBe("withheld");
    expect(grade("A4", { torsoTiltDeg: 19 })).toBe("withheld");
  });

  it("측정값이 설계한 기울기와 같다", () => {
    expect(criterion("A4", { torsoTiltDeg: 14 }).measured).toBe(14);
  });
});

describe("A5 유지·흔들림", () => {
  const fps = 30;

  it("충분히 오래 멈춰 있으면 합격", () => {
    // 40프레임 = 1.3초
    expect(grade("A5", { frames: 40, fps })).toBe("pass");
  });

  it("유지 시간이 모자라면 0.1 감점", () => {
    // 16프레임 = 0.5초
    const c = criterion("A5", { frames: 16, fps });
    expect(c.grade).toBe("minor");
    expect(c.deduction).toBe(STANCE.holdDeduction);
    expect(c.note).toContain("0.5");
  });

  it("유지 시간이 기준 0.8초 경계에 있으면 보류", () => {
    // 25프레임 = 정확히 0.8초
    expect(grade("A5", { frames: 25, fps })).toBe("withheld");
  });

  it("경계에서 한 프레임만 넘어가도 채점으로 돌아온다", () => {
    // 27프레임 = 0.867초. 경계에서 ε(0.03초)보다 멀다.
    expect(grade("A5", { frames: 27, fps })).toBe("pass");
  });

  it("완전히 정지한 자세의 흔들림은 0이다", () => {
    expect(criterion("A5", { frames: 40, fps }).measured).toBe(0);
  });

  it("작게 흔들리는 것은 허용한다", () => {
    // 무릎 각도 ±4도 → 엉덩이 높이 표준편차 약 0.018·S (기준 0.03·S 안쪽).
    const c = criterion("A5", { frames: 120, fps, swayAmplitudeDeg: 4 });
    expect(c.measured!).toBeLessThan(STANCE.maxHipSwayRatio);
    expect(c.grade).toBe("pass");
  });

  it("크게 흔들리면 유지 시간을 채워도 0.1 감점", () => {
    // 무릎 각도 ±8도 → 약 0.035·S. 4초를 버텨도 자세가 가만있지 않았다.
    const c = criterion("A5", { frames: 120, fps, swayAmplitudeDeg: 8 });
    expect(c.measured!).toBeGreaterThan(STANCE.maxHipSwayRatio);
    expect(c.grade).toBe("minor");
    expect(c.deduction).toBe(STANCE.holdDeduction);
    expect(c.note).toContain(METRIC_LABEL.hipSway);
  });

  it("흔들려도 나머지 항목은 중앙값으로 멀쩡히 채점한다", () => {
    const j = judgeSequence(staticStanceSequence({ frames: 120, fps, swayAmplitudeDeg: 8 }));
    expect(j.criteria.find((c) => c.id === "A1")?.grade).toBe("pass");
    expect(j.criteria.find((c) => c.id === "A2")?.grade).toBe("pass");
    expect(j.score).toBe(9.9);
  });

  it("흔들림 문턱은 S에 비례한다 — 경계값을 그대로 노출한다", () => {
    expect(criterion("A5", { frames: 40, fps }).boundaries).toEqual([STANCE.maxHipSwayRatio]);
  });
});

/**
 * 차렷 — 발을 모으고 무릎을 편 채 가만히 서 있는 자세.
 * 구간 탐지 조건(무릎 ≤ 160°, 발 간격 ≥ 1.2·S) 중 둘을 동시에 어긴다.
 */
const STANDING_STILL: StanceFixtureOptions = {
  gapRatio: 0.35,
  kneeLeftDeg: 178,
  kneeRightDeg: 177,
  torsoTiltDeg: 2,
};

/** 차렷으로 선 시퀀스에서 한 프레임만 제대로 된 주춤서기로 바꾼다. 타임스탬프는 그대로다. */
function standingWithOneStanceFrame(index: number, frames = 40): LandmarkSequence {
  const standing = staticStanceSequence({ ...STANDING_STILL, frames });
  const stance = staticStanceSequence({ frames });
  return {
    ...standing,
    frames: standing.frames.map((f, i) =>
      i === index ? { t: f.t, landmarks: stance.frames[i].landmarks } : f,
    ),
  };
}

describe("H7 주춤서기로 볼 멈춘 구간", () => {
  it("차렷으로 가만히 서 있으면 점수를 내지 않는다", () => {
    // 이 입력의 A3(좌우 대칭)·A4(상체 수직)는 가만히 서 있다는 이유만으로 통과한다.
    // H7이 없으면 A1·A2 감점만 붙은 '판정 완료'가 되어 9.3점이 나왔다.
    const j = judgeSequence(staticStanceSequence({ ...STANDING_STILL, frames: 40 }));
    expect(j.status).toBe("withheld");
    expect(j.score).toBeNull();
    expect(j.withheld.map((w) => w.code)).toContain("H7");
  });

  it("보류 사유에 실제 경계값과 할 일을 적는다", () => {
    const j = judgeSequence(staticStanceSequence({ ...STANDING_STILL, frames: 40 }));
    const h7 = j.withheld.find((w) => w.code === "H7");
    expect(h7?.message).toContain(`${STANCE.engagedKneeAngleMax}°`);
    expect(h7?.message).toContain(`${STANCE.engagedFeetGapMin}배`);
    expect(h7?.message).toContain(`${STANCE.minHoldSeconds}초`);
  });

  it("감점은 되지만 자세를 잡은 경우는 그대로 채점한다", () => {
    // 발 1.55(0.1 감점) · 무릎 155°(0.1 감점). "나쁜 자세"는 보류가 아니라 감점이다.
    const j = judgeSequence(
      staticStanceSequence({ frames: 40, gapRatio: 1.55, kneeLeftDeg: 155, kneeRightDeg: 155 }),
    );
    expect(j.status).toBe("judged");
    expect(j.score).toBe(9.8);
    expect(j.withheld.map((w) => w.code)).not.toContain("H7");
  });

  it("정상 주춤서기는 보류가 하나도 붙지 않는다", () => {
    const j = judgeSequence(staticStanceSequence({ frames: 40 }));
    expect(j.status).toBe("judged");
    expect(j.score).toBe(10);
    expect(j.withheld).toEqual([]);
  });

  it("문턱은 한 프레임이다 — 주춤서기로 볼 프레임이 하나라도 있으면 채점한다", () => {
    // 같은 40프레임인데 19번 한 프레임만 주춤서기다. 그 한 프레임이 있으면 H7은 닫히지 않고,
    // "구간이 짧다"는 사실은 A5가 0.1 감점으로 말한다. 보류는 '자세 아님'에만 쓴다.
    const judged = judgeSequence(standingWithOneStanceFrame(19));
    expect(judged.status).toBe("judged");
    expect(judged.withheld.map((w) => w.code)).not.toContain("H7");
    expect(judged.criteria.find((c) => c.id === "A5")?.grade).toBe("minor");

    // 그 한 프레임을 되돌리면(= 전부 차렷) 같은 길이·같은 fps인데 보류로 넘어간다.
    const withheld = judgeSequence(staticStanceSequence({ ...STANDING_STILL, frames: 40 }));
    expect(withheld.status).toBe("withheld");
    expect(withheld.withheld.map((w) => w.code)).toContain("H7");
  });

  it("무릎만 편 채 발을 벌려도 주춤서기가 아니다", () => {
    const j = judgeSequence(
      staticStanceSequence({ frames: 40, gapRatio: 2.0, kneeLeftDeg: 178, kneeRightDeg: 177 }),
    );
    expect(j.status).toBe("withheld");
    expect(j.withheld.map((w) => w.code)).toContain("H7");
  });

  it("보류여도 감점 항목은 그대로 남는다 — 왜 보류인지 읽을 수 있어야 한다", () => {
    const j = judgeSequence(staticStanceSequence({ ...STANDING_STILL, frames: 40 }));
    expect(j.score).toBeNull();
    expect(j.criteria.find((c) => c.id === "A1")?.deduction).toBeGreaterThan(0);
    expect(j.criteria.find((c) => c.id === "A2")?.deduction).toBeGreaterThan(0);
  });
});

describe("총점", () => {
  it("전부 합격이면 만점", () => {
    const j = judgeSequence(staticStanceSequence({ frames: 40 }));
    expect(j.status).toBe("judged");
    expect(j.score).toBe(10);
    expect(j.totalDeduction).toBe(0);
  });

  it("감점이 쌓이면 그만큼 깎인다", () => {
    // A1 0.3(좁음) + A4 0.1(기울기 14도)
    const j = judgeSequence(staticStanceSequence({ frames: 40, gapRatio: 1.4, torsoTiltDeg: 14 }));
    expect(j.totalDeduction).toBe(0.4);
    expect(j.score).toBe(9.6);
  });

  it("측정하지 않기로 한 항목을 빈칸으로 두지 않는다", () => {
    const j = judgeSequence(staticStanceSequence({ frames: 40 }));
    expect(j.notMeasured.map((n) => n.title)).toContain("체중 배분 50:50");
    expect(j.notMeasured.every((n) => n.reason.length > 0)).toBe(true);
  });

  it("모든 감점 항목이 측정값과 경계값을 함께 낸다 (PRD F3)", () => {
    const j = judgeSequence(staticStanceSequence({ frames: 40, gapRatio: 1.4 }));
    for (const c of j.criteria) {
      if (c.deduction === 0) continue;
      expect(c.measured).not.toBeNull();
      expect(c.boundaries.length).toBeGreaterThan(0);
      expect(c.note.length).toBeGreaterThan(0);
    }
  });
});
