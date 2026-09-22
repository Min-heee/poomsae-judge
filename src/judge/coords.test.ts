/**
 * 랜드마크에서 몸의 값을 뽑는 층.
 *
 * 여기 있는 시험 대부분은 "좌표가 뒤집혀도 같은 답이 나오는가"를 묻는다.
 * 왼쪽/오른쪽, 위/아래, 앞/뒤가 뒤바뀐 입력은 실제로 들어온다(거울 모드, 반대 방향 촬영).
 */

import { describe, expect, it } from "vitest";

import {
  ankleGapX,
  height,
  hipElevation,
  hipMid,
  kneeAngle,
  midpoint,
  shoulderMid,
  shoulderWidth,
  torsoBackwardLean,
  torsoTilt,
} from "./coords";
import { LANDMARK_COUNT, LEFT_LEG, LM, RIGHT_LEG } from "./landmarks";
import type { Landmark } from "./types";

function blank(): Landmark[] {
  return Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
}

function put(frame: Landmark[], index: number, x: number, y: number, z = 0): Landmark[] {
  frame[index] = { x, y, z, visibility: 1 };
  return frame;
}

describe("height", () => {
  it("y가 아래로 증가한다는 약속대로 위에 있는 점이 더 높다", () => {
    const upper: Landmark = { x: 0, y: -2, z: 0, visibility: 1 };
    const lower: Landmark = { x: 0, y: 1, z: 0, visibility: 1 };
    expect(height(upper)).toBeGreaterThan(height(lower));
    expect(height(upper) - height(lower)).toBeCloseTo(3, 12);
    expect(height({ x: 0, y: 0, z: 0, visibility: 1 })).toBe(0);
  });
});

describe("midpoint", () => {
  it("가운데를 잡고 신뢰도는 낮은 쪽을 따른다", () => {
    const m = midpoint(
      { x: 0, y: 0, z: 0, visibility: 0.9 },
      { x: 2, y: 4, z: -6, visibility: 0.4 },
    );
    expect(m).toEqual({ x: 1, y: 2, z: -3, visibility: 0.4 });
  });
});

describe("shoulderWidth (기준 길이 S)", () => {
  it("몸이 어느 쪽을 보고 있어도 같은 값이다 — 그래서 여기만 3차원 거리를 쓴다", () => {
    const facingCamera = put(put(blank(), LM.leftShoulder, 0.2, 0, 0), LM.rightShoulder, -0.2, 0, 0);
    const facingSide = put(put(blank(), LM.leftShoulder, 0, 0, 0.2), LM.rightShoulder, 0, 0, -0.2);
    expect(shoulderWidth(facingCamera)).toBeCloseTo(0.4, 12);
    expect(shoulderWidth(facingSide)).toBeCloseTo(0.4, 12);
  });
});

describe("ankleGapX", () => {
  it("좌우 발목의 수평 거리를 잰다", () => {
    const f = put(put(blank(), LM.leftAnkle, 0.44, 0.7), LM.rightAnkle, -0.44, 0.7);
    expect(ankleGapX(f)).toBeCloseTo(0.88, 12);
  });

  it("좌우가 뒤바뀌어도 같은 값이다 — 거울 모드에서도 같은 판정이 나와야 한다", () => {
    const normal = put(put(blank(), LM.leftAnkle, 0.44, 0.7), LM.rightAnkle, -0.44, 0.7);
    const mirrored = put(put(blank(), LM.leftAnkle, -0.44, 0.7), LM.rightAnkle, 0.44, 0.7);
    expect(ankleGapX(mirrored)).toBe(ankleGapX(normal));
    expect(ankleGapX(mirrored)).toBeGreaterThan(0);
  });

  it("깊이(z)를 넣지 않는다 — 카메라 거리 오차가 발 간격에 섞이면 안 된다", () => {
    const flat = put(put(blank(), LM.leftAnkle, 0.4, 0.7, 0), LM.rightAnkle, -0.4, 0.7, 0);
    const staggered = put(put(blank(), LM.leftAnkle, 0.4, 0.7, 0.3), LM.rightAnkle, -0.4, 0.7, -0.3);
    expect(ankleGapX(staggered)).toBe(ankleGapX(flat));
  });
});

describe("kneeAngle", () => {
  it("곧게 편 다리는 180도", () => {
    const f = blank();
    put(f, LM.leftHip, 0, 0);
    put(f, LM.leftKnee, 0, 0.4);
    put(f, LM.leftAnkle, 0, 0.8);
    expect(kneeAngle(f, LEFT_LEG)).toBeCloseTo(180, 9);
  });

  it("직각으로 접은 다리는 90도", () => {
    const f = blank();
    put(f, LM.rightHip, 0, 0);
    put(f, LM.rightKnee, 0, 0.4);
    put(f, LM.rightAnkle, 0.4, 0.4);
    expect(kneeAngle(f, RIGHT_LEG)).toBeCloseTo(90, 9);
  });

  it("좌우 다리를 각각 잰다", () => {
    const f = blank();
    put(f, LM.leftHip, 0, 0);
    put(f, LM.leftKnee, 0, 0.4);
    put(f, LM.leftAnkle, 0, 0.8);
    put(f, LM.rightHip, 0, 0);
    put(f, LM.rightKnee, 0, 0.4);
    put(f, LM.rightAnkle, 0.4, 0.4);
    expect(kneeAngle(f, LEFT_LEG)).toBeCloseTo(180, 9);
    expect(kneeAngle(f, RIGHT_LEG)).toBeCloseTo(90, 9);
  });
});

describe("torsoTilt / torsoBackwardLean", () => {
  function torsoFrame(dx: number, dy: number): Landmark[] {
    const f = blank();
    put(f, LM.leftHip, 0.1, 0);
    put(f, LM.rightHip, -0.1, 0);
    put(f, LM.leftShoulder, dx + 0.2, dy);
    put(f, LM.rightShoulder, dx - 0.2, dy);
    return f;
  }

  it("수직이면 0도", () => {
    expect(torsoTilt(torsoFrame(0, -0.5))).toBeCloseTo(0, 9);
  });

  it("기운 방향과 무관하게 크기만 잰다 (A4)", () => {
    expect(torsoTilt(torsoFrame(0.5, -0.5))).toBeCloseTo(45, 9);
    expect(torsoTilt(torsoFrame(-0.5, -0.5))).toBeCloseTo(45, 9);
  });

  it("차는 방향을 알면 뒤로 젖힌 것만 양수로 잰다 (B5)", () => {
    // 차는 방향이 +x 인데 어깨가 -x 쪽 → 뒤로 젖힌 것.
    expect(torsoBackwardLean(torsoFrame(-0.5, -0.5), 1)).toBeCloseTo(45, 9);
    expect(torsoBackwardLean(torsoFrame(0.5, -0.5), 1)).toBeCloseTo(-45, 9);
    // 반대 방향으로 차면 부호도 뒤집힌다.
    expect(torsoBackwardLean(torsoFrame(-0.5, -0.5), -1)).toBeCloseTo(-45, 9);
  });

  it("어깨·엉덩이 중점을 쓴다", () => {
    const f = torsoFrame(0, -0.5);
    expect(shoulderMid(f).x).toBeCloseTo(0, 12);
    expect(hipMid(f).x).toBeCloseTo(0, 12);
  });
});

describe("hipElevation", () => {
  it("발목 평균 높이 대비 엉덩이 높이다", () => {
    const f = blank();
    put(f, LM.leftHip, 0.1, 0);
    put(f, LM.rightHip, -0.1, 0);
    put(f, LM.leftAnkle, 0.4, 0.7);
    put(f, LM.rightAnkle, -0.4, 0.7);
    expect(hipElevation(f)).toBeCloseTo(0.7, 12);
  });

  it("원점을 옮겨도 값이 그대로다 — 엉덩이가 원점인 좌표계에서도 흔들림을 잴 수 있어야 한다", () => {
    const shift = (f: Landmark[], dy: number) => f.map((p) => ({ ...p, y: p.y + dy }));
    const f = blank();
    put(f, LM.leftHip, 0.1, 0);
    put(f, LM.rightHip, -0.1, 0);
    put(f, LM.leftAnkle, 0.4, 0.7);
    put(f, LM.rightAnkle, -0.4, 0.7);
    expect(hipElevation(shift(f, 12.5))).toBeCloseTo(hipElevation(f), 12);
  });

  it("앉으면 값이 줄어든다", () => {
    const make = (ankleY: number) => {
      const f = blank();
      put(f, LM.leftHip, 0.1, 0);
      put(f, LM.rightHip, -0.1, 0);
      put(f, LM.leftAnkle, 0.4, ankleY);
      put(f, LM.rightAnkle, -0.4, ankleY);
      return f;
    };
    expect(hipElevation(make(0.6))).toBeLessThan(hipElevation(make(0.8)));
  });
});
