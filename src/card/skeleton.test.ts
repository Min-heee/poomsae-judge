/**
 * 카드 안의 스켈레톤 — 상자 안에 들어가는가, 비율이 맞는가, 두 벌이 같은 자를 쓰는가.
 */

import { describe, expect, it } from "vitest";

import { applyFit, BODY_EDGES, fitToBox, skeletonOps, type Box } from "./skeleton";
import { opsBounds, opsHash } from "./ops";
import { stripFace } from "./sanitize";
import { standPose } from "./fixtures";

const BOX: Box = { x: 100, y: 200, w: 400, h: 420 };

function skeleton(mine = standPose(), reference: ReturnType<typeof standPose> | null = null) {
  return { mine: stripFace(mine), reference: reference ? stripFace(reference) : null, aspect: 4 / 3 };
}

describe("간선", () => {
  it("얼굴이 끝점인 간선은 하나도 없다", () => {
    for (const [a, b] of BODY_EDGES) {
      expect(a).toBeGreaterThanOrEqual(11);
      expect(b).toBeGreaterThanOrEqual(11);
    }
  });

  it("몸통·다리 간선은 그대로 남아 있다", () => {
    const keys = new Set(BODY_EDGES.map(([a, b]) => `${a}-${b}`));
    for (const k of ["11-12", "23-24", "25-27", "26-28", "11-23", "12-24"]) {
      expect(keys.has(k)).toBe(true);
    }
  });
});

describe("상자 맞추기", () => {
  it("점이 없으면 변환도 없다", () => {
    expect(fitToBox([], BOX, 4 / 3)).toBeNull();
  });

  it("모든 점이 상자 안에 들어간다", () => {
    const fit = fitToBox(stripFace(standPose()), BOX, 4 / 3);
    expect(fit).not.toBeNull();
    for (const p of stripFace(standPose())) {
      const [x, y] = applyFit(fit!, p, BOX);
      expect(x).toBeGreaterThanOrEqual(BOX.x);
      expect(x).toBeLessThanOrEqual(BOX.x + BOX.w);
      expect(y).toBeGreaterThanOrEqual(BOX.y);
      expect(y).toBeLessThanOrEqual(BOX.y + BOX.h);
    }
  });

  it("한 배율만 쓴다 — 가로세로를 따로 늘이지 않는다", () => {
    const pts = stripFace(standPose());
    const fit = fitToBox(pts, BOX, 4 / 3)!;
    // 같은 길이의 가로 선분과 세로 선분이 그림에서도 같은 길이여야 한다.
    const h = applyFit(fit, { x: 0.55, y: 0.5 }, BOX)[0] - applyFit(fit, { x: 0.45, y: 0.5 }, BOX)[0];
    const v = applyFit(fit, { x: 0.5, y: 0.55 }, BOX)[1] - applyFit(fit, { x: 0.5, y: 0.45 }, BOX)[1];
    // 가로 0.1은 aspect(4/3)를 곱해 0.1333 의 길이가 된다.
    expect(h / v).toBeCloseTo(4 / 3, 6);
  });

  it("모든 점이 같은 자리여도 폭발하지 않는다", () => {
    const same = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
    const fit = fitToBox(stripFace(same), BOX, 4 / 3)!;
    const [x, y] = applyFit(fit, { x: 0.5, y: 0.5 }, BOX);
    expect(x).toBeCloseTo(BOX.x + BOX.w / 2, 6);
    expect(y).toBeCloseTo(BOX.y + BOX.h / 2, 6);
  });

  it("좌표를 통째로 밀어도 그림은 같다 — 가운데 맞추기가 실제로 동작한다", () => {
    const a = skeletonOps(skeleton(standPose()), BOX);
    const b = skeletonOps(skeleton(standPose({ shiftY: 0.2 })), BOX);
    expect(opsHash(a)).toBe(opsHash(b));
  });
});

/** 선 굵기와 원 반지름까지 넣어 상자 밖으로 한 점도 안 나가는지 본다. */
function inside(list: ReturnType<typeof skeletonOps>, slack = 8) {
  const b = opsBounds(list);
  expect(b.minX).toBeGreaterThanOrEqual(BOX.x - slack);
  expect(b.maxX).toBeLessThanOrEqual(BOX.x + BOX.w + slack);
  expect(b.minY).toBeGreaterThanOrEqual(BOX.y - slack);
  expect(b.maxY).toBeLessThanOrEqual(BOX.y + BOX.h + slack);
}

describe("머리", () => {
  it("머리 원이 상자 위로 삐져나가지 않는다 — 배율이 머리까지 세고 정해진다", () => {
    // 첫 렌더에서 실제로 판 위로 튀어나왔던 자리다. 관절 33점만으로 배율을 정하면
    // 어깨 위에 더 그리는 머리가 상자를 넘는다.
    inside(skeletonOps(skeleton(), BOX), 0);
    inside(skeletonOps(skeleton(standPose(), standPose({ spread: 1.4 })), BOX), 0);
  });

  it("상자가 아주 납작해도 머리가 넘치지 않는다", () => {
    const flat: Box = { x: 0, y: 0, w: 300, h: 90 };
    const b = opsBounds(skeletonOps(skeleton(), flat));
    expect(b.minY).toBeGreaterThanOrEqual(flat.y);
    expect(b.maxY).toBeLessThanOrEqual(flat.y + flat.h);
  });

  it("어깨나 엉덩이가 없으면 머리를 그리지 않는다 — 지어내지 않는다", () => {
    const noTorso = standPose();
    const pts = stripFace(noTorso).filter((p) => ![11, 12, 23, 24].includes(p.i));
    const ops = skeletonOps({ mine: pts, reference: null, aspect: 4 / 3 }, BOX);
    const bigCircles = ops.filter((o) => o.op === "circle" && o.r > 12);
    expect(bigCircles).toHaveLength(0);
  });
});

describe("두 벌", () => {
  it("교본이 있으면 명령이 늘고, 둘 다 상자 안이다", () => {
    const one = skeletonOps(skeleton(), BOX);
    const two = skeletonOps(skeleton(standPose(), standPose({ spread: 1.4 })), BOX);
    expect(two.length).toBeGreaterThan(one.length);
    inside(two);
  });

  it("교본을 먼저 그린다 — 내 자세가 위에 온다", () => {
    const ops = skeletonOps(skeleton(standPose(), standPose({ spread: 1.4 })), BOX);
    const firstGhost = ops.findIndex((o) => "alpha" in o && o.alpha === 0.45);
    const firstMine = ops.findIndex((o) => o.op === "line" && o.alpha === 1);
    expect(firstGhost).toBeGreaterThanOrEqual(0);
    expect(firstGhost).toBeLessThan(firstMine);
  });

  it("교본만 움직여도 내 스켈레톤의 자리가 따라 바뀐다 — 변환이 하나라는 뜻", () => {
    const a = skeletonOps(skeleton(standPose(), standPose({ spread: 1.0 })), BOX);
    const b = skeletonOps(skeleton(standPose(), standPose({ spread: 2.6 })), BOX);
    expect(opsHash(a)).not.toBe(opsHash(b));
  });
});
