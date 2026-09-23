/**
 * 비교 층의 시험.
 *
 * 지키려는 성질은 넷이다.
 *  1. 교본과 똑같이 하면 100이다. (기준이 스스로를 통과하지 못하면 아무 말도 못 한다)
 *  2. 한 군데만 어긋나면 **그 관절만** 뜬다. (전부 빨개지면 고칠 데를 못 찾는다)
 *  3. 좌우를 뒤집어도 같은 점수다. (왼발 차기가 0점이 되면 안 된다)
 *  4. **읽지 못한 관절은 어긋남 색을 받지 못한다.** (화면의 두 빨강이 겹치지 않는 근거)
 */

import { describe, expect, it } from "vitest";

import { STANCE, WITHHOLD } from "../judge/constants";
import { LANDMARK_COUNT, LM } from "../judge/landmarks";
import type { Landmark } from "../judge/types";
import { buildReferenceFrame, buildReferenceFrameWith } from "../samples/reference-frames";
import { ANGLE_BAND, LENGTH_BAND, SCORE_AT_WARN, itemScore, bandOf, OFF_ZERO_MULTIPLE } from "./bands";
import { chooseOrientation, compareToReference } from "./compare";
import { MIRROR_INDEX, mirrorFrame, normalize } from "./frame";
import { referencePose, referencePoseVariant } from "./reference";
import type { MatchBand } from "./types";

function blur(frame: readonly Landmark[], indices: readonly number[], v = 0.2): Landmark[] {
  const set = new Set(indices);
  return frame.map((p, i) => (set.has(i) ? { ...p, visibility: v } : { ...p }));
}

function scaleAndShift(frame: readonly Landmark[], k: number, dx: number, dy: number): Landmark[] {
  return frame.map((p) => ({ x: p.x * k + dx, y: p.y * k + dy, z: p.z * k, visibility: p.visibility }));
}

/** x만 뒤집는다 = 카메라가 반대편에 선 것. 좌우 인덱스는 그대로다(같은 사람이다). */
function flipX(frame: readonly Landmark[]): Landmark[] {
  return frame.map((p) => ({ ...p, x: -p.x }));
}

function byId<T extends { id: string }>(metrics: readonly T[], id: string): T {
  const m = metrics.find((x) => x.id === id);
  if (m === undefined) throw new Error(`지표 ${id} 가 없다`);
  return m;
}

describe("교본과 똑같이 하면 100이다", () => {
  for (const id of ["ready", "juchum", "arae-makki", "momtong-an-makki", "ap-chagi-apex"] as const) {
    it(`${id}: 일치도 100, 어긋난 관절 0개`, () => {
      const pose = referencePose(id);
      const c = compareToReference(pose, pose.frame);
      expect(c.match).toBeCloseTo(100, 9);
      expect(c.offJoints).toEqual([]);
      expect(c.off).toEqual([]);
      expect(c.unreadableCount).toBe(0);
      expect(c.metrics.every((m) => m.band === "ok")).toBe(true);
      expect(c.metrics.every((m) => Math.abs(m.diff ?? 1) < 1e-9)).toBe(true);
    });
  }
});

describe("키와 카메라 거리를 지운다", () => {
  it("몸 전체를 1.7배 키우고 옮겨도 같은 결과다", () => {
    const pose = referencePose("juchum");
    const grown = scaleAndShift(pose.frame, 1.7, 0.5, -0.3);
    const c = compareToReference(pose, grown);
    expect(c.match).toBeCloseTo(100, 6);
    expect(c.offJoints).toEqual([]);
  });

  it("작은 사람도 같은 결과다", () => {
    const pose = referencePose("ap-chagi-apex");
    const c = compareToReference(pose, scaleAndShift(pose.frame, 0.55, -1, 2));
    expect(c.match).toBeCloseTo(100, 6);
  });
});

describe("한 군데만 어긋나면 그 관절만 뜬다", () => {
  it("오른 무릎만 23° 덜 펴면 오른 무릎 하나만 어긋남이다", () => {
    const pose = referencePose("ready");
    const frame = buildReferenceFrameWith("ready", { kneeAngleRightDeg: 155 });
    const c = compareToReference(pose, frame);

    expect(c.offJoints).toEqual([LM.rightKnee]);
    expect(c.off.map((m) => m.id)).toEqual(["knee-right"]);
    expect(byId(c.metrics, "knee-right").diff).toBeCloseTo(-23, 1);
    expect(byId(c.metrics, "knee-left").band).toBe("ok");
    expect(byId(c.metrics, "knee-left").diff).toBeCloseTo(0, 9);
    expect(c.match).toBeLessThan(100);
    expect(c.match).toBeGreaterThan(90); // 가중치 5짜리 지표 하나라 일치도는 조금만 준다
  });

  it("어긋난 방향이 부호로 남는다 — '덜'과 '더'는 고치는 법이 반대다", () => {
    const pose = referencePose("juchum");
    const tooStraight = compareToReference(pose, buildReferenceFrameWith("juchum", { kneeAngleLeftDeg: 152 }));
    const tooDeep = compareToReference(pose, buildReferenceFrameWith("juchum", { kneeAngleLeftDeg: 124 }));
    expect(byId(tooStraight.metrics, "knee-left").diff).toBeGreaterThan(0);
    expect(byId(tooDeep.metrics, "knee-left").diff).toBeLessThan(0);
  });

  it("주의 대역(6~15°)은 어긋남 목록에 들어가지 않는다", () => {
    const pose = referencePose("ready");
    const c = compareToReference(pose, buildReferenceFrameWith("ready", { kneeAngleRightDeg: 168 }));
    expect(byId(c.metrics, "knee-right").band).toBe("warn");
    expect(c.offJoints).toEqual([]);
    expect(c.jointBands[LM.rightKnee]).toBe("warn");
  });

  it("판정이 합격이라 한 발 간격을 오버레이가 빨갛게 칠하지 않는다", () => {
    // A1의 합격대는 1.70~2.30 이고 교본은 그 한가운데인 2.00이다. 합격대를 훑으며
    // **빨강(off)이 한 번도 나오지 않는지** 본다 — 두 층이 한 화면에서 서로 다른 말을
    // 하지 않게 하려는 것이 이 밴드(0.30/0.60)의 존재 이유다.
    //
    // 양 끝(차이 정확히 0.30)이 '맞음'이 아니라 '주의'로 나오는 것은 받아들인다.
    // 2.0 − 1.7 이 부동소수점에서 0.30000000000000004 이기 때문이고, 애초에 지키려던
    // 약속은 "합격을 빨갛게 칠하지 않는다"이지 "합격을 전부 초록으로 칠한다"가 아니다.
    const pose = referencePose("juchum");
    const [, passLo, passHi] = STANCE.feetGapBoundaries;
    for (let gap = passLo; gap <= passHi + 1e-9; gap = Math.round((gap + 0.05) * 100) / 100) {
      const c = compareToReference(pose, buildReferenceFrameWith("juchum", { feetGapRatio: gap }));
      expect(byId(c.metrics, "feet-gap").band, `발 간격 ${gap}`).not.toBe("off");
      expect(c.jointBands[LM.leftAnkle], `발 간격 ${gap}`).not.toBe("off");
    }
  });

  it("합격대 한가운데는 맞음이다", () => {
    const pose = referencePose("juchum");
    for (const gap of [1.85, 2.0, 2.15]) {
      const c = compareToReference(pose, buildReferenceFrameWith("juchum", { feetGapRatio: gap }));
      expect(byId(c.metrics, "feet-gap").band, `발 간격 ${gap}`).toBe("ok");
    }
  });
});

describe("어긋남 목록은 나쁜 것부터 나온다", () => {
  it("화면이 위에서부터 읽으면 제일 급한 것을 먼저 말한다", () => {
    const pose = referencePose("ready");
    // 무릎 23° 어긋남(점수 낮음)과 발 간격 0.70·S 어긋남(점수 덜 낮음)을 함께 만든다.
    const frame = buildReferenceFrameWith("ready", { kneeAngleRightDeg: 155, feetGapRatio: 0.2 });
    const c = compareToReference(pose, frame);
    expect(c.off.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < c.off.length; i++) {
      expect(c.off[i].score as number, `${c.off[i - 1].id} → ${c.off[i].id}`).toBeGreaterThanOrEqual(
        c.off[i - 1].score as number,
      );
    }
    expect(c.off[0].id).toBe("knee-right");
    expect(c.off.map((m) => m.id)).toContain("feet-gap");
  });
});

describe("좌우를 뒤집어도 같은 점수다", () => {
  const cases = ["ready", "juchum", "arae-makki", "momtong-an-makki", "ap-chagi-apex"] as const;

  for (const id of cases) {
    it(`${id}: 거울 자세를 mirrored 로 재면 원본과 같은 값이 나온다`, () => {
      const pose = referencePose(id);
      // 일부러 어긋난 자세를 만들어 비교한다. 완벽한 자세는 뒤집어도 100이라 시험이 약하다.
      const player = buildReferenceFrameWith(id, id === "ap-chagi-apex" ? { kickKneeDeg: 30 } : { kneeAngleLeftDeg: 150 });
      const direct = compareToReference(pose, player);
      const mirrored = compareToReference(pose, mirrorFrame(player), { mirrored: true });

      expect(mirrored.match).toBeCloseTo(direct.match as number, 9);
      for (const m of direct.metrics) {
        const n = byId(mirrored.metrics, m.id);
        expect(n.measured).toBeCloseTo(m.measured as number, 9);
        expect(n.diff).toBeCloseTo(m.diff as number, 9);
        expect(n.band).toBe(m.band);
      }
    });
  }

  it("거울로 비교하면 관절 번호와 좌우 이름이 사람의 몸 쪽으로 돌아온다", () => {
    const pose = referencePose("ready");
    const player = buildReferenceFrameWith("ready", { kneeAngleRightDeg: 155 });
    const direct = compareToReference(pose, player);
    const mirrored = compareToReference(pose, mirrorFrame(player), { mirrored: true });

    expect(direct.offJoints).toEqual([LM.rightKnee]);
    // 거울 사람의 어긋난 무릎은 **왼** 무릎이다.
    expect(mirrored.offJoints).toEqual([LM.leftKnee]);
    expect(byId(mirrored.metrics, "knee-right").side).toBe("left");
    expect(byId(mirrored.metrics, "knee-right").labelKo).toBe("왼쪽 무릎");
    // 지표 id 는 정의의 이름이라 뒤집히지 않는다.
    expect(byId(direct.metrics, "knee-right").side).toBe("right");
  });

  it("좌우 대칭인 자세는 그냥 뒤집어도 같은 점수다", () => {
    const pose = referencePose("juchum");
    const player = buildReferenceFrameWith("juchum", { feetGapRatio: 1.75 });
    const a = compareToReference(pose, player);
    const b = compareToReference(pose, mirrorFrame(player));
    expect(b.match).toBeCloseTo(a.match as number, 9);
  });

  it("거울은 x를 뒤집고 좌우 인덱스를 바꾼다 — 둘 다 해야 한다", () => {
    // 한쪽만 하면 조용히 틀린다. 인덱스만 바꾸면 오른팔 동작을 왼팔 규칙으로 재고,
    // x만 뒤집으면 왼팔이 오른쪽에 그려진다. 두 번 뒤집어 보는 시험은 이것을 못 잡는다 —
    // 잘못된 거울도 제 짝을 되돌리기 때문이다. 그래서 한 번만 뒤집어 놓고 직접 본다.
    const f = buildReferenceFrame("arae-makki");
    const m = mirrorFrame(f);
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const src = f[MIRROR_INDEX[i]];
      expect(m[i].x, `랜드마크 ${i} 의 x`).toBeCloseTo(-src.x, 12);
      expect(m[i].y, `랜드마크 ${i} 의 y`).toBeCloseTo(src.y, 12);
      expect(m[i].z, `랜드마크 ${i} 의 z`).toBeCloseTo(src.z, 12);
      expect(m[i].visibility).toBe(src.visibility);
    }
    // 막는 팔(오른손목, x < 0)이 거울에서는 왼손목의 x > 0 이 된다.
    expect(f[LM.rightWrist].x).toBeLessThan(0);
    expect(m[LM.leftWrist].x).toBeGreaterThan(0);
  });

  it("거울은 제 짝을 되돌린다 — 두 번 뒤집으면 원본이다", () => {
    const f = buildReferenceFrame("arae-makki");
    const twice = mirrorFrame(mirrorFrame(f));
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      expect(twice[i].x).toBeCloseTo(f[i].x, 12);
      expect(twice[i].y).toBeCloseTo(f[i].y, 12);
      expect(MIRROR_INDEX[MIRROR_INDEX[i]]).toBe(i);
    }
  });

  it("왼팔 아래막기를 관측으로 골라낸다 — 고른 근거가 문장으로 나온다", () => {
    const pose = referencePose("arae-makki");
    const leftHanded = mirrorFrame(buildReferenceFrame("arae-makki"));
    const choice = chooseOrientation(pose, leftHanded);
    expect(choice.mirrored).toBe(true);
    expect(choice.comparison.match).toBeCloseTo(100, 6);
    expect(choice.matchAsIs).toBeLessThan(choice.matchMirrored as number);
    expect(choice.reasonKo).toContain("뒤집어");
  });

  it("대칭 자세에서는 좌우를 지어내지 않는다 — 비겨도 그대로 둔다", () => {
    const pose = referencePose("juchum");
    const choice = chooseOrientation(pose, buildReferenceFrame("juchum"));
    expect(choice.mirrored).toBe(false);
    expect(choice.matchAsIs).toBeCloseTo(choice.matchMirrored as number, 9);
  });
});

describe("나쁜 쪽으로 채점한다", () => {
  it("하체 지표는 **덜 굽은 쪽** 무릎을 읽는다 — 판정 A2와 같은 규약이다", () => {
    const pose = referencePose("arae-makki");
    // 한쪽만 펴면(170°) 그쪽이 나쁜 쪽이다. 더 굽은 쪽(138°)을 읽으면 이 자세가 만점이 된다.
    const lopsided = buildReferenceFrameWith("arae-makki", { kneeAngleLeftDeg: 170 });
    const c = compareToReference(pose, lopsided);
    expect(byId(c.metrics, "lower-knee").measured).toBeCloseTo(170, 1);
    expect(byId(c.metrics, "lower-knee").band).toBe("off");
    expect(c.offJoints).toContain(LM.leftKnee);
  });
});

describe("측면 코스는 사람이 어느 쪽을 보고 서든 성립한다", () => {
  it("카메라가 반대편에 서도(x 전부 뒤집기) 같은 결과다", () => {
    // 측면 촬영에서 "오른쪽을 보고 선다"를 상수로 박으면, 반대로 선 사람의 상체 젖힘
    // 부호가 뒤집혀 8° 뒤로 젖힌 자세가 8° 앞으로 숙인 것으로 읽힌다.
    // 차는 발이 몸 앞에 있다는 관측으로 방향을 정하면 양쪽 모두에서 같은 값이 나온다.
    const pose = referencePose("ap-chagi-apex");
    const other = compareToReference(pose, flipX(pose.frame));
    expect(other.match).toBeCloseTo(100, 6);
    expect(byId(other.metrics, "torso-lean").diff).toBeCloseTo(0, 6);
    expect(other.offJoints).toEqual([]);
  });

  it("상체를 반대로 숙이면 그것은 잡는다 — 방향을 몰라서가 아니다", () => {
    const pose = referencePose("ap-chagi-apex");
    const leaning = buildReferenceFrameWith("ap-chagi-apex", { torsoLeanDeg: -12 });
    const c = compareToReference(pose, leaning);
    expect(byId(c.metrics, "torso-lean").measured).toBeCloseTo(-12, 1);
    expect(byId(c.metrics, "torso-lean").diff).toBeCloseTo(-20, 1);
    expect(byId(c.metrics, "torso-lean").band).toBe("off");
  });
});

describe("부호를 남겨야 하는 지표", () => {
  it("안막기 주먹이 중심선을 지나치면 못 미친 것과 다르게 읽힌다", () => {
    // 목표는 중심선을 살짝 넘어선 +0.11·S 다. 반대쪽 −0.11·S 는 **다른 자세**인데
    // 절댓값으로 재면 둘이 같은 값이 되어 "완벽하다"고 말하게 된다.
    const pose = referencePose("momtong-an-makki");
    const crossed = pose.frame.map((p, i) =>
      i === LM.rightWrist ? { ...p, x: -p.x } : { ...p },
    );
    const c = compareToReference(pose, crossed);
    const m = byId(c.metrics, "block-fist-lateral");
    expect(m.target).toBeGreaterThan(0);
    expect(m.measured).toBeLessThan(0);
    expect(m.diff as number).toBeCloseTo(-2 * m.target, 6);
    expect(m.band).not.toBe("ok");
  });
});

describe("읽지 못한 관절은 어긋남 색을 받지 못한다", () => {
  it("흐린 무릎은 어긋나 있어도 어긋남이 아니라 '읽지 못함'이다", () => {
    const pose = referencePose("ready");
    const bad = buildReferenceFrameWith("ready", { kneeAngleRightDeg: 155 });
    const before = compareToReference(pose, bad);
    expect(before.jointBands[LM.rightKnee]).toBe("off");

    const after = compareToReference(pose, blur(bad, [LM.rightKnee]));
    expect(byId(after.metrics, "knee-right").band).toBe("unreadable");
    expect(byId(after.metrics, "knee-right").measured).toBeNull();
    expect(byId(after.metrics, "knee-right").reason).toContain("신뢰도");
    expect(after.jointBands[LM.rightKnee]).toBe("none");
    expect(after.offJoints).toEqual([]);
  });

  it("어떤 입력에서도 한 관절이 '흐림'과 '어긋남'을 동시에 갖지 않는다", () => {
    const pose = referencePose("juchum");
    const bad = buildReferenceFrameWith("juchum", {
      kneeAngleLeftDeg: 120,
      kneeAngleRightDeg: 158,
      feetGapRatio: 1.2,
      torsoTiltDeg: 25,
    });
    // 관절을 하나씩 흐리게 하며 전수로 확인한다.
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const c = compareToReference(pose, blur(bad, [i]));
      expect(c.jointBands[i], `랜드마크 ${i}`).toBe<MatchBand>("none");
      for (let j = 0; j < LANDMARK_COUNT; j++) {
        if (blurOf(c.jointBands[j])) {
          throw new Error("jointBands 에 unreadable 이 새어 나왔다 — 화면이 두 빨강을 겹쳐 칠한다");
        }
      }
    }
  });

  it("지표가 자기 관절을 reads 에 빠뜨려도 흐린 관절은 칠해지지 않는다", () => {
    // 색 규약은 주석이 아니라 코드가 지켜야 한다. 일부러 잘못 만든 지표 —
    // 25번(왼 무릎)을 **칠하면서 읽지는 않는** 지표 — 를 넣고, 25번을 흐리게 했을 때도
    // 어긋남 색이 나가지 않는지 본다. `compare.ts` 의 마지막 한 줄이 이것을 막는다.
    const base = referencePose("juchum");
    const bad: typeof base = {
      ...base,
      metrics: [
        {
          ...base.metrics[0],
          id: "bad-spec",
          reads: [LM.rightKnee],
          joints: [LM.leftKnee],
          measure: () => 999,
          target: 0,
        },
      ],
    };
    const frame = blur(buildReferenceFrame("juchum"), [LM.leftKnee]);
    const c = compareToReference(bad, frame);
    expect(c.metrics[0].band).toBe("off"); // 지표 자체는 어긋남으로 읽힌다
    expect(c.jointBands[LM.leftKnee]).toBe("none"); // 그래도 흐린 관절은 칠하지 않는다
    expect(c.offJoints).toEqual([]);
  });

  it("읽지 못한 지표는 일치도의 분자·분모에서 함께 빠진다", () => {
    const pose = referencePose("ready");
    const perfect = pose.frame;
    const c = compareToReference(pose, blur(perfect, [LM.rightWrist]));
    // 오른 손목을 읽는 지표(주먹 높이·좌우·팔꿈치)만 빠지고, 남은 지표는 전부 100이다.
    expect(c.unreadableCount).toBeGreaterThan(0);
    expect(c.match).toBeCloseTo(100, 9);
  });

  it("기준점(어깨·엉덩이)이 흐리면 비교 전체를 접는다", () => {
    const pose = referencePose("juchum");
    const c = compareToReference(pose, blur(pose.frame, [LM.leftHip]));
    expect(c.match).toBeNull();
    expect(c.readableCount).toBe(0);
    expect(c.metrics.every((m) => m.band === "unreadable")).toBe(true);
    expect(c.jointBands.every((b) => b === "none")).toBe(true);
    expect(c.metrics[0].reason).toContain("엉덩이 중점");
  });

  it("어깨가 겹쳐 S를 못 구하면 0으로 나누지 않고 접는다", () => {
    const pose = referencePose("juchum");
    const collapsed = pose.frame.map((p, i) =>
      i === LM.leftShoulder ? { ...pose.frame[LM.rightShoulder] } : { ...p },
    );
    const c = compareToReference(pose, collapsed);
    expect(c.match).toBeNull();
    expect(c.shoulderWidthM).toBeNull();
    expect(c.metrics[0].reason).toContain("어깨");
  });
});

function blurOf(b: MatchBand): boolean {
  return b === "unreadable";
}

describe("밴드와 항목 점수", () => {
  it("맞음 문턱 안은 전부 100이다", () => {
    expect(itemScore(0, ANGLE_BAND)).toBe(100);
    expect(itemScore(ANGLE_BAND.ok, ANGLE_BAND)).toBe(100);
    expect(itemScore(-ANGLE_BAND.ok, ANGLE_BAND)).toBe(100);
  });

  it("주의 문턱에서 두 식이 같은 값을 준다 — 경계에서 튀지 않는다", () => {
    expect(itemScore(ANGLE_BAND.warn, ANGLE_BAND)).toBeCloseTo(SCORE_AT_WARN, 9);
    expect(itemScore(ANGLE_BAND.warn + 1e-9, ANGLE_BAND)).toBeCloseTo(SCORE_AT_WARN, 6);
  });

  it("어긋남은 주의 문턱의 2배에서 0에 닿고 그 아래로 내려가지 않는다", () => {
    const zeroAt = ANGLE_BAND.warn * OFF_ZERO_MULTIPLE;
    expect(itemScore(zeroAt, ANGLE_BAND)).toBe(0);
    expect(itemScore(zeroAt + 100, ANGLE_BAND)).toBe(0);
    expect(itemScore(-zeroAt - 100, ANGLE_BAND)).toBe(0);
  });

  it("점수가 단조 감소한다", () => {
    let prev = 101;
    for (let d = 0; d <= 40; d += 0.25) {
      const s = itemScore(d, ANGLE_BAND);
      expect(s).toBeLessThanOrEqual(prev + 1e-9);
      prev = s;
    }
  });

  it("밴드 이름이 문턱과 같이 간다", () => {
    expect(bandOf(LENGTH_BAND.ok, LENGTH_BAND)).toBe("ok");
    expect(bandOf(LENGTH_BAND.ok + 1e-9, LENGTH_BAND)).toBe("warn");
    expect(bandOf(LENGTH_BAND.warn, LENGTH_BAND)).toBe("warn");
    expect(bandOf(LENGTH_BAND.warn + 1e-9, LENGTH_BAND)).toBe("off");
  });

  it("각도 밴드의 하한이 H4의 ε보다 충분히 크다 — 잡음이 색을 흔들지 못한다", () => {
    expect(ANGLE_BAND.ok / WITHHOLD.minVisibility).toBeGreaterThan(0); // (형태 확인용)
    expect(ANGLE_BAND.ok).toBeGreaterThanOrEqual(3 * 2); // ε(deg) = 2
  });
});

describe("결정성", () => {
  it("같은 입력이면 같은 결과다", () => {
    const pose = referencePose("momtong-an-makki");
    const player = buildReferenceFrameWith("momtong-an-makki", { torsoTiltDeg: 7 });
    const a = compareToReference(pose, player);
    const b = compareToReference(pose, player);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("정규화가 원본을 건드리지 않는다", () => {
    const f = buildReferenceFrame("juchum");
    const before = JSON.stringify(f);
    normalize(f);
    compareToReference(referencePose("juchum"), f, { mirrored: true });
    expect(JSON.stringify(f)).toBe(before);
  });
});

describe("문제 변형은 합격대 안에서만 움직인다", () => {
  it("발 간격 1.80 / 2.00 / 2.20 은 만들 수 있다", () => {
    for (const gap of [1.8, 2.0, 2.2]) {
      const variant = referencePoseVariant("juchum", { feetGapRatio: gap });
      expect(byId(variant.metrics, "feet-gap").target).toBeCloseTo(gap, 6);
      // 변형 교본도 스스로에게는 100이어야 한다.
      expect(compareToReference(variant, variant.frame).match).toBeCloseTo(100, 9);
    }
  });

  it("합격대 밖의 교본은 만들지 못한다 — 교본대로 했는데 감점이 나오면 안 된다", () => {
    expect(() => referencePoseVariant("juchum", { feetGapRatio: 1.4 })).toThrow(/합격대/);
    expect(() => referencePoseVariant("juchum", { feetGapRatio: 2.5 })).toThrow(/합격대/);
    expect(() => referencePoseVariant("juchum", { kneeAngleLeftDeg: 150 })).toThrow(/합격선/);
  });

  it("모르는 파라미터는 조용히 무시하지 않고 던진다", () => {
    expect(() => referencePoseVariant("juchum", { kickHipDeg: 100 })).toThrow(/받지 않는다/);
  });
});
