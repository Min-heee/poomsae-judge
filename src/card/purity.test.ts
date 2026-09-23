/**
 * 카드가 결정적이라는 약속을 **소스에서** 지킨다.
 *
 * 해시 비교는 "이번에 두 번 불렀더니 같았다"만 말한다. 시계나 난수나 화면 배율이
 * 코드 어딘가에 들어오면 그 시험은 같은 프로세스 안에서 여전히 통과하면서
 * 내일 다른 기기에서 다른 파일을 낸다. 그래서 **들어올 수 없게** 못 박는다.
 *
 * 특히 `devicePixelRatio` — 카드 배율을 DPR 로 정하면 같은 판정이 노트북에서
 * 2160px, 외장 모니터에서 1080px 로 나온다(docs/TECH-NOTES.md 12.1 ㄴ).
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = dirname(fileURLToPath(import.meta.url));

function sources(): { name: string; code: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((name) => ({ name, code: readFileSync(join(DIR, name), "utf8") }));
}

/** 주석과 문자열을 빼고 진짜 코드만 본다 — 이 파일의 설명문에 걸리지 않게. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/** 순수해야 하는 파일 — DOM 도 시계도 난수도 없다. */
const PURE = ["types.ts", "ops.ts", "sanitize.ts", "skeleton.ts", "layout.ts", "theme.ts", "fixtures.ts"];

describe("카드는 결정적이다 — 소스에 비결정성이 없다", () => {
  it("어느 파일도 devicePixelRatio 를 읽지 않는다", () => {
    for (const { name, code } of sources()) {
      expect(`${name}: ${codeOnly(code).includes("devicePixelRatio")}`).toBe(`${name}: false`);
    }
  });

  it("어느 파일도 시계를 읽지 않는다 — 날짜는 호출자가 넘긴다", () => {
    for (const { name, code } of sources()) {
      const c = codeOnly(code);
      expect(`${name}: ${c.includes("Date.now") || c.includes("new Date")}`).toBe(`${name}: false`);
      expect(`${name}: ${c.includes("performance.now")}`).toBe(`${name}: false`);
    }
  });

  it("어느 파일도 난수를 쓰지 않는다", () => {
    for (const { name, code } of sources()) {
      expect(`${name}: ${codeOnly(code).includes("Math.random")}`).toBe(`${name}: false`);
    }
  });
});

describe("순수 층에는 DOM 이 없다", () => {
  it.each(PURE)("%s 은 document·window·navigator 를 만지지 않는다", (name) => {
    const code = codeOnly(readFileSync(join(DIR, name), "utf8"));
    for (const api of ["document.", "window.", "navigator.", "getContext", "HTMLCanvas"]) {
      expect(`${name} ${api}: ${code.includes(api)}`).toBe(`${name} ${api}: false`);
    }
  });

  it("DOM 을 만지는 파일은 셋뿐이다 — 시험할 수 없는 면적을 좁혀 둔다", () => {
    const touching = sources()
      .filter(({ code }) => {
        const c = codeOnly(code);
        return c.includes("document.") || c.includes("navigator.") || c.includes("window.");
      })
      .map(({ name }) => name)
      .sort();
    expect(touching).toEqual(["export.ts", "paint.ts", "text.ts"]);
  });
});

describe("판정 규칙을 건드리지 않는다", () => {
  it("카드 층은 판정 상수를 읽기만 한다 — 새 경계값을 정의하지 않는다", () => {
    for (const { name, code } of sources()) {
      const c = codeOnly(code);
      // 감점 값·보류 문턱을 카드가 다시 적으면 상수가 두 벌이 된다.
      expect(`${name}: ${/DEDUCTION\s*=/.test(c) || /WITHHOLD\s*=/.test(c)}`).toBe(`${name}: false`);
      expect(`${name}: ${c.includes("judgeSequence")}`).toBe(`${name}: false`);
    }
  });
});
