/**
 * 카드가 받는 것과, 카드가 그리는 것.
 *
 * 이 파일이 **개인정보 경계선**이다. 카드 렌더러는 여기 적힌 것 외에는 아무것도
 * 모른다 — 영상도, 비디오 엘리먼트도, 캔버스도, 사용자 이름칸도 타입에 없다.
 * "넣지 않기로 했다"를 주석이 아니라 **타입과 정제 함수**로 만든다(`sanitize.ts`).
 *
 * 스켈레톤은 좌표로만 들어온다. 그림은 그 좌표에서 **새로 그린다** —
 * 영상 픽셀이 카드에 닿을 경로가 애초에 없다(docs/PRD-game.md 5.4).
 */

import type { CriterionResult, MotionKind } from "@/judge/types";

/** 그리기용 정규화 이미지 좌표(0~1). 판정에는 절대 쓰지 않는다. */
export interface CardPoint {
  x: number;
  y: number;
}

export interface CardSkeletonInput {
  /** 33개 정규화 이미지 좌표. **얼굴(0~10)은 정제 단계에서 버려진다.** */
  mine: readonly CardPoint[];
  /** 교본 고스트. 없으면 내 자세만 그린다. */
  reference?: readonly CardPoint[] | null;
  /**
   * 원본 영상의 가로÷세로(`PoseSequence.aspect`). 기본 4:3.
   *
   * 정규화 이미지 좌표는 x 를 폭으로, y 를 높이로 나눈 값이라 두 축의 자가 다르다.
   * 이 값을 곱해야 비율이 맞는 공간으로 돌아온다 — 안 곱하면 카드에서만
   * 사람이 옆으로 눌리거나 늘어난다.
   */
  aspect?: number;
}

export interface CardRoundInput {
  /** 0~100. 라운드 보류면 null. */
  baseScore: number | null;
  /** 0~170. 콤보·속도까지 더한 라운드 점수. */
  total: number;
}

export interface CardBestInput {
  /** 1부터 세는 라운드 번호. */
  roundNumber: number;
  /** 10점 만점 원점수. 보류면 null. */
  rawScore: number | null;
  /** 만점(`MAX_SCORE`). 카드가 숫자를 지어내지 않도록 호출자가 넘긴다. */
  maxScore: number;
  /** 그 라운드의 판정 항목. 감점 줄을 여기서 고른다. */
  criteria: readonly CriterionResult[];
  skeleton: CardSkeletonInput;
}

/**
 * 카드 한 장에 필요한 전부.
 *
 * **여기 없는 것**: 이름, 아이디, 기기 정보, 위치, 영상, 얼굴 좌표, 시각(시:분).
 * 날짜는 `dateISO` 로 **호출자가 넘긴다** — 카드 안에서 `new Date()` 를 부르면
 * 같은 판정이 부를 때마다 다른 이미지가 되어 결정성이 깨진다.
 */
export interface CardInput {
  /** "정면 코스 · 주춤서기" 같은 한 줄. */
  courseLabel: string;
  motion: MotionKind;
  /** 게임 총점. */
  totalScore: number;
  /** 기본점 평균(0~100). 별 등급의 근거라 같이 띄운다. */
  averageBase: number;
  /** 별 개수 0~3. **문턱은 게임 층이 정한다**(PRD-game 5.2) — 카드는 받은 대로 그린다. */
  stars: number;
  rounds: readonly CardRoundInput[];
  best: CardBestInput;
  /** "2026-09-24". 날짜까지만 — 시:분은 개인 일상을 드러낼 수 있어 넣지 않는다. */
  dateISO: string;
  /** `RULES_VERSION`. 과거 카드와 섞이지 않게 하는 표시다. */
  rulesVersion: string;
  /** "합성 샘플 파일" / "웹캠 실시간". 샘플 점수를 자기 기록처럼 보이게 두지 않는다. */
  originLabel: string;
}

/* ── 정제된 모양 (레이아웃이 실제로 읽는 것) ───────────────────────── */

/** 몸통 랜드마크 한 점. `i` 는 언제나 11 이상이다 — 얼굴은 여기 못 들어온다. */
export interface BodyPoint {
  i: number;
  x: number;
  y: number;
}

export interface CardSkeleton {
  mine: readonly BodyPoint[];
  reference: readonly BodyPoint[] | null;
  /** 가로÷세로. 정제 단계에서 유한한 양수로 고정된다. */
  aspect: number;
}

export interface CardRound {
  /** 1부터. */
  number: number;
  baseScore: number | null;
  total: number;
  withheld: boolean;
}

/** 카드에 찍히는 감점 한 줄. 측정값과 경계값을 언제나 함께 들고 다닌다. */
export interface CardDeductionLine {
  /** "A1" 같은 규칙 ID. 한글이 안 나와도 이건 읽힌다. */
  id: string;
  title: string;
  /** "1.48·S" / "142.6°" / "—" */
  measuredText: string;
  /** "1.50 / 1.70 / 2.30 / 2.60". 접두어("경계")는 레이아웃이 붙인다. */
  boundsText: string;
  /** 0.1 / 0.3 / 0(보류) */
  deduction: number;
  withheld: boolean;
}

export interface CardData {
  courseLabel: string;
  motion: MotionKind;
  totalScore: number;
  averageBase: number;
  stars: number;
  rounds: readonly CardRound[];
  bestRoundNumber: number;
  rawScoreText: string;
  maxScoreText: string;
  deductions: readonly CardDeductionLine[];
  skeleton: CardSkeleton;
  dateText: string;
  rulesVersion: string;
  originLabel: string;
}
