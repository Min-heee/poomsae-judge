/**
 * 내 자세와 교본을 견주는 층.
 *
 * 하는 말은 한 종류다 — **"이 관절이 교본보다 몇 도 어긋났다."**
 * 점수를 깎지 않고, 판정을 부르지 않으며, `src/judge` 의 상수를 읽기만 한다.
 *
 * 배타성 하나를 구조로 보장한다: **읽지 못한 관절은 어긋남 등급을 받을 수 없다.**
 * 측정값이 없으면 차이도 없기 때문이다. 화면의 두 빨강(점선 = 흐림, 실선 = 어긋남)이
 * 한 관절에 겹치지 않는 근거가 이것이고, 마지막에 한 번 더 못 박는다
 * (흐린 랜드마크는 무조건 `none` 으로 되돌린다).
 */

import { WITHHOLD } from "../judge/constants";
import { LANDMARK_COUNT, LANDMARK_NAMES_KO } from "../judge/landmarks";
import type { LandmarkFrame } from "../judge/types";
import { bandOf, itemScore } from "./bands";
import { MIRROR_INDEX, mirrorFrame, normalize } from "./frame";
import { FRAME_ANCHORS, SIDE_LABEL_KO, sideLabel } from "./metrics";
import type {
  BodySide,
  Comparison,
  MatchBand,
  MetricComparison,
  NormalizedFrame,
  ReferenceMetric,
  ReferencePose,
} from "./types";

export interface CompareOptions {
  /**
   * 플레이어 프레임을 좌우로 뒤집어 비교한다.
   *
   * 왼팔 아래막기·왼발 앞차기를 오른쪽 기준 자세로 재는 길이다. **기준 자세가 아니라
   * 플레이어를 뒤집는다** — 기준을 뒤집으면 지표가 읽는 인덱스까지 전부 바꿔야 한다.
   * 결과의 `joints`·`jointBands`·`side` 는 다시 플레이어 쪽으로 되돌려 낸다.
   */
  mirrored?: boolean;
}

/** 나쁜 쪽이 이긴다. 한 관절이 여러 지표에 걸리면 가장 나쁜 등급으로 칠한다. */
const BAND_RANK: Record<MatchBand, number> = { none: 0, ok: 1, warn: 2, off: 3, unreadable: 0 };

function worse(a: MatchBand, b: MatchBand): MatchBand {
  return BAND_RANK[b] > BAND_RANK[a] ? b : a;
}

function flipSide(side: BodySide | null, mirrored: boolean): BodySide | null {
  if (side === null || !mirrored) return side;
  return side === "left" ? "right" : "left";
}

function jointName(i: number): string {
  return LANDMARK_NAMES_KO[i] ?? `랜드마크 ${i}`;
}

function dimJoints(f: LandmarkFrame, indices: readonly number[]): number[] {
  return indices.filter((i) => f[i].visibility < WITHHOLD.minVisibility);
}

function unreadable(
  metric: ReferenceMetric,
  mirrored: boolean,
  reason: string,
): MetricComparison {
  return {
    id: metric.id,
    labelKo: sideLabel(metric.baseLabelKo, flipSide(metric.side, mirrored)),
    side: flipSide(metric.side, mirrored),
    unit: metric.unit,
    target: metric.target,
    measured: null,
    diff: null,
    band: "unreadable",
    score: null,
    weight: metric.weight,
    joints: mirrored ? metric.joints.map((j) => MIRROR_INDEX[j]) : metric.joints,
    hintKo: metric.hintKo,
    reason,
  };
}

function compareMetric(
  metric: ReferenceMetric,
  source: LandmarkFrame,
  normalized: NormalizedFrame,
  mirrored: boolean,
): MetricComparison {
  const dim = dimJoints(source, metric.reads);
  if (dim.length > 0) {
    const names = dim
      .map((j) => (mirrored ? MIRROR_INDEX[j] : j))
      .map((j) => jointName(j))
      .join(", ");
    return unreadable(
      metric,
      mirrored,
      `${names} 의 신뢰도가 ${WITHHOLD.minVisibility} 미만이다. 읽지 못한 관절은 어긋남을 말하지 않는다.`,
    );
  }

  const measured = metric.measure(normalized);
  if (!Number.isFinite(measured)) {
    return unreadable(metric, mirrored, "필요한 관절이 겹쳐 있어 각도·비율을 낼 수 없었다.");
  }

  const diff = measured - metric.target;
  const band = bandOf(diff, { ok: metric.ok, warn: metric.warn });
  return {
    id: metric.id,
    labelKo: sideLabel(metric.baseLabelKo, flipSide(metric.side, mirrored)),
    side: flipSide(metric.side, mirrored),
    unit: metric.unit,
    target: metric.target,
    measured,
    diff,
    band,
    score: itemScore(diff, { ok: metric.ok, warn: metric.warn }),
    weight: metric.weight,
    joints: mirrored ? metric.joints.map((j) => MIRROR_INDEX[j]) : metric.joints,
    hintKo: metric.hintKo,
  };
}

function allUnreadable(
  pose: ReferencePose,
  mirrored: boolean,
  reason: string,
  shoulderWidthM: number | null,
): Comparison {
  const metrics = pose.metrics.map((m) => unreadable(m, mirrored, reason));
  return {
    poseId: pose.id,
    mirrored,
    match: null,
    metrics,
    off: [],
    jointBands: new Array<MatchBand>(LANDMARK_COUNT).fill("none"),
    offJoints: [],
    readableCount: 0,
    unreadableCount: metrics.length,
    shoulderWidthM,
  };
}

/**
 * 한 프레임을 기준 자세와 견준다.
 *
 * 같은 입력이면 같은 출력이다 — `Date.now()`·`Math.random()` 을 쓰지 않는다.
 */
export function compareToReference(
  pose: ReferencePose,
  frame: LandmarkFrame,
  opts: CompareOptions = {},
): Comparison {
  const mirrored = opts.mirrored ?? false;
  const source = mirrored ? mirrorFrame(frame) : frame;

  const normalized = normalize(source);
  if (normalized === null) {
    return allUnreadable(
      pose,
      mirrored,
      "두 어깨가 겹쳐 기준 길이 S를 구할 수 없다. 모든 비율의 분모가 사라진다.",
      null,
    );
  }

  // 정규화가 기대는 네 점. 하나라도 흐리면 원점과 축척이 흔들리므로 비교 전체를 접는다.
  const dimAnchors = dimJoints(source, FRAME_ANCHORS);
  if (dimAnchors.length > 0) {
    const names = dimAnchors
      .map((j) => jointName(mirrored ? MIRROR_INDEX[j] : j))
      .join(", ");
    return allUnreadable(
      pose,
      mirrored,
      `${names} 가 흐리다. 엉덩이 중점(원점)과 어깨 너비(축척)를 못 믿으면 모든 값이 흔들린다.`,
      normalized.shoulderWidthM,
    );
  }

  const metrics = pose.metrics.map((m) => compareMetric(m, source, normalized, mirrored));

  let weighted = 0;
  let weightSum = 0;
  let readableCount = 0;
  for (const m of metrics) {
    if (m.score === null) continue;
    weighted += m.score * m.weight;
    weightSum += m.weight;
    readableCount++;
  }
  const match = weightSum > 0 ? weighted / weightSum : null;

  const jointBands = new Array<MatchBand>(LANDMARK_COUNT).fill("none");
  for (const m of metrics) {
    if (m.band === "unreadable") continue;
    for (const j of m.joints) jointBands[j] = worse(jointBands[j], m.band);
  }
  // 마지막 못. 흐린 랜드마크는 어떤 경로로도 어긋남 색을 받지 못한다.
  // (위 로직이 이미 막지만, 지표가 자기 관절을 `reads` 에 빠뜨린 날에도 색이 겹치지 않게
  //  한 줄로 보장해 둔다. 색 규약은 주석이 아니라 코드가 지켜야 한다.)
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    if (frame[i].visibility < WITHHOLD.minVisibility) jointBands[i] = "none";
  }

  const offJoints: number[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) if (jointBands[i] === "off") offJoints.push(i);

  const off = metrics
    .filter((m) => m.band === "off")
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

  return {
    poseId: pose.id,
    mirrored,
    match,
    metrics,
    off,
    jointBands,
    offJoints,
    readableCount,
    unreadableCount: metrics.length - readableCount,
    shoulderWidthM: normalized.shoulderWidthM,
  };
}

export interface OrientationChoice {
  mirrored: boolean;
  comparison: Comparison;
  /** 뒤집지 않고 잰 일치도. */
  matchAsIs: number | null;
  /** 뒤집고 잰 일치도. */
  matchMirrored: number | null;
  /** 왜 이쪽을 골랐는지 한 줄. 화면에 그대로 적는다. */
  reasonKo: string;
}

/**
 * 플레이어가 어느 쪽으로 했는지 고른다.
 *
 * 왼팔 아래막기·왼발 앞차기를 허용하려면 누군가는 좌우를 정해야 하고, 그 근거는
 * 화면에 적혀야 한다(`docs/reference-poses.md` 7절 3번). 관측으로 정한다 —
 * **두 방향으로 다 재 보고 더 잘 맞는 쪽**을 쓴다. 같으면 뒤집지 않은 쪽이다(결정성).
 *
 * 좌우 대칭인 자세(준비·주춤서기)에서는 두 값이 같게 나오고, 그때 이 함수는
 * 아무것도 뒤집지 않는다 — 대칭인 자세에 좌우를 지어내지 않는다.
 */
export function chooseOrientation(
  pose: ReferencePose,
  frame: LandmarkFrame,
): OrientationChoice {
  const asIs = compareToReference(pose, frame, { mirrored: false });
  const flipped = compareToReference(pose, frame, { mirrored: true });
  const a = asIs.match;
  const b = flipped.match;

  const useMirror = a === null ? b !== null : b !== null && b > a;
  const chosen = useMirror ? flipped : asIs;

  const fmt = (v: number | null) => (v === null ? "재지 못함" : `${v.toFixed(1)}`);
  const reasonKo = useMirror
    ? `좌우를 뒤집어 비교했다 — 그대로 ${fmt(a)} vs 뒤집어 ${fmt(b)}. 기준 자세와 반대쪽 팔·다리로 한 것으로 본다.`
    : a === null && b === null
      ? "어느 쪽으로도 읽지 못했다."
      : `그대로 비교했다 — 그대로 ${fmt(a)} vs 뒤집어 ${fmt(b)}.`;

  return { mirrored: useMirror, comparison: chosen, matchAsIs: a, matchMirrored: b, reasonKo };
}

export { SIDE_LABEL_KO };
