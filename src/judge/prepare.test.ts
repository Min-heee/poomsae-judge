import { describe, expect, it } from "vitest";

import { WITHHOLD } from "./constants";
import { LM } from "./landmarks";
import { checkVisibility, prepareSequence } from "./prepare";
import { InvalidSequenceError, type Landmark, type LandmarkSequence } from "./types";
import { staticStanceSequence } from "../samples/fixtures";

function withTimes(times: readonly number[], base?: LandmarkSequence): LandmarkSequence {
  const src = base ?? staticStanceSequence({ frames: times.length });
  return {
    ...src,
    frames: times.map((t, i) => ({ t, landmarks: src.frames[i].landmarks })),
  };
}

function blur(
  sequence: LandmarkSequence,
  frames: readonly number[],
  landmarks: readonly number[],
  visibility: number,
): LandmarkSequence {
  const frameSet = new Set(frames);
  const lmSet = new Set(landmarks);
  return {
    ...sequence,
    frames: sequence.frames.map((f, i) =>
      frameSet.has(i)
        ? {
            t: f.t,
            landmarks: f.landmarks.map((p, idx) =>
              lmSet.has(idx) ? { ...p, visibility } : p,
            ),
          }
        : f,
    ),
  };
}

describe("구조 검사", () => {
  it("프레임이 2개 미만이면 거부한다", () => {
    const seq = staticStanceSequence({ frames: 1 });
    expect(() => prepareSequence(seq)).toThrow(InvalidSequenceError);
  });

  it("랜드마크가 33개가 아니면 거부한다", () => {
    const seq = staticStanceSequence({ frames: 3 });
    const broken: LandmarkSequence = {
      ...seq,
      frames: seq.frames.map((f, i) =>
        i === 1 ? { t: f.t, landmarks: f.landmarks.slice(0, 20) } : f,
      ),
    };
    expect(() => prepareSequence(broken)).toThrow(/랜드마크가 20개/);
  });

  it("시간이 거꾸로 가면 거부한다 — 판정 이전의 문제다", () => {
    expect(() => prepareSequence(withTimes([0, 33.3, 20]))).toThrow(/단조 증가/);
  });

  it("같은 시각이 두 번 나와도 거부한다", () => {
    expect(() => prepareSequence(withTimes([0, 33.3, 33.3]))).toThrow(/단조 증가/);
  });

  it("fps가 0 이하면 거부한다", () => {
    const seq = { ...staticStanceSequence({ frames: 3 }), fps: 0 };
    expect(() => prepareSequence(seq)).toThrow(/fps/);
  });
});

describe("H1 신뢰도 게이트", () => {
  it("필수 관절이 문턱 미만이면 무효 프레임", () => {
    const seq = blur(staticStanceSequence({ frames: 10 }), [3, 4], [LM.leftKnee], 0.3);
    const prepared = prepareSequence(seq);
    expect(prepared.invalidFrames.map((f) => f.sourceIndex)).toEqual([3, 4]);
    expect(prepared.invalidFrames[0].reason).toContain("왼쪽 무릎");
  });

  it("문턱과 같은 값은 유효다 — 미만일 때만 무효", () => {
    const seq = blur(
      staticStanceSequence({ frames: 5 }),
      [2],
      [LM.leftKnee],
      WITHHOLD.minVisibility,
    );
    expect(prepareSequence(seq).invalidFrames).toHaveLength(0);
  });

  it("얼굴·손이 가려져도 다리 판정은 막지 않는다", () => {
    const seq = blur(
      staticStanceSequence({ frames: 5 }),
      [0, 1, 2, 3, 4],
      [LM.nose, LM.leftWrist, LM.rightWrist, LM.leftEar],
      0.05,
    );
    expect(prepareSequence(seq).invalidFrames).toHaveLength(0);
  });

  it("어느 관절이 얼마나 흐렸는지 사유에 적는다", () => {
    const frame = staticStanceSequence({ frames: 2 }).frames[0].landmarks;
    const dimmed: Landmark[] = frame.map((p, i) =>
      i === LM.rightAnkle ? { ...p, visibility: 0.12 } : { ...p },
    );
    expect(checkVisibility(dimmed)).toContain("오른쪽 발목 0.12");
    expect(checkVisibility(frame)).toBeNull();
  });
});

describe("프레임 결손 — 보간과 H3", () => {
  const nominal = 1000 / 30;

  it("간격이 정상이면 보간하지 않는다", () => {
    const prepared = prepareSequence(staticStanceSequence({ frames: 10 }));
    expect(prepared.gaps).toHaveLength(0);
    expect(prepared.interpolatedCount).toBe(0);
    expect(prepared.frames).toHaveLength(10);
  });

  it("120ms 이하 결손은 선형 보간으로 메운다", () => {
    // 가운데에서 두 프레임을 건너뛴 시간축 (간격 100ms).
    const seq = withTimes([0, nominal, nominal + 100, nominal * 2 + 100]);
    const prepared = prepareSequence(seq);
    expect(prepared.gaps).toHaveLength(1);
    expect(prepared.gaps[0].filled).toBe(true);
    expect(prepared.gaps[0].gapMs).toBeCloseTo(100, 6);
    expect(prepared.interpolatedCount).toBe(2);
    expect(prepared.frames.filter((f) => f.interpolated)).toHaveLength(2);
  });

  it("보간 프레임은 직전 원본 프레임 번호를 들고 다닌다", () => {
    const seq = withTimes([0, nominal, nominal + 100, nominal * 2 + 100]);
    const filled = prepareSequence(seq).frames.filter((f) => f.interpolated);
    expect(filled.every((f) => f.sourceIndex === 1)).toBe(true);
  });

  it("120ms를 넘는 결손은 메우지 않고 기록만 남긴다 (H3의 근거)", () => {
    const seq = withTimes([0, nominal, nominal + 200, nominal + 233]);
    const prepared = prepareSequence(seq);
    expect(prepared.gaps).toHaveLength(1);
    expect(prepared.gaps[0].filled).toBe(false);
    expect(prepared.interpolatedCount).toBe(0);
  });

  it("문턱 바로 아래는 메우고 바로 위는 메우지 않는다", () => {
    const under = prepareSequence(
      withTimes([0, nominal, nominal + WITHHOLD.maxFrameGapMs]),
    );
    const over = prepareSequence(
      withTimes([0, nominal, nominal + WITHHOLD.maxFrameGapMs + 0.5]),
    );
    expect(under.gaps[0].filled).toBe(true);
    expect(over.gaps[0].filled).toBe(false);
  });

  it("흐린 구간을 보간으로 세탁할 수 없다", () => {
    const base = withTimes([0, nominal, nominal + 100, nominal * 2 + 100]);
    const seq = blur(base, [1, 2], [LM.leftKnee], 0.1);
    const prepared = prepareSequence(seq);
    const filled = prepared.frames.filter((f) => f.interpolated);
    expect(filled).toHaveLength(2);
    expect(filled.every((f) => f.valid)).toBe(false);
  });

  it("원본 프레임 수는 보간과 무관하게 보고한다", () => {
    const seq = withTimes([0, nominal, nominal + 100, nominal * 2 + 100]);
    expect(prepareSequence(seq).sourceFrameCount).toBe(4);
  });
});
