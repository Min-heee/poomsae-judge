/**
 * 33개 포즈 랜드마크의 이름과 골격 연결.
 *
 * 인덱스는 MediaPipe Pose Landmarker의 순서를 그대로 따른다.
 * 홀수 = 사람의 왼쪽, 짝수 = 사람의 오른쪽(0 제외).
 * 이 파일은 판정 규칙을 담지 않는다 — "어디가 무릎인가"만 안다.
 */

export const LM = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

/** 랜드마크 개수. MediaPipe Pose 모델이 내는 점의 수와 같아야 한다. */
export const LANDMARK_COUNT = 33;

/**
 * 규칙 A·B가 실제로 읽는 8개 점.
 * H1(프레임 무효 판정)은 이 8개의 visibility만 본다 — 얼굴·손이 가려져도
 * 다리 판정에는 지장이 없으므로 무효로 떨어뜨리지 않는다.
 */
export const ESSENTIAL_LANDMARKS: readonly number[] = [
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
];

/** 사람이 읽을 이름 (판정 보류 사유 문장에 쓴다). */
export const LANDMARK_NAMES_KO: Readonly<Record<number, string>> = {
  [LM.leftShoulder]: "왼쪽 어깨",
  [LM.rightShoulder]: "오른쪽 어깨",
  [LM.leftHip]: "왼쪽 엉덩이",
  [LM.rightHip]: "오른쪽 엉덩이",
  [LM.leftKnee]: "왼쪽 무릎",
  [LM.rightKnee]: "오른쪽 무릎",
  [LM.leftAnkle]: "왼쪽 발목",
  [LM.rightAnkle]: "오른쪽 발목",
};

/**
 * 스켈레톤 간선 35개.
 * MediaPipe의 PoseLandmarker.POSE_CONNECTIONS를 [start, end]로 편 값이며,
 * 브라우저에서 실제로 추출해 확인했다(docs/TECH-NOTES.md 3.6절).
 * 렌더링 계층이 쓰라고 여기 둔다 — 판정에는 쓰이지 않는다.
 */
export const POSE_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
];

/** 다리 한 쪽의 관절 묶음. 좌우 규칙을 같은 코드로 돌리기 위한 것. */
export interface LegIndices {
  readonly side: "left" | "right";
  readonly nameKo: string;
  readonly hip: number;
  readonly knee: number;
  readonly ankle: number;
  readonly heel: number;
  readonly footIndex: number;
}

export const LEFT_LEG: LegIndices = {
  side: "left",
  nameKo: "왼다리",
  hip: LM.leftHip,
  knee: LM.leftKnee,
  ankle: LM.leftAnkle,
  heel: LM.leftHeel,
  footIndex: LM.leftFootIndex,
};

export const RIGHT_LEG: LegIndices = {
  side: "right",
  nameKo: "오른다리",
  hip: LM.rightHip,
  knee: LM.rightKnee,
  ankle: LM.rightAnkle,
  heel: LM.rightHeel,
  footIndex: LM.rightFootIndex,
};

export const LEGS: readonly LegIndices[] = [LEFT_LEG, RIGHT_LEG];
