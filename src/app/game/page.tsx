import type { Metadata } from "next";
import { FollowGame } from "@/components/FollowGame";

/**
 * 게임은 별도 라우트다.
 *
 * 홈(판정 화면)은 게임 상태 기계도 카드 렌더러도 필요로 하지 않는다. 라우트를 가르면
 * 홈의 First Load JS 가 그대로 남는다 — three.js 를 동적 import 로 뗀 것과 같은 이유다.
 */
export const metadata: Metadata = {
  title: "따라하기 게임 · 품새 판정기",
  description:
    "화면이 교본 자세를 제시하고, 제한 시간 안에 맞추면 기존 판정 코어가 점수를 냅니다. 카메라 없이 합성 샘플로도 전부 시연됩니다.",
};

export default function GamePage() {
  return <FollowGame />;
}
