/**
 * 랜드마크에서 "몸의 값"을 뽑는 층.
 *
 * 규칙(stance.ts / frontKick.ts)은 좌표를 직접 만지지 않고 전부 이 파일을 통한다.
 * 좌표계 약속이 바뀌면 고칠 곳이 여기 하나가 되도록.
 */

import { HEIGHT_SIGN } from "./constants";
import { LM, type LegIndices } from "./landmarks";
import { angleAtVertexXY, distance3, signedBackwardTiltXY, tiltFromVerticalXY } from "./math";
import type { Landmark, LandmarkFrame } from "./types";

/**
 * 높이. y가 아래로 증가한다는 약속을 여기 한 곳에서만 쓴다.
 * -0을 0으로 접는다 — 부호 있는 0이 스냅샷 비교에서 다른 값으로 잡히는 일이 없도록.
 */
export function height(p: Landmark): number {
  const h = HEIGHT_SIGN * p.y;
  return Object.is(h, -0) ? 0 : h;
}

export function midpoint(a: Landmark, b: Landmark): Landmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}

export function shoulderMid(f: LandmarkFrame): Landmark {
  return midpoint(f[LM.leftShoulder], f[LM.rightShoulder]);
}

export function hipMid(f: LandmarkFrame): Landmark {
  return midpoint(f[LM.leftHip], f[LM.rightHip]);
}

/**
 * 기준 길이 S = 좌우 어깨 사이 거리 (PRD 5절).
 *
 * 여기만 3차원 거리를 쓴다. S는 몸이 어느 쪽을 보고 있든 같은 값이어야 하는데,
 * 화면 평면 거리로 재면 측면에서 본 사람의 S가 0에 가까워져 모든 비율이 폭발한다.
 *
 * 대가: S는 z에 의존하고, 단일 카메라의 z는 상대값이다. 즉 S는 이 프로젝트에서
 * 깊이에 기대는 유일한 값이며, 측면 촬영에서 가장 불안정하다. 깊이에 덜 기대는
 * 대안은 몸통 길이(어깨 중점–엉덩이 중점)인데, 두 시야 모두에서 화면 평면에 놓이므로
 * 더 안정적이다. PRD가 S를 어깨 너비로 못 박았기에 여기서는 따르고, 한계를 적어 둔다.
 */
export function shoulderWidth(f: LandmarkFrame): number {
  return distance3(f[LM.leftShoulder], f[LM.rightShoulder]);
}

/** 다리 한 쪽의 무릎 내각(엉덩이–무릎–발목). 화면 평면. */
export function kneeAngle(f: LandmarkFrame, leg: LegIndices): number {
  return angleAtVertexXY(f[leg.hip], f[leg.knee], f[leg.ankle]);
}

/** 상체가 수직에서 벗어난 각(부호 없음). A4용. */
export function torsoTilt(f: LandmarkFrame): number {
  const hip = hipMid(f);
  const sho = shoulderMid(f);
  return tiltFromVerticalXY(sho.x - hip.x, sho.y - hip.y);
}

/** 상체가 차는 방향의 반대로 젖혀진 각(부호 있음). 앞으로 숙이면 음수. B5용. */
export function torsoBackwardLean(f: LandmarkFrame, forwardSign: number): number {
  const hip = hipMid(f);
  const sho = shoulderMid(f);
  return signedBackwardTiltXY(sho.x - hip.x, sho.y - hip.y, forwardSign);
}

/** 좌우 발목의 수평(x) 거리. 깊이를 빼고 잰다. */
export function ankleGapX(f: LandmarkFrame): number {
  return Math.abs(f[LM.leftAnkle].x - f[LM.rightAnkle].x);
}

/**
 * 양 발목 평균 높이 대비 엉덩이 높이.
 *
 * worldLandmarks는 엉덩이 중점이 원점이라 엉덩이의 절대 높이가 항상 0이다.
 * 그대로 표준편차를 내면 언제나 0이 나와 A5의 흔들림 판정이 무의미해진다.
 * 발목 기준으로 재면 원점이 무엇이든 같은 값이 나오고, 위아래로 까딱이는 것을 실제로 잡는다.
 */
export function hipElevation(f: LandmarkFrame): number {
  const hipH = height(hipMid(f));
  const ankleH = (height(f[LM.leftAnkle]) + height(f[LM.rightAnkle])) / 2;
  return hipH - ankleH;
}
