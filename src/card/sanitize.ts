/**
 * 카드에 들어갈 것을 **골라 담는** 한 겹.
 *
 * 레이아웃은 `CardInput` 을 직접 읽지 않는다. 반드시 이 함수를 지난 `CardData` 만
 * 읽는다. 이유는 하나다 — 카드에 무엇이 들어가는지가 **한 파일에서 전부 보여야**
 * "개인정보는 넣지 않는다"가 검사 가능한 약속이 되기 때문이다.
 *
 * 여기서 하는 일 네 가지:
 *  1. **허용 목록 투영.** 아는 필드만 새 객체로 옮겨 담는다. 호출자가 실수로
 *     이름·아이디·영상 URL 같은 것을 끼워 넣어도 그 필드는 정제 결과에 없다.
 *  2. **얼굴 랜드마크(0~10) 제거.** 머리는 어깨에서 유도한 원 하나로 그린다.
 *  3. **숫자 고정.** NaN·Infinity·범위 밖 값이 레이아웃에 닿지 않게 한다 —
 *     좌표 하나가 NaN 이면 그림 전체가 사라진다.
 *  4. **글자 길이 상한.** 카드는 폭이 정해진 종이다. 문자열 상한을 여기서 두고,
 *     남은 넘침은 레이아웃의 `fitText` 가 잡는다.
 */

import { LANDMARK_COUNT } from "@/judge/landmarks";
import { formatMeasure } from "@/pose/display";
import type { CriterionResult } from "@/judge/types";
import type {
  BodyPoint,
  CardData,
  CardDeductionLine,
  CardInput,
  CardPoint,
  CardRound,
  CardSkeletonInput,
} from "./types";

/**
 * 카드가 그리는 첫 랜드마크 번호.
 * 0~10은 코·눈·귀·입이다. **이 상수 아래는 카드에 들어갈 수 없다.**
 */
export const FIRST_BODY_LANDMARK = 11;

/** 카드에 찍는 감점 줄 수. PRD-game 5.4가 "감점 두 줄"이라고 적었다. */
export const MAX_DEDUCTION_LINES = 2;

/** 라운드 막대 최대 개수. 한 판은 5라운드지만 상한을 두어 레이아웃을 지킨다. */
export const MAX_ROUND_BARS = 8;

const MAX_LABEL_CHARS = 48;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

/**
 * 제어문자를 걷어내고 길이를 자른다.
 *
 * 줄바꿈·탭이 그대로 캔버스에 가면 `fillText` 는 그것을 네모로 그린다.
 * 카드의 모든 문자열이 이 함수를 지난다.
 */
export function safeText(v: unknown, maxChars = MAX_LABEL_CHARS): string {
  if (typeof v !== "string") return "";
  const cleaned = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  return [...cleaned].slice(0, maxChars).join("");
}

/**
 * 얼굴을 버리고 몸통만 남긴다.
 *
 * 정규화 이미지 좌표는 0~1이 화면 안이지만, 검출기는 화면 밖 값도 낸다.
 * 여기서 자르지 않는 이유는 **자르면 자세가 왜곡되기 때문**이다 —
 * 캔버스 밖으로 나가지 않게 하는 일은 `skeleton.ts` 의 맞춤 변환이 맡고,
 * 이 함수는 "유한한 수인가"만 본다.
 */
export function stripFace(points: readonly CardPoint[] | null | undefined): BodyPoint[] {
  if (!Array.isArray(points)) return [];
  const out: BodyPoint[] = [];
  const upper = Math.min(points.length, LANDMARK_COUNT);
  for (let i = FIRST_BODY_LANDMARK; i < upper; i += 1) {
    const p = points[i];
    if (!p || typeof p.x !== "number" || typeof p.y !== "number") continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    out.push({ i, x: p.x, y: p.y });
  }
  return out;
}

function sanitizeSkeleton(s: CardSkeletonInput | null | undefined): CardData["skeleton"] {
  const mine = stripFace(s?.mine);
  const ref = stripFace(s?.reference);
  return {
    mine,
    reference: ref.length > 0 ? ref : null,
    aspect: num(s?.aspect, 0.2, 5, 4 / 3),
  };
}

/**
 * 카드에 적을 감점 줄을 고른다.
 *
 * 순서: 큰 감점 → 작은 감점 → 항목 보류 → 규칙 ID 순.
 * 합격 항목은 넣지 않는다 — 카드에 자리가 두 줄뿐이고, 사람이 알고 싶은 것은
 * "어디서 깎였나"이기 때문이다. 대신 원점수와 만점을 같이 띄워
 * 깎인 총량은 언제나 드러난다.
 *
 * 값과 경계를 **함께** 넣는 것은 이 프로젝트의 원칙이다("점수 옆에 언제나
 * 측정값과 경계값"). 숫자 형식은 화면과 같은 `formatMeasure` 를 쓴다 —
 * 카드와 화면이 같은 값을 다르게 적으면 둘 중 하나는 거짓말이 된다.
 */
export function pickDeductionLines(
  criteria: readonly CriterionResult[] | null | undefined,
  limit = MAX_DEDUCTION_LINES,
): CardDeductionLine[] {
  if (!Array.isArray(criteria)) return [];

  const flagged = criteria.filter((c) => c && (c.deduction > 0 || c.grade === "withheld"));
  const sorted = [...flagged].sort((a, b) => {
    if (b.deduction !== a.deduction) return b.deduction - a.deduction;
    const aw = a.grade === "withheld" ? 1 : 0;
    const bw = b.grade === "withheld" ? 1 : 0;
    if (aw !== bw) return aw - bw;
    return String(a.id).localeCompare(String(b.id));
  });

  return sorted.slice(0, Math.max(0, limit)).map((c) => ({
    id: safeText(c.id, 6) || "?",
    title: safeText(c.title, 24),
    measuredText: formatMeasure(
      typeof c.measured === "number" && Number.isFinite(c.measured) ? c.measured : null,
      c.unit,
    ),
    boundsText: formatBoundaries(c),
    deduction: num(c.deduction, 0, 10, 0),
    withheld: c.grade === "withheld",
  }));
}

/**
 * 경계값 줄. `1.50 / 1.70 / 2.30 / 2.60·S`
 *
 * 단위를 **마지막에 한 번만** 붙인다. 네 번 반복하면 카드에서 가장 좁은 줄이
 * 33자로 불어나 이름·측정값과 자리를 다투고, 결국 셋 다 잘린다.
 * 자릿수와 단위 기호 자체는 화면과 같은 `formatMeasure` 에서 온다.
 */
function formatBoundaries(c: CriterionResult): string {
  const bounds = Array.isArray(c.boundaries) ? c.boundaries.filter((b) => Number.isFinite(b)) : [];
  if (bounds.length === 0) return "—";
  const texts = bounds.map((b) => formatMeasure(b, c.unit));
  const suffix = formatMeasure(0, c.unit).replace(/^[-\d.]+/, "");
  if (suffix.length === 0) return texts.join(" / ");
  return texts.map((t, i) => (i === texts.length - 1 ? t : t.slice(0, -suffix.length))).join(" / ");
}

function sanitizeRounds(rounds: CardInput["rounds"]): CardRound[] {
  if (!Array.isArray(rounds)) return [];
  return rounds.slice(0, MAX_ROUND_BARS).map((r, idx) => {
    const withheld = !r || r.baseScore === null || typeof r.baseScore !== "number";
    return {
      number: idx + 1,
      baseScore: withheld ? null : num(r.baseScore, 0, 100, 0),
      total: num(r?.total, 0, 999, 0),
      withheld,
    };
  });
}

/**
 * 호출자가 준 것 중 **아는 것만** 새 객체로 옮겨 담는다.
 *
 * 입력 객체를 그대로 들고 가지 않는 것이 핵심이다. 스프레드(`...input`)를 쓰면
 * 모르는 필드가 따라 들어오고, 그 순간 이 경계선이 사라진다.
 */
export function sanitizeCardData(input: CardInput): CardData {
  const maxScore = num(input?.best?.maxScore, 0.1, 1000, 10);
  const raw = input?.best?.rawScore;
  const rawOk = typeof raw === "number" && Number.isFinite(raw);

  return {
    courseLabel: safeText(input?.courseLabel) || "—",
    motion: input?.motion === "frontKick" ? "frontKick" : "stance",
    totalScore: Math.round(num(input?.totalScore, 0, 99999, 0)),
    averageBase: Math.round(num(input?.averageBase, 0, 100, 0)),
    stars: Math.round(num(input?.stars, 0, 3, 0)),
    rounds: sanitizeRounds(input?.rounds),
    bestRoundNumber: Math.round(num(input?.best?.roundNumber, 1, MAX_ROUND_BARS, 1)),
    rawScoreText: rawOk ? num(raw, 0, maxScore, 0).toFixed(1) : "—",
    maxScoreText: maxScore.toFixed(1),
    deductions: pickDeductionLines(input?.best?.criteria),
    skeleton: sanitizeSkeleton(input?.best?.skeleton),
    dateText: DATE_RE.test(String(input?.dateISO ?? "")) ? String(input.dateISO) : "—",
    rulesVersion: safeText(input?.rulesVersion, 24) || "—",
    originLabel: safeText(input?.originLabel, 24) || "—",
  };
}
