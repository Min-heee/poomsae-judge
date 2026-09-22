/**
 * 합성 샘플의 골격 모형.
 *
 * 왜 합성인가: 녹화·추출은 (1) 결정성이 추론 백엔드에 묶이고, (2) 실패 케이스를
 * 의도적으로 만들 수 없다. PRD F5의 완료 기준이 "일부러 손상시킨 샘플이 보류로 떨어질 것"인데
 * 그건 합성이 아니면 만들기 어렵다. 대신 정직하게 적어 둔다 —
 * **합성 데이터는 규칙이 옳다는 것을 증명하지 않는다. 규칙이 의도대로 동작하는지만 증명한다.**
 *
 * 좌표계는 판정 코어의 약속과 같다: 미터, 엉덩이 중점이 원점, y는 아래로 증가.
 * 분절 길이는 신장 H에 인체계측 비율을 곱해 고정한다.
 */

import type { Landmark } from "../judge/types";
import { LANDMARK_COUNT, LM } from "../judge/landmarks";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

/** 기준 신장(m). 모든 분절 길이가 여기서 나온다. */
export const BODY_HEIGHT_M = 1.7;

/**
 * 인체계측 비율(신장 대비). 공개된 표준 인체계측 비율의 통상값을 쓴다.
 * 정확한 개인차를 재현하려는 값이 아니라, "사람처럼 보이고 분절 길이가 일정하다"는
 * 성질만 필요해서 고정한 값이다.
 */
export const SEGMENT = {
  thigh: 0.245 * BODY_HEIGHT_M,
  shank: 0.246 * BODY_HEIGHT_M,
  foot: 0.152 * BODY_HEIGHT_M,
  upperArm: 0.186 * BODY_HEIGHT_M,
  forearm: 0.146 * BODY_HEIGHT_M,
  shoulderWidth: 0.259 * BODY_HEIGHT_M,
  pelvisWidth: 0.191 * BODY_HEIGHT_M,
  torso: 0.288 * BODY_HEIGHT_M,
  shoulderToNose: 0.16 * BODY_HEIGHT_M,
} as const;

/** 합성 랜드마크의 기본 신뢰도. 가림 샘플은 degrade.ts가 이 값을 깎는다. */
export const DEFAULT_VISIBILITY = 0.95;

export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(a: Vec3, k: number): Vec3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

/** 시드 PRNG. Math.random()을 쓰면 샘플이 재현되지 않는다. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 2링크 역운동학. 엉덩이와 발목 위치가 주어지면 무릎을 찾는다.
 * x–y 평면에서만 푼다(주춤서기는 정면, 앞차기는 측면이 모두 이 평면이다).
 * bendSign은 무릎이 어느 쪽으로 튀어나오는지 — 주춤서기는 바깥쪽이다.
 */
export function solveKnee(
  hip: Vec3,
  ankle: Vec3,
  thigh: number,
  shank: number,
  bendSign: number,
): Vec3 {
  const dx = ankle.x - hip.x;
  const dy = ankle.y - hip.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { x: hip.x + thigh * bendSign, y: hip.y, z: hip.z };
  const dClamped = Math.min(d, thigh + shank - 1e-6);
  const a = (thigh * thigh - shank * shank + dClamped * dClamped) / (2 * dClamped);
  const h = Math.sqrt(Math.max(0, thigh * thigh - a * a));
  const ux = dx / d;
  const uy = dy / d;
  return {
    x: hip.x + ux * a - uy * h * bendSign,
    y: hip.y + uy * a + ux * h * bendSign,
    z: (hip.z + ankle.z) / 2,
  };
}

/** 엉덩이 굴곡 φ, 무릎 굴곡 κ(도)로 다리를 편다. 0/0이면 곧게 선 다리. */
export function forwardLeg(
  hip: Vec3,
  hipFlexDeg: number,
  kneeFlexDeg: number,
  forward: Vec3,
): { knee: Vec3; ankle: Vec3 } {
  const down = v3(0, 1, 0);
  const dir = (angleDeg: number): Vec3 => {
    const a = angleDeg * DEG;
    return add(scale(forward, Math.sin(a)), scale(down, Math.cos(a)));
  };
  const knee = add(hip, scale(dir(hipFlexDeg), SEGMENT.thigh));
  const ankle = add(knee, scale(dir(hipFlexDeg - kneeFlexDeg), SEGMENT.shank));
  return { knee, ankle };
}

function put(out: Landmark[], index: number, p: Vec3): void {
  out[index] = { x: p.x, y: p.y, z: p.z, visibility: DEFAULT_VISIBILITY };
}

/**
 * 얼굴·팔·발 랜드마크를 채운다.
 * 규칙 A·B는 이 점들을 읽지 않는다. 스켈레톤이 사람처럼 보이라고 있는 것이고,
 * 그래서 값의 정밀도보다 "있다/없다"가 중요하다.
 */
function fillCosmetic(
  out: Landmark[],
  shoulderMid: Vec3,
  lateral: Vec3,
  forward: Vec3,
  ankles: { left: Vec3; right: Vec3 },
): void {
  const up = v3(0, -1, 0);
  const side = (k: number) => scale(lateral, k);

  const leftShoulder = add(shoulderMid, side(SEGMENT.shoulderWidth / 2));
  const rightShoulder = add(shoulderMid, side(-SEGMENT.shoulderWidth / 2));
  put(out, LM.leftShoulder, leftShoulder);
  put(out, LM.rightShoulder, rightShoulder);

  const nose = add(add(shoulderMid, scale(up, SEGMENT.shoulderToNose)), scale(forward, 0.05));
  put(out, LM.nose, nose);
  put(out, LM.leftEyeInner, add(add(nose, side(0.02)), scale(up, 0.03)));
  put(out, LM.leftEye, add(add(nose, side(0.032)), scale(up, 0.032)));
  put(out, LM.leftEyeOuter, add(add(nose, side(0.045)), scale(up, 0.03)));
  put(out, LM.rightEyeInner, add(add(nose, side(-0.02)), scale(up, 0.03)));
  put(out, LM.rightEye, add(add(nose, side(-0.032)), scale(up, 0.032)));
  put(out, LM.rightEyeOuter, add(add(nose, side(-0.045)), scale(up, 0.03)));
  put(out, LM.leftEar, add(add(add(nose, side(0.075)), scale(up, 0.02)), scale(forward, -0.06)));
  put(out, LM.rightEar, add(add(add(nose, side(-0.075)), scale(up, 0.02)), scale(forward, -0.06)));
  put(out, LM.mouthLeft, add(add(nose, side(0.022)), scale(up, -0.045)));
  put(out, LM.mouthRight, add(add(nose, side(-0.022)), scale(up, -0.045)));

  // 팔은 가드 자세로 고정한다. 팔이 늘어져 있으면 태권도 동작으로 보이지 않는다.
  const armSide = [
    { shoulder: leftShoulder, sign: 1, elbow: LM.leftElbow, wrist: LM.leftWrist, pinky: LM.leftPinky, index: LM.leftIndex, thumb: LM.leftThumb },
    { shoulder: rightShoulder, sign: -1, elbow: LM.rightElbow, wrist: LM.rightWrist, pinky: LM.rightPinky, index: LM.rightIndex, thumb: LM.rightThumb },
  ];
  for (const arm of armSide) {
    const elbow = add(
      add(arm.shoulder, scale(up, -SEGMENT.upperArm * 0.94)),
      scale(forward, 0.04),
    );
    const wrist = add(
      add(add(elbow, scale(forward, SEGMENT.forearm * 0.82)), scale(up, SEGMENT.forearm * 0.28)),
      side(-0.05 * arm.sign),
    );
    put(out, arm.elbow, elbow);
    put(out, arm.wrist, wrist);
    put(out, arm.pinky, add(add(wrist, scale(forward, 0.05)), side(-0.02 * arm.sign)));
    put(out, arm.index, add(add(wrist, scale(forward, 0.06)), scale(up, 0.01)));
    put(out, arm.thumb, add(add(wrist, scale(forward, 0.035)), side(0.015 * arm.sign)));
  }

  // 발: 뒤꿈치는 발목 뒤 아래, 발끝은 앞 아래.
  const feet = [
    { ankle: ankles.left, heel: LM.leftHeel, toe: LM.leftFootIndex },
    { ankle: ankles.right, heel: LM.rightHeel, toe: LM.rightFootIndex },
  ];
  for (const f of feet) {
    put(out, f.heel, add(add(f.ankle, scale(forward, -0.045)), scale(up, -0.045)));
    put(out, f.toe, add(add(f.ankle, scale(forward, SEGMENT.foot * 0.66)), scale(up, -0.06)));
  }
}

export interface StanceParams {
  /** 좌우 발목 사이 거리 ÷ 어깨 너비. 규칙 A1이 재는 값이 바로 이것이다. */
  feetGapRatio: number;
  /** 좌우 무릎 내각(도). 규칙 A2·A3이 재는 값. */
  kneeAngleLeftDeg: number;
  kneeAngleRightDeg: number;
  /** 상체가 수직에서 벗어난 각(도). 규칙 A4. */
  torsoTiltDeg: number;
}

/**
 * 주춤서기 한 프레임. 정면 시야이므로 좌우 벌림이 x축에 나타난다.
 *
 * 발 간격과 무릎 내각을 직접 지정하고 발목 위치를 역산한다.
 * 관절각을 넣고 결과를 재는 것보다, 재려는 값을 넣고 자세를 만드는 쪽이
 * "이 샘플이 왜 이 등급인가"를 설명하기 쉽다.
 */
export function buildStanceFrame(p: StanceParams): Landmark[] {
  const out: Landmark[] = new Array(LANDMARK_COUNT);
  const lateral = v3(1, 0, 0); // 사람의 왼쪽이 +x
  const forward = v3(0, 0, -1); // 카메라를 마주 본다

  const hipHalf = SEGMENT.pelvisWidth / 2;
  const leftHip = v3(hipHalf, 0, 0);
  const rightHip = v3(-hipHalf, 0, 0);
  put(out, LM.leftHip, leftHip);
  put(out, LM.rightHip, rightHip);

  const ankleX = (p.feetGapRatio * SEGMENT.shoulderWidth) / 2;

  const legs = [
    { hip: leftHip, sign: 1, angle: p.kneeAngleLeftDeg, knee: LM.leftKnee, ankle: LM.leftAnkle },
    { hip: rightHip, sign: -1, angle: p.kneeAngleRightDeg, knee: LM.rightKnee, ankle: LM.rightAnkle },
  ];
  const anklePos: Record<"left" | "right", Vec3> = {
    left: v3(0, 0, 0),
    right: v3(0, 0, 0),
  };

  for (const leg of legs) {
    // 무릎 내각 θ로부터 엉덩이–발목 거리 D를 구한다(코사인 법칙).
    const cos = Math.cos(leg.angle * DEG);
    const d2 =
      SEGMENT.thigh * SEGMENT.thigh +
      SEGMENT.shank * SEGMENT.shank -
      2 * SEGMENT.thigh * SEGMENT.shank * cos;
    const dx = leg.sign * ankleX - leg.hip.x;
    const dy = Math.sqrt(Math.max(0, d2 - dx * dx));
    const ankle = v3(leg.sign * ankleX, dy, 0);
    // 무릎은 바깥쪽으로 나간다. 주춤서기는 무릎을 모으지 않는다.
    const knee = solveKnee(leg.hip, ankle, SEGMENT.thigh, SEGMENT.shank, -leg.sign);
    put(out, leg.knee, knee);
    put(out, leg.ankle, ankle);
    anklePos[leg.sign === 1 ? "left" : "right"] = ankle;
  }

  const tilt = p.torsoTiltDeg * DEG;
  const shoulderMid = v3(SEGMENT.torso * Math.sin(tilt), -SEGMENT.torso * Math.cos(tilt), 0);
  fillCosmetic(out, shoulderMid, lateral, forward, anklePos);
  return out;
}

export interface KickParams {
  /** 차는 다리의 엉덩이 굴곡(도). 0이면 곧게 선 다리, 90이면 허벅지가 수평. */
  kickHipDeg: number;
  /** 차는 다리의 무릎 굴곡(도). 내각 = 180 − 이 값. */
  kickKneeDeg: number;
  /** 축발의 엉덩이 굴곡 보정(도). 이 값이 변하면 축발 발목이 앞뒤로 밀린다 = 규칙 B6. */
  supportDriftDeg: number;
  /** 축발 무릎 굴곡(도). */
  supportKneeDeg: number;
  /** 상체가 차는 방향의 반대로 젖혀진 각(도). 규칙 B5. */
  torsoLeanDeg: number;
}

/**
 * 앞차기 한 프레임. 측면 시야이므로 앞뒤 움직임이 x축(+x가 차는 방향)에 나타난다.
 * 차는 다리는 오른다리로 고정한다.
 */
export function buildKickFrame(p: KickParams): Landmark[] {
  const out: Landmark[] = new Array(LANDMARK_COUNT);
  const lateral = v3(0, 0, 1); // 사람의 왼쪽이 +z
  const forward = v3(1, 0, 0); // +x 를 향해 찬다

  const hipHalf = SEGMENT.pelvisWidth / 2;
  const leftHip = v3(0, 0, hipHalf);
  const rightHip = v3(0, 0, -hipHalf);
  put(out, LM.leftHip, leftHip);
  put(out, LM.rightHip, rightHip);

  // 축발(왼다리): 굴곡을 무릎 굴곡의 절반에 두면 발목이 엉덩이 바로 아래 온다.
  const supportHip = p.supportKneeDeg / 2 + p.supportDriftDeg;
  const support = forwardLeg(leftHip, supportHip, p.supportKneeDeg, forward);
  put(out, LM.leftKnee, support.knee);
  put(out, LM.leftAnkle, support.ankle);

  const kick = forwardLeg(rightHip, p.kickHipDeg, p.kickKneeDeg, forward);
  put(out, LM.rightKnee, kick.knee);
  put(out, LM.rightAnkle, kick.ankle);

  const lean = p.torsoLeanDeg * DEG;
  const shoulderMid = v3(-SEGMENT.torso * Math.sin(lean), -SEGMENT.torso * Math.cos(lean), 0);
  fillCosmetic(out, shoulderMid, lateral, forward, { left: support.ankle, right: kick.ankle });
  return out;
}

/**
 * 결정적 지터. 검출기 노이즈를 흉내 낸다.
 * Math.random()을 쓰지 않는다 — 같은 시드면 같은 파일이 나와야 한다.
 */
export function jitter(frame: Landmark[], rand: () => number, amplitudeM: number): Landmark[] {
  return frame.map((p) => ({
    x: p.x + (rand() * 2 - 1) * amplitudeM,
    y: p.y + (rand() * 2 - 1) * amplitudeM,
    z: p.z + (rand() * 2 - 1) * amplitudeM,
    visibility: p.visibility,
  }));
}
