/**
 * 글자 — 자르기 · 접기 · 한글 폴백.
 *
 * 여기서 시험하는 것은 "예쁜가"가 아니라 **"넘치지 않는가"** 다.
 * 글꼴은 기기마다 다르므로, 폭을 넘긴 글자는 다른 기기에서 반드시 겹친다.
 */

import { describe, expect, it } from "vitest";

import { cardStrings, estimateMeasure, fitText, font, wrapText, type Measure } from "./text";

const F = font(500, 40);
const m: Measure = estimateMeasure;
const w = (t: string) => m(t, F).width;

describe("폭에 맞게 자르기", () => {
  it("들어가는 글자는 건드리지 않는다", () => {
    expect(fitText("주춤서기", 1000, F, m)).toBe("주춤서기");
  });

  it("넘치면 잘라 내고 말줄임을 붙인다 — 결과가 반드시 폭 안이다", () => {
    const long = "주춤서기 발 간격이 좁습니다 조금 더 벌리세요";
    const out = fitText(long, 300, F, m);
    expect(out.endsWith("...")).toBe(true);
    expect(w(out)).toBeLessThanOrEqual(300);
  });

  it("말줄임표는 마침표 셋이다 — 한글이 없는 환경에서도 그려진다", () => {
    expect(fitText("가나다라마바사", 120, F, m)).toContain("...");
    expect(fitText("가나다라마바사", 120, F, m)).not.toContain("…");
  });

  it("폭이 말줄임표조차 못 담으면 빈 문자열이다", () => {
    expect(fitText("가나다", 5, F, m)).toBe("");
    expect(fitText("가나다", 0, F, m)).toBe("");
  });
});

describe("여러 줄로 접기", () => {
  const text = "개인 학습용 데모입니다. 공인 기준이 아니며 어떤 단체의 채점표도 아닙니다.";

  it("모든 줄이 폭 안에 있다", () => {
    for (const maxWidth of [200, 320, 500, 900]) {
      for (const line of wrapText(text, maxWidth, F, m, 3)) {
        expect(w(line)).toBeLessThanOrEqual(maxWidth);
      }
    }
  });

  it("줄 수 상한을 넘지 않는다", () => {
    expect(wrapText(text, 150, F, m, 2).length).toBeLessThanOrEqual(2);
  });

  it("숫자와 단위는 중간에서 끊기지 않는다", () => {
    const lines = wrapText("측정 1.48·S 경계 1.70~2.30 입니다", 200, F, m, 4);
    const joined = lines.join("|");
    expect(joined).toContain("1.48·S");
    expect(joined).toContain("1.70~2.30");
  });

  it("규칙 ID 도 한 덩이로 남는다", () => {
    const lines = wrapText("항목 A1 과 B7 을 봅니다", 120, F, m, 4);
    expect(lines.join("|")).toContain("A1");
    expect(lines.join("|")).toContain("B7");
  });

  it("한 토큰이 폭보다 길면 그 줄을 잘라 낸다 — 넘치게 두지 않는다", () => {
    const lines = wrapText("1.2345678901234567890 뒤에 더 있는 글", 80, F, m, 3);
    for (const line of lines) expect(w(line)).toBeLessThanOrEqual(80);
  });

  it("빈 문자열과 0폭은 빈 배열", () => {
    expect(wrapText("", 100, F, m)).toEqual([]);
    expect(wrapText("가나다", 0, F, m)).toEqual([]);
  });
});

describe("글자 폭 추정", () => {
  it("글자가 늘면 폭도 는다", () => {
    expect(w("가나")).toBeGreaterThan(w("가"));
    expect(w("12345")).toBeGreaterThan(w("123"));
  });

  it("한글이 라틴 숫자보다 넓다 — 카드 레이아웃이 기대는 성질", () => {
    expect(w("가")).toBeGreaterThan(w("1"));
  });

  it("글꼴 크기에 비례한다", () => {
    const small = m("주춤서기", font(500, 20)).width;
    const big = m("주춤서기", font(500, 40)).width;
    expect(big).toBeCloseTo(small * 2, 6);
  });

  it("같은 입력이면 같은 값 — 추정기도 결정적이다", () => {
    expect(m("주춤서기 9.4점", F)).toEqual(m("주춤서기 9.4점", F));
  });
});

describe("한글 폴백 문구", () => {
  it("라틴 문구에 한글이 한 글자도 없다", () => {
    for (const v of Object.values(cardStrings(false))) {
      expect(v).not.toMatch(/[가-힣]/);
    }
  });

  it("두 벌의 열쇠가 같다 — 폴백에서 빠지는 문구가 없다", () => {
    expect(Object.keys(cardStrings(true)).sort()).toEqual(Object.keys(cardStrings(false)).sort());
  });
});
