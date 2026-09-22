/**
 * 지금 이 프레임에서 읽히는 값들 — 화면 오른쪽 계기판.
 *
 * 이것은 **판정이 아니다.** 판정은 시퀀스 전체를 보고 구간을 고른 뒤
 * `src/judge/` 가 내린다. 여기서 하는 일은 "타임라인을 이 프레임에 두었을 때
 * 지표가 얼마인가"를 보여 주는 것뿐이다(docs/PRD.md F4).
 *
 * 그래서 이 파일은 측정 정의도 경계값도 새로 만들지 않는다. 좌표에서 값을 뽑는 일은
 * `@/judge/coords` 에, 경계값은 `@/judge/constants` 에 맡기고, 여기서는 그 둘을
 * 이어 붙여 CriterionResult 모양으로 포장만 한다. 등급 색이 판정 결과와
 * 어긋나지 않는 이유가 이것이다.
 */

import { FRONT_KICK, STANCE, WITHHOLD } from "@/judge/constants";
import { scoreItem, type BandSpec } from "@/judge/grading";
import {
  ankleGapX,
  height,
  hipElevation,
  hipMid,
  kneeAngle,
  shoulderWidth,
  torsoBackwardLean,
  torsoTilt,
} from "@/judge/coords";
import { ESSENTIAL_LANDMARKS, LANDMARK_NAMES_KO, LEFT_LEG, RIGHT_LEG } from "@/judge/landmarks";
import type { CriterionResult, Grade, LandmarkFrame, MeasureUnit } from "@/judge/types";
import type { PoseSequence } from "./types";

/** 이 프레임에서 안 보이는 필수 관절의 한국어 이름들 (H1). */
export function hiddenEssentials(frame: LandmarkFrame): string[] {
  return ESSENTIAL_LANDMARKS.filter(
    (i) => !frame[i] || frame[i].visibility < WITHHOLD.minVisibility,
  ).map((i) => LANDMARK_NAMES_KO[i] ?? `#${i}`);
}

/** 단위별 표시 소수 자리. 값이 부동소수점 끝자리로 흔들리지 않게 고정한다. */
const DIGITS: Record<MeasureUnit, number> = { deg: 1, ratio: 2, s: 2, m: 3, none: 0 };

interface ReadInput {
  id: string;
  title: string;
  rule: string;
  measured: number;
  unit: MeasureUnit;
  spec: BandSpec;
  passText: string;
  atFrame: number;
  atTimeMs: number;
}

/**
 * 측정값 하나를 화면 한 줄로 바꾼다.
 *
 * 등급 판정·H4(경계 근접 보류)·반올림은 전부 판정 코어의 `scoreItem` 이 한다.
 * 계기판이 초록이라고 했는데 판정은 감점이더라, 같은 일이 생기면 이 화면의
 * 주장이 무너지기 때문에 같은 함수를 지나가게 한다.
 */
function read(input: ReadInput): CriterionResult {
  return scoreItem({
    id: input.id,
    title: input.title,
    rule: input.rule,
    measured: input.measured,
    unit: input.unit,
    spec: input.spec,
    digits: DIGITS[input.unit],
    atFrame: input.atFrame,
    atTimeMs: input.atTimeMs,
    describe: (_value: number, g: Grade) =>
      g === "pass" ? `합격 기준 ${input.passText}` : `합격 기준 ${input.passText} 를 벗어났다`,
  });
}

/** 이 프레임의 국면(앞차기)과 보조 문구. */
export interface FrameReadout {
  frameIndex: number;
  timeMs: number;
  criteria: CriterionResult[];
  /** 무효 프레임이면 사유 */
  invalid?: string;
  /** 주춤서기: 지금까지 연속으로 자세를 유지한 시간 */
  hold?: { seconds: number; required: number; ok: boolean };
  /** 앞차기: 지금 국면 */
  phase?: { id: string; label: string };
  /** 앞차기: 어느 다리로 차는가 */
  kickingLeg?: "left" | "right";
}

/** 주춤서기 자세를 "취하고 있는" 프레임인가 (구간 탐지용, 채점 아님). */
function isEngagedStance(f: LandmarkFrame): boolean {
  const S = shoulderWidth(f);
  if (!Number.isFinite(S) || S < 1e-6) return false;
  const gap = ankleGapX(f) / S;
  const worstKnee = Math.max(kneeAngle(f, LEFT_LEG), kneeAngle(f, RIGHT_LEG));
  return gap >= STANCE.engagedFeetGapMin && worstKnee <= STANCE.engagedKneeAngleMax;
}

function stanceReadout(seq: PoseSequence, i: number): FrameReadout {
  const frames = seq.frames;
  const f = frames[i].world;
  const t0 = frames[0].t;
  const timeMs = frames[i].t - t0;
  const S = shoulderWidth(f);
  const gap = S > 1e-6 ? ankleGapX(f) / S : Number.NaN;
  const kneeL = kneeAngle(f, LEFT_LEG);
  const kneeR = kneeAngle(f, RIGHT_LEG);
  const worstKnee = Math.max(kneeL, kneeR);
  const symmetry = Math.abs(kneeL - kneeR);
  const tilt = torsoTilt(f);

  const common = { atFrame: i, atTimeMs: timeMs };
  const criteria: CriterionResult[] = [
    read({
      ...common,
      id: "A1",
      title: "발 간격",
      rule: "좌우 발목 수평거리 ÷ 어깨너비 S",
      measured: gap,
      unit: "ratio",
      spec: { boundaries: STANCE.feetGapBoundaries, deductions: STANCE.feetGapDeductions },
      passText: `${STANCE.feetGapBoundaries[1]}~${STANCE.feetGapBoundaries[2]}·S`,
    }),
    read({
      ...common,
      id: "A2",
      title: `무릎 굽힘 (나쁜 쪽 ${kneeL >= kneeR ? "왼" : "오른"})`,
      rule: "엉덩이–무릎–발목 내각",
      measured: worstKnee,
      unit: "deg",
      spec: { boundaries: STANCE.kneeAngleBoundaries, deductions: STANCE.kneeAngleDeductions },
      passText: `≤ ${STANCE.kneeAngleBoundaries[0]}°`,
    }),
    read({
      ...common,
      id: "A3",
      title: "좌우 대칭",
      rule: "좌우 무릎 내각의 차",
      measured: symmetry,
      unit: "deg",
      spec: { boundaries: STANCE.symmetryBoundaries, deductions: STANCE.symmetryDeductions },
      passText: `≤ ${STANCE.symmetryBoundaries[0]}°`,
    }),
    read({
      ...common,
      id: "A4",
      title: "상체 수직",
      rule: "엉덩이중점→어깨중점 벡터와 수직축의 각",
      measured: tilt,
      unit: "deg",
      spec: { boundaries: STANCE.torsoTiltBoundaries, deductions: STANCE.torsoTiltDeductions },
      passText: `≤ ${STANCE.torsoTiltBoundaries[0]}°`,
    }),
  ];

  // A5 유지: 지금 프레임에서 거슬러 올라가며 자세를 유지한 시간.
  let start = i;
  while (start > 0 && isEngagedStance(frames[start - 1].world)) start -= 1;
  const seconds = isEngagedStance(f) ? (frames[i].t - frames[start].t) / 1000 : 0;

  const hidden = hiddenEssentials(f);
  return {
    frameIndex: i,
    timeMs,
    criteria,
    hold: { seconds, required: STANCE.minHoldSeconds, ok: seconds >= STANCE.minHoldSeconds },
    invalid:
      hidden.length > 0
        ? `H1 무효 프레임 — ${hidden.join("·")}이(가) visibility ${WITHHOLD.minVisibility} 미만`
        : undefined,
  };
}

/** 어느 다리로 차는지와 차는 방향. 시퀀스 전체를 보고 한 번만 정한다. */
interface KickContext {
  leg: typeof LEFT_LEG;
  legSide: "left" | "right";
  support: typeof LEFT_LEG;
  forwardSign: number;
  /** 정점(최대 신전) 프레임 */
  peak: number;
  /** 정점 직전 최소 무릎각 프레임 = 들기 */
  chamber: number;
  /** 정점 이후 최소 무릎각 프레임 = 회수 */
  retract: number;
}

const kickContextCache = new WeakMap<PoseSequence, KickContext | null>();

export function kickContext(seq: PoseSequence): KickContext | null {
  if (kickContextCache.has(seq)) return kickContextCache.get(seq) ?? null;
  const ctx = computeKickContext(seq);
  kickContextCache.set(seq, ctx);
  return ctx;
}

function computeKickContext(seq: PoseSequence): KickContext | null {
  const frames = seq.frames;
  if (frames.length === 0) return null;

  // 차는 다리 = 발목이 엉덩이 기준으로 가장 높이 올라간 쪽.
  const rise = (f: LandmarkFrame, leg: typeof LEFT_LEG) => {
    const S = shoulderWidth(f);
    if (!Number.isFinite(S) || S < 1e-6) return Number.NaN;
    return (height(f[leg.ankle]) - height(hipMid(f))) / S;
  };
  let maxL = -Infinity;
  let maxR = -Infinity;
  for (const fr of frames) {
    maxL = Math.max(maxL, rise(fr.world, LEFT_LEG) || -Infinity);
    maxR = Math.max(maxR, rise(fr.world, RIGHT_LEG) || -Infinity);
  }
  if (!Number.isFinite(maxL) && !Number.isFinite(maxR)) return null;
  const legSide: "left" | "right" = maxL >= maxR ? "left" : "right";
  const leg = legSide === "left" ? LEFT_LEG : RIGHT_LEG;
  const support = legSide === "left" ? RIGHT_LEG : LEFT_LEG;

  // 차는 방향: 발목이 골반에서 화면 평면 x로 가장 많이 벗어난 쪽.
  let forwardSign = 1;
  let maxAbs = 0;
  for (const fr of frames) {
    const dx = fr.world[leg.ankle].x - hipMid(fr.world).x;
    if (Math.abs(dx) > maxAbs) {
      maxAbs = Math.abs(dx);
      forwardSign = dx >= 0 ? 1 : -1;
    }
  }

  const knees = frames.map((fr) => kneeAngle(fr.world, leg));
  let peak = 0;
  for (let i = 0; i < knees.length; i += 1) {
    if (Number.isFinite(knees[i]) && knees[i] > knees[peak]) peak = i;
  }
  let chamber = 0;
  for (let i = 0; i <= peak; i += 1) {
    if (Number.isFinite(knees[i]) && knees[i] < knees[chamber]) chamber = i;
  }
  let retract = peak;
  for (let i = peak; i < knees.length; i += 1) {
    if (Number.isFinite(knees[i]) && knees[i] < knees[retract]) retract = i;
  }

  return { leg, legSide, support, forwardSign, peak, chamber, retract };
}

function kickPhase(ctx: KickContext | null, i: number): { id: string; label: string } {
  if (!ctx) return { id: "S0", label: "준비" };
  if (i < ctx.chamber) return { id: "S0", label: "준비" };
  if (i < ctx.peak) return { id: "S1", label: "무릎 들기" };
  if (i === ctx.peak) return { id: "S2", label: "뻗기 (정점)" };
  if (i <= ctx.retract) return { id: "S3", label: "회수" };
  return { id: "S4", label: "착지" };
}

function frontKickReadout(seq: PoseSequence, i: number): FrameReadout {
  const frames = seq.frames;
  const f = frames[i].world;
  const t0 = frames[0].t;
  const timeMs = frames[i].t - t0;
  const ctx = kickContext(seq);
  const common = { atFrame: i, atTimeMs: timeMs };

  const S = shoulderWidth(f);
  const leg = ctx?.leg ?? LEFT_LEG;
  const knee = kneeAngle(f, leg);
  const ankleRise = S > 1e-6 ? (height(f[leg.ankle]) - height(hipMid(f))) / S : Number.NaN;
  const lean = torsoBackwardLean(f, ctx?.forwardSign ?? 1);

  // 축발 이동은 구간 누적값이라 시작 프레임부터 지금까지를 본다.
  let drift = Number.NaN;
  if (ctx && S > 1e-6) {
    const p0 = frames[0].world[ctx.support.ankle];
    let max = 0;
    for (let j = 0; j <= i; j += 1) {
      const p = frames[j].world[ctx.support.ankle];
      max = Math.max(max, Math.abs(p.x - p0.x) / S);
    }
    drift = max;
  }

  const criteria: CriterionResult[] = [
    read({
      ...common,
      id: "B4",
      title: `무릎 펴짐 (${ctx?.legSide === "right" ? "오른" : "왼"}다리)`,
      rule: "정점 프레임의 무릎 내각",
      measured: knee,
      unit: "deg",
      spec: {
        boundaries: FRONT_KICK.extensionAngleBoundaries,
        deductions: FRONT_KICK.extensionAngleDeductions,
      },
      passText: `≥ ${FRONT_KICK.extensionAngleBoundaries[1]}°`,
    }),
    read({
      ...common,
      id: "B3",
      title: "발목 높이 − 엉덩이",
      rule: "(발목 높이 − 엉덩이 높이) ÷ S",
      measured: ankleRise,
      unit: "ratio",
      spec: {
        boundaries: FRONT_KICK.kickHeightBoundaries,
        deductions: FRONT_KICK.kickHeightDeductions,
      },
      passText: `≥ ${FRONT_KICK.kickHeightBoundaries[1]}`,
    }),
    read({
      ...common,
      id: "B5",
      title: "상체 젖힘",
      rule: "차는 방향 반대로 기운 각",
      measured: lean,
      unit: "deg",
      spec: {
        boundaries: FRONT_KICK.torsoLeanBoundaries,
        deductions: FRONT_KICK.torsoLeanDeductions,
      },
      passText: `≤ ${FRONT_KICK.torsoLeanBoundaries[0]}°`,
    }),
    read({
      ...common,
      id: "B6",
      title: "축발 수평 이동",
      rule: "여기까지 축발 발목이 움직인 폭 ÷ S",
      measured: drift,
      unit: "ratio",
      spec: {
        boundaries: FRONT_KICK.supportDriftBoundaries,
        deductions: FRONT_KICK.supportDriftDeductions,
      },
      passText: `≤ ${FRONT_KICK.supportDriftBoundaries[0]}`,
    }),
  ];

  const hidden = hiddenEssentials(f);
  return {
    frameIndex: i,
    timeMs,
    criteria,
    phase: kickPhase(ctx, i),
    kickingLeg: ctx?.legSide,
    invalid:
      hidden.length > 0
        ? `H1 무효 프레임 — ${hidden.join("·")}이(가) visibility ${WITHHOLD.minVisibility} 미만`
        : undefined,
  };
}

/** 프레임 하나의 계기판 값. 판정이 아니라 관측이다. */
export function readFrame(seq: PoseSequence, frameIndex: number): FrameReadout {
  if (seq.frames.length === 0) {
    return { frameIndex: 0, timeMs: 0, criteria: [], invalid: "프레임이 없습니다." };
  }
  const i = Math.min(Math.max(frameIndex, 0), seq.frames.length - 1);
  return seq.motion === "stance" ? stanceReadout(seq, i) : frontKickReadout(seq, i);
}

/** 엉덩이 높이(발목 기준). 흔들림을 눈으로 보고 싶을 때 쓴다. */
export function hipElevationOf(frame: LandmarkFrame): number {
  return hipElevation(frame);
}
