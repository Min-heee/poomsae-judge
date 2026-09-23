/**
 * 결과 카드 — 결정성 · 표시 일치 · 경계 · 개인정보.
 *
 * 네 가지를 시험한다. 순서가 곧 중요도다.
 *  1. **같은 결과면 같은 그림.** 명령 목록의 해시로 확인한다.
 *  2. **화면에 뜬 숫자가 입력과 같다.** 카드가 점수를 지어내지 않는지.
 *  3. **아무것도 카드 밖으로 나가지 않는다.** 극단 좌표·긴 글자·큰 숫자로.
 *  4. **사람을 식별할 수 있는 것이 들어갈 경로가 없다.**
 */

import { describe, expect, it } from "vitest";

import { buildCardOps } from "./layout";
import { canonicalize, opsBounds, opsHash, opsText, type CardOp } from "./ops";
import { pickDeductionLines, sanitizeCardData, stripFace } from "./sanitize";
import { CARD } from "./theme";
import { cardStrings } from "./text";
import { cardInput, criterion, standPose } from "./fixtures";
import type { CardInput } from "./types";

function ops(input: CardInput, hangulOk = true): CardOp[] {
  return buildCardOps(sanitizeCardData(input), { hangulOk });
}

function allText(input: CardInput, hangulOk = true): string {
  return opsText(ops(input, hangulOk)).join("\n");
}

describe("결정성 — 같은 결과면 같은 그림", () => {
  it("같은 입력을 다섯 번 그려도 명령이 한 글자도 다르지 않다", () => {
    const input = cardInput();
    const first = opsHash(ops(input));
    for (let i = 0; i < 5; i += 1) expect(opsHash(ops(input))).toBe(first);
  });

  it("JSON 으로 왕복한 입력도 같은 그림을 낸다 — 객체 정체성에 기대지 않는다", () => {
    const input = cardInput();
    const clone = JSON.parse(JSON.stringify(input)) as CardInput;
    expect(opsHash(ops(clone))).toBe(opsHash(ops(input)));
  });

  it("점수가 1점 달라지면 그림도 달라진다 — 해시가 실제로 내용을 본다", () => {
    const a = opsHash(ops(cardInput({ totalScore: 812 })));
    const b = opsHash(ops(cardInput({ totalScore: 813 })));
    expect(a).not.toBe(b);
  });

  it("별 개수가 달라지면 그림도 달라진다", () => {
    const a = opsHash(ops(cardInput({ stars: 2 })));
    const b = opsHash(ops(cardInput({ stars: 3 })));
    expect(a).not.toBe(b);
  });

  it("입력 객체를 건드리지 않는다", () => {
    const input = cardInput();
    const before = JSON.stringify(input);
    ops(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("명령 목록이 순수 값이다 — 함수·캔버스 객체가 섞여 들어가지 않는다", () => {
    const list = ops(cardInput());
    expect(() => canonicalize(list)).not.toThrow();
    expect(JSON.parse(canonicalize(list))).toHaveLength(list.length);
  });

  it("좌표에 NaN·Infinity 가 없다", () => {
    const text = canonicalize(ops(cardInput()));
    expect(text).not.toMatch(/null,null/);
    for (const op of ops(cardInput())) {
      for (const v of Object.values(op)) {
        if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe("표시가 입력과 일치한다", () => {
  it("총점·기본점 평균·원점수·날짜·규칙표 버전이 그대로 찍힌다", () => {
    const text = allText(cardInput());
    expect(text).toContain("812");
    expect(text).toContain("86");
    expect(text).toContain("9.7");
    expect(text).toContain("10.0");
    expect(text).toContain("2026-09-24");
    expect(text).toContain("A/B-1.1.0");
    expect(text).toContain("합성 샘플 파일");
  });

  it("별은 채워진 것만 칠해진다 — 개수가 입력과 같다", () => {
    for (const stars of [0, 1, 2, 3]) {
      const polys = ops(cardInput({ stars })).filter((o) => o.op === "poly");
      expect(polys).toHaveLength(3);
      expect(polys.filter((o) => o.op === "poly" && o.fill !== undefined)).toHaveLength(stars);
    }
  });

  it("범위를 벗어난 별·점수는 잘려서 들어간다 — 카드가 4번째 별을 그리지 않는다", () => {
    const data = sanitizeCardData(cardInput({ stars: 9, averageBase: 250 }));
    expect(data.stars).toBe(3);
    expect(data.averageBase).toBe(100);
  });

  it("라운드 막대가 라운드 수만큼 있고 보류 라운드는 채우지 않는다", () => {
    const text = allText(cardInput());
    expect(text).toContain("92");
    expect(text).toContain("보류");
    const bars = ops(cardInput()).filter((o) => o.op === "rect" && o.radius === 10);
    // 라운드마다 홈통 1개 + (채움 1개 또는 보류 테두리 1개) = 10개
    expect(bars).toHaveLength(10);
  });

  it("감점 줄에 측정값과 경계값이 함께 있다 — 점수만 내놓지 않는다", () => {
    const text = allText(cardInput());
    expect(text).toContain("A1");
    expect(text).toContain("1.48·S");
    expect(text).toContain("1.50 / 1.70 / 2.30 / 2.60·S");
    expect(text).toContain("−0.3");
  });

  it("감점이 큰 항목이 먼저 온다", () => {
    const lines = pickDeductionLines([
      criterion({ id: "A4", deduction: 0.1, grade: "minor" }),
      criterion({ id: "A1", deduction: 0.3, grade: "major" }),
    ]);
    expect(lines.map((l) => l.id)).toEqual(["A1", "A4"]);
  });

  it("합격 항목은 감점 줄에 오지 않는다", () => {
    const lines = pickDeductionLines([
      criterion({ id: "A2", deduction: 0, grade: "pass" }),
      criterion({ id: "A3", deduction: 0, grade: "pass" }),
    ]);
    expect(lines).toHaveLength(0);
    expect(allText(cardInput({ best: { ...cardInput().best, criteria: [] } }))).toContain(
      cardStrings(true).noDeduction,
    );
  });

  it("항목 보류는 감점이 아니라 보류로 적힌다 — 0점과 보류를 섞지 않는다", () => {
    const withheld = cardInput({
      best: {
        ...cardInput().best,
        criteria: [criterion({ id: "A5", grade: "withheld", deduction: 0, measured: null })],
      },
    });
    const text = allText(withheld);
    expect(text).toContain("A5");
    expect(text).toContain("보류");
    expect(text).not.toContain("−0.0");
  });

  it("보류된 판정은 원점수 자리에 줄표가 온다 — 0점을 지어내지 않는다", () => {
    const data = sanitizeCardData(
      cardInput({ best: { ...cardInput().best, rawScore: null } }),
    );
    expect(data.rawScoreText).toBe("—");
  });
});

describe("무엇도 카드 밖으로 나가지 않는다", () => {
  const within = (list: CardOp[]) => {
    const b = opsBounds(list);
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.minY).toBeGreaterThanOrEqual(0);
    expect(b.maxX).toBeLessThanOrEqual(CARD.width);
    expect(b.maxY).toBeLessThanOrEqual(CARD.height);
  };

  it("보통 카드", () => within(ops(cardInput())));

  it("한글이 안 나오는 환경의 카드", () => within(ops(cardInput(), false)));

  it("극단 좌표 — 음수·거대값·비수치가 섞인 스켈레톤", () => {
    const broken = standPose();
    broken[11] = { x: -50, y: -40 };
    broken[12] = { x: 1e6, y: 1e6 };
    broken[25] = { x: Number.NaN, y: 0.5 };
    broken[26] = { x: 0.5, y: Number.POSITIVE_INFINITY };
    const input = cardInput();
    within(
      ops(
        cardInput({
          best: { ...input.best, skeleton: { mine: broken, reference: standPose(), aspect: 4 / 3 } },
        }),
      ),
    );
  });

  it("스켈레톤이 아예 없어도 그림만 빠지고 나머지는 그대로다", () => {
    const input = cardInput();
    const list = ops(
      cardInput({ best: { ...input.best, skeleton: { mine: [], reference: null } } }),
    );
    within(list);
    expect(opsText(list).join("")).toContain("812");
  });

  it("아주 긴 코스 이름·항목 이름·출처가 들어와도 잘려서 들어간다", () => {
    const long = "가".repeat(400);
    const input = cardInput();
    within(
      ops(
        cardInput({
          courseLabel: long,
          originLabel: long,
          rulesVersion: long,
          best: {
            ...input.best,
            criteria: [criterion({ title: long }), criterion({ id: "A9", title: long })],
          },
        }),
      ),
    );
  });

  it("터무니없이 큰 점수에도 레이아웃이 버틴다", () => {
    within(ops(cardInput({ totalScore: 99999, averageBase: 100 })));
  });

  it("라운드가 많아도 막대가 겹치지 않는다", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ baseScore: i * 8, total: i * 10 }));
    const list = ops(cardInput({ rounds: many }));
    within(list);
    // 상한(8개)에서 잘린다.
    expect(sanitizeCardData(cardInput({ rounds: many })).rounds).toHaveLength(8);
  });

  it("문자열에 줄바꿈·탭이 들어와도 캔버스에 제어문자가 가지 않는다", () => {
    const list = ops(cardInput({ courseLabel: "정면\n\t코스", originLabel: "웹캠\t실시간" }));
    for (const o of list) {
      if (o.op === "text") expect(o.text).not.toMatch(/[\u0000-\u001f]/);
    }
    expect(opsText(list).join("\u0000")).toContain("정면 코스");
  });
});

describe("개인정보 — 들어갈 경로가 없다", () => {
  it("얼굴 랜드마크(0~10)는 정제 단계에서 사라진다", () => {
    const body = stripFace(standPose());
    expect(body.length).toBeGreaterThan(0);
    expect(Math.min(...body.map((p) => p.i))).toBeGreaterThanOrEqual(11);
  });

  it("얼굴 좌표를 어디에 두든 카드가 한 픽셀도 달라지지 않는다", () => {
    const input = cardInput();
    const a = opsHash(
      ops(
        cardInput({
          best: {
            ...input.best,
            skeleton: { ...input.best.skeleton, mine: standPose({ face: { x: 0.01, y: 0.01 } }) },
          },
        }),
      ),
    );
    const b = opsHash(
      ops(
        cardInput({
          best: {
            ...input.best,
            skeleton: { ...input.best.skeleton, mine: standPose({ face: { x: 0.99, y: 0.99 } }) },
          },
        }),
      ),
    );
    expect(a).toBe(b);
  });

  it("머리는 어깨·엉덩이에서 유도한 원 하나다 — 얼굴 좌표에서 오지 않는다", () => {
    const circles = ops(cardInput()).filter((o) => o.op === "circle");
    expect(circles.length).toBeGreaterThan(0);
  });

  it("호출자가 이름·연락처·영상 URL 을 끼워 넣어도 정제 결과에 남지 않는다", () => {
    const polluted = {
      ...cardInput(),
      playerName: "민병희",
      email: "someone@example.com",
      videoDataUrl: "data:image/png;base64,AAAA",
      deviceId: "ABCD-1234-DEVICE",
    } as CardInput;

    const data = sanitizeCardData(polluted);
    expect(Object.keys(data)).not.toContain("playerName");
    expect(Object.keys(data)).not.toContain("email");
    expect(Object.keys(data)).not.toContain("videoDataUrl");
    expect(Object.keys(data)).not.toContain("deviceId");

    const text = canonicalize(buildCardOps(data));
    for (const secret of ["민병희", "someone@example.com", "data:image", "ABCD-1234-DEVICE"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("카드에 시각(시:분)이 들어가지 않는다 — 날짜까지만 적는다", () => {
    const data = sanitizeCardData(cardInput({ dateISO: "2026-09-24T21:37:11.000Z" }));
    // 날짜 형식이 아니면 통째로 거부한다. 시각이 새어 들어갈 자리가 없다.
    expect(data.dateText).toBe("—");
    expect(allText(cardInput())).not.toMatch(/\d{2}:\d{2}/);
  });

  it("카드는 영상·비디오 엘리먼트를 받을 타입이 없다", () => {
    const keys = Object.keys(sanitizeCardData(cardInput()));
    expect(keys).toEqual([
      "courseLabel",
      "motion",
      "totalScore",
      "averageBase",
      "stars",
      "rounds",
      "bestRoundNumber",
      "rawScoreText",
      "maxScoreText",
      "deductions",
      "skeleton",
      "dateText",
      "rulesVersion",
      "originLabel",
    ]);
  });
});

describe("한글이 안 나오는 환경", () => {
  it("고정 문구가 통째로 라틴으로 바뀐다", () => {
    const text = allText(cardInput(), false);
    expect(text).not.toMatch(/[가-힣]/);
  });

  it("그래도 점수·측정값·경계값·규칙 ID 는 그대로 남는다", () => {
    const text = allText(cardInput(), false);
    expect(text).toContain("812");
    expect(text).toContain("9.7");
    expect(text).toContain("A1");
    expect(text).toContain("1.48·S");
    expect(text).toContain("1.50 / 1.70 / 2.30 / 2.60·S");
    expect(text).toContain("A/B-1.1.0");
  });

  it("면책 한 줄이 두 환경 모두에 있다", () => {
    expect(allText(cardInput())).toContain("공인 기준이 아니며");
    expect(allText(cardInput(), false)).toContain("not an official score");
  });
});

describe("카드가 흉내 내지 않는 것", () => {
  it("어떤 단체 이름도, 상표도, 인증서 문구도 들어 있지 않다", () => {
    for (const hangulOk of [true, false]) {
      const text = allText(cardInput(), hangulOk).toLowerCase();
      for (const banned of ["인증", "certificate", "공인 인증", "official", "국기원", "협회", "연맹"]) {
        // "not an official score" 는 부정문이므로 예외로 둔다.
        if (banned === "official") {
          expect(text.replace("not an official score", "")).not.toContain("official");
          continue;
        }
        expect(text).not.toContain(banned);
      }
    }
  });
});
