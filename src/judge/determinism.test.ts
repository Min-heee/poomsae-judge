/**
 * 결정성 (PRD 원칙 2).
 *
 * "같은 입력이면 같은 점수"는 이 프로젝트가 규칙 기반을 고른 이유 자체다.
 * 그러니 말로 두지 않고 시험한다.
 */

import { describe, expect, it } from "vitest";

import { judgeSequence } from "./judge";
import { RULES_VERSION } from "./constants";
import type { LandmarkSequence } from "./types";
import { kickSequence, staticStanceSequence } from "../samples/fixtures";

const CASES: { name: string; sequence: LandmarkSequence }[] = [
  { name: "주춤서기", sequence: staticStanceSequence({ frames: 40 }) },
  { name: "주춤서기(감점)", sequence: staticStanceSequence({ frames: 40, gapRatio: 1.4 }) },
  { name: "앞차기", sequence: kickSequence() },
  { name: "앞차기(회수 생략)", sequence: kickSequence({ retract: false }) },
];

describe("같은 입력이면 같은 출력", () => {
  for (const c of CASES) {
    it(`${c.name} — 반복 호출이 완전히 같은 결과를 낸다`, () => {
      const first = judgeSequence(c.sequence);
      for (let i = 0; i < 5; i++) {
        expect(judgeSequence(c.sequence)).toEqual(first);
      }
    });

    it(`${c.name} — JSON으로 직렬화해도 같다`, () => {
      const a = JSON.stringify(judgeSequence(c.sequence));
      const b = JSON.stringify(judgeSequence(c.sequence));
      expect(a).toBe(b);
    });
  }
});

describe("입력을 건드리지 않는다", () => {
  it("판정 후에도 원본 시퀀스가 그대로다", () => {
    const sequence = kickSequence();
    const before = JSON.stringify(sequence);
    judgeSequence(sequence);
    expect(JSON.stringify(sequence)).toBe(before);
  });

  it("같은 시퀀스 객체를 두 번 넘겨도 두 번째가 달라지지 않는다", () => {
    const sequence = staticStanceSequence({ frames: 40 });
    const first = judgeSequence(sequence);
    const second = judgeSequence(sequence);
    expect(second).toEqual(first);
  });
});

describe("시간 기준", () => {
  it("타임스탬프를 통째로 밀어도 판정이 같다 — 절대 시각에 기대지 않는다", () => {
    const base = kickSequence();
    const shifted: LandmarkSequence = {
      ...base,
      frames: base.frames.map((f) => ({ ...f, t: f.t + 123456 })),
    };
    const a = judgeSequence(base);
    const b = judgeSequence(shifted);
    expect(b.score).toBe(a.score);
    expect(b.criteria.map((c) => [c.id, c.measured, c.grade])).toEqual(
      a.criteria.map((c) => [c.id, c.measured, c.grade]),
    );
  });
});

describe("규칙 버전", () => {
  it("모든 판정에 규칙표 버전이 붙는다", () => {
    expect(judgeSequence(kickSequence()).rulesVersion).toBe(RULES_VERSION);
  });
});

describe("출력 숫자의 자리수가 고정된다", () => {
  it("점수는 소수 첫째 자리까지", () => {
    const j = judgeSequence(kickSequence({ retract: false, apexLeanDeg: 20 }));
    expect(j.score).toBe(9.6);
    expect(j.totalDeduction).toBe(0.4);
  });

  it("측정값에 부동소수점 찌꺼기가 남지 않는다", () => {
    const j = judgeSequence(staticStanceSequence({ frames: 40 }));
    for (const c of j.criteria) {
      if (c.measured === null) continue;
      const text = String(c.measured);
      expect(text).not.toMatch(/\d{8,}/);
    }
  });
});
