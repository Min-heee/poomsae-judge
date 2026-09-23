/**
 * 카드를 PNG 파일로 꺼내는 층.
 *
 * 실측에서 나온 규칙 넷(docs/TECH-NOTES.md 12.1):
 *  1. **`toBlob` 을 쓴다.** `toDataURL` 은 같은 속도에 문자열이 33% 더 크다.
 *     그리고 `toBlob` 은 `null` 을 줄 수 있다 — 그 분기를 반드시 적는다.
 *  2. **첫 인코딩을 미리 깨워 둔다.** 콜드 스타트가 **1078ms** 였다. 기록 중이면
 *     그 한 번이 H3(120ms)를 넘겨 **라운드 점수를 통째로 날린다.**
 *  3. **`revokeObjectURL` 을 다음 태스크로 미룬다.** 취소가 돌아온 그 순간 URL이
 *     죽는 것을 실측했다. `click()` 직후에 취소하면 큰 PNG에서 저장이 실패할 수 있다.
 *  4. **`navigator.share` 는 보조 경로다.** 이 환경의 `canShare` 는 false 였고,
 *     HTTPS·사용자 활성화·권한 정책을 전부 요구한다. 기본은 내려받기다.
 */

import { CARD } from "./theme";
import type { CardData } from "./types";

/** 파일 이름에 넣어도 안전한 글자만 남긴다. */
export function safeFileName(text: string): string {
  return text
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const MOTION_SLUG: Record<string, string> = {
  stance: "stance",
  frontKick: "frontkick",
};

/**
 * 파일 이름. `poomsae-20260924-stance-0812.png`
 *
 * **일부러 라틴 문자만 쓴다.** 코스 이름을 한글로 넣으면 브라우저·운영체제·
 * 메신저를 건널 때마다 인코딩이 갈리고, 같은 카드가 기기마다 다른 이름으로 저장된다.
 * 대신 동작 슬러그를 넣어 무엇의 기록인지는 이름만 보고도 알 수 있게 했다.
 * 점수를 네 자리로 채우는 것은 파일 목록에서 정렬이 무너지지 않게 하려는 것이다.
 */
export function cardFileName(data: Pick<CardData, "dateText" | "motion" | "totalScore">): string {
  const date = safeFileName(data.dateText).replace(/-/g, "") || "nodate";
  const motion = MOTION_SLUG[data.motion] ?? "poomsae";
  const score = String(Math.max(0, Math.round(data.totalScore))).padStart(4, "0");
  return `poomsae-${date}-${motion}-${score}.png`;
}

/**
 * PNG 인코더를 미리 깨운다. 1×1 캔버스 한 번, 측정상 1ms 미만.
 * 게임 시작 버튼에서 부르면 카드 저장의 첫 1초가 사라진다.
 */
export function warmUpPngEncoder(): void {
  if (typeof document === "undefined") return;
  try {
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 1;
    cv.getContext("2d")?.fillRect(0, 0, 1, 1);
    cv.toBlob(() => {}, "image/png");
  } catch {
    // 인코더가 없으면 저장할 때 제대로 실패하면 된다. 여기서 막을 일은 아니다.
  }
}

/** 캔버스 → PNG Blob. `null` 과 다른 타입을 둘 다 거른다. */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("PNG 로 인코딩하지 못했습니다. 카드가 너무 크거나 메모리가 부족합니다."));
        return;
      }
      // 지원하지 않는 타입을 주면 브라우저가 조용히 PNG 로 바꾼다.
      // 우리는 처음부터 PNG 를 요청했으므로, 다른 타입이 오면 그게 이상한 것이다.
      if (blob.type !== "image/png") {
        reject(new Error(`PNG 가 아닌 형식으로 인코딩되었습니다: ${blob.type || "알 수 없음"}`));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

/**
 * 내려받기에 필요한 바깥 세계. 주입할 수 있게 열어 둔 이유는 하나다 —
 * **취소를 정말로 미루는지**를 시험으로 확인하기 위해서다.
 */
export interface DownloadEnv {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createAnchor(): { href: string; download: string; rel: string; click(): void };
  /** 다음 태스크로 미루는 방법. */
  defer(fn: () => void): void;
}

/** URL 을 얼마나 살려 둘 것인가. 저장 대화상자가 떠 있는 동안 죽으면 안 된다. */
export const REVOKE_DELAY_MS = 60_000;

export function browserDownloadEnv(): DownloadEnv {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement("a"),
    defer: (fn) => {
      window.setTimeout(fn, REVOKE_DELAY_MS);
    },
  };
}

/**
 * Blob 하나를 디스크로.
 *
 * `src/pose/transfer.ts` 의 `downloadText` 와 같은 구조이되 **취소 시점만 다르다.**
 * 거기는 300바이트 JSON 이라 `finally` 취소가 지금까지 문제가 없었지만,
 * 카드는 900 kB 짜리 PNG 다. 취소를 다음 태스크로 미룬다.
 */
export function downloadBlob(fileName: string, blob: Blob, env: DownloadEnv = browserDownloadEnv()): void {
  const url = env.createObjectURL(blob);
  const a = env.createAnchor();
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.click();
  env.defer(() => env.revokeObjectURL(url));
}

/**
 * 공유가 되면 공유하고, 안 되면 내려받는다.
 *
 * 순서가 중요하다 — `share` 는 "있으면 더 좋은 것"이지 기본 경로가 아니다.
 *
 * **취소와 실패를 가른다.** 예전에는 `share` 가 던지면 무조건 `"shared"` 를 돌려줬고,
 * 화면은 그때도 "공유 시트로 넘겼습니다"라고 적었다 — 아무 일도 일어나지 않았는데
 * 성공했다고 말하는 경로다. `canShare` 가 true 인데 `share` 가 거부되는 조합
 * (권한 정책·HTTPS 아님·인앱 브라우저)은 드물지 않다. 그래서
 *
 *   - 사용자가 시트를 닫았으면(`AbortError`) **아무것도 하지 않고** `"cancelled"`.
 *     취소한 사람에게 파일을 떠안기지 않는다.
 *   - 그 밖의 예외는 공유가 **실패한** 것이므로 내려받기로 떨어뜨리고 `"downloaded"`.
 */
export async function shareOrDownloadCard(
  fileName: string,
  blob: Blob,
): Promise<"shared" | "downloaded" | "cancelled"> {
  if (typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
    try {
      const file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "품새 판정 결과" });
        return "shared";
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return "cancelled";
      // 공유가 실패했다. 사용자는 카드를 원했으므로 내려받기로 떨어뜨린다.
    }
  }
  downloadBlob(fileName, blob);
  return "downloaded";
}

/** 카드 미리보기용 URL. 화면에 `<img>` 로 띄워 두면 모바일에서 길게 눌러 저장할 수 있다. */
export function previewUrl(blob: Blob): { url: string; revoke: () => void } {
  const url = URL.createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

/** 카드 이미지의 실제 픽셀 크기. 화면에 "2160×2700 PNG" 라고 적을 때 쓴다. */
export const CARD_PIXEL_SIZE = {
  width: CARD.width * CARD.scale,
  height: CARD.height * CARD.scale,
} as const;
