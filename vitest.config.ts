import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 판정 코어는 DOM도 카메라도 쓰지 않는 순수 함수다.
 * 그래서 테스트 환경은 node 하나로 충분하고, jsdom 의존성을 두지 않는다.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
