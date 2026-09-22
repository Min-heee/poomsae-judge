/**
 * 키프레임 → 시퀀스.
 *
 * 관절각을 국면마다 찍고 사이를 부드럽게 잇는다. 선형 보간은 로봇처럼 보이므로
 * smoothstep을 쓴다. 국면 길이를 다르게 주어 시간 비대칭을 만든다 —
 * 실제 앞차기는 뻗기가 빠르고 회수·내리기가 느리다.
 */

import type { Landmark, LandmarkSequence, TimedFrame } from "../judge/types";
import {
  buildKickFrame,
  buildStanceFrame,
  jitter,
  mulberry32,
  type KickParams,
  type StanceParams,
} from "./rig";

export interface Keyframe<P> {
  /** 초. 오름차순이어야 한다. */
  t: number;
  params: P;
}

function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}

/**
 * 키프레임 사이를 smoothstep으로 잇는다. 같은 시각을 두 번 찍으면 그 구간은 유지(hold)가 된다.
 * P의 모든 필드가 수여야 한다는 제약을 타입으로 건다 — 문자열 필드가 섞이면 보간이 말이 안 된다.
 */
export function sampleKeyframes<P extends { [K in keyof P]: number }>(
  keys: readonly Keyframe<P>[],
  t: number,
): P {
  if (keys.length === 0) throw new Error("키프레임이 비어 있다.");
  if (t <= keys[0].t) return { ...keys[0].params };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { ...last.params };

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.t - a.t;
  const u = span <= 0 ? 1 : smoothstep((t - a.t) / span);

  const from = a.params as Record<string, number>;
  const to = b.params as Record<string, number>;
  const out: Record<string, number> = {};
  for (const key of Object.keys(from)) {
    out[key] = from[key] + (to[key] - from[key]) * u;
  }
  return out as P;
}

export interface SampleSpec {
  id: string;
  label: string;
  motion: "stance" | "frontKick";
  view: "frontal" | "sagittal";
  fps: number;
  durationSeconds: number;
  /** 지터용 시드. 샘플마다 다르게 두되 고정한다. */
  seed: number;
  /** 지터 진폭(m). 검출기 노이즈를 흉내 낸다. */
  jitterM: number;
  origin: string;
  /** 이 샘플이 어떤 판정을 받도록 만들었는가. 테스트가 이것을 확인한다. */
  intent: string;
  poseAt: (tSeconds: number) => Landmark[];
}

/** 스펙 하나를 시퀀스로 굽는다. 같은 스펙이면 항상 같은 바이트가 나와야 한다. */
export function buildSequence(spec: SampleSpec): LandmarkSequence {
  const rand = mulberry32(spec.seed);
  const dtMs = 1000 / spec.fps;
  const count = Math.round(spec.durationSeconds * spec.fps) + 1;
  const frames: TimedFrame[] = [];
  for (let i = 0; i < count; i++) {
    const tSeconds = i / spec.fps;
    const pose = spec.poseAt(tSeconds);
    frames.push({
      t: Math.round(i * dtMs * 10) / 10,
      landmarks: spec.jitterM > 0 ? jitter(pose, rand, spec.jitterM) : pose,
    });
  }
  return {
    id: spec.id,
    label: spec.label,
    motion: spec.motion,
    view: spec.view,
    fps: spec.fps,
    frames,
    origin: spec.origin,
  };
}

const SYNTHETIC_ORIGIN =
  "src/samples 의 생성 스크립트가 만든 합성 시퀀스. 촬영본이 아니며, 규칙이 옳다는 증명이 아니라 규칙이 의도대로 동작하는지를 보이는 회귀용 데이터다.";

// ---------------------------------------------------------------------------
// 주춤서기
// ---------------------------------------------------------------------------

/**
 * 차렷 → 주춤서기 → 차렷.
 * 유지 구간에서 무릎 각도에 아주 작은 사인파를 얹어 실제 사람의 미세한 흔들림을 흉내 낸다
 * (규칙 A5가 재는 것이 바로 이 흔들림이다).
 */
function stancePose(
  gapRatio: number,
  kneeLeft: number,
  kneeRight: number,
  torsoTilt: number,
): (t: number) => Landmark[] {
  const keys: Keyframe<StanceParams>[] = [
    { t: 0.0, params: { feetGapRatio: 0.35, kneeAngleLeftDeg: 178, kneeAngleRightDeg: 178, torsoTiltDeg: 2 } },
    { t: 0.15, params: { feetGapRatio: 0.35, kneeAngleLeftDeg: 178, kneeAngleRightDeg: 178, torsoTiltDeg: 2 } },
    { t: 0.55, params: { feetGapRatio: gapRatio, kneeAngleLeftDeg: kneeLeft, kneeAngleRightDeg: kneeRight, torsoTiltDeg: torsoTilt } },
    { t: 2.15, params: { feetGapRatio: gapRatio, kneeAngleLeftDeg: kneeLeft, kneeAngleRightDeg: kneeRight, torsoTiltDeg: torsoTilt } },
    { t: 2.45, params: { feetGapRatio: 0.35, kneeAngleLeftDeg: 178, kneeAngleRightDeg: 178, torsoTiltDeg: 2 } },
    { t: 2.6, params: { feetGapRatio: 0.35, kneeAngleLeftDeg: 178, kneeAngleRightDeg: 178, torsoTiltDeg: 2 } },
  ];
  return (t: number) => {
    const p = sampleKeyframes(keys, t);
    const holding = t > 0.55 && t < 2.15;
    const sway = holding ? 0.3 * Math.sin(2 * Math.PI * 0.5 * t) : 0;
    return buildStanceFrame({
      ...p,
      kneeAngleLeftDeg: p.kneeAngleLeftDeg + sway,
      kneeAngleRightDeg: p.kneeAngleRightDeg + sway * 0.8,
    });
  };
}

// ---------------------------------------------------------------------------
// 앞차기
// ---------------------------------------------------------------------------

function kickPose(keys: readonly Keyframe<KickParams>[]): (t: number) => Landmark[] {
  return (t: number) => buildKickFrame(sampleKeyframes(keys, t));
}

const KICK_REST: KickParams = {
  kickHipDeg: 0,
  kickKneeDeg: 0,
  supportDriftDeg: 0,
  supportKneeDeg: 10,
  torsoLeanDeg: 0,
};

/** 합격 앞차기: 들기 → 뻗기 → 회수 → 내리기를 모두 지킨다. */
const GOOD_KICK_KEYS: Keyframe<KickParams>[] = [
  { t: 0.0, params: { ...KICK_REST } },
  { t: 0.33, params: { ...KICK_REST, supportDriftDeg: 0.4 } },
  { t: 0.5, params: { kickHipDeg: 100, kickKneeDeg: 95, supportDriftDeg: 0.8, supportKneeDeg: 12, torsoLeanDeg: 6 } },
  { t: 0.63, params: { kickHipDeg: 110, kickKneeDeg: 12, supportDriftDeg: 1.0, supportKneeDeg: 12, torsoLeanDeg: 10 } },
  { t: 0.83, params: { kickHipDeg: 105, kickKneeDeg: 85, supportDriftDeg: 0.8, supportKneeDeg: 12, torsoLeanDeg: 8 } },
  { t: 1.2, params: { kickHipDeg: 10, kickKneeDeg: 25, supportDriftDeg: 0.4, supportKneeDeg: 11, torsoLeanDeg: 2 } },
  { t: 1.4, params: { ...KICK_REST } },
  { t: 2.0, params: { ...KICK_REST } },
];

/** 무릎이 덜 펴진 앞차기: 정점에서 무릎 내각 138°(합격선 155°). B4만 물린다. */
const UNDEREXTENDED_KICK_KEYS: Keyframe<KickParams>[] = [
  { t: 0.0, params: { ...KICK_REST } },
  { t: 0.33, params: { ...KICK_REST, supportDriftDeg: 0.4 } },
  { t: 0.5, params: { kickHipDeg: 100, kickKneeDeg: 95, supportDriftDeg: 0.8, supportKneeDeg: 12, torsoLeanDeg: 6 } },
  { t: 0.63, params: { kickHipDeg: 125, kickKneeDeg: 42, supportDriftDeg: 1.0, supportKneeDeg: 12, torsoLeanDeg: 9 } },
  { t: 0.83, params: { kickHipDeg: 108, kickKneeDeg: 85, supportDriftDeg: 0.8, supportKneeDeg: 12, torsoLeanDeg: 7 } },
  { t: 1.2, params: { kickHipDeg: 10, kickKneeDeg: 25, supportDriftDeg: 0.4, supportKneeDeg: 11, torsoLeanDeg: 2 } },
  { t: 1.4, params: { ...KICK_REST } },
  { t: 2.0, params: { ...KICK_REST } },
];

/**
 * 균형이 무너진 시도: 상체가 뒤로 젖혀지고(B5), 축발이 밀리고(B6),
 * 찬 다리를 접지 않고 그대로 내린다(B2).
 */
const BALANCE_BROKEN_KICK_KEYS: Keyframe<KickParams>[] = [
  { t: 0.0, params: { ...KICK_REST } },
  { t: 0.3, params: { ...KICK_REST, supportDriftDeg: 1 } },
  { t: 0.5, params: { kickHipDeg: 95, kickKneeDeg: 92, supportDriftDeg: 2, supportKneeDeg: 14, torsoLeanDeg: 14 } },
  { t: 0.66, params: { kickHipDeg: 105, kickKneeDeg: 12, supportDriftDeg: 9, supportKneeDeg: 18, torsoLeanDeg: 30 } },
  { t: 1.1, params: { kickHipDeg: 20, kickKneeDeg: 8, supportDriftDeg: 11, supportKneeDeg: 16, torsoLeanDeg: 18 } },
  { t: 1.4, params: { kickHipDeg: 0, kickKneeDeg: 0, supportDriftDeg: 11, supportKneeDeg: 12, torsoLeanDeg: 4 } },
  { t: 2.0, params: { kickHipDeg: 0, kickKneeDeg: 0, supportDriftDeg: 11, supportKneeDeg: 10, torsoLeanDeg: 2 } },
];

/**
 * 생성할 샘플들.
 * 손상 샘플(가림·프레임 결손)은 여기 없다 — 좋은 샘플에서 degrade.ts가 파생시킨다.
 * PRD F5의 완료 기준이 정확히 그 형태다: "일부러 손상시킨 샘플".
 */
export const SAMPLE_SPECS: readonly SampleSpec[] = [
  {
    id: "frontkick-good",
    label: "앞차기 — 합격",
    motion: "frontKick",
    view: "sagittal",
    fps: 30,
    durationSeconds: 2.0,
    seed: 20260922,
    jitterM: 0.002,
    origin: SYNTHETIC_ORIGIN,
    intent: "B1~B7 전부 합격. 10.0점.",
    poseAt: kickPose(GOOD_KICK_KEYS),
  },
  {
    id: "frontkick-underextended",
    label: "앞차기 — 무릎이 덜 펴짐",
    motion: "frontKick",
    view: "sagittal",
    fps: 30,
    durationSeconds: 2.0,
    seed: 20260923,
    jitterM: 0.002,
    origin: SYNTHETIC_ORIGIN,
    intent: "B4(펴짐)만 0.3 감점. 9.7점.",
    poseAt: kickPose(UNDEREXTENDED_KICK_KEYS),
  },
  {
    id: "frontkick-balance-broken",
    label: "앞차기 — 균형이 무너진 시도",
    motion: "frontKick",
    view: "sagittal",
    fps: 30,
    durationSeconds: 2.0,
    seed: 20260924,
    jitterM: 0.002,
    origin: SYNTHETIC_ORIGIN,
    intent: "B2(회수 생략) 0.3 + B5(상체 젖힘) 0.3 + B6(축발 흔들림) 0.1. 9.3점.",
    poseAt: kickPose(BALANCE_BROKEN_KICK_KEYS),
  },
  {
    id: "stance-good",
    label: "주춤서기 — 합격",
    motion: "stance",
    view: "frontal",
    fps: 30,
    durationSeconds: 2.6,
    seed: 20260925,
    jitterM: 0.002,
    origin: SYNTHETIC_ORIGIN,
    intent: "A1~A5 전부 합격. 10.0점.",
    poseAt: stancePose(2.0, 138, 140, 4),
  },
  {
    id: "stance-narrow",
    label: "주춤서기 — 발 간격 좁음",
    motion: "stance",
    view: "frontal",
    fps: 30,
    durationSeconds: 2.6,
    seed: 20260926,
    jitterM: 0.002,
    origin: SYNTHETIC_ORIGIN,
    intent: "A1(발 간격)만 0.3 감점. 9.7점.",
    poseAt: stancePose(1.35, 138, 140, 4),
  },
];
