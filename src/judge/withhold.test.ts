/**
 * 판정 보류 H1~H7.
 *
 * 이 파일이 지키려는 성질 하나: **보류는 0점이 아니다.**
 * score가 0인 것과 score가 null인 것은 다른 결과이고, 화면도 다르게 말해야 한다.
 */

import { describe, expect, it } from "vitest";

import { REQUIRED_VIEW, WITHHOLD } from "./constants";
import { formatFrameRanges, judgeSequence } from "./judge";
import { LM } from "./landmarks";
import type { LandmarkSequence, WithholdCode } from "./types";
import {
  blurFrames,
  kickSequence,
  removeFrames,
  staticStanceSequence,
} from "../samples/fixtures";

function codes(sequence: LandmarkSequence): WithholdCode[] {
  return judgeSequence(sequence).withheld.map((w) => w.code);
}

const ESSENTIAL_PAIR = [LM.rightKnee, LM.rightAnkle];

describe("H1 — 흐린 프레임은 경고로 남는다", () => {
  it("문턱을 안 넘으면 채점은 계속하되 프레임 번호를 남긴다", () => {
    const base = staticStanceSequence({ frames: 40 });
    const seq = blurFrames(base, 2, 4, ESSENTIAL_PAIR, 0.3); // 3/40 = 7.5%
    const j = judgeSequence(seq);
    expect(j.status).toBe("judged");
    expect(j.score).not.toBeNull();
    const h1 = j.withheld.find((w) => w.code === "H1");
    expect(h1?.frames).toEqual([2, 3, 4]);
    expect(h1?.message).toContain("2~4");
  });

  it("흐린 프레임이 없으면 H1 경고도 없다", () => {
    expect(codes(staticStanceSequence({ frames: 40 }))).not.toContain("H1");
  });
});

describe("H2 — 무효 프레임 비율", () => {
  it("20%를 넘으면 전체 보류", () => {
    const base = staticStanceSequence({ frames: 40 });
    const seq = blurFrames(base, 0, 19, ESSENTIAL_PAIR, 0.3); // 50%
    const j = judgeSequence(seq);
    expect(j.status).toBe("withheld");
    expect(j.score).toBeNull();
    expect(j.withheld.map((w) => w.code)).toContain("H2");
  });

  it("문턱 바로 아래는 채점한다", () => {
    const base = staticStanceSequence({ frames: 50 });
    const seq = blurFrames(base, 0, 9, ESSENTIAL_PAIR, 0.3); // 정확히 20%
    const j = judgeSequence(seq);
    expect(j.frameStats.invalidRatio).toBe(WITHHOLD.maxInvalidRatio);
    expect(j.status).toBe("judged");
  });

  it("문턱 바로 위는 보류한다", () => {
    const base = staticStanceSequence({ frames: 50 });
    const seq = blurFrames(base, 0, 10, ESSENTIAL_PAIR, 0.3); // 22%
    expect(judgeSequence(seq).status).toBe("withheld");
  });

  it("보류 사유에 무효 프레임 번호가 들어간다", () => {
    const base = kickSequence();
    const seq = blurFrames(base, 5, 40, ESSENTIAL_PAIR, 0.3);
    const h2 = judgeSequence(seq).withheld.find((w) => w.code === "H2");
    expect(h2?.frames?.length).toBeGreaterThan(0);
    expect(h2?.message).toContain("%");
  });

  it("흐려서 못 봤다는 말을 두 번 하지 않는다", () => {
    const base = kickSequence();
    const seq = blurFrames(base, 0, 60, ESSENTIAL_PAIR, 0.3);
    const h2 = judgeSequence(seq).withheld.filter((w) => w.code === "H2");
    expect(h2).toHaveLength(1);
  });
});

describe("H3 — 끊긴 프레임", () => {
  it("120ms를 넘게 비면 전체 보류", () => {
    const seq = removeFrames(kickSequence(), 20, 25);
    const j = judgeSequence(seq);
    expect(j.status).toBe("withheld");
    expect(j.score).toBeNull();
    const h3 = j.withheld.find((w) => w.code === "H3");
    expect(h3?.message).toContain("ms 비었다");
    expect(h3?.frames).toEqual([19]);
  });

  it("한 프레임만 빠진 것(=33ms)은 보류하지 않는다", () => {
    const seq = removeFrames(kickSequence(), 20, 20);
    expect(judgeSequence(seq).status).toBe("judged");
  });

  it("메울 수 있는 결손은 메우고 그 사실을 보고한다", () => {
    // 3프레임(=100ms) 결손은 보간 대상.
    const seq = removeFrames(kickSequence(), 20, 21);
    const j = judgeSequence(seq);
    expect(j.status).toBe("judged");
    expect(j.frameStats.interpolated).toBeGreaterThan(0);
  });

  it("보류해도 잰 값은 화면에 남긴다 — 왜 못 믿는지 보이려면 값이 있어야 한다", () => {
    const j = judgeSequence(removeFrames(kickSequence(), 20, 25));
    expect(j.criteria.length).toBeGreaterThan(0);
    expect(j.score).toBeNull();
  });
});

describe("H4 — 경계에 붙은 항목", () => {
  it("항목 하나가 보류돼도 나머지로 채점한다", () => {
    // A1만 경계(1.71)에 붙는다.
    const j = judgeSequence(staticStanceSequence({ frames: 40, gapRatio: 1.71 }));
    expect(j.status).toBe("judged");
    expect(j.criteria.find((c) => c.id === "A1")?.grade).toBe("withheld");
    expect(j.withheld.filter((w) => w.code === "H4")).toHaveLength(1);
  });

  it("보류한 항목은 총점에서 빠진다 — 감점도 가점도 아니다", () => {
    const j = judgeSequence(staticStanceSequence({ frames: 40, gapRatio: 1.71 }));
    expect(j.totalDeduction).toBe(0);
    expect(j.score).toBe(10);
  });

  it("보류 사유에 항목 번호와 H4가 들어간다", () => {
    const j = judgeSequence(staticStanceSequence({ frames: 40, gapRatio: 1.71 }));
    const h4 = j.withheld.find((w) => w.code === "H4");
    expect(h4?.message).toContain("A1");
    expect(h4?.message).toContain("H4");
  });
});

describe("H5 — 보류 항목이 많으면 전체 보류", () => {
  it("항목 2개가 경계에 붙으면 전체 보류", () => {
    // A1(1.71)과 A4(11) 둘 다 경계 근처.
    const j = judgeSequence(
      staticStanceSequence({ frames: 40, gapRatio: 1.71, torsoTiltDeg: 11 }),
    );
    const withheldItems = j.criteria.filter((c) => c.grade === "withheld");
    expect(withheldItems).toHaveLength(WITHHOLD.maxWithheldCriteria);
    expect(j.status).toBe("withheld");
    expect(j.score).toBeNull();
    expect(j.withheld.map((w) => w.code)).toContain("H5");
  });

  it("하나면 보류하지 않는다 — 문턱이 2개다", () => {
    const j = judgeSequence(staticStanceSequence({ frames: 40, gapRatio: 1.71 }));
    expect(j.status).toBe("judged");
    expect(j.withheld.map((w) => w.code)).not.toContain("H5");
  });

  it("H5 사유에 어떤 항목이 빠졌는지 적는다", () => {
    const j = judgeSequence(
      staticStanceSequence({ frames: 40, gapRatio: 1.71, torsoTiltDeg: 11 }),
    );
    const h5 = j.withheld.find((w) => w.code === "H5");
    expect(h5?.message).toContain("A1");
    expect(h5?.message).toContain("A4");
  });
});

describe("보류와 0점은 다르다", () => {
  it("보류는 score가 null이고 status가 withheld다", () => {
    const j = judgeSequence(removeFrames(kickSequence(), 20, 25));
    expect(j.score).toBeNull();
    expect(j.status).toBe("withheld");
  });

  it("감점이 많아 0점이 되는 경우와 구분된다", () => {
    const judged = judgeSequence(staticStanceSequence({ frames: 40, gapRatio: 1.4 }));
    expect(judged.status).toBe("judged");
    expect(typeof judged.score).toBe("number");
  });
});

describe("formatFrameRanges", () => {
  it("연속한 번호를 접는다", () => {
    expect(formatFrameRanges([1, 2, 3, 7, 9, 10])).toBe("1~3, 7, 9~10");
  });

  it("순서가 뒤섞여 있어도 정렬해서 접는다", () => {
    expect(formatFrameRanges([5, 3, 4])).toBe("3~5");
  });

  it("빈 목록은 빈 문자열", () => {
    expect(formatFrameRanges([])).toBe("");
  });
});

describe("H6 — 카메라 각도 전제", () => {
  /**
   * 규칙의 각도·비율은 전부 화면 평면에서 잰다. 그래서 어느 평면이 화면 평면인지가
   * 규칙의 전제이고, 전제가 어긋난 입력은 "그럴듯한 점수"가 가장 잘 나오는 자리다.
   * 각도는 관측할 수 없으므로 시퀀스의 선언을 믿되, 전제와 다르면 멈춘다.
   */
  it("주춤서기를 측면이라고 선언하면 채점하지 않는다", () => {
    const seq = { ...staticStanceSequence({ frames: 40 }), view: "sagittal" as const };
    const j = judgeSequence(seq);
    expect(j.status).toBe("withheld");
    expect(j.score).toBeNull();
    expect(j.withheld.map((w) => w.code)).toContain("H6");
  });

  it("앞차기를 정면이라고 선언해도 채점하지 않는다", () => {
    const seq = { ...kickSequence({}), view: "frontal" as const };
    expect(codes(seq)).toContain("H6");
    expect(judgeSequence(seq).score).toBeNull();
  });

  it("전제와 같으면 H6은 나오지 않는다", () => {
    const stance = staticStanceSequence({ frames: 40 });
    expect(stance.view).toBe(REQUIRED_VIEW.stance);
    expect(codes(stance)).not.toContain("H6");

    const kick = kickSequence({});
    expect(kick.view).toBe(REQUIRED_VIEW.frontKick);
    expect(codes(kick)).not.toContain("H6");
  });

  it("보류 사유에 두 각도를 모두 적는다 — 무엇을 어떻게 고쳐야 하는지 알 수 있게", () => {
    const seq = { ...staticStanceSequence({ frames: 40 }), view: "sagittal" as const };
    const h6 = judgeSequence(seq).withheld.find((w) => w.code === "H6");
    expect(h6?.message).toContain("측면");
    expect(h6?.message).toContain("정면");
    expect(h6?.message).toContain("주춤서기");
  });

  it("보류여도 무엇을 쟀는지는 남는다 — 보류는 '못 봤다'가 아니라 '점수를 말하지 않는다'다", () => {
    const seq = { ...staticStanceSequence({ frames: 40 }), view: "sagittal" as const };
    const j = judgeSequence(seq);
    expect(j.criteria.length).toBeGreaterThan(0);
    expect(j.score).toBeNull();
  });
});
