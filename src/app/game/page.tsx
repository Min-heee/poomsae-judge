import type { Metadata } from "next";
import { FollowGame } from "@/components/FollowGame";

/**
 * 게임은 별도 라우트다.
 *
 * 홈(판정 화면)은 게임 상태 기계도 카드 렌더러도 필요로 하지 않는다. 라우트를 가르면
 * 그 둘이 홈의 첫 화면에 실리지 않는다 — three.js 를 동적 import 로 뗀 것과 같은 이유다.
 *
 * **다만 홈이 그대로 남지는 않았다(실측).** main 131 kB → 이 브랜치 138 kB,
 * `/game` 162 kB(상한 200 kB). 라우트가 둘이 되면서 공통 코드(판정·포즈 계층)가
 * 공유 청크로 갈라진 몫이다. 오버레이 그리기(`./overlay`)와 비교 코어(`@/follow`)는
 * 토글을 켤 때만 받아 오므로 홈의 첫 화면에는 들어가지 않는다 — 측정값으로 말하는
 * 저장소이니 이 숫자도 추정이 아니라 `npm run build` 의 출력이다.
 */
export const metadata: Metadata = {
  title: "따라하기 게임 · 품새 판정기",
  description:
    "화면이 교본 자세를 제시하고, 제한 시간 안에 맞추면 기존 판정 코어가 점수를 냅니다. 카메라 없이 합성 샘플로도 전부 시연됩니다.",
};

export default function GamePage() {
  return <FollowGame />;
}
