/**
 * 포즈 입력 계층의 진입점.
 *
 * 랜드마크를 "어디서 가져오는가"만 담당한다 — 샘플 JSON 재생, 그리고 선택적 웹캠 추론.
 * 판정 규칙은 여기 두지 않는다(`src/judge`). 이 계층의 일은 두 입력원이 같은 모양의
 * 시퀀스를 내보내도록 맞추는 것, 그리고 그 시퀀스를 판정 코어가 먹는 모양으로
 * 바꿔 주는 것이다.
 *
 * MediaPipe 모듈은 여기서 재export 하지 않는다 — 그러면 샘플 모드에서도 번들에
 * 딸려 들어온다. 웹캠 훅이 `./landmarker` 를 직접 동적 import 한다.
 */

export type {
  CameraView,
  Landmark,
  MotionKind,
  PoseFrame,
  PoseSequence,
  SequenceOrigin,
} from "./types";
export {
  MOTION_LABEL,
  ORIGIN_LABEL,
  VIEW_LABEL,
  frameIndexAt,
  sequenceDurationMs,
  toLandmarkSequence,
} from "./types";

export {
  normalizeSequence,
  projectFrames,
  REQUIRED_FIELDS,
  SequenceFormatError,
} from "./sequence";
export { assetUrl, BASE_PATH, loadSamples, type SampleLoadResult } from "./samples";

export { judgePose } from "./judge-adapter";
export {
  downloadText,
  exportSequenceText,
  importSequence,
  sequenceFileName,
} from "./transfer";
export { readFrame, hiddenEssentials, type FrameReadout } from "./readout";

export {
  GRADE_LABEL,
  GRADE_TONE,
  HOLD_RULES,
  RULE_TABLE,
  holdRulesFor,
  axisRatio,
  euroRo,
  formatMeasure,
  gaugeModel,
  judgementJoints,
  unitSuffix,
  type GaugeModel,
  type GradeTone,
  type HoldRule,
  type RuleRow,
} from "./display";

export { DARK_THEME, DEFAULT_EMPHASIS, drawPose, weakLandmarkNames } from "./draw2d";
export { usePlayback, type Playback } from "./usePlayback";
export { useWebcamPose, type WebcamPose, type WebcamStatus } from "./useWebcamPose";
