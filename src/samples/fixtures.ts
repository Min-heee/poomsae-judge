/**
 * 테스트가 쓰는 시퀀스 제조기.
 *
 * 공개 샘플(motion.ts)은 "보기 좋은 동작"이 목적이고, 이 파일은 "경계값을 정확히 맞춘
 * 입력"이 목적이다. 그래서 지터를 끄고, 정점에 평평한 구간을 두어 이동평균이
 * 측정값을 흔들지 않게 한다. 둘을 한 파일에 섞으면 어느 쪽 목적도 만족하지 못한다.
 *
 * 앱 번들에는 들어가지 않는다 — 어떤 화면도 이것을 import 하지 않는다.
 */

import type { LandmarkSequence, TimedFrame } from "../judge/types";
import { buildSequence, sampleKeyframes, type Keyframe } from "./motion";
import { buildKickFrame, buildStanceFrame, type KickParams } from "./rig";

export interface StanceFixtureOptions {
  gapRatio?: number;
  kneeLeftDeg?: number;
  kneeRightDeg?: number;
  torsoTiltDeg?: number;
  /** 프레임 수. 유지 시간 = (frames - 1) / fps 다. */
  frames?: number;
  fps?: number;
  /**
   * 무릎 각도에 얹을 사인파의 진폭(도). 0이면 완전히 정지한 자세다.
   * 무릎이 펴졌다 굽었다 하면 엉덩이가 위아래로 움직이고, 그것이 규칙 A5가 재는 흔들림이다.
   */
  swayAmplitudeDeg?: number;
  /** 그 사인파의 주파수(Hz). 너무 빠르면 '멈춘 구간' 자체가 성립하지 않는다. */
  swayHz?: number;
  id?: string;
}

/**
 * 한 자세로 가만히 있는 주춤서기. 값이 프레임마다 똑같으므로
 * 중앙값·표준편차가 설계값과 정확히 같다 — 경계값 시험에 필요한 성질이다.
 */
export function staticStanceSequence(opts: StanceFixtureOptions = {}): LandmarkSequence {
  const {
    gapRatio = 2.0,
    kneeLeftDeg = 138,
    kneeRightDeg = 140,
    torsoTiltDeg = 4,
    frames = 40,
    fps = 30,
    swayAmplitudeDeg = 0,
    swayHz = 0.25,
    id = "fixture-stance",
  } = opts;

  const dtMs = 1000 / fps;
  const out: TimedFrame[] = [];
  for (let i = 0; i < frames; i++) {
    const sway =
      swayAmplitudeDeg === 0
        ? 0
        : swayAmplitudeDeg * Math.sin(2 * Math.PI * swayHz * (i / fps));
    out.push({
      t: Math.round(i * dtMs * 10) / 10,
      landmarks: buildStanceFrame({
        feetGapRatio: gapRatio,
        kneeAngleLeftDeg: kneeLeftDeg + sway,
        kneeAngleRightDeg: kneeRightDeg + sway,
        torsoTiltDeg,
      }),
    });
  }
  return {
    id,
    label: id,
    motion: "stance",
    view: "frontal",
    fps,
    frames: out,
    origin: "테스트 픽스처. 한 자세를 그대로 반복한 시퀀스다.",
  };
}

export interface KickFixtureOptions {
  /** 정점의 엉덩이 굴곡(도). 발목 높이를 좌우한다 = 규칙 B3. */
  apexHipDeg?: number;
  /** 정점의 무릎 굴곡(도). 내각 = 180 − 이 값 = 규칙 B4. */
  apexKneeFlexDeg?: number;
  /** 정점의 상체 젖힘(도) = 규칙 B5. */
  apexLeanDeg?: number;
  /** 동작 끝의 축발 밀림(도) = 규칙 B6. */
  driftDeg?: number;
  /** 들기 단계를 넣을 것인가. false면 규칙 B1이 발화한다. */
  chamber?: boolean;
  /**
   * 들기 단계에서 무릎을 얼마나 접는가(도). 내각 = 180 − 이 값.
   * 덜 접으면(예: 60 → 내각 120°) 규칙 B1이 요구하는 '들기'로 치지 않는다.
   */
  chamberKneeFlexDeg?: number;
  /**
   * 정점 뒤에 '무릎을 접은 채 더 높이 올리는' 국면을 넣는다.
   * 발목 높이만 보면 이쪽이 정점보다 높지만 다리는 접혀 있다 —
   * 정점을 고를 때 무릎이 펴진 프레임만 후보로 두는 이유를 시험하는 입력이다.
   */
  postApexHighFold?: boolean;
  /** 회수 단계를 넣을 것인가. false면 규칙 B2가 발화한다. */
  retract?: boolean;
  /** 들기에서 정점까지 걸리는 시간(초) = 규칙 B7. */
  chamberToApexSeconds?: number;
  fps?: number;
  id?: string;
}

/**
 * 정점에 평평한 구간(0.3초)을 둔 앞차기.
 * 이동평균 창이 전부 평평한 구간 안에 들어가므로, 정점에서 읽는 값이
 * 설계값과 같아진다. 경계 바로 위/아래를 시험하려면 이 성질이 필요하다.
 */
export function kickSequence(opts: KickFixtureOptions = {}): LandmarkSequence {
  const {
    apexHipDeg = 110,
    apexKneeFlexDeg = 12,
    apexLeanDeg = 10,
    driftDeg = 1,
    chamber = true,
    chamberKneeFlexDeg = 95,
    retract = true,
    postApexHighFold = false,
    chamberToApexSeconds = 0.2,
    fps = 30,
    id = "fixture-kick",
  } = opts;

  const rest: KickParams = {
    kickHipDeg: 0,
    kickKneeDeg: 0,
    supportDriftDeg: 0,
    supportKneeDeg: 10,
    torsoLeanDeg: 0,
  };
  const apex: KickParams = {
    kickHipDeg: apexHipDeg,
    kickKneeDeg: apexKneeFlexDeg,
    supportDriftDeg: driftDeg,
    supportKneeDeg: 12,
    torsoLeanDeg: apexLeanDeg,
  };
  // 들기를 뺄 때는 무릎을 접지 않고 다리째 올린다 — "발부터 올라간" 대표 오류다.
  const chamberParams: KickParams = chamber
    ? { ...apex, kickHipDeg: 100, kickKneeDeg: chamberKneeFlexDeg, torsoLeanDeg: apexLeanDeg * 0.6 }
    : { ...apex, kickHipDeg: 55, kickKneeDeg: 8, torsoLeanDeg: apexLeanDeg * 0.6 };

  const tChamber = 0.4;
  const tApex = tChamber + chamberToApexSeconds;
  const tApexEnd = tApex + 0.3;
  const tRetract = tApexEnd + 0.2;
  const tDown = tRetract + 0.35;

  const keys: Keyframe<KickParams>[] = [
    { t: 0.0, params: { ...rest } },
    { t: 0.2, params: { ...rest, supportDriftDeg: driftDeg * 0.2 } },
    { t: tChamber, params: chamberParams },
    { t: tApex, params: { ...apex } },
    { t: tApexEnd, params: { ...apex } },
    ...(postApexHighFold
      ? [{ t: tApexEnd + 0.13, params: { ...apex, kickHipDeg: 150, kickKneeDeg: 60 } }]
      : []),
    retract
      ? { t: tRetract, params: { ...apex, kickHipDeg: 105, kickKneeDeg: 85 } }
      : { t: tRetract, params: { ...apex, kickHipDeg: 70, kickKneeDeg: apexKneeFlexDeg } },
    { t: tDown, params: { ...rest, supportDriftDeg: driftDeg, torsoLeanDeg: apexLeanDeg * 0.2 } },
    { t: tDown + 0.3, params: { ...rest, supportDriftDeg: driftDeg } },
  ];

  return buildSequence({
    id,
    label: id,
    motion: "frontKick",
    view: "sagittal",
    fps,
    durationSeconds: tDown + 0.4,
    seed: 1,
    jitterM: 0, // 경계값 시험이므로 노이즈를 넣지 않는다.
    origin: "테스트 픽스처. 정점에 평평한 구간을 둔 합성 앞차기다.",
    intent: "테스트 전용",
    poseAt: (t) => buildKickFrame(sampleKeyframes(keys, t)),
  });
}

/** 시퀀스의 특정 프레임 구간에서 특정 관절의 신뢰도를 깎는다. */
export function blurFrames(
  sequence: LandmarkSequence,
  from: number,
  to: number,
  landmarks: readonly number[],
  visibility: number,
): LandmarkSequence {
  const targets = new Set(landmarks);
  return {
    ...sequence,
    frames: sequence.frames.map((f, i) =>
      i < from || i > to
        ? f
        : {
            t: f.t,
            landmarks: f.landmarks.map((p, idx) =>
              targets.has(idx) ? { ...p, visibility } : p,
            ),
          },
    ),
  };
}

/** 시퀀스에서 프레임을 지운다. 타임스탬프는 그대로라 그 자리에 시간 구멍이 남는다. */
export function removeFrames(
  sequence: LandmarkSequence,
  from: number,
  to: number,
): LandmarkSequence {
  return {
    ...sequence,
    frames: sequence.frames.filter((_, i) => i < from || i > to),
  };
}
