/**
 * 기준 자세(교본)의 시험.
 *
 * 가장 중요한 것 하나부터: **교본이 판정에서 만점을 받는가.**
 * 교본대로 한 사람이 감점을 받으면 화면이 거짓말을 하는 것이다.
 *
 * 그 다음은 문서와 코드의 대조다. `docs/reference-poses.md` 5절의 표는 사람이 읽는
 * 값이고, 목표값은 코드가 기준 프레임에서 잰 값이다. 둘이 갈라지면 여기서 깨진다 —
 * 조용히 갈라지는 것보다 낫다.
 */

import { describe, expect, it } from "vitest";

import { judgeSequence } from "../judge";
import { LM } from "../judge/landmarks";
import type { Landmark, LandmarkSequence, TimedFrame } from "../judge/types";
import { kickSequence } from "../samples/fixtures";
import {
  REACH_LIMIT,
  REFERENCE_POSE_IDS,
  RIG_ARM_REACH_M,
  buildReferenceFrame,
  referenceDemoFrames,
  solveElbow3,
} from "../samples/reference-frames";
import { METRIC_SPECS, weightSum } from "./metrics";
import { REFERENCE_POSES, referencePose } from "./reference";
import type { ReferencePoseId } from "./types";

/**
 * `docs/reference-poses.md` 5절 표의 목표값.
 *
 * **이 값은 코드가 쓰지 않는다.** 실제 목표값은 기준 프레임에서 재고, 이 표는 그 계산이
 * 맞는지 보는 시험값이다. 문서를 고치면 여기도 고쳐야 하고, 그래야 둘이 붙어 있는다.
 */
const DOC_TARGETS: Record<ReferencePoseId, Record<string, number>> = {
  ready: {
    "knee-left": 178.0,
    "knee-right": 178.0,
    "torso-tilt": 0.0,
    "elbow-left": 140.1,
    "elbow-right": 140.1,
    "fist-height-left": 0.0,
    "fist-height-right": 0.0,
    "fist-lateral-left": 0.18,
    "fist-lateral-right": 0.18,
    "feet-gap": 0.9,
  },
  juchum: {
    "knee-left": 138.0,
    "knee-right": 138.0,
    "knee-symmetry": 0.0,
    "feet-gap": 2.0,
    "knee-spread": 1.0,
    "torso-tilt": 0.0,
    "waist-fist-height-left": 0.18,
    "waist-fist-height-right": 0.18,
  },
  "arae-makki": {
    "block-elbow": 151.6,
    "block-shoulder-spread": 22.5,
    "block-fist-height": -0.11,
    "block-fist-lateral": 0.57,
    "pull-fist-height": 0.18,
    "lower-knee": 138.0,
  },
  "momtong-an-makki": {
    "block-fist-height": 0.95,
    "block-fist-lateral": 0.11,
    "block-elbow-height": 0.59,
    "block-elbow-angle": 70.7,
    "pull-fist-height": 0.18,
    "lower-knee": 138.0,
  },
  "ap-chagi-apex": {
    "kick-knee": 168.0,
    "foot-height": 0.46,
    "knee-height": 0.32,
    "hip-flex": 78.0,
    "support-knee": 168.0,
    "torso-lean": 8.0,
  },
};

/** 문서 5절이 약속한 허용 오차. 각도 ±0.5°, 비율 ±0.02. */
const TOLERANCE = { deg: 0.5, ratio: 0.02 } as const;

function staticSequence(id: string, frame: readonly Landmark[], count = 60): LandmarkSequence {
  const frames: TimedFrame[] = [];
  for (let i = 0; i < count; i++) {
    frames.push({ t: Math.round((i * 1000) / 30 * 10) / 10, landmarks: frame });
  }
  return { id, label: id, motion: "stance", view: "frontal", fps: 30, frames };
}

describe("문서의 표와 코드가 같은 값을 말한다", () => {
  for (const id of REFERENCE_POSE_IDS) {
    it(`${id} 의 목표값이 docs/reference-poses.md 5절 표와 같다`, () => {
      const pose = referencePose(id);
      const doc = DOC_TARGETS[id];
      const seen = new Set<string>();
      for (const m of pose.metrics) {
        expect(doc, `${id}/${m.id} 가 문서 표에 없다`).toHaveProperty(m.id);
        seen.add(m.id);
        const tolerance = m.unit === "deg" ? TOLERANCE.deg : TOLERANCE.ratio;
        expect(
          Math.abs(m.target - doc[m.id]),
          `${id}/${m.id}: 코드 ${m.target.toFixed(3)} vs 문서 ${doc[m.id]}`,
        ).toBeLessThanOrEqual(tolerance);
      }
      // 문서에만 있고 코드에 없는 항목도 잡는다 — 지표를 지우면 조용히 통과하지 않게.
      expect([...Object.keys(doc)].sort()).toEqual([...seen].sort());
    });
  }
});

describe("지표 정의", () => {
  for (const id of REFERENCE_POSE_IDS) {
    it(`${id} 의 가중치 합이 100이다`, () => {
      expect(weightSum(METRIC_SPECS[id])).toBeCloseTo(100, 9);
    });

    it(`${id} 의 지표 id 가 겹치지 않는다`, () => {
      const ids = METRIC_SPECS[id].map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it(`${id} 의 joints 가 reads 나 프레임 기준점 안에 있다`, () => {
      for (const m of METRIC_SPECS[id]) {
        for (const j of m.joints) {
          // 어깨·엉덩이는 정규화가 이미 쓰는 점이라 reads 에 다시 적지 않는다.
          const anchors: number[] = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip];
          expect(
            m.reads.includes(j) || anchors.includes(j),
            `${id}/${m.id}: 칠하려는 관절 ${j} 를 읽지 않는다`,
          ).toBe(true);
        }
      }
    });
  }
});

describe("교본이 판정에서 만점을 받는다", () => {
  it("주춤서기 기준 자세 = 10.0점, 보류 없음", () => {
    const j = judgeSequence(staticSequence("ref-juchum", buildReferenceFrame("juchum")));
    expect(j.status).toBe("judged");
    expect(j.score).toBe(10.0);
    expect(j.withheld).toEqual([]);
    expect(j.criteria.map((c) => c.grade)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
  });

  it("앞차기 기준 정점(엉덩이 110° · 무릎 12° · 상체 8°) = 10.0점", () => {
    const j = judgeSequence(
      kickSequence({ apexHipDeg: 110, apexKneeFlexDeg: 12, apexLeanDeg: 8, id: "ref-kick" }),
    );
    expect(j.status).toBe("judged");
    expect(j.score).toBe(10.0);
    expect(j.criteria.every((c) => c.grade === "pass")).toBe(true);
  });
});

describe("생성기", () => {
  it("두 번 만들면 같은 좌표가 나온다", () => {
    for (const id of REFERENCE_POSE_IDS) {
      expect(JSON.stringify(buildReferenceFrame(id))).toBe(JSON.stringify(buildReferenceFrame(id)));
    }
  });

  it("모든 기준 자세에서 팔이 도달 범위 안이다", () => {
    for (const id of REFERENCE_POSE_IDS) {
      const f = buildReferenceFrame(id);
      for (const [sho, wri] of [
        [LM.leftShoulder, LM.leftWrist],
        [LM.rightShoulder, LM.rightWrist],
      ]) {
        const d = Math.hypot(f[wri].x - f[sho].x, f[wri].y - f[sho].y, f[wri].z - f[sho].z);
        expect(d / RIG_ARM_REACH_M, `${id} 의 ${sho}→${wri}`).toBeLessThanOrEqual(REACH_LIMIT);
      }
    }
  });

  it("닿지 않는 주먹은 조용히 클램프하지 않고 던진다", () => {
    expect(() =>
      solveElbow3({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 0.3, 0.25, { x: 0, y: 1, z: 0 }),
    ).toThrow(/팔 길이 밖/);
  });

  it("도달 한계가 98%다 — 아래막기가 96.8%를 쓰므로 여유가 1%뿐이다", () => {
    // 상수를 그대로 적는다. `REACH_LIMIT` 로 문턱을 시험하면 상수를 고칠 때 시험도 같이
    // 움직여서 아무것도 지키지 못한다.
    expect(REACH_LIMIT).toBe(0.98);
    const upper = 0.3;
    const fore = 0.25;
    const reach = upper + fore;
    const bend = { x: 0, y: 1, z: 0 };
    const at = (pct: number) => () =>
      solveElbow3({ x: 0, y: 0, z: 0 }, { x: reach * pct, y: 0, z: 0 }, upper, fore, bend);
    expect(at(0.97)).not.toThrow();
    expect(at(0.99)).toThrow(/팔 길이 밖/);
  });

  it("아래막기가 도달 한계를 거의 다 쓴다 — 여유가 1%뿐이라는 근거", () => {
    const f = buildReferenceFrame("arae-makki");
    const d = Math.hypot(
      f[LM.rightWrist].x - f[LM.rightShoulder].x,
      f[LM.rightWrist].y - f[LM.rightShoulder].y,
      f[LM.rightWrist].z - f[LM.rightShoulder].z,
    );
    expect(d / RIG_ARM_REACH_M).toBeGreaterThan(0.95);
    expect(d / RIG_ARM_REACH_M).toBeLessThanOrEqual(REACH_LIMIT);
  });

  it("bendDir 이 어깨→손목 축과 평행하면 던진다", () => {
    expect(() =>
      solveElbow3({ x: 0, y: 0, z: 0 }, { x: 0.3, y: 0, z: 0 }, 0.3, 0.25, { x: 1, y: 0, z: 0 }),
    ).toThrow(/평행/);
  });

  it("33개 랜드마크가 전부 유한한 좌표다", () => {
    for (const id of REFERENCE_POSE_IDS) {
      const f = buildReferenceFrame(id);
      expect(f).toHaveLength(33);
      for (let i = 0; i < f.length; i++) {
        expect(Number.isFinite(f[i].x) && Number.isFinite(f[i].y) && Number.isFinite(f[i].z), `${id}/${i}`).toBe(true);
        expect(f[i].visibility).toBeGreaterThan(0);
      }
    }
  });

  it("손가락 점이 손목을 따라온다 — 스켈레톤에서 손이 떨어지지 않는다", () => {
    const f = buildReferenceFrame("momtong-an-makki");
    for (const [w, h] of [
      [LM.rightWrist, LM.rightPinky],
      [LM.rightWrist, LM.rightIndex],
      [LM.rightWrist, LM.rightThumb],
    ]) {
      const d = Math.hypot(f[h].x - f[w].x, f[h].y - f[w].y, f[h].z - f[w].z);
      expect(d, `랜드마크 ${h}`).toBeLessThan(0.12);
    }
  });
});

describe("시연 시퀀스", () => {
  for (const id of ["ready", "arae-makki", "momtong-an-makki"] as const) {
    it(`${id} 시연 시퀀스가 준비 → 목표 → 준비로 돈다`, () => {
      const demo = referenceDemoFrames(id);
      expect(demo.frames.length).toBeGreaterThan(30);
      // 시간이 단조 증가한다.
      for (let i = 1; i < demo.frames.length; i++) {
        expect(demo.frames[i].t).toBeGreaterThan(demo.frames[i - 1].t);
      }
      // 유지 구간의 한가운데는 기준 프레임과 거의 같아야 한다.
      const mid = (demo.holdFromMs + demo.holdToMs) / 2;
      const at = demo.frames.reduce((best, f) =>
        Math.abs(f.t - mid) < Math.abs(best.t - mid) ? f : best,
      );
      const ref = buildReferenceFrame(id);
      for (const i of [LM.rightWrist, LM.leftWrist, LM.rightKnee, LM.leftAnkle]) {
        expect(Math.hypot(at.landmarks[i].x - ref[i].x, at.landmarks[i].y - ref[i].y), `${id}/${i}`).toBeLessThan(
          0.01,
        );
      }
    });
  }

  it("같은 옵션이면 같은 시퀀스가 나온다", () => {
    expect(JSON.stringify(referenceDemoFrames("ready"))).toBe(
      JSON.stringify(referenceDemoFrames("ready")),
    );
  });

  it("판정 규칙이 있는 자세는 시연 시퀀스를 만들지 않고 던진다 — 공개 샘플을 쓴다", () => {
    expect(() => referenceDemoFrames("juchum")).toThrow(/공개 샘플/);
    expect(() => referenceDemoFrames("ap-chagi-apex")).toThrow(/공개 샘플/);
  });
});

describe("층 분리", () => {
  it("판정 규칙이 없는 자세는 judgedMotion 이 null 이다 — 점수가 없다는 뜻이다", () => {
    expect(REFERENCE_POSES.ready.judgedMotion).toBeNull();
    expect(REFERENCE_POSES["arae-makki"].judgedMotion).toBeNull();
    expect(REFERENCE_POSES["momtong-an-makki"].judgedMotion).toBeNull();
    expect(REFERENCE_POSES.juchum.judgedMotion).toBe("stance");
    expect(REFERENCE_POSES["ap-chagi-apex"].judgedMotion).toBe("frontKick");
  });

  it("기준 자세가 선언한 시야가 판정 규칙의 전제와 같다", () => {
    expect(REFERENCE_POSES.juchum.view).toBe("frontal");
    expect(REFERENCE_POSES["ap-chagi-apex"].view).toBe("sagittal");
  });

  it("모든 기준 자세에 근거 한 줄이 붙어 있다", () => {
    for (const id of REFERENCE_POSE_IDS) {
      expect(referencePose(id).sourceNote.length).toBeGreaterThan(20);
    }
  });
});
