/**
 * 포즈 입력 계층 → 판정 코어를 잇는 다리.
 *
 * 통합 전에는 이 파일이 런타임에 `@/judge` 를 들여다보며 쓸 만한 함수 이름을
 * 찾는 탐침이었다. 판정 코어가 아직 없을 수도 있었기 때문이다. 이제 코어가
 * `judgeSequence` 를 내보내므로 **정적 import 한 줄로 줄였다.**
 *
 * 탐침을 걷어낸 이유(통합에서 가장 중요한 부분):
 *   - 탐침은 `Record<string, unknown>` 을 거치느라 경계에서 타입 검사가 사라졌다.
 *     코어의 export 이름이 바뀌면 `tsc` 가 잡지 못하고, 화면에 "판정 코어 미연결"
 *     띠가 조용히 뜨는 것으로 끝났다. 지금은 컴파일이 깨진다.
 *   - 탐침의 폴백 경로는 실제로 틀려 있었다. `judgeStance`/`judgeFrontKick` 는
 *     `PreparedSequence` 를 받아 `StanceOutcome | null` 을 돌려주는데, 탐침은
 *     그것을 `(seq: LandmarkSequence) => Judgement` 로 캐스팅해 두었다.
 *     `judgeSequence` 가 먼저 잡혀서 한 번도 실행되지 않았을 뿐이다.
 *
 * 판정이 던지는 경우는 여전히 있다(구조가 깨진 입력 = InvalidSequenceError).
 * 그건 화면(Studio)이 try/catch 로 받아 사유를 그대로 띄운다. 점수를 지어내지
 * 않는다는 원칙은 그대로다.
 */

import { judgeSequence } from "@/judge";
import type { Judgement } from "@/judge/types";
import { toLandmarkSequence, type PoseSequence } from "./types";

/**
 * 포즈 시퀀스를 판정한다.
 *
 * 변환(`toLandmarkSequence`)이 곧 "판정의 입력은 영상이 아니라 랜드마크 시퀀스"
 * 라는 경계선이다(docs/PRD.md 6절). 화면 좌표(image)는 여기서 버려진다.
 *
 * 구조가 깨진 입력이면 `InvalidSequenceError` 를 던진다. 데이터 품질 문제는
 * 던지지 않고 `status: "withheld"` 로 돌아온다 — 보류는 실패가 아니다.
 */
export function judgePose(seq: PoseSequence): Judgement {
  return judgeSequence(toLandmarkSequence(seq));
}
