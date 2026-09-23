/**
 * 카드 안의 스켈레톤 그림.
 *
 * **영상 픽셀은 한 점도 들어오지 않는다.** 좌표에서 선과 원을 새로 그린다.
 * 얼굴 랜드마크는 이미 `sanitize.ts` 에서 버려졌으므로 여기서는 받을 수조차 없고,
 * 머리는 **어깨와 엉덩이에서 유도한 원 하나**다 — 카드를 보고 사람을 알아볼 수 없다.
 *
 * 맞춤 규칙 셋:
 *  1. **비율 보정.** 정규화 이미지 좌표는 x·y 의 자가 다르므로 x 에 `aspect` 를 곱해
 *     비율이 맞는 공간으로 되돌린 뒤에 그린다.
 *  2. **등방 배율.** 가로·세로를 따로 늘이지 않는다. 한 배율로 맞추고 가운데에 놓는다.
 *  3. **변환은 하나.** 내 자세와 교본 고스트가 **같은 변환**을 탄다. 둘을 따로 맞추면
 *     같은 자세를 줘도 팔다리 길이가 다르게 그려진다(docs/TECH-NOTES.md 12.3 ㄴ).
 *     배율은 두 스켈레톤을 합친 경계상자에서 정하므로, 유한한 입력이라면
 *     **어떤 점도 상자 밖으로 나갈 수 없다**(마지막 잘라내기는 그래도 둔다).
 */

import { LM, POSE_EDGES } from "@/judge/landmarks";
import type { CardOp } from "./ops";
import { CARD_COLORS } from "./theme";
import type { BodyPoint, CardSkeleton } from "./types";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 몸통 간선만. 얼굴(0~10)이 끝점인 간선은 애초에 그리지 않는다. */
export const BODY_EDGES: readonly (readonly [number, number])[] = POSE_EDGES.filter(
  ([a, b]) => a >= 11 && b >= 11,
);

export interface Fit {
  /** 비율 보정에 쓴 가로÷세로. */
  aspect: number;
  scale: number;
  ox: number;
  oy: number;
}

/** 비율 보정을 마친 좌표. `ax` = x × aspect. */
interface AspectPoint {
  ax: number;
  y: number;
}

/** 상자 안 여백 비율. 관절 원과 머리 원이 모서리에 닿지 않게 한다. */
const PAD = 0.86;

/**
 * 점들을 상자에 맞추는 변환을 구한다.
 *
 * `extra` 는 랜드마크가 아니면서 그림에는 나오는 것들의 자리다 — 지금은 머리 원의
 * 네 귀퉁이가 들어온다. 이것을 빼먹으면 **머리만 상자 밖으로 삐져나간다**:
 * 배율은 관절 33점으로 정해지는데 머리는 어깨 위에 더 그려지기 때문이다.
 * 실제로 첫 렌더에서 머리가 판 위로 튀어나왔고, 그래서 이 인자가 생겼다.
 *
 * 점이 하나뿐이거나 모두 같은 자리면 배율을 정할 수 없다 —
 * 그때는 배율 1로 두고 가운데에 놓는다(그림이 폭발하는 것보다 점 하나가 낫다).
 */
export function fitToBox(
  points: readonly BodyPoint[],
  box: Box,
  aspect: number,
  extra: readonly AspectPoint[] = [],
): Fit | null {
  if (points.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const put = (ax: number, y: number) => {
    minX = Math.min(minX, ax);
    maxX = Math.max(maxX, ax);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const p of points) put(p.x * aspect, p.y);
  for (const p of extra) put(p.ax, p.y);

  const bw = maxX - minX;
  const bh = maxY - minY;
  const usable = { w: box.w * PAD, h: box.h * PAD };

  let scale = 1;
  if (bw > 1e-9 || bh > 1e-9) {
    const sx = bw > 1e-9 ? usable.w / bw : Number.POSITIVE_INFINITY;
    const sy = bh > 1e-9 ? usable.h / bh : Number.POSITIVE_INFINITY;
    scale = Math.min(sx, sy);
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    aspect,
    scale,
    ox: box.x + box.w / 2 - cx * scale,
    oy: box.y + box.h / 2 - cy * scale,
  };
}

export function applyFit(fit: Fit, p: { x: number; y: number }, box: Box): [number, number] {
  return applyFitAspect(fit, p.x * fit.aspect, p.y, box);
}

function applyFitAspect(fit: Fit, ax: number, y: number, box: Box): [number, number] {
  const px = ax * fit.scale + fit.ox;
  const py = y * fit.scale + fit.oy;
  // 마지막 안전망. 유한한 입력이라면 여기서 아무 일도 일어나지 않는다.
  return [
    Math.min(box.x + box.w, Math.max(box.x, px)),
    Math.min(box.y + box.h, Math.max(box.y, py)),
  ];
}

function byIndex(points: readonly BodyPoint[]): Map<number, BodyPoint> {
  const m = new Map<number, BodyPoint>();
  for (const p of points) m.set(p.i, p);
  return m;
}

function midOf(m: Map<number, BodyPoint>, a: number, b: number): { x: number; y: number } | null {
  const pa = m.get(a);
  const pb = m.get(b);
  if (!pa || !pb) return null;
  return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
}

/** 머리 원. 얼굴 좌표가 아니라 어깨·엉덩이에서 유도한다. 단위는 비율 보정 좌표. */
interface Head {
  ax: number;
  y: number;
  r: number;
  /** 어깨 중점 — 목 선의 시작점. */
  neck: AspectPoint;
}

/**
 * 머리를 어디에 얼마나 크게 그릴 것인가.
 *
 * 크기 기준은 **몸통 길이**(어깨중점→엉덩이중점)다. 어깨 폭으로 잡으면 측면 시야에서
 * 두 어깨가 깊이로 겹쳐 화면 폭이 0에 수렴하고, 머리가 사라진다
 * (docs/TECH-NOTES.md 12.0 ㄱ — 두 시야 모두에서 화면 평면에 놓이는 길이는 몸통뿐이다).
 */
function headOf(m: Map<number, BodyPoint>, aspect: number): Head | null {
  const shoulder = midOf(m, LM.leftShoulder, LM.rightShoulder);
  const hip = midOf(m, LM.leftHip, LM.rightHip);
  if (!shoulder || !hip) return null;

  const sax = shoulder.x * aspect;
  const hax = hip.x * aspect;
  const torso = Math.hypot(sax - hax, shoulder.y - hip.y);
  if (torso <= 1e-9) return null;

  const ux = (sax - hax) / torso;
  const uy = (shoulder.y - hip.y) / torso;
  const r = torso * 0.22;
  const d = r + torso * 0.12;
  return { ax: sax + ux * d, y: shoulder.y + uy * d, r, neck: { ax: sax, y: shoulder.y } };
}

/** 머리 원이 차지하는 네 귀퉁이. 배율을 정할 때 이것까지 넣어야 머리가 안 삐져나간다. */
function headExtent(head: Head | null): AspectPoint[] {
  if (!head) return [];
  return [
    { ax: head.ax - head.r, y: head.y - head.r },
    { ax: head.ax + head.r, y: head.y + head.r },
  ];
}

interface Style {
  bone: string;
  boneCore: string;
  joint: string;
  jointCore: string;
  alpha: number;
  hollow: boolean;
  lineScale: number;
}

const MINE: Style = {
  bone: CARD_COLORS.bone,
  boneCore: CARD_COLORS.boneCore,
  joint: CARD_COLORS.joint,
  jointCore: CARD_COLORS.jointCore,
  alpha: 1,
  hollow: false,
  lineScale: 1,
};

/** 교본 고스트 — `--brand-dim` 반투명 실선, 관절은 빈 원(docs/PRD-game.md 5.3). */
const GHOST: Style = {
  bone: CARD_COLORS.brandDim,
  boneCore: CARD_COLORS.brandDim,
  joint: CARD_COLORS.brandDim,
  jointCore: CARD_COLORS.brandDim,
  alpha: 0.45,
  hollow: true,
  lineScale: 0.8,
};

/** 몸통·다리·팔 = 굵게. draw2d.ts 의 위계를 그대로 따른다. */
const CORE_EDGES = new Set(
  [
    [11, 12], [11, 23], [12, 24], [23, 24],
    [23, 25], [24, 26], [25, 27], [26, 28],
    [11, 13], [13, 15], [12, 14], [14, 16],
  ].map(([a, b]) => `${a}-${b}`),
);

function drawOne(
  points: readonly BodyPoint[],
  head: Head | null,
  fit: Fit,
  box: Box,
  style: Style,
): CardOp[] {
  const ops: CardOp[] = [];
  const m = byIndex(points);
  // 선 굵기는 배율에 비례시킨다 — 작게 그려진 스켈레톤이 굵은 선에 묻히지 않게.
  const unit = Math.max(2, Math.min(box.w, box.h) / 90) * style.lineScale;

  for (const [a, b] of BODY_EDGES) {
    const pa = m.get(a);
    const pb = m.get(b);
    if (!pa || !pb) continue;
    const [x1, y1] = applyFit(fit, pa, box);
    const [x2, y2] = applyFit(fit, pb, box);
    const core = CORE_EDGES.has(`${a}-${b}`);
    ops.push({
      op: "line",
      x1,
      y1,
      x2,
      y2,
      stroke: core ? style.boneCore : style.bone,
      lineWidth: core ? unit * 1.6 : unit * 0.7,
      cap: "round",
      alpha: style.alpha,
    });
  }

  // 머리 — 얼굴 좌표가 아니라 어깨·엉덩이에서 유도한 원 하나.
  if (head) {
    const [cx, cy] = applyFitAspect(fit, head.ax, head.y, box);
    const [sx, sy] = applyFitAspect(fit, head.neck.ax, head.neck.y, box);
    const r = head.r * fit.scale;
    const len = Math.hypot(cx - sx, cy - sy);
    const ux = len > 1e-9 ? (cx - sx) / len : 0;
    const uy = len > 1e-9 ? (cy - sy) / len : -1;
    ops.push({
      op: "line",
      x1: sx,
      y1: sy,
      x2: cx - ux * r,
      y2: cy - uy * r,
      stroke: style.boneCore,
      lineWidth: unit * 1.2,
      cap: "round",
      alpha: style.alpha,
    });
    ops.push({
      op: "circle",
      x: cx,
      y: cy,
      r,
      fill: style.hollow ? undefined : style.boneCore,
      stroke: style.hollow ? style.boneCore : undefined,
      lineWidth: unit,
      alpha: style.alpha * (style.hollow ? 1 : 0.9),
    });
  }

  for (const p of points) {
    const [x, y] = applyFit(fit, p, box);
    const big = EMPHASIS.has(p.i);
    const r = big ? unit * 1.3 : unit * 0.7;
    ops.push({
      op: "circle",
      x,
      y,
      r,
      fill: style.hollow ? undefined : big ? style.jointCore : style.joint,
      stroke: style.hollow ? style.joint : undefined,
      lineWidth: style.hollow ? unit * 0.6 : undefined,
      alpha: style.alpha,
    });
  }

  return ops;
}

/** 규칙이 실제로 읽는 관절. draw2d.ts 의 `DEFAULT_EMPHASIS` 와 같은 8개. */
const EMPHASIS = new Set<number>([
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
]);

/**
 * 스켈레톤 두 벌(교본 고스트 → 내 자세 순)을 상자 안에 그린다.
 *
 * 고스트를 먼저 그리는 이유는 내 자세가 위에 와야 하기 때문이다 —
 * 카드의 주인공은 교본이 아니라 그날의 내 자세다.
 */
export function skeletonOps(skeleton: CardSkeleton, box: Box): CardOp[] {
  const aspect = skeleton.aspect;
  const mineHead = headOf(byIndex(skeleton.mine), aspect);
  const refHead = skeleton.reference ? headOf(byIndex(skeleton.reference), aspect) : null;

  const all = skeleton.reference ? [...skeleton.mine, ...skeleton.reference] : skeleton.mine;
  const fit = fitToBox(all, box, aspect, [...headExtent(mineHead), ...headExtent(refHead)]);
  if (!fit) return [];

  const ops: CardOp[] = [];
  if (skeleton.reference) ops.push(...drawOne(skeleton.reference, refHead, fit, box, GHOST));
  ops.push(...drawOne(skeleton.mine, mineHead, fit, box, MINE));
  return ops;
}
