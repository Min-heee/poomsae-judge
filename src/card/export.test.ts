/**
 * 파일로 꺼내기 — 이름 규칙과 `revokeObjectURL` 의 시점.
 *
 * 취소 시점을 시험하는 이유: 실측에서 `revokeObjectURL` 이 돌아온 **그 순간**
 * URL 이 죽었다(docs/TECH-NOTES.md 12.1 ㄹ). `click()` 직후에 취소하면
 * 900 kB PNG 에서 저장이 실패할 수 있다. "미룬다"는 주석이 아니라 시험이어야 한다.
 */

import { describe, expect, it, vi } from "vitest";

import { cardFileName, downloadBlob, safeFileName, type DownloadEnv } from "./export";
import { sanitizeCardData } from "./sanitize";
import { cardInput } from "./fixtures";

describe("파일 이름", () => {
  it("날짜·동작·점수가 들어가고 전부 라틴이다", () => {
    const data = sanitizeCardData(cardInput());
    expect(cardFileName(data)).toBe("poomsae-20260924-stance-0812.png");
  });

  it("앞차기는 다른 슬러그를 받는다", () => {
    const data = sanitizeCardData(cardInput({ motion: "frontKick", totalScore: 640 }));
    expect(cardFileName(data)).toBe("poomsae-20260924-frontkick-0640.png");
  });

  it("점수를 네 자리로 채운다 — 파일 목록에서 정렬이 무너지지 않게", () => {
    expect(cardFileName(sanitizeCardData(cardInput({ totalScore: 7 })))).toContain("-0007.png");
  });

  it("날짜가 없으면 이름이 흔들리지 않게 고정 문자열을 쓴다", () => {
    const data = sanitizeCardData(cardInput({ dateISO: "언젠가" }));
    expect(cardFileName(data)).toBe("poomsae-nodate-stance-0812.png");
  });

  it("같은 카드는 언제나 같은 이름이다", () => {
    const data = sanitizeCardData(cardInput());
    expect(cardFileName(data)).toBe(cardFileName(data));
  });

  it("경로 문자와 한글은 이름에서 걸러진다", () => {
    expect(safeFileName("정면/코스\\2026")).toBe("2026");
    expect(safeFileName("a b..c")).toBe("a-b..c");
    expect(safeFileName("--")).toBe("");
  });
});

describe("내려받기", () => {
  function fakeEnv() {
    const calls: string[] = [];
    let deferred: (() => void) | null = null;
    const anchor = {
      href: "",
      download: "",
      rel: "",
      click: () => calls.push("click"),
    };
    const env: DownloadEnv = {
      createObjectURL: () => {
        calls.push("create");
        return "blob:fake";
      },
      revokeObjectURL: () => calls.push("revoke"),
      createAnchor: () => anchor,
      defer: (fn) => {
        calls.push("defer");
        deferred = fn;
      },
    };
    return { env, calls, anchor, run: () => deferred?.() };
  }

  it("취소는 click 과 같은 태스크에서 일어나지 않는다", () => {
    const f = fakeEnv();
    downloadBlob("card.png", new Blob(["x"]), f.env);
    expect(f.calls).toEqual(["create", "click", "defer"]);
    expect(f.calls).not.toContain("revoke");
  });

  it("미뤄 둔 일이 실제로 취소를 부른다 — 영원히 새지 않는다", () => {
    const f = fakeEnv();
    downloadBlob("card.png", new Blob(["x"]), f.env);
    f.run();
    expect(f.calls[f.calls.length - 1]).toBe("revoke");
  });

  it("앵커에 파일 이름과 rel 이 실린다", () => {
    const f = fakeEnv();
    downloadBlob("poomsae-20260924-stance-0812.png", new Blob(["x"]), f.env);
    expect(f.anchor.download).toBe("poomsae-20260924-stance-0812.png");
    expect(f.anchor.href).toBe("blob:fake");
    expect(f.anchor.rel).toBe("noopener");
  });

  it("클릭은 정확히 한 번", () => {
    const f = fakeEnv();
    const spy = vi.spyOn(f.anchor, "click");
    downloadBlob("card.png", new Blob(["x"]), f.env);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
