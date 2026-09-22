import { describe, expect, it } from "vitest";

import {
  angleAtVertexXY,
  clamp,
  lerpFrame,
  lerpLandmark,
  longestRun,
  mean,
  median,
  movingAverage,
  round,
  signedBackwardTiltXY,
  stdDev,
  tiltFromVerticalXY,
} from "./math";
import type { Landmark } from "./types";

const p = (x: number, y: number, z = 0, visibility = 1): Landmark => ({ x, y, z, visibility });

describe("angleAtVertexXY", () => {
  it("직각을 90도로 잰다", () => {
    expect(angleAtVertexXY(p(1, 0), p(0, 0), p(0, 1))).toBeCloseTo(90, 9);
  });

  it("곧게 편 관절을 180도로 잰다", () => {
    expect(angleAtVertexXY(p(-1, 0), p(0, 0), p(1, 0))).toBeCloseTo(180, 9);
  });

  it("z를 무시한다 — 각도는 화면 평면에서만 잰다", () => {
    const withoutZ = angleAtVertexXY(p(1, 0, 0), p(0, 0, 0), p(0, 1, 0));
    const withZ = angleAtVertexXY(p(1, 0, 5), p(0, 0, -3), p(0, 1, 9));
    expect(withZ).toBeCloseTo(withoutZ, 9);
  });

  it("z가 커도 각도가 흔들리지 않는다 — 깊이에 기대지 않기로 한 약속", () => {
    // x·y만 보면 45도다. z를 섞으면 5도쯤으로 무너진다.
    expect(angleAtVertexXY(p(1, 1, 10), p(0, 0, 0), p(1, 0, 0))).toBeCloseTo(45, 9);
    expect(angleAtVertexXY(p(1, 1, -10), p(0, 0, 0), p(1, 0, 0))).toBeCloseTo(45, 9);
    expect(angleAtVertexXY(p(1, 1, 0), p(0, 0, -7), p(1, 0, 3))).toBeCloseTo(45, 9);
  });

  it("두 점이 겹치면 NaN을 준다 — 없는 값을 지어내지 않는다", () => {
    expect(angleAtVertexXY(p(0, 0), p(0, 0), p(1, 0))).toBeNaN();
  });
});

describe("tiltFromVerticalXY / signedBackwardTiltXY", () => {
  it("수직 벡터는 0도", () => {
    expect(tiltFromVerticalXY(0, -1)).toBeCloseTo(0, 9);
    expect(tiltFromVerticalXY(0, 1)).toBeCloseTo(0, 9);
  });

  it("45도 기울기를 45도로 잰다", () => {
    expect(tiltFromVerticalXY(1, -1)).toBeCloseTo(45, 9);
  });

  it("차는 방향의 반대로 기울면 양수, 앞으로 숙이면 음수", () => {
    // forward = +x. 어깨가 -x 쪽이면 뒤로 젖힌 것.
    expect(signedBackwardTiltXY(-1, -1, 1)).toBeCloseTo(45, 9);
    expect(signedBackwardTiltXY(1, -1, 1)).toBeCloseTo(-45, 9);
  });
});

describe("median", () => {
  it("홀수 개는 가운데 값", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("짝수 개는 가운데 둘의 평균", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("입력 배열을 바꾸지 않는다", () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });

  it("바깥값 하나가 대표값을 끌고 가지 못한다 — 평균과 달리", () => {
    const values = [10, 10, 10, 10, 1000];
    expect(median(values)).toBe(10);
    expect(mean(values)).toBeGreaterThan(200);
  });
});

describe("stdDev", () => {
  it("전부 같은 값이면 0", () => {
    expect(stdDev([2, 2, 2, 2])).toBe(0);
  });

  it("모표준편차(N으로 나눈다)", () => {
    // 평균 2, 편차 제곱 합 2, N=4 → sqrt(0.5)
    expect(stdDev([1, 2, 2, 3])).toBeCloseTo(Math.sqrt(0.5), 12);
  });
});

describe("movingAverage", () => {
  it("창 안의 값을 평균낸다", () => {
    expect(movingAverage([1, 2, 3], 3)).toEqual([1.5, 2, 2.5]);
  });

  it("null(무효 프레임)은 창에서 빼고 평균낸다 — 0으로 끌어내리지 않는다", () => {
    expect(movingAverage([10, null, 10], 3)).toEqual([10, 10, 10]);
  });

  it("창 안이 전부 null이면 null", () => {
    expect(movingAverage([null, null, null], 3)).toEqual([null, null, null]);
  });

  it("창이 1이면 원본 그대로", () => {
    expect(movingAverage([1, 5, 9], 1)).toEqual([1, 5, 9]);
  });

  it("짝수 창은 거부한다 — 가운데가 없으면 값이 한쪽으로 밀린다", () => {
    expect(() => movingAverage([1, 2], 2)).toThrow();
  });
});

describe("longestRun", () => {
  it("가장 긴 연속 구간을 찾는다", () => {
    expect(longestRun([true, false, true, true, true, false])).toEqual({ start: 2, end: 4 });
  });

  it("끝에 붙은 구간도 찾는다", () => {
    expect(longestRun([false, true, true])).toEqual({ start: 1, end: 2 });
  });

  it("전부 false면 null", () => {
    expect(longestRun([false, false])).toBeNull();
  });

  it("길이가 같으면 앞선 구간을 고른다 — 결정적이어야 하므로", () => {
    expect(longestRun([true, true, false, true, true])).toEqual({ start: 0, end: 1 });
  });
});

describe("round", () => {
  it("자리수를 고정한다", () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(-1.23456, 3)).toBe(-1.235);
  });

  it("-0을 0으로 접는다 — JSON에서 부호가 흔들리지 않게", () => {
    expect(Object.is(round(-0.0001, 2), 0)).toBe(true);
  });
});

describe("보간", () => {
  it("visibility는 낮은 쪽을 따른다 — 보간으로 신뢰도를 세탁할 수 없다", () => {
    const out = lerpLandmark(p(0, 0, 0, 0.9), p(10, 0, 0, 0.2), 0.5);
    expect(out.x).toBe(5);
    expect(out.visibility).toBe(0.2);
  });

  it("프레임 전체를 보간한다", () => {
    const a = [p(0, 0), p(2, 4)];
    const b = [p(10, 0), p(2, 8)];
    const out = lerpFrame(a, b, 0.25);
    expect(out[0].x).toBe(2.5);
    expect(out[1].y).toBe(5);
  });

  it("랜드마크 수가 다르면 거부한다", () => {
    expect(() => lerpFrame([p(0, 0)], [p(0, 0), p(1, 1)], 0.5)).toThrow();
  });
});

describe("clamp", () => {
  it("범위 밖을 잘라 낸다", () => {
    expect(clamp(-2, -1, 1)).toBe(-1);
    expect(clamp(2, -1, 1)).toBe(1);
    expect(clamp(0.5, -1, 1)).toBe(0.5);
  });
});
