/**
 * 프레임을 비교할 수 있는 모양으로 만드는 층 — 정규화와 거울.
 *
 * 둘 다 **순수 변환**이다. 좌표만 바꾸고 아무 판단도 하지 않는다.
 * 판단(무엇이 어긋났는가)은 `compare.ts` 한 곳에 있다.
 */

import { hipMid, shoulderWidth } from "../judge/coords";
import { LANDMARK_COUNT, LM } from "../judge/landmarks";
import type { Landmark, LandmarkFrame } from "../judge/types";
import type { NormalizedFrame } from "./types";

/**
 * 어깨 폭 S로 나누고 엉덩이 중점을 원점으로 옮긴다.
 *
 * S를 못 구하면(어깨 두 점이 겹치면) `null` 을 돌린다. 0으로 나눈 값으로
 * 그럴듯한 차이를 만들어 내는 것이 제일 나쁘다.
 *
 * **S는 3차원 거리다** — 판정의 `shoulderWidth()` 를 그대로 쓴다. 두 층이 서로 다른
 * 자로 재면 화면의 "0.18·S"와 판정의 "0.18·S"가 다른 값을 뜻하게 된다.
 * (화면에 **그릴 때**의 배율은 다른 문제다. 측면 촬영에서는 어깨가 깊이로 겹쳐
 * 화면 위 어깨 폭이 0에 수렴하므로, 그리기 배율은 몸통 길이를 써야 한다 —
 * 그건 그리기 계층의 일이고 여기서 재는 값과는 무관하다.)
 */
export function normalize(frame: LandmarkFrame): NormalizedFrame | null {
  if (frame.length !== LANDMARK_COUNT) {
    throw new Error(`랜드마크가 ${frame.length}개다. ${LANDMARK_COUNT}개여야 한다.`);
  }
  const S = shoulderWidth(frame);
  if (!Number.isFinite(S) || S <= 0) return null;
  const origin = hipMid(frame);
  const points: Landmark[] = new Array(LANDMARK_COUNT);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = frame[i];
    points[i] = {
      x: (p.x - origin.x) / S,
      y: (p.y - origin.y) / S,
      z: (p.z - origin.z) / S,
      visibility: p.visibility,
    };
  }
  return { points, shoulderWidthM: S };
}

/**
 * 좌우 짝. MediaPipe 인덱스는 홀수 = 사람의 왼쪽, 짝수 = 오른쪽(0 제외)이지만
 * 그 규칙을 믿고 `i ^ 1` 로 계산하지 않는다 — 코(0)가 예외이고, 규칙이 아니라
 * 표로 적어 두면 다음 사람이 확인할 수 있다.
 */
export const MIRROR_PAIRS: readonly (readonly [number, number])[] = [
  [LM.leftEyeInner, LM.rightEyeInner],
  [LM.leftEye, LM.rightEye],
  [LM.leftEyeOuter, LM.rightEyeOuter],
  [LM.leftEar, LM.rightEar],
  [LM.mouthLeft, LM.mouthRight],
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftElbow, LM.rightElbow],
  [LM.leftWrist, LM.rightWrist],
  [LM.leftPinky, LM.rightPinky],
  [LM.leftIndex, LM.rightIndex],
  [LM.leftThumb, LM.rightThumb],
  [LM.leftHip, LM.rightHip],
  [LM.leftKnee, LM.rightKnee],
  [LM.leftAnkle, LM.rightAnkle],
  [LM.leftHeel, LM.rightHeel],
  [LM.leftFootIndex, LM.rightFootIndex],
];

/** 인덱스 i의 거울 짝. 코(0)는 자기 자신이다. */
export const MIRROR_INDEX: readonly number[] = (() => {
  const out = Array.from({ length: LANDMARK_COUNT }, (_, i) => i);
  for (const [a, b] of MIRROR_PAIRS) {
    out[a] = b;
    out[b] = a;
  }
  return out;
})();

/**
 * 좌우를 뒤집은 프레임.
 *
 * 두 가지를 **함께** 해야 한다 — x를 음수로 뒤집고, 좌우 인덱스를 맞바꾼다.
 * 하나만 하면 왼팔이 오른쪽에 그려지거나(인덱스만), 오른팔로 한 동작을 왼팔 규칙으로
 * 재게 된다(x만).
 *
 * 쓰는 곳은 둘이다.
 *  - **비교**: 왼팔 아래막기·왼발 앞차기를 오른쪽 기준 자세로 재려면 플레이어를 뒤집는다.
 *    기준 자세를 뒤집지 않는 이유는, 뒤집으면 지표가 읽는 인덱스까지 전부 바꿔야 하기 때문이다.
 *  - **그리기**: 웹캠 화면은 거울로 보이므로, 교본 고스트도 같은 플래그를 타야 겹친다.
 */
export function mirrorFrame(frame: LandmarkFrame): Landmark[] {
  if (frame.length !== LANDMARK_COUNT) {
    throw new Error(`랜드마크가 ${frame.length}개다. ${LANDMARK_COUNT}개여야 한다.`);
  }
  const out: Landmark[] = new Array(LANDMARK_COUNT);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const src = frame[MIRROR_INDEX[i]];
    out[i] = { x: -src.x, y: src.y, z: src.z, visibility: src.visibility };
  }
  return out;
}
