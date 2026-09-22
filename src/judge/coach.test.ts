/**
 * 코칭 문장 생성기 테스트.
 *
 * 여기서 지키려는 것은 문장의 "말맛"이 아니라 세 가지 약속이다.
 *   1. 결정적이다 — 같은 판정이면 같은 문장.
 *   2. 판정에 없는 말을 하지 않는다 — 특히 보류를 점수로 바꾸지 않는다.
 *   3. 감점이 있으면 그 항목을 빠짐없이 짚는다.
 */

import { describe, expect, it } from "vitest";
import { ruleCoach } from "./coach";
import { judgeSequence } from "./judge";
import type { CriterionResult, Judgement } from "./types";
import { buildAllSamples } from "@/samples/build";

/** 샘플은 한 번만 굽는다. 같은 시퀀스를 반복해 넣어야 결정성 테스트가 의미 있다. */
const SAMPLES = new Map(buildAllSamples().map((s) => [s.sequence.id, s.sequence]));

function judgeSample(id: string): Judgement {
  const seq = SAMPLES.get(id);
  if (seq === undefined) throw new Error(`샘플 ${id} 이(가) 없다`);
  return judgeSequence(seq);
}

describe("ruleCoach — 만점", () => {
  const advice = ruleCoach(judgeSample("stance-good"));

  it("총평에 점수를 적는다", () => {
    expect(advice.headline).toContain("10.0");
    expect(advice.headline).toContain("주춤서기");
  });

  it("고칠 점이 없으면 fix 줄이 없다", () => {
    expect(advice.points.filter((p) => p.tone === "fix")).toHaveLength(0);
  });

  it("출처를 규칙 기반이라고 밝힌다", () => {
    expect(advice.source).toBe("rules");
    expect(advice.sourceNote).not.toBe("");
  });
});

describe("ruleCoach — 감점", () => {
  const judgement = judgeSample("frontkick-balance-broken");
  const advice = ruleCoach(judgement);

  it("감점 항목을 하나도 빠뜨리지 않는다", () => {
    const deducted = judgement.criteria.filter((c) => c.deduction > 0).map((c) => c.id);
    const mentioned = advice.points.filter((p) => p.tone === "fix").map((p) => p.criterionId);
    expect(deducted.length).toBeGreaterThan(0);
    expect(new Set(mentioned)).toEqual(new Set(deducted));
  });

  it("감점이 큰 것을 먼저 말한다", () => {
    const fixes = advice.points.filter((p) => p.tone === "fix");
    const byId = new Map(judgement.criteria.map((c) => [c.id, c.deduction]));
    for (let i = 1; i < fixes.length; i += 1) {
      const prev = byId.get(fixes[i - 1].criterionId ?? "") ?? 0;
      const cur = byId.get(fixes[i].criterionId ?? "") ?? 0;
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
  });

  it("총평이 가장 큰 감점 항목을 가리킨다", () => {
    const worst = [...judgement.criteria]
      .filter((c) => c.deduction > 0)
      .sort((a, b) => b.deduction - a.deduction || a.id.localeCompare(b.id))[0];
    expect(advice.headline).toContain(worst.id);
  });

  it("되짚을 프레임을 달아 준다", () => {
    const fixes = advice.points.filter((p) => p.tone === "fix");
    expect(fixes.some((p) => p.atFrame !== null)).toBe(true);
  });

  it("잘한 항목도 한 줄 남긴다", () => {
    expect(advice.points.some((p) => p.tone === "good")).toBe(true);
  });
});

describe("ruleCoach — 보류는 점수가 아니다", () => {
  const judgement = judgeSample("frontkick-occluded");
  const advice = ruleCoach(judgement);

  it("입력이 실제로 보류다", () => {
    expect(judgement.status).toBe("withheld");
    expect(judgement.score).toBeNull();
  });

  it("보류를 0점이라고 말하지 않는다", () => {
    expect(advice.headline).toContain("보류");
    expect(advice.headline).not.toMatch(/0\.0점|0점/);
  });

  it("보류 문장만 내고 교정 문장을 내지 않는다", () => {
    expect(advice.points.length).toBeGreaterThan(0);
    expect(advice.points.every((p) => p.tone === "hold")).toBe(true);
  });

  it("프레임이 끊긴 샘플은 그 사유를 짚는다", () => {
    const dropped = ruleCoach(judgeSample("frontkick-dropped-frames"));
    expect(dropped.points.some((p) => p.criterionId === "H3")).toBe(true);
  });
});

describe("결정성", () => {
  it("같은 판정을 몇 번 넣어도 같은 문장이 나온다", () => {
    for (const id of [
      "stance-good",
      "stance-narrow",
      "frontkick-good",
      "frontkick-underextended",
      "frontkick-balance-broken",
      "frontkick-occluded",
      "frontkick-dropped-frames",
    ]) {
      const j = judgeSample(id);
      const a = JSON.stringify(ruleCoach(j));
      const b = JSON.stringify(ruleCoach(j));
      const c = JSON.stringify(ruleCoach(judgeSample(id)));
      expect(a).toBe(b);
      expect(a).toBe(c);
    }
  });
});

describe("A1은 좁은 쪽과 넓은 쪽을 다르게 말한다", () => {
  /** A1 한 줄만 바꿔 끼운 가짜 판정. 방향 분기만 보는 것이 목적이다. */
  function withFeetGap(measured: number): Judgement {
    const base = judgeSample("stance-good");
    const a1: CriterionResult = {
      id: "A1",
      title: "발 간격",
      rule: "좌우 발목 수평거리 ÷ S",
      measured,
      unit: "ratio",
      boundaries: [1.5, 1.7, 2.3, 2.6],
      grade: "major",
      deduction: 0.3,
      note: "",
      atFrame: 10,
      atTimeMs: 333,
    };
    return { ...base, criteria: [a1], totalDeduction: 0.3, score: 9.7 };
  }

  it("좁으면 벌리라고 한다", () => {
    const text = ruleCoach(withFeetGap(1.2)).points[0].text;
    expect(text).toContain("벌려");
  });

  it("넓으면 좁히라고 한다", () => {
    const text = ruleCoach(withFeetGap(2.9)).points[0].text;
    expect(text).toContain("좁혀");
  });
});

describe("항목 보류 — 판정이 남긴 사유를 그대로 옮긴다", () => {
  /**
   * 이 묶음이 지키는 것은 PRD 6절의 간판 주장이다 —
   * "판정이 관측하지 않은 사실은 구조적으로 문장에 나올 수 없다."
   *
   * 구조적 보장은 입력에만 걸려 있다(입력이 Judgement 하나뿐이다). 그러나 매핑
   * 단계에서 보류 사유를 한 문장으로 뭉개면 그 보장이 바로 깨진다. 실제로
   * withholdReason 에는 서로 다른 사유가 최소 다섯 종류 들어온다.
   */
  function withWithheld(...items: { id: string; title: string; reason?: string; note?: string }[]): Judgement {
    const base = judgeSample("stance-good");
    const criteria: CriterionResult[] = items.map((it) => ({
      id: it.id,
      title: it.title,
      rule: "테스트용 규칙",
      measured: null,
      unit: "ratio",
      boundaries: [1],
      grade: "withheld",
      deduction: 0,
      note: it.note ?? "",
      atFrame: 7,
      atTimeMs: 233,
      ...(it.reason === undefined ? {} : { withholdReason: it.reason }),
    }));
    return { ...base, criteria, totalDeduction: 0, score: 10, status: "judged" };
  }

  it("'관절이 겹쳤다'는 사유를 '경계에 가깝다'로 바꾸지 않는다", () => {
    const reason = "필요한 관절이 겹쳐 있어 각도·비율을 낼 수 없었다.";
    const advice = ruleCoach(withWithheld({ id: "A2", title: "무릎 굽힘", reason }));
    const hold = advice.points.find((p) => p.criterionId === "A2");
    expect(hold).toBeDefined();
    expect(hold?.text).toContain(reason);
    expect(hold?.text).not.toContain("등급 경계에 너무 가까워");
  });

  it("사유가 다르면 문장도 다르다", () => {
    const advice = ruleCoach(
      withWithheld(
        { id: "A2", title: "무릎 굽힘", reason: "필요한 관절이 겹쳐 있어 각도·비율을 낼 수 없었다." },
        { id: "A5", title: "유지·흔들림", reason: "어깨 너비 S를 구할 수 없어 흔들림을 정규화하지 못했다." },
      ),
    );
    const texts = advice.points.filter((p) => p.tone === "hold").map((p) => p.text);
    expect(texts).toHaveLength(2);
    expect(texts[0]).not.toBe(texts[1]);
    expect(texts[1]).toContain("어깨 너비 S");
  });

  it("사유가 없으면 판정의 근거 문장으로 떨어진다 — 지어내지 않는다", () => {
    const advice = ruleCoach(
      withWithheld({ id: "A4", title: "상체 수직", note: "측정값을 계산할 수 없었다." }),
    );
    const hold = advice.points.find((p) => p.criterionId === "A4");
    expect(hold?.text).toContain("측정값을 계산할 수 없었다.");
  });

  it("보류 줄은 감점 줄과 섞이지 않는다", () => {
    const advice = ruleCoach(withWithheld({ id: "A2", title: "무릎 굽힘", reason: "사유 X" }));
    expect(advice.points.filter((p) => p.tone === "fix")).toHaveLength(0);
    expect(advice.points.filter((p) => p.tone === "hold")).toHaveLength(1);
  });
});

describe("전체 보류 — H4·H6 은 판정의 메시지를 그대로 쓴다", () => {
  function withNotes(...notes: { code: "H4" | "H6"; message: string }[]): Judgement {
    const base = judgeSample("stance-good");
    return { ...base, status: "withheld", score: null, withheld: notes };
  }

  it("H4 메시지를 보일러플레이트로 덮지 않는다", () => {
    const message = "A5 유지·흔들림 — 어깨 너비 S를 구할 수 없어 흔들림을 정규화하지 못했다.";
    const advice = ruleCoach(withNotes({ code: "H4", message }));
    expect(advice.points.map((p) => p.text)).toContain(message);
  });

  it("H6(카메라 각도 전제)도 판정이 쓴 문장을 그대로 낸다", () => {
    const message = "이 시퀀스는 카메라 각도를 '정면'으로 선언했는데, 앞차기 규칙은 '측면' 촬영을 전제한다.";
    const advice = ruleCoach(withNotes({ code: "H6", message }));
    expect(advice.points.map((p) => p.text)).toContain(message);
  });
});
