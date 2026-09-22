/**
 * 규칙 B — 앞차기 (PRD 5절).
 *
 * 앞차기는 순서가 있는 동작이라 상태 기계로 읽는다.
 *   S0 준비 → S1 들기 → S2 뻗기 → S3 회수 → S4 착지
 *
 * 구현에서 정한 것 두 가지를 적어 둔다. PRD 문장을 코드로 옮길 때 생긴 틈이다.
 *
 * (1) "S2 뻗기 시점"을 발목이 가장 높은 프레임으로 정의한다.
 *     "가장 앞으로 뻗은 프레임"이 자연스러워 보이지만, 다리를 편 채 내리는 동안
 *     엉덩이 굴곡이 90°를 지날 때 전방 도달이 최대가 되어 정점이 내리기 구간으로 밀린다.
 *     발목 높이는 뻗은 순간에 최대이고, 내리는 동안 단조 감소한다.
 *
 * (2) 무릎각·발목 높이 시계열에 3프레임 이동평균을 건다.
 *     한 프레임의 튐이 정점 프레임이나 상태 전이를 바꾸면 결정성이 무의미해진다.
 *
 * 알려진 한계: 찬 높이가 회수 자세(무릎을 접어 올린 자세)보다 낮은 아주 낮은 차기에서는
 * 정점이 실제 타격 순간보다 조금 뒤로 잡힐 수 있다. 다리를 접기 전에 엉덩이가 먼저 올라오기
 * 때문이다. 이 경우 B3(높이)이 이미 0.3을 물리므로 판정의 결론은 바뀌지 않지만,
 * B4(펴짐)가 가리키는 프레임이 사람이 보는 타격 순간과 어긋날 수 있다.
 */

import { FRONT_KICK } from "./constants";
import { height, hipMid, kneeAngle, shoulderWidth, torsoBackwardLean } from "./coords";
import { scoreItem, structuralItem, type BandSpec } from "./grading";
import { LEFT_LEG, RIGHT_LEG, type LegIndices } from "./landmarks";
import { mean, movingAverage, round } from "./math";
import type { PreparedFrame, PreparedSequence } from "./prepare";
import type { CriterionResult } from "./types";

interface LegSeries {
  kneeAngle: (number | null)[];
  kneeHeight: (number | null)[];
  ankleHeight: (number | null)[];
  ankleX: (number | null)[];
}

interface KickSeries {
  valid: boolean[];
  shoulder: (number | null)[];
  hipHeight: (number | null)[];
  left: LegSeries;
  right: LegSeries;
}

function legSeries(frames: readonly PreparedFrame[], leg: LegIndices): LegSeries {
  const n = frames.length;
  const s: LegSeries = {
    kneeAngle: new Array(n),
    kneeHeight: new Array(n),
    ankleHeight: new Array(n),
    ankleX: new Array(n),
  };
  for (let i = 0; i < n; i++) {
    if (!frames[i].valid) {
      s.kneeAngle[i] = null;
      s.kneeHeight[i] = null;
      s.ankleHeight[i] = null;
      s.ankleX[i] = null;
      continue;
    }
    const f = frames[i].landmarks;
    const a = kneeAngle(f, leg);
    s.kneeAngle[i] = Number.isFinite(a) ? a : null;
    s.kneeHeight[i] = height(f[leg.knee]);
    s.ankleHeight[i] = height(f[leg.ankle]);
    s.ankleX[i] = f[leg.ankle].x;
  }
  // 이동평균은 각도와 높이에만 건다. x는 B6(흔들림 폭)의 측정 대상이라 건드리지 않는다 —
  // 흔들림을 재면서 흔들림을 깎아 내면 안 된다.
  s.kneeAngle = movingAverage(s.kneeAngle, FRONT_KICK.smoothingWindow);
  s.kneeHeight = movingAverage(s.kneeHeight, FRONT_KICK.smoothingWindow);
  s.ankleHeight = movingAverage(s.ankleHeight, FRONT_KICK.smoothingWindow);
  return s;
}

function buildSeries(frames: readonly PreparedFrame[]): KickSeries {
  const n = frames.length;
  const shoulder: (number | null)[] = new Array(n);
  const hipHeight: (number | null)[] = new Array(n);
  const valid: boolean[] = new Array(n);
  for (let i = 0; i < n; i++) {
    valid[i] = frames[i].valid;
    if (!frames[i].valid) {
      shoulder[i] = null;
      hipHeight[i] = null;
      continue;
    }
    const f = frames[i].landmarks;
    const S = shoulderWidth(f);
    shoulder[i] = S > 0 ? S : null;
    hipHeight[i] = height(hipMid(f));
  }
  return {
    valid,
    shoulder,
    hipHeight,
    left: legSeries(frames, LEFT_LEG),
    right: legSeries(frames, RIGHT_LEG),
  };
}

export interface KickPhases {
  kicking: LegIndices;
  support: LegIndices;
  /** 발이 떠 있던 구간(인덱스, 양끝 포함). */
  windowStart: number;
  windowEnd: number;
  /** S1. 없으면 B1(순서 위반). */
  chamber: number | null;
  /** S2. 발목이 가장 높은 프레임. */
  extension: number;
  /** S3. 없으면 B2(회수 생략). */
  retract: number | null;
  /** S4. 끝까지 안 내려오면 null. */
  landing: number | null;
  /** +1이면 +x가 차는 방향. */
  forwardSign: number;
  /** 기준 길이 S의 대표값. */
  shoulderWidth: number;
}

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * 어느 다리로 찼는가, 그리고 어디가 들기·뻗기·회수·착지인가.
 * 전부 데이터에서 정한다 — 사용자가 고르게 하면 같은 입력에 다른 판정이 나온다.
 */
export function findKickPhases(prepared: PreparedSequence): KickPhases | null {
  const { frames } = prepared;
  const series = buildSeries(frames);

  const shoulders = series.shoulder.filter(finite);
  if (shoulders.length === 0) return null;
  const S = mean(shoulders);
  if (!(S > 0)) return null;

  // 차는 다리 = 발목이 더 높이 올라간 쪽.
  const peak = (s: LegSeries) =>
    s.ankleHeight.reduce<number>((m, v) => (finite(v) && v > m ? v : m), Number.NEGATIVE_INFINITY);
  const kickingIsLeft = peak(series.left) > peak(series.right);
  const kicking = kickingIsLeft ? LEFT_LEG : RIGHT_LEG;
  const support = kickingIsLeft ? RIGHT_LEG : LEFT_LEG;
  const kickSeries = kickingIsLeft ? series.left : series.right;

  // 시작 자세의 발목 높이 = 첫 유효 프레임.
  const firstValid = frames.findIndex((_, i) => series.valid[i] && finite(kickSeries.ankleHeight[i]));
  if (firstValid === -1) return null;
  const restHeight = kickSeries.ankleHeight[firstValid] as number;

  const liftThreshold = restHeight + FRONT_KICK.liftThresholdRatio * S;
  const landThreshold = restHeight + FRONT_KICK.landThresholdRatio * S;

  let windowStart = -1;
  let windowEnd = -1;
  for (let i = firstValid; i < frames.length; i++) {
    const h = kickSeries.ankleHeight[i];
    if (!finite(h) || h <= liftThreshold) {
      if (windowStart !== -1) break; // 첫 번째 차기만 본다. 한 시퀀스 = 한 동작.
      continue;
    }
    if (windowStart === -1) windowStart = i;
    windowEnd = i;
  }
  if (windowStart === -1) return null;

  // 정점 = "다리가 거의 다 뻗은" 프레임 중 발목이 가장 높은 것. 같은 값이면 앞선 프레임.
  // 단순히 가장 높은 프레임을 쓰면 낮게 찬 동작에서 회수 순간이 정점으로 잡힌다
  // (constants.ts의 apexExtensionToleranceDeg 주석 참고).
  let maxKnee = Number.NEGATIVE_INFINITY;
  for (let i = windowStart; i <= windowEnd; i++) {
    const a = kickSeries.kneeAngle[i];
    if (finite(a) && a > maxKnee) maxKnee = a;
  }
  const extendedEnough = Number.isFinite(maxKnee)
    ? maxKnee - FRONT_KICK.apexExtensionToleranceDeg
    : Number.NEGATIVE_INFINITY;

  let extension = -1;
  let best = Number.NEGATIVE_INFINITY;
  for (let i = windowStart; i <= windowEnd; i++) {
    const h = kickSeries.ankleHeight[i];
    const a = kickSeries.kneeAngle[i];
    if (!finite(h) || !finite(a) || a < extendedEnough) continue;
    if (h > best) {
      best = h;
      extension = i;
    }
  }
  if (extension === -1) {
    // 무릎각을 아예 읽지 못한 경우의 대비책. 높이만으로 고른다.
    for (let i = windowStart; i <= windowEnd; i++) {
      const h = kickSeries.ankleHeight[i];
      if (finite(h) && h > best) {
        best = h;
        extension = i;
      }
    }
  }
  if (extension === -1) return null;

  // 차는 방향 = 구간 동안 발목이 엉덩이보다 주로 어느 쪽에 있었는가.
  let forwardAcc = 0;
  for (let i = windowStart; i <= windowEnd; i++) {
    if (!series.valid[i]) continue;
    const f = frames[i].landmarks;
    forwardAcc += f[kicking.ankle].x - hipMid(f).x;
  }
  const forwardSign = forwardAcc >= 0 ? 1 : -1;

  // S1 들기: 정점 이전, 무릎이 엉덩이 높이 이상이고 무릎각이 접혀 있는 첫 프레임.
  let chamber: number | null = null;
  for (let i = windowStart; i <= extension; i++) {
    const kh = kickSeries.kneeHeight[i];
    const ka = kickSeries.kneeAngle[i];
    const hh = series.hipHeight[i];
    if (!finite(kh) || !finite(ka) || !finite(hh)) continue;
    if (kh >= hh && ka <= FRONT_KICK.chamberKneeAngleMax) {
      chamber = i;
      break;
    }
  }

  // S4 착지: 정점 이후 발목이 시작 높이 근처로 내려온 첫 프레임.
  let landing: number | null = null;
  for (let i = extension + 1; i < frames.length; i++) {
    const h = kickSeries.ankleHeight[i];
    if (finite(h) && h <= landThreshold) {
      landing = i;
      break;
    }
  }

  // S3 회수: 정점과 착지 사이에서 무릎이 다시 접히는 첫 프레임.
  const retractEnd = landing ?? frames.length - 1;
  let retract: number | null = null;
  for (let i = extension + 1; i <= retractEnd; i++) {
    const ka = kickSeries.kneeAngle[i];
    if (finite(ka) && ka <= FRONT_KICK.retractKneeAngleMax) {
      retract = i;
      break;
    }
  }

  return {
    kicking,
    support,
    windowStart,
    windowEnd,
    chamber,
    extension,
    retract,
    landing,
    forwardSign,
    shoulderWidth: S,
  };
}

const HEIGHT_SPEC: BandSpec = {
  boundaries: FRONT_KICK.kickHeightBoundaries,
  deductions: FRONT_KICK.kickHeightDeductions,
};
const EXTENSION_SPEC: BandSpec = {
  boundaries: FRONT_KICK.extensionAngleBoundaries,
  deductions: FRONT_KICK.extensionAngleDeductions,
};
const LEAN_SPEC: BandSpec = {
  boundaries: FRONT_KICK.torsoLeanBoundaries,
  deductions: FRONT_KICK.torsoLeanDeductions,
};
const DRIFT_SPEC: BandSpec = {
  boundaries: FRONT_KICK.supportDriftBoundaries,
  deductions: FRONT_KICK.supportDriftDeductions,
};
const DELAY_SPEC: BandSpec = {
  boundaries: FRONT_KICK.extendDelayBoundaries,
  deductions: FRONT_KICK.extendDelayDeductions,
};

export interface FrontKickOutcome {
  criteria: CriterionResult[];
  phases: KickPhases;
}

export function judgeFrontKick(prepared: PreparedSequence): FrontKickOutcome | null {
  const { frames } = prepared;
  const phases = findKickPhases(prepared);
  if (phases === null) return null;

  const series = buildSeries(frames);
  const kickSeries = phases.kicking.side === "left" ? series.left : series.right;
  const supportSeries = phases.support.side === "left" ? series.left : series.right;
  const S = phases.shoulderWidth;

  const ext = frames[phases.extension];
  const atExt = { atFrame: ext.sourceIndex, atTimeMs: round(ext.timeMs, 1) };

  const criteria: CriterionResult[] = [];

  // B1 순서 위반
  criteria.push(
    structuralItem({
      id: "B1",
      title: "순서(들기 → 뻗기)",
      rule: `무릎이 엉덩이 높이 이상으로 올라오고 무릎각이 ${FRONT_KICK.chamberKneeAngleMax}° 이하로 접히는 '들기'를 거쳐야 한다.`,
      violated: phases.chamber === null,
      deduction: FRONT_KICK.orderViolationDeduction,
      note:
        phases.chamber === null
          ? "무릎을 접어 올리는 단계 없이 다리가 올라갔다. 발부터 올라가면 허리가 뒤로 빠진다."
          : `프레임 ${frames[phases.chamber].sourceIndex}에서 무릎을 접어 올렸다. 순서를 지켰다.`,
      atFrame: phases.chamber === null ? ext.sourceIndex : frames[phases.chamber].sourceIndex,
      atTimeMs:
        phases.chamber === null ? round(ext.timeMs, 1) : round(frames[phases.chamber].timeMs, 1),
    }),
  );

  // B2 회수 생략
  criteria.push(
    structuralItem({
      id: "B2",
      title: "회수",
      rule: `내리기 전에 무릎을 ${FRONT_KICK.retractKneeAngleMax}° 이하로 다시 접어야 한다.`,
      violated: phases.retract === null,
      deduction: FRONT_KICK.noRetractDeduction,
      note:
        phases.retract === null
          ? "찬 다리를 접지 않고 그대로 내렸다. 회수는 앞차기와 단순한 다리 들기를 가르는 지점이다."
          : `프레임 ${frames[phases.retract].sourceIndex}에서 무릎을 다시 접었다.`,
      atFrame: phases.retract === null ? ext.sourceIndex : frames[phases.retract].sourceIndex,
      atTimeMs:
        phases.retract === null ? round(ext.timeMs, 1) : round(frames[phases.retract].timeMs, 1),
    }),
  );

  // B3 높이
  const ankleH = kickSeries.ankleHeight[phases.extension];
  const hipH = series.hipHeight[phases.extension];
  const heightRatio =
    finite(ankleH) && finite(hipH) ? (ankleH - hipH) / S : Number.NaN;
  criteria.push(
    scoreItem({
      id: "B3",
      title: "높이",
      rule: "정점에서 (발목 높이 − 엉덩이 높이) ÷ S. 0 이상이면 합격.",
      measured: heightRatio,
      unit: "ratio",
      spec: HEIGHT_SPEC,
      digits: 3,
      ...atExt,
      describe: (v, g) =>
        g === "pass"
          ? `발목이 엉덩이보다 ${v}·S 높은 지점까지 올라갔다.`
          : `발목이 엉덩이 높이보다 ${round(Math.abs(v), 3)}·S 낮다. 앞차기는 최소 엉덩이 높이까지 올라가야 한다.`,
    }),
  );

  // B4 펴짐
  const extAngle = kickSeries.kneeAngle[phases.extension];
  criteria.push(
    scoreItem({
      id: "B4",
      title: "펴짐",
      rule: "정점에서 무릎 내각. 155° 이상이면 합격.",
      measured: finite(extAngle) ? extAngle : Number.NaN,
      unit: "deg",
      spec: EXTENSION_SPEC,
      digits: 1,
      ...atExt,
      describe: (v, g) =>
        g === "pass"
          ? `정점에서 무릎이 ${v}°까지 펴졌다.`
          : `정점에서 무릎이 ${v}°까지만 펴졌다. 합격선은 155°다.`,
    }),
  );

  // B5 상체 젖힘
  const lean = ext.valid ? torsoBackwardLean(ext.landmarks, phases.forwardSign) : Number.NaN;
  // 앞으로 숙인 것은 이 규칙이 잡는 오류가 아니다. 0으로 접어 음수가 등급을 타지 않게 한다.
  const leanBack = Number.isFinite(lean) ? Math.max(0, lean) : Number.NaN;
  criteria.push(
    scoreItem({
      id: "B5",
      title: "상체 젖힘",
      rule: "정점에서 상체가 차는 방향의 반대로 기운 각. 15° 이하면 합격.",
      measured: leanBack,
      unit: "deg",
      spec: LEAN_SPEC,
      digits: 1,
      ...atExt,
      describe: (v, g) =>
        g === "pass"
          ? `상체가 뒤로 ${v}° 기울었다. 합격선 15° 안쪽이다.`
          : `상체가 뒤로 ${v}° 젖혀졌다. 허리가 빠지면 차는 힘이 실리지 않는다. 합격선은 15°다.`,
    }),
  );

  // B6 축발 흔들림
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (let i = phases.windowStart; i <= phases.windowEnd; i++) {
    const x = supportSeries.ankleX[i];
    if (!finite(x)) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  const drift = Number.isFinite(minX) && Number.isFinite(maxX) ? (maxX - minX) / S : Number.NaN;
  criteria.push(
    scoreItem({
      id: "B6",
      title: "축발 흔들림",
      rule: "동작 구간 중 축발 발목의 수평 이동폭 ÷ S. 0.25 이하면 합격.",
      measured: drift,
      unit: "ratio",
      spec: DRIFT_SPEC,
      digits: 3,
      ...atExt,
      describe: (v, g) =>
        g === "pass"
          ? `축발이 ${v}·S 움직였다. 합격선 0.25·S 안쪽이다.`
          : `축발이 ${v}·S 밀렸다. 중심이 무너졌다는 뜻이다. 합격선은 0.25·S다.`,
    }),
  );

  // B7 뻗기 지연
  if (phases.chamber === null) {
    criteria.push({
      id: "B7",
      title: "뻗기 지연",
      rule: "들기에서 정점까지 걸린 시간. 0.5초 이하면 합격.",
      measured: null,
      unit: "s",
      boundaries: FRONT_KICK.extendDelayBoundaries,
      grade: "unmeasured",
      deduction: 0,
      note: "들기 단계가 없어 시작점을 잡을 수 없다. B1에서 이미 감점했다.",
      atFrame: ext.sourceIndex,
      atTimeMs: round(ext.timeMs, 1),
    });
  } else {
    const delay = (ext.timeMs - frames[phases.chamber].timeMs) / 1000;
    criteria.push(
      scoreItem({
        id: "B7",
        title: "뻗기 지연",
        rule: "들기에서 정점까지 걸린 시간. 0.5초 이하면 합격.",
        measured: delay,
        unit: "s",
        spec: DELAY_SPEC,
        digits: 3,
        ...atExt,
        describe: (v, g) =>
          g === "pass"
            ? `들기에서 정점까지 ${v}초 걸렸다. 합격선 0.5초 안쪽이다.`
            : `들기에서 정점까지 ${v}초 걸렸다. 뻗기가 늦으면 차기가 아니라 미는 동작이 된다.`,
      }),
    );
  }

  return { criteria, phases };
}
