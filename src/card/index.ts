/**
 * 결과 카드의 공개 면.
 *
 * 바깥에서 알아야 할 것은 셋뿐이다 —
 *   `CardInput` 을 만들고, `renderCard` 로 캔버스에 그리고, `saveCard` 로 파일을 뽑는다.
 *
 * 카드가 **하지 않는** 것도 여기 적어 둔다. 영상 프레임을 받지 않고, 얼굴 좌표를
 * 그리지 않고, 시계를 읽지 않고, 난수를 쓰지 않고, 이름을 묻지 않는다.
 * 그래서 같은 입력이면 언제 어디서 눌러도 같은 이미지가 나온다.
 *
 * **외부 값은 날짜 하나뿐이다.** 카드에 박히는 날짜는 호출자가 넘긴다(`dateISO`) —
 * 이 층이 시계를 읽지 않는다는 사실은 그대로이고(`purity.test.ts` 가 막는다), 대신
 * "같은 판정이면 같은 이미지"라는 문장은 **같은 날짜**라는 조건을 달고 참이다.
 * 날짜를 지역 달력으로 정한 것은 화면 쪽의 결정이다(UTC 를 쓰면 한국에서 자정부터
 * 오전 9시까지 어제 날짜가 박힌다).
 */

export type {
  BodyPoint,
  CardBestInput,
  CardData,
  CardDeductionLine,
  CardInput,
  CardPoint,
  CardRound,
  CardRoundInput,
  CardSkeleton,
  CardSkeletonInput,
} from "./types";

export {
  sanitizeCardData,
  pickDeductionLines,
  stripFace,
  safeText,
  FIRST_BODY_LANDMARK,
  MAX_DEDUCTION_LINES,
} from "./sanitize";

export { buildCardOps, starPoints, type LayoutOptions } from "./layout";
export { skeletonOps, fitToBox, applyFit, BODY_EDGES, type Box, type Fit } from "./skeleton";
export { opsBounds, opsHash, opsText, canonicalize, type Bounds, type CardOp } from "./ops";
export { CARD, CARD_COLORS, CONTENT_WIDTH } from "./theme";
export {
  FONT_STACK,
  LINE_HEIGHT,
  cardStrings,
  estimateMeasure,
  fitText,
  font,
  hangulRenders,
  measurerFromContext,
  wrapText,
  type CardStrings,
  type Measure,
} from "./text";
export { createCardCanvas, paintCard, paintOps, renderCard } from "./paint";
export {
  CARD_PIXEL_SIZE,
  REVOKE_DELAY_MS,
  browserDownloadEnv,
  canvasToPngBlob,
  cardFileName,
  downloadBlob,
  previewUrl,
  safeFileName,
  shareOrDownloadCard,
  warmUpPngEncoder,
  type DownloadEnv,
} from "./export";

import { createCardCanvas, paintCard } from "./paint";
import { canvasToPngBlob, cardFileName, shareOrDownloadCard } from "./export";
import { sanitizeCardData } from "./sanitize";
import type { LayoutOptions } from "./layout";
import type { CardInput, CardSkeletonInput } from "./types";
import type { Judgement } from "@/judge/types";

/**
 * 카드 한 장을 만들어 저장(또는 공유)한다 — 네 단계를 한 줄로 묶은 편의 함수다.
 *
 * **게임 화면은 이 함수를 쓰지 않는다.** 미리보기 `<img>` 를 먼저 띄워야 해서
 * `createCardCanvas → renderCard → canvasToPngBlob` 을 직접 부르고, 저장은 사용자가
 * 버튼을 누를 때 한다. 여기는 그 순서가 필요 없는 호출자(스크립트·다른 화면)를 위한 문이다.
 *
 * 기록 중에는 부르지 말 것 — PNG 인코딩이 메인 스레드를 잡고, 그 시간이 120ms 를
 * 넘으면 그 라운드가 점수가 아니라 H3 보류로 끝난다(docs/TECH-NOTES.md 12.0 ㄴ).
 * 카드는 라운드가 다 끝난 뒤에 뽑는 물건이다.
 */
export async function saveCard(
  input: CardInput,
  opts: LayoutOptions = {},
): Promise<{ fileName: string; blob: Blob; how: "shared" | "downloaded" | "cancelled" }> {
  const data = sanitizeCardData(input);
  const canvas = createCardCanvas();
  paintCard(canvas, data, opts);
  const blob = await canvasToPngBlob(canvas);
  const fileName = cardFileName(data);
  const how = await shareOrDownloadCard(fileName, blob);
  return { fileName, blob, how };
}

/**
 * 판정 하나를 카드 입력으로 옮긴다.
 *
 * **점수는 옮기지 않는다 — 받는다.** 게임 점수 산식(정규화·콤보·속도)은 놀이 층의
 * 규칙이고(docs/PRD-game.md 5.2), 카드가 그것을 다시 계산하면 산식이 두 벌이 된다.
 * 이 함수가 대신 해 주는 것은 **잊기 쉬운 것들**이다 — 규칙표 버전, 동작 종류,
 * 감점 항목, 10점 만점 원점수. 넷 다 판정이 이미 들고 있는 값이다.
 */
export function cardInputFromJudgement(
  judgement: Judgement,
  score: Pick<CardInput, "totalScore" | "averageBase" | "stars" | "rounds">,
  meta: {
    courseLabel: string;
    dateISO: string;
    originLabel: string;
    skeleton: CardSkeletonInput;
    bestRoundNumber?: number;
  },
): CardInput {
  return {
    courseLabel: meta.courseLabel,
    motion: judgement.motion,
    totalScore: score.totalScore,
    averageBase: score.averageBase,
    stars: score.stars,
    rounds: score.rounds,
    best: {
      roundNumber: meta.bestRoundNumber ?? 1,
      rawScore: judgement.score,
      maxScore: judgement.maxScore,
      criteria: judgement.criteria,
      skeleton: meta.skeleton,
    },
    dateISO: meta.dateISO,
    rulesVersion: judgement.rulesVersion,
    originLabel: meta.originLabel,
  };
}
