/**
 * 판정 코어의 공개 면.
 *
 * 이 폴더 안의 코드는 순수 함수만 둔다 — DOM·카메라·네트워크·Date.now()·Math.random()을
 * 쓰지 않는다. 입력은 랜드마크 시퀀스, 출력은 점수와 근거이며, 같은 입력이면 항상 같은
 * 출력이어야 한다(PRD 원칙 2 / docs/PRD.md 5절 규칙 A·B).
 *
 * 화면 계층은 이 파일만 import 하면 된다.
 */

export { judgeSequence, finalScore, formatFrameRanges } from "./judge";
export { judgeStance, findStanceWindow, type StanceWindow, type StanceOutcome } from "./stance";
export {
  judgeFrontKick,
  findKickPhases,
  type KickPhases,
  type FrontKickOutcome,
} from "./frontKick";
export { prepareSequence, checkVisibility, type PreparedFrame, type PreparedSequence } from "./prepare";

export {
  RULES_VERSION,
  MAX_SCORE,
  DEDUCTION,
  EPSILON,
  WITHHOLD,
  STANCE,
  FRONT_KICK,
  NOT_MEASURED,
  HEIGHT_SIGN,
  METRIC_LABEL,
  MOTION_LABEL_KO,
  REQUIRED_VIEW,
  VIEW_LABEL_KO,
} from "./constants";

export {
  LM,
  LEGS,
  LEFT_LEG,
  RIGHT_LEG,
  POSE_EDGES,
  LANDMARK_COUNT,
  ESSENTIAL_LANDMARKS,
  LANDMARK_NAMES_KO,
  type LegIndices,
} from "./landmarks";

export { unitSuffix, bandIndex, deductionFor, distanceToNearestBoundary, gradeOf } from "./grading";

export { ruleCoach, type CoachAdvice, type CoachPoint } from "./coach";

export type {
  Landmark,
  LandmarkFrame,
  TimedFrame,
  LandmarkSequence,
  MotionKind,
  CameraView,
  Grade,
  MeasureUnit,
  CriterionResult,
  NotMeasured,
  WithholdCode,
  WithholdNote,
  FrameStats,
  Judgement,
} from "./types";
export { InvalidSequenceError } from "./types";
