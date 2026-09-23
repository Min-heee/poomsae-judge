/**
 * 카드의 색과 치수.
 *
 * 색은 `src/app/globals.css` 의 토큰과 `src/pose/draw2d.ts` 의 `DARK_THEME` 에서
 * 그대로 옮겨 적은 값이다. 캔버스는 CSS 변수를 읽을 수 없어 사본이 생기는데,
 * 이미 `draw2d.ts` 가 같은 이유로 같은 사본을 들고 있다 —
 * **새 색을 만들지 않는 것**으로 두 벌이 갈라지는 것을 막는다.
 * 카드에 쓰인 색은 전부 화면 어딘가에 이미 있는 색이다.
 */

export const CARD_COLORS = {
  /** 배경 그러데이션 — --bg 에서 --surface 로. */
  bgTop: "#0b0e13",
  bgBottom: "#131a24",
  surface: "#131a24",
  surface2: "#1b2431",
  line: "#26303d",
  lineBright: "#3a4756",
  fg: "#e9eff7",
  muted: "#a3b4c8",
  brand: "#7aa2f7",
  brandDim: "#4e6fae",
  ok: "#56d98a",
  warn: "#f2c15b",
  bad: "#f78787",
  hold: "#c29bf5",
  /** 스켈레톤 — draw2d.ts DARK_THEME 과 같은 값. */
  bone: "#3d4a5c",
  boneCore: "#8ab4f8",
  joint: "#5b6b80",
  jointCore: "#cfe1ff",
} as const;

/**
 * 카드 크기. 4:5 세로 — 대부분의 메신저와 소셜에서 잘리지 않는 비율이다.
 *
 * **배율은 상수 2다. `devicePixelRatio` 를 쓰지 않는다.**
 * DPR 로 정하면 같은 판정이 노트북에서 2160px, 외장 모니터에서 1080px 로 나와
 * 파일이 기기마다 달라진다. "같은 입력이면 같은 결과"가 카드에서 깨지는 자리다
 * (docs/TECH-NOTES.md 12.1 ㄴ).
 */
export const CARD = {
  width: 1080,
  height: 1350,
  scale: 2,
  margin: 72,
} as const;

/** 본문 폭. 좌우 여백을 뺀 값이라 모든 줄이 이 폭 안에서 끝나야 한다. */
export const CONTENT_WIDTH = CARD.width - CARD.margin * 2;
