import { Studio } from "@/components/Studio";

/**
 * 첫 화면 = 판정 화면.
 *
 * 랜딩 페이지를 따로 두지 않는다. 심사위원이 링크를 열었을 때 클릭 두 번 안에
 * 판정 카드까지 닿아야 한다(docs/PRD.md 3절). 이 파일은 서버 컴포넌트로 남고,
 * 브라우저 API를 만지는 것은 전부 Studio 안의 클라이언트 경계 뒤에 있다.
 */
export default function Home() {
  return <Studio />;
}
