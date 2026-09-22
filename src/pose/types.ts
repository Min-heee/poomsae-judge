/**
 * 포즈 입력 계층이 주고받는 자료형.
 *
 * 이 파일은 "랜드마크가 어떻게 생겼는가"만 정한다. 판정 규칙은 여기 없다.
 * 샘플 재생과 웹캠 추론은 전혀 다른 경로지만, 둘 다 마지막에는 같은 모양의
 * PoseSequence 를 내놓는다. 화면과 판정 코어는 입력이 어디서 왔는지 몰라도 된다.
 *
 * 좌표계 약속 (판정 코어와 맞춘 것 — src/judge/constants.ts HEIGHT_SIGN):
 *   world … **y가 아래로 증가**한다. 높이는 -y. 원점은 엉덩이 중점.
 *   image … 0~1 정규화 이미지 좌표. 그리기 전용.
 *
 * 왜 좌표계가 둘인가: 정규화 좌표의 x는 이미지 *너비*로, y는 *높이*로 나눈 값이라
 * 영상이 정사각형이 아니면 두 축의 스케일이 다르다. 그 좌표로 각도를 재면
 * 16:9에서 진짜 90°가 60°쯤으로 나온다(docs/TECH-NOTES.md 3.4).
 * 그래서 규칙은 전부 world 로 계산하고, image 는 2D 오버레이에만 쓴다.
 */

import type { CameraView, Landmark, LandmarkSequence, MotionKind } from "@/judge/types";

export type { CameraView, Landmark, MotionKind };

/**
 * 한국어 이름은 판정 코어에 있는 것을 그대로 쓴다(`@/judge/constants`).
 * 판정이 내는 보류 문장에도 같은 이름이 들어가므로, 여기서 다시 적으면
 * 화면과 판정이 다른 말을 하게 된다.
 */
export { MOTION_LABEL_KO as MOTION_LABEL, VIEW_LABEL_KO as VIEW_LABEL } from "@/judge/constants";

/** 한 프레임. 두 좌표계를 나란히 들고 다닌다. */
export interface PoseFrame {
  /** 시퀀스 시작 기준 경과 시간(ms). 단조 증가. */
  t: number;
  /** 33개. 0~1 정규화 이미지 좌표. **그리기 전용.** */
  image: Landmark[];
  /** 33개. 판정 좌표(y 아래로 증가, 엉덩이 중점 원점). **계산용.** */
  world: Landmark[];
}

/** 시퀀스가 어디서 왔는가. 화면에 그대로 표시한다. */
export type SequenceOrigin = "sample" | "webcam" | "imported";

export const ORIGIN_LABEL: Record<SequenceOrigin, string> = {
  sample: "합성 샘플 파일",
  webcam: "웹캠 실시간",
  imported: "불러온 파일",
};

export interface PoseSequence {
  id: string;
  /** 목록에 뜨는 이름. 예: "주춤서기 — 발 간격 좁음" */
  label: string;
  motion: MotionKind;
  view: CameraView;
  /** 이 시퀀스가 무엇을 보여 주려는 것인지 한 줄. */
  note?: string;
  /** 명목 프레임률. 실제 시간 계산은 언제나 frame.t 로 한다. */
  fps: number;
  /** 원본 영상의 가로÷세로. image 좌표를 그릴 때 쓴다. */
  aspect: number;
  frames: PoseFrame[];
  origin: SequenceOrigin;
  /** "합성 생성", "웹캠 최근 4초" 같은 출처 한 줄. 파일이 스스로 적어 온 것이다. */
  originNote?: string;
}

/**
 * 판정 코어에 넘길 모양으로 바꾼다.
 *
 * 코어는 화면을 모르므로 image 좌표를 받지 않는다. 이 변환이 곧
 * "판정의 입력은 영상이 아니라 랜드마크 시퀀스"라는 경계선이다(docs/PRD.md 6절).
 */
export function toLandmarkSequence(seq: PoseSequence): LandmarkSequence {
  return {
    id: seq.id,
    label: seq.label,
    motion: seq.motion,
    view: seq.view,
    fps: seq.fps,
    frames: seq.frames.map((f) => ({ t: f.t, landmarks: f.world })),
    origin: seq.originNote ?? ORIGIN_LABEL[seq.origin],
  };
}

/** 시퀀스의 총 길이(ms). */
export function sequenceDurationMs(seq: PoseSequence): number {
  if (seq.frames.length === 0) return 0;
  return seq.frames[seq.frames.length - 1].t - seq.frames[0].t;
}

/**
 * 주어진 시각(ms)에 해당하는 프레임 번호.
 *
 * 보간하지 않고 "그 시각 이하의 마지막 프레임"을 고른다 —
 * 화면에 뜬 숫자가 실제로 저장된 프레임의 값이어야 근거로 쓸 수 있다.
 */
export function frameIndexAt(seq: PoseSequence, tMs: number): number {
  const frames = seq.frames;
  if (frames.length === 0) return 0;
  const base = frames[0].t;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t - base <= tMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
