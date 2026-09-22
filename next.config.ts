import type { NextConfig } from "next";

/**
 * GitHub Pages 프로젝트 페이지는 /<repo> 아래에 붙는다.
 * 로컬 개발과 루트 도메인 배포에서는 basePath가 없어야 하므로
 * 환경변수가 있을 때만 켜지게 한다. (공식 배포 템플릿과 같은 방식)
 *
 *   PAGES_BASE_PATH=/poomsae-judge npm run build
 */
const basePath = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // 정적 내보내기: 서버 런타임 없이 out/ 만으로 배포된다.
  // 런타임 서버가 없으므로 비밀값이 배포물에 남을 자리도 없다.
  output: "export",

  // false면 out/judge.html 이 나와 Pages에서 /judge/ 가 404가 된다.
  trailingSlash: true,

  basePath: basePath || undefined,

  // 정적 내보내기에는 이미지 최적화 서버가 없다.
  images: { unoptimized: true },

  // 클라이언트 코드에서도 basePath를 알아야 샘플 JSON 경로를 만들 수 있다.
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
