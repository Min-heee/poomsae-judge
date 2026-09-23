/**
 * 게임 판정의 시험.
 *
 * 가장 중요한 것부터: **준비 자세가 채점될 경로가 없다.**
 * 판정 창은 본질적으로 과거를 보므로, 카운트다운이 끝나는 순간을 스냅샷하면
 * '준비 자세'를 채점하게 된다. 여기서 시험하는 것은 그 경로가 막혔는가다.
 *
 * 그 다음은 점수가 **이미 나온 감점에서만** 나오는가, 그리고 같은 입력이면 같은
 * 점수인가다.
 */

import { describe, expect, it } from "vitest";

import { judgeSequence } from "../judge";
import { FRONT_KICK, STANCE } from "../judge/constants";
import type { Landmark, LandmarkSequence, TimedFrame } from "../judge/types";
import { kickSequence, staticStanceSequence } from "../samples/fixtures";
import { buildStanceFrame } from "../samples/rig";
import { COURSES, ROUNDS_PER_COURSE, ROUND_LIMIT_SECONDS, course, courseDurationSeconds } from "./courses";
import {
  MAX_DEDUCTION_BY_CRITERION,
  WINDOW_MS,
  WINDOW_STEP_MS,
  baseScoreOf,
  comboMultiplier,
  judgeRound,
  maxDeductionFor,
  speedPoints,
  starsFor,
  summarizeCourse,
  takeRecording,
  type RoundInput,
  type RoundResult,
} from "./game";

const FPS = 30;

const STANDING = { feetGapRatio: 0.35, kneeAngleLeftDeg: 178, kneeAngleRightDeg: 178, torsoTiltDeg: 2 };
const GOOD_JUCHUM = { feetGapRatio: 2.0, kneeAngleLeftDeg: 138, kneeAngleRightDeg: 138, torsoTiltDeg: 0 };
const NARROW_JUCHUM = { feetGapRatio: 1.35, kneeAngleLeftDeg: 138, kneeAngleRightDeg: 138, torsoTiltDeg: 0 };

/** 시작 신호 기준 기록을 만든다. t = 0 이 시작 신호다. */
function record(seconds: number, poseAt: (t: number) => Landmark[], fps = FPS): TimedFrame[] {
  const out: TimedFrame[] = [];
  const count = Math.round(seconds * fps) + 1;
  for (let i = 0; i < count; i++) {
    out.push({ t: Math.round((i * 1000) / fps * 10) / 10, landmarks: poseAt(i / fps) });
  }
  return out;
}

function stanceRound(frames: readonly TimedFrame[], over: Partial<RoundInput> = {}): RoundInput {
  return {
    motion: "stance",
    view: "frontal",
    limitSeconds: 6,
    frames,
    fps: FPS,
    comboBefore: 0,
    sequenceId: "test-round",
    ...over,
  };
}

function holdGood(seconds = 6): TimedFrame[] {
  return record(seconds, () => buildStanceFrame(GOOD_JUCHUM));
}

describe("준비 자세가 채점될 경로가 없다", () => {
  it("시작 신호 이전(t < 0) 프레임이 있으면 던진다", () => {
    const frames: TimedFrame[] = [
      { t: -500, landmarks: buildStanceFrame(STANDING) },
      { t: 0, landmarks: buildStanceFrame(GOOD_JUCHUM) },
      { t: 33.3, landmarks: buildStanceFrame(GOOD_JUCHUM) },
    ];
    expect(() => judgeRound(stanceRound(frames))).toThrow(/준비 단계의 프레임/);
  });

  it("모든 후보 창이 t = 0 이후에서만 선다", () => {
    const r = judgeRound(stanceRound(holdGood()));
    expect(r.window?.startMs).toBeGreaterThanOrEqual(0);
    expect(r.window?.fromIndex).toBeGreaterThanOrEqual(0);
  });

  it("준비 자세로 시작해도 **실제로 채점한 프레임**은 전부 그 뒤다", () => {
    // 0~2.5초는 차렷(준비), 2.5초부터 주춤서기. 준비 구간만 보면 H7 보류가 난다.
    const frames = record(6, (t) => buildStanceFrame(t < 2.5 ? STANDING : GOOD_JUCHUM));
    const r = judgeRound(stanceRound(frames));
    expect(r.status).toBe("scored");
    expect(r.baseScore).toBe(100);

    // 채택한 **창**은 전환점에 걸쳐 있을 수 있다 — 창은 2초짜리 자루일 뿐이다.
    // 중요한 것은 판정이 그 자루 안에서 다시 고른 구간이고, 그 구간은 전환점 뒤에 있다.
    // 준비 자세의 프레임은 중앙값에 한 장도 들어가지 않았다는 뜻이다.
    expect(r.window?.judgedFromMs as number).toBeGreaterThanOrEqual(2500);
    expect(r.window?.judgedToMs as number).toBeLessThanOrEqual(r.window?.endMs as number);
  });

  it("준비 구간이 섞인 창은 A5(유지)가 걸려 더 낮은 점수를 받는다 — 규칙이 스스로 걸러 낸다", () => {
    // 전환점 직후를 0.3초만 담는 창(0.8~2.8초)은 유지 0.8초를 못 채워 A5가 0.1 깎인다.
    // 게임은 그런 창 대신 유지가 충분한 창을 고른다 — 새 규칙 없이 기존 감점만으로.
    const frames = record(6, (t) => buildStanceFrame(t < 2.5 ? STANDING : GOOD_JUCHUM));
    const early = judgeSequence({
      id: "early",
      label: "early",
      motion: "stance",
      view: "frontal",
      fps: FPS,
      frames: frames.filter((f) => f.t >= 800 && f.t <= 2800),
    });
    expect(baseScoreOf(early)).toBeLessThan(100);
    expect(judgeRound(stanceRound(frames)).baseScore).toBe(100);
  });

  it("준비 자세만 있는 기록은 점수를 지어내지 않고 보류한다", () => {
    const r = judgeRound(stanceRound(record(6, () => buildStanceFrame(STANDING))));
    expect(r.status).toBe("withheld");
    expect(r.baseScore).toBeNull();
    expect(r.score).toBe(0);
    expect(r.allWithheld).toBe(true);
    // 왜 보류인지 말할 수 있어야 한다.
    expect(r.judgement?.withheld.map((w) => w.code)).toContain("H7");
  });
});

describe("가장 잘 맞은 창을 고른다", () => {
  it("전반이 나쁘고 후반이 좋으면 후반을 채택한다", () => {
    const frames = record(6, (t) => buildStanceFrame(t < 3 ? NARROW_JUCHUM : GOOD_JUCHUM));
    const r = judgeRound(stanceRound(frames));
    expect(r.baseScore).toBe(100);
    expect(r.window?.endMs).toBeGreaterThan(3000);
  });

  it("전반이 좋고 후반이 나빠도 좋은 쪽을 채택한다", () => {
    const frames = record(6, (t) => buildStanceFrame(t < 3 ? GOOD_JUCHUM : NARROW_JUCHUM));
    const r = judgeRound(stanceRound(frames));
    expect(r.baseScore).toBe(100);
    expect(r.window?.startMs).toBeLessThan(1500);
  });

  it("동점이면 먼저 끝난 창을 쓴다", () => {
    const r = judgeRound(stanceRound(holdGood()));
    expect(r.baseScore).toBe(100);
    expect(r.window?.startMs).toBe(0);
  });

  it("6초 구간이면 후보 창이 21개다", () => {
    const r = judgeRound(stanceRound(holdGood()));
    expect(r.candidateCount).toBe((6000 - WINDOW_MS) / WINDOW_STEP_MS + 1);
    expect(r.candidateCount).toBe(21);
  });

  it("되감기 구간은 게임의 2초 창이 아니라 판정이 고른 구간이다", () => {
    const r = judgeRound(stanceRound(holdGood()));
    expect(r.window?.judgedFromMs).not.toBeNull();
    expect(r.window?.judgedToMs).not.toBeNull();
    expect(r.window?.judgedFromMs as number).toBeGreaterThanOrEqual(r.window?.startMs as number);
    expect(r.window?.judgedToMs as number).toBeLessThanOrEqual(r.window?.endMs as number);
  });

  it("앞차기도 같은 루프를 지난다", () => {
    const kick = kickSequence({ apexHipDeg: 110, apexKneeFlexDeg: 12, apexLeanDeg: 8 });
    const r = judgeRound({
      motion: "frontKick",
      view: "sagittal",
      limitSeconds: 4,
      frames: kick.frames,
      fps: kick.fps,
      comboBefore: 0,
      sequenceId: "test-kick",
    });
    expect(r.status).toBe("scored");
    expect(r.baseScore).toBe(100);
  });
});

describe("제한 시간", () => {
  it("제한 시간 뒤에 만든 자세는 채점하지 않는다", () => {
    // 4.5초부터 좋은 자세가 나오지만 제한은 4초다.
    const frames = record(8, (t) => buildStanceFrame(t < 4.5 ? STANDING : GOOD_JUCHUM));
    const r = judgeRound(stanceRound(frames, { limitSeconds: 4 }));
    expect(r.status).toBe("withheld");
  });

  it("같은 기록이라도 제한이 길면 채점된다", () => {
    const frames = record(8, (t) => buildStanceFrame(t < 4.5 ? STANDING : GOOD_JUCHUM));
    const r = judgeRound(stanceRound(frames, { limitSeconds: 8 }));
    expect(r.status).toBe("scored");
    expect(r.baseScore).toBe(100);
  });

  it("기록이 창 하나보다 짧아도 있는 만큼으로 판정한다", () => {
    const r = judgeRound(stanceRound(holdGood(1.5), { limitSeconds: 4 }));
    expect(r.candidateCount).toBe(1);
    expect(r.window?.startMs).toBe(0);
  });

  it("프레임이 한 장뿐이면 창을 세우지 못한다 — 보류다", () => {
    const frames: TimedFrame[] = [{ t: 0, landmarks: buildStanceFrame(GOOD_JUCHUM) }];
    const r = judgeRound(stanceRound(frames));
    expect(r.status).toBe("withheld");
    expect(r.candidateCount).toBe(0);
    expect(r.note).toContain("창을 하나도");
  });

  it("시간이 거꾸로 가는 기록은 조용히 고치지 않고 던진다", () => {
    const frames: TimedFrame[] = [
      { t: 0, landmarks: buildStanceFrame(GOOD_JUCHUM) },
      { t: 33.3, landmarks: buildStanceFrame(GOOD_JUCHUM) },
      { t: 33.3, landmarks: buildStanceFrame(GOOD_JUCHUM) },
    ];
    expect(() => judgeRound(stanceRound(frames))).toThrow(/단조 증가/);
  });
});

describe("점수 산식", () => {
  it("분모는 규칙표에서 끌어온다 — 주춤서기 1.3 / 앞차기 1.7", () => {
    const stanceSum = ["A1", "A2", "A3", "A4", "A5"].reduce((s, id) => s + maxDeductionFor(id), 0);
    const kickSum = ["B1", "B2", "B3", "B4", "B5", "B6", "B7"].reduce(
      (s, id) => s + maxDeductionFor(id),
      0,
    );
    expect(stanceSum).toBeCloseTo(1.3, 9);
    expect(kickSum).toBeCloseTo(1.7, 9);
    // 규칙표를 읽어서 만든 값이지 손으로 적은 값이 아니다.
    expect(MAX_DEDUCTION_BY_CRITERION.A1).toBe(Math.max(...STANCE.feetGapDeductions));
    expect(MAX_DEDUCTION_BY_CRITERION.B4).toBe(Math.max(...FRONT_KICK.extensionAngleDeductions));
  });

  it("규칙표에 없는 항목이 오면 조용히 넘기지 않고 던진다", () => {
    expect(() => maxDeductionFor("A9")).toThrow(/모르는 판정 항목/);
  });

  it("감점 0이면 기본점 100이다", () => {
    const j = judgeSequence(staticStanceSequence({ ...jc(GOOD_JUCHUM) }));
    expect(j.score).toBe(10.0);
    expect(baseScoreOf(j)).toBe(100);
  });

  it("A1만 0.3 깎이면 기본점 77이다 — 100 × (1 − 0.3/1.3)", () => {
    const j = judgeSequence(staticStanceSequence({ ...jc(NARROW_JUCHUM) }));
    expect(j.score).toBe(9.7);
    expect(baseScoreOf(j)).toBe(Math.round(100 * (1 - 0.3 / 1.3)));
    expect(baseScoreOf(j)).toBe(77);
  });

  it("H4로 보류된 항목은 분자와 분모에서 함께 빠진다", () => {
    // A2를 경계(145°)의 ε 안에 두면 그 항목만 보류된다. 분모가 1.3 → 1.0 으로 줄고,
    // 남은 A1의 0.3이 더 무겁게 셈해진다.
    const j = judgeSequence(
      staticStanceSequence({ gapRatio: 1.35, kneeLeftDeg: 144.5, kneeRightDeg: 144.5, torsoTiltDeg: 0 }),
    );
    const withheldItems = j.criteria.filter((c) => c.grade === "withheld");
    expect(withheldItems.map((c) => c.id)).toEqual(["A2"]);
    expect(j.status).toBe("judged");
    expect(baseScoreOf(j)).toBe(Math.round(100 * (1 - 0.3 / 1.0)));
    expect(baseScoreOf(j)).toBe(70);
  });

  it("보류된 판정에는 기본점이 없다 — 0점이 아니다", () => {
    const j = judgeSequence(standingSequence());
    expect(j.status).toBe("withheld");
    expect(baseScoreOf(j)).toBeNull();
  });

  it("콤보 배수는 1.0에서 1.5까지다", () => {
    expect(comboMultiplier(0)).toBeCloseTo(1.0, 9);
    expect(comboMultiplier(1)).toBeCloseTo(1.1, 9);
    expect(comboMultiplier(5)).toBeCloseTo(1.5, 9);
    expect(comboMultiplier(9)).toBeCloseTo(1.5, 9);
    expect(comboMultiplier(-3)).toBeCloseTo(1.0, 9);
  });

  it("속도 점수는 남긴 1초당 4점, 상한 20점이다", () => {
    expect(speedPoints(6, 2)).toBe(16);
    expect(speedPoints(6, 5.9)).toBe(0);
    expect(speedPoints(4, 4)).toBe(0);
    expect(speedPoints(6, 6.5)).toBe(0);
    expect(speedPoints(10, 0)).toBe(20);
  });

  it("라운드 점수 = round(기본점 × 콤보) + 속도점", () => {
    const r = judgeRound(stanceRound(holdGood(), { comboBefore: 0 }));
    expect(r.baseScore).toBe(100);
    expect(r.comboAfter).toBe(1);
    expect(r.comboMultiplier).toBeCloseTo(1.1, 9);
    expect(r.speedPoints).toBe(speedPoints(6, (r.window?.endMs as number) / 1000));
    expect(r.score).toBe(Math.round(100 * 1.1) + r.speedPoints);
  });

  it("성공하면 콤보가 이어지고 실패하면 끊긴다", () => {
    const good = judgeRound(stanceRound(holdGood(), { comboBefore: 3 }));
    expect(good.success).toBe(true);
    expect(good.comboAfter).toBe(4);
    expect(good.comboMultiplier).toBeCloseTo(1.4, 9);

    const bad = judgeRound(stanceRound(record(6, () => buildStanceFrame(STANDING)), { comboBefore: 3 }));
    expect(bad.success).toBe(false);
    expect(bad.comboAfter).toBe(0);
    expect(bad.comboMultiplier).toBeCloseTo(1.0, 9);
    expect(bad.score).toBe(0);
  });

  it("기본점 70이 성공의 경계다 — 69점은 콤보를 끊는다", () => {
    // A1 하나만 major 감점이면 77점 — 성공이다.
    const near = judgeRound(stanceRound(record(6, () => buildStanceFrame(NARROW_JUCHUM))));
    expect(near.baseScore).toBe(77);
    expect(near.success).toBe(true);

    // A1 major(0.3) + A4 minor(0.1) = 0.4 → 100 × (1 − 0.4/1.3) = 69. 문턱 바로 아래다.
    const justUnder = judgeRound(
      stanceRound(
        record(6, () => buildStanceFrame({ ...NARROW_JUCHUM, torsoTiltDeg: 13 })),
        { comboBefore: 4 },
      ),
    );
    expect(justUnder.baseScore).toBe(69);
    expect(justUnder.success).toBe(false);
    expect(justUnder.comboAfter).toBe(0);
    expect(justUnder.comboMultiplier).toBeCloseTo(1.0, 9);
    expect(justUnder.score).toBe(69 + justUnder.speedPoints);
  });
});

describe("한 판 정리", () => {
  const mk = (base: number | null, score: number, combo: number): RoundResult => ({
    sequenceId: "r",
    motion: "stance",
    limitSeconds: 6,
    status: base === null ? "withheld" : "scored",
    baseScore: base,
    comboBefore: 0,
    comboAfter: combo,
    comboMultiplier: comboMultiplier(combo),
    speedPoints: 0,
    score,
    success: base !== null && base >= 70,
    window: null,
    judgement: null,
    candidateCount: 1,
    allWithheld: base === null,
    note: "",
  });

  it("별은 총점이 아니라 기본점 평균으로 매긴다", () => {
    expect(starsFor(59.9)).toBe(0);
    expect(starsFor(60)).toBe(1);
    expect(starsFor(74.9)).toBe(1);
    expect(starsFor(75)).toBe(2);
    expect(starsFor(89.9)).toBe(2);
    expect(starsFor(90)).toBe(3);
    expect(starsFor(100)).toBe(3);
  });

  it("총점·평균·최고 라운드·보류 수를 낸다", () => {
    const s = summarizeCourse([mk(100, 126, 1), mk(77, 85, 2), mk(null, 0, 0), mk(90, 99, 1), mk(100, 130, 2)]);
    expect(s.totalScore).toBe(126 + 85 + 0 + 99 + 130);
    expect(s.averageBase).toBeCloseTo((100 + 77 + 0 + 90 + 100) / 5, 9);
    expect(s.withheldRounds).toBe(1);
    expect(s.bestCombo).toBe(2);
    expect(s.bestRoundIndex).toBe(0); // 동점이면 먼저 나온 라운드
  });

  it("빈 판은 0점 0별이다", () => {
    const s = summarizeCourse([]);
    expect(s.totalScore).toBe(0);
    expect(s.stars).toBe(0);
    expect(s.bestRoundIndex).toBeNull();
  });

  it("전부 보류면 최고 라운드가 없다 — 카드에 넣을 스켈레톤도 없다는 뜻이다", () => {
    const s = summarizeCourse([mk(null, 0, 0), mk(null, 0, 0)]);
    expect(s.bestRoundIndex).toBeNull();
    expect(s.stars).toBe(0);
  });
});

describe("결정성", () => {
  it("같은 기록을 두 번 판정하면 같은 결과다", () => {
    const frames = record(6, (t) => buildStanceFrame(t < 3 ? NARROW_JUCHUM : GOOD_JUCHUM));
    const a = judgeRound(stanceRound(frames));
    const b = judgeRound(stanceRound(frames));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("시연 모드를 몇 번 눌러도 같은 결과다", () => {
    const seq = staticStanceSequence({ ...jc(GOOD_JUCHUM), frames: 200 });
    const first = takeRecording(seq.frames, 0, 6);
    const again = takeRecording(seq.frames, 0, 6);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
    expect(JSON.stringify(judgeRound(stanceRound(first)))).toBe(
      JSON.stringify(judgeRound(stanceRound(again))),
    );
  });
});

describe("기록기", () => {
  it("시작 신호 기준으로 시간을 다시 센다", () => {
    const seq = staticStanceSequence({ frames: 200 });
    const rec = takeRecording(seq.frames, 1000, 4);
    expect(rec[0].t).toBe(0);
    expect(rec[rec.length - 1].t).toBeLessThanOrEqual(4000);
    expect(rec.length).toBeGreaterThan(100);
  });

  it("제한 시간 밖의 프레임을 버린다", () => {
    const seq = staticStanceSequence({ frames: 300 });
    const rec = takeRecording(seq.frames, 0, 2);
    expect(rec.every((f) => f.t <= 2000)).toBe(true);
  });
});

describe("코스 구성", () => {
  it("두 코스가 시야를 섞지 않는다", () => {
    expect(course("frontal").view).toBe("frontal");
    expect(course("frontal").motion).toBe("stance");
    expect(course("sagittal").view).toBe("sagittal");
    expect(course("sagittal").motion).toBe("frontKick");
  });

  it("제한 시간이 6초에서 4초로 0.5초씩 줄고, 하한 4초는 규칙에서 나온다", () => {
    expect(ROUND_LIMIT_SECONDS).toEqual([6, 5.5, 5, 4.5, 4]);
    const min = Math.min(...ROUND_LIMIT_SECONDS);
    // A5의 유지 0.8초 + H7의 멈춘 구간 0.2초 + 앉는 시간을 담을 수 있어야 한다.
    expect(min).toBeGreaterThan(STANCE.minHoldSeconds + STANCE.settledMinSeconds);
    expect(min * 1000).toBeGreaterThanOrEqual(WINDOW_MS);
  });

  it("모든 코스가 5라운드이고 시연 샘플이 라운드마다 있다", () => {
    for (const c of COURSES) {
      expect(c.rounds).toHaveLength(ROUNDS_PER_COURSE);
      for (const r of c.rounds) expect(r.demoSampleId.length).toBeGreaterThan(0);
      // 점수가 오르내려야 콤보와 등급이 움직이는 것이 보인다.
      expect(new Set(c.rounds.map((r) => r.demoSampleId)).size).toBeGreaterThan(1);
    }
  });

  it("한 판이 1분 안팎이다", () => {
    for (const c of COURSES) {
      expect(courseDurationSeconds(c)).toBeGreaterThan(50);
      expect(courseDurationSeconds(c)).toBeLessThan(80);
    }
  });

  it("점수 라운드의 자세에는 판정 규칙이 있다", () => {
    for (const c of COURSES) {
      for (const r of c.rounds) expect(r.poseId).toBe(c.poseId);
    }
  });
});

// --- 도우미 -----------------------------------------------------------------

function jc(p: typeof GOOD_JUCHUM) {
  return {
    gapRatio: p.feetGapRatio,
    kneeLeftDeg: p.kneeAngleLeftDeg,
    kneeRightDeg: p.kneeAngleRightDeg,
    torsoTiltDeg: p.torsoTiltDeg,
  };
}

function standingSequence(): LandmarkSequence {
  const frames = record(3, () => buildStanceFrame(STANDING));
  return { id: "standing", label: "standing", motion: "stance", view: "frontal", fps: FPS, frames };
}
