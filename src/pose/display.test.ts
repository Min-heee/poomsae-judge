/**
 * 앱 안에서 읽는 규칙 표 테스트.
 *
 * 이 파일이 지키려는 것은 하나다 — **화면이 판정과 다른 말을 하지 않는가.**
 *
 * 규칙 표와 보류 규칙은 심사위원이 "이 점수가 어디서 나왔는가"를 눌러 볼 때 읽는
 * 화면이고, 그러면서도 판정 코어와 달리 테스트가 한 줄도 없던 자리였다. 보류 코드를
 * 하나 더하고 표에 행을 빠뜨려도, 표가 코드로는 도달할 수 없는 칸을 약속해도,
 * 288개 테스트가 전부 통과했다.
 */

import { describe, expect, it } from "vitest";

import { STANCE } from "@/judge/constants";
import { judgeSequence } from "@/judge";
import type { WithholdCode } from "@/judge/types";
import { staticStanceSequence } from "@/samples/fixtures";
import { HOLD_RULES, RULE_TABLE, holdRulesFor } from "./display";

/** 판정이 실제로 낼 수 있는 보류 코드. 하나라도 늘면 이 목록과 표가 함께 바뀌어야 한다. */
const ALL_CODES: WithholdCode[] = ["H1", "H2", "H3", "H4", "H5", "H6", "H7"];

describe("보류 규칙 — 판정이 내는 코드와 화면의 표가 일대일이다", () => {
  it("모든 코드에 설명이 있고, 빈 문장이 없다", () => {
    expect(HOLD_RULES.map((h) => h.code).sort()).toEqual([...ALL_CODES].sort());
    for (const rule of HOLD_RULES) expect(rule.text.length).toBeGreaterThan(10);
  });

  it("H7 행이 실제 경계값을 그대로 적는다 — 문구만 남고 게이트가 넓어지는 일이 없게", () => {
    const h7 = HOLD_RULES.find((h) => h.code === "H7");
    expect(h7?.text).toContain(`${STANCE.engagedKneeAngleMax}°`);
    expect(h7?.text).toContain(`${STANCE.engagedFeetGapMin}·S`);
    expect(h7?.text).toContain(`${STANCE.settleSpeedMaxMps}m/s`);
    expect(h7?.text).toContain(`${STANCE.settledMinSeconds}초`);
  });

  it("주춤서기 전용 보류는 앞차기 표에 나오지 않는다", () => {
    expect(holdRulesFor("stance").map((h) => h.code)).toContain("H7");
    expect(holdRulesFor("frontKick").map((h) => h.code)).not.toContain("H7");
    // 동작을 가리지 않는 것은 양쪽에 다 있어야 한다.
    expect(holdRulesFor("frontKick").map((h) => h.code)).toContain("H6");
  });
});

describe("규칙 표 — 판정이 내는 항목과 같은 목록이다", () => {
  it("주춤서기 표의 행이 판정 결과의 항목과 일치한다", () => {
    const judged = judgeSequence(staticStanceSequence({ frames: 40 }));
    expect(RULE_TABLE.stance.rows.map((r) => r.id)).toEqual(judged.criteria.map((c) => c.id));
  });

  it("A2의 0.3 감점 칸이 실제 경계값을 가리킨다", () => {
    // 이 칸이 가리키는 구간(> 160°)에 도달할 수 있다는 것은 stance.test.ts 가 따로 못 박는다.
    // 여기서는 화면의 숫자가 상수에서 온 값인지만 본다.
    const a2 = RULE_TABLE.stance.rows.find((r) => r.id === "A2");
    expect(a2?.major).toContain(`${STANCE.kneeAngleBoundaries[1]}`);
  });
});
