/**
 * 카드의 글자 — 글꼴 스택, 실측, 줄바꿈, 그리고 한글이 안 나올 때의 대비책.
 *
 * 규율 세 줄 (docs/TECH-NOTES.md 12.2):
 *  1. **웹폰트를 받지 않는다.** 시스템 스택만 쓴다 — 내려받기 0, FOUT 0,
 *     그리고 "외부 에셋을 내려받지 말 것"이라는 과제 규칙과 같은 방향이다.
 *  2. **x 좌표를 상수로 박지 않는다.** 글꼴이 기기마다 다르므로 글자 옆에 글자를
 *     놓을 때는 언제나 앞 글자의 실측 폭에서 이어 붙인다. 시안에서 실제로 겹쳤다.
 *  3. **`document.fonts.check()` 를 믿지 않는다.** 존재하지 않는 글꼴 이름에도
 *     `true` 를 돌려준다(실측). 알고 싶은 것은 "어떤 글꼴인가"가 아니라
 *     **"한글이 네모 상자로 나오는가"** 이고, 그건 픽셀로 잴 수 있다.
 */

/**
 * 시스템 글꼴 스택. `src/app/globals.css` 의 body 스택과 같은 계열을 쓴다 —
 * 화면과 카드의 글자가 다른 글꼴로 나오면 같은 결과로 안 보인다.
 */
export const FONT_STACK =
  'system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "Segoe UI", Roboto, sans-serif';

export function font(weight: number, sizePx: number): string {
  return `${weight} ${sizePx}px ${FONT_STACK}`;
}

/** 줄 간격. 라틴 기준 1.2em 을 쓰면 한글 받침이 아랫줄에 닿는다(실측 최소 1.19em). */
export const LINE_HEIGHT = 1.5;

export interface TextBox {
  width: number;
  ascent: number;
  descent: number;
}

/** 글자 한 덩이를 재는 함수. 브라우저에서는 `ctx.measureText`, 테스트에서는 추정기. */
export type Measure = (text: string, fontSpec: string) => TextBox;

const SIZE_RE = /(\d+(?:\.\d+)?)px/;

function sizeOf(fontSpec: string): number {
  const m = SIZE_RE.exec(fontSpec);
  return m ? Number(m[1]) : 16;
}

/**
 * 실측기가 없을 때 쓰는 추정기.
 *
 * 값은 이 맥에서 실제로 잰 비율에서 왔다(64px 기준: 한글 0.865em 안팎,
 * ascent 52.0/64 = 0.81em, descent 5.1/64 ≈ 0.08em — 받침이 있는 글자를 감안해
 * descent 는 넉넉히 0.22em 으로 잡는다).
 *
 * **레이아웃의 정답이 아니라 하한이다.** 브라우저에서는 진짜 `measureText` 가
 * 들어오고, 이 추정기는 (1) 서버 프리렌더처럼 캔버스가 없는 자리와
 * (2) 테스트에서 결정적인 기준자로 쓰인다.
 */
export function estimateMeasure(text: string, fontSpec: string): TextBox {
  const size = sizeOf(fontSpec);
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 32;
    if (ch === " ") em += 0.3;
    else if (code >= 0x1100 && code <= 0xd7ff) em += 1.0; // 한글·한자
    else if (code >= 0x3000 && code <= 0x30ff) em += 1.0; // 전각 기호·가나
    else if (ch >= "0" && ch <= "9") em += 0.56;
    else if (ch >= "A" && ch <= "Z") em += 0.66;
    else if (ch >= "a" && ch <= "z") em += 0.53;
    else em += 0.45;
  }
  return { width: em * size, ascent: size * 0.81, descent: size * 0.22 };
}

/**
 * 캔버스 컨텍스트로 만드는 실측기.
 *
 * `actualBoundingBox*` 가 없는 구현을 만나면 추정기의 값으로 떨어진다 —
 * 세로 정렬이 조용히 0이 되어 글자가 상자 밖으로 나가는 것보다 낫다.
 */
export function measurerFromContext(ctx: CanvasRenderingContext2D): Measure {
  return (text, fontSpec) => {
    ctx.font = fontSpec;
    const m = ctx.measureText(text);
    const fallback = estimateMeasure(text, fontSpec);
    const ascent = Number.isFinite(m.actualBoundingBoxAscent)
      ? m.actualBoundingBoxAscent
      : fallback.ascent;
    const descent = Number.isFinite(m.actualBoundingBoxDescent)
      ? m.actualBoundingBoxDescent
      : fallback.descent;
    return {
      width: Number.isFinite(m.width) ? m.width : fallback.width,
      // 받침 없는 글자에서 ascent 가 작게 나와도 줄 높이가 흔들리지 않게 글꼴 크기로 하한을 둔다.
      ascent: Math.max(ascent, sizeOf(fontSpec) * 0.7),
      descent: Math.max(descent, sizeOf(fontSpec) * 0.2),
    };
  };
}

/**
 * 폭에 맞게 잘라 낸다. 넘치면 뒤를 버리고 `...` 을 붙인다.
 *
 * 말줄임표는 `…`(U+2026) 이 아니라 마침표 셋이다 — 한글이 안 나오는 환경은
 * 라틴 글리프만 있는 환경일 수 있고, 거기서 `…` 도 네모가 될 수 있다.
 *
 * 이 함수가 레이아웃의 마지막 안전망이다. 카드의 모든 글자가 여기를 지나므로
 * "긴 한국어 항목 이름 때문에 카드 밖으로 삐져나갔다"가 구조적으로 불가능해진다.
 */
export function fitText(text: string, maxWidth: number, fontSpec: string, measure: Measure): string {
  if (maxWidth <= 0) return "";
  if (measure(text, fontSpec).width <= maxWidth) return text;

  const ell = "...";
  const ellW = measure(ell, fontSpec).width;
  if (ellW > maxWidth) return "";

  const chars = [...text];
  let out = "";
  for (const ch of chars) {
    const next = out + ch;
    if (measure(next, fontSpec).width + ellW > maxWidth) break;
    out = next;
  }
  return out.length === 0 ? ell : out + ell;
}

/**
 * 여러 줄로 접는다.
 *
 * 한글은 글자 단위로 끊어도 읽히므로 단어 래퍼가 필요 없다. 다만 **숫자와 단위**
 * (`142.6°`, `1.70~2.30`, `A1`)는 끊기면 뜻이 달라지므로 분리 금지 토큰으로 묶는다.
 * 라틴 낱말도 같은 토큰 규칙에 태워 중간에서 잘리지 않게 한다.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSpec: string,
  measure: Measure,
  maxLines = 3,
): string[] {
  if (maxWidth <= 0 || text.length === 0) return [];

  const tokens = tokenize(text);
  const lines: string[] = [];
  let line = "";

  const push = () => {
    if (line.length > 0) lines.push(line);
    line = "";
  };

  for (const tk of tokens) {
    if (tk === " " && line.length === 0) continue;
    const candidate = line + tk;
    if (measure(candidate, fontSpec).width <= maxWidth || line.length === 0) {
      line = candidate;
      continue;
    }
    push();
    if (lines.length >= maxLines) break;
    line = tk === " " ? "" : tk;
  }
  if (lines.length < maxLines) push();

  if (lines.length === 0) return [];
  if (lines.length > maxLines) lines.length = maxLines;
  // 분리 금지 토큰 하나가 폭보다 길면 그 줄은 여전히 넘친다. 모든 줄을 한 번 더 자른다 —
  // 이 한 줄이 "카드 밖으로 안 나간다"를 보장한다.
  return lines.map((l) => fitText(l, maxWidth, fontSpec, measure));
}

/** 분리 금지 토큰: 수·단위·라틴 낱말은 한 덩이, 한글은 한 글자씩, 공백은 그대로. */
function tokenize(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.length > 0) out.push(buf);
    buf = "";
  };
  for (const ch of text) {
    const glued = /[0-9A-Za-z.,~/·°±+\-−]/.test(ch);
    if (glued) {
      buf += ch;
      continue;
    }
    flush();
    out.push(ch);
  }
  flush();
  return out;
}

/* ── 한글이 네모 상자로 떨어지는 환경인가 ─────────────────────────── */

/**
 * 60×60 캔버스 두 장으로 두부(tofu)를 가려낸다.
 *
 * 사용자 영역 문자(U+E000)는 어떤 글꼴에도 글리프가 없어 **반드시** 두부로 그려진다.
 * 한글 한 글자를 같은 조건으로 그려 잉크 양이 확연히 다르면 진짜 글리프다.
 *
 * 브라우저 API를 함수 **안**에서만 만진다 — 모듈 최상단에서 건드리면
 * 정적 내보내기의 프리렌더가 깨진다(TECH-NOTES 4.4).
 * 확인할 수 없는 환경에서는 `true`(한글이 나온다)로 답한다. 알 수 없다는 이유로
 * 한글을 버리면 잘 나오는 기기에서까지 카드가 라틴으로 나온다.
 */
export function hangulRenders(fontStack: string = FONT_STACK): boolean {
  if (typeof document === "undefined") return true;
  try {
    const cv = document.createElement("canvas");
    cv.width = 60;
    cv.height = 60;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    if (!cx) return true;

    const ink = (t: string): number => {
      cx.fillStyle = "#000";
      cx.fillRect(0, 0, 60, 60);
      cx.fillStyle = "#fff";
      cx.font = `700 40px ${fontStack}`;
      cx.textBaseline = "middle";
      cx.fillText(t, 2, 30);
      const d = cx.getImageData(0, 0, 60, 60).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 32) n += 1;
      return n;
    };

    const hangul = ink("한");
    const tofu = ink("");
    if (tofu === 0) return true; // 두부조차 안 그려지면 판단 근거가 없다.
    return Math.abs(hangul - tofu) > tofu * 0.1;
  } catch {
    return true;
  }
}

/* ── 한글이 안 나올 때 쓸 문자열 ──────────────────────────────────── */

/**
 * 카드의 모든 고정 문구. 한글이 안 나오는 환경에서는 라틴으로 통째로 바뀐다.
 *
 * 폴백이 성립하는 이유는 이 카드의 **알맹이가 원래 숫자와 기호**이기 때문이다 —
 * 점수 `812`, 원점수 `9.7 / 10.0`, 측정값 `1.48·S`, 경계값 `1.70 / 2.30`,
 * 규칙 ID `A1`~`A5`·`B1`~`B7`, 그리고 스켈레톤 그림. 한글로만 말하는 것은
 * 제목·항목 이름·면책 한 줄뿐이라, 그것만 갈아 끼우면 카드는 여전히 판정서로 읽힌다.
 */
export interface CardStrings {
  title: string;
  totalUnit: string;
  avgBase: string;
  roundShort: string;
  withheld: string;
  bestRound: string;
  rawScore: string;
  bounds: string;
  measured: string;
  reference: string;
  mine: string;
  rulesLabel: string;
  originLabel: string;
  disclaimer: string;
  noDeduction: string;
  /** 그림의 배율이 무엇에 맞춰졌는지. 판정의 어깨 폭 S 와 다르다는 사실을 숨기지 않는다. */
  scaleNote: string;
}

const KO: CardStrings = {
  title: "품새 판정 결과",
  totalUnit: "점",
  avgBase: "기본점 평균",
  roundShort: "라운드",
  withheld: "보류",
  bestRound: "가장 잘 맞은 라운드",
  rawScore: "원점수",
  bounds: "경계",
  measured: "측정",
  reference: "교본",
  mine: "내 자세",
  rulesLabel: "규칙표",
  originLabel: "입력",
  disclaimer: "개인 학습용 데모입니다. 공인 기준이 아니며 어떤 단체의 채점표도 아닙니다.",
  noDeduction: "감점 항목이 없습니다.",
  scaleNote: "그림 배율 = 몸통 길이 기준",
};

const LATIN: CardStrings = {
  title: "POOMSAE JUDGE",
  totalUnit: "pts",
  avgBase: "AVG BASE",
  roundShort: "R",
  withheld: "HOLD",
  bestRound: "BEST ROUND",
  rawScore: "RAW",
  bounds: "bounds",
  measured: "value",
  reference: "REF",
  mine: "YOU",
  rulesLabel: "RULES",
  originLabel: "INPUT",
  disclaimer: "personal practice demo - not an official score of any organization",
  noDeduction: "no deduction",
  scaleNote: "drawing scale = torso length",
};

export function cardStrings(hangulOk: boolean): CardStrings {
  return hangulOk ? KO : LATIN;
}

/**
 * 한글이 안 나오는 환경에서 동작 이름을 대신할 라틴 이름.
 * 규칙 ID 대역을 같이 적어 카드만 보고도 어느 규칙표인지 알 수 있게 한다.
 */
export const MOTION_LATIN: Record<string, string> = {
  stance: "STANCE / A1-A5",
  frontKick: "FRONT KICK / B1-B7",
};
