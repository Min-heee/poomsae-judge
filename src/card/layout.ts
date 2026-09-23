/**
 * 카드 한 장의 배치. **순수 함수다** — 캔버스도, DOM도, 시계도, 난수도 없다.
 *
 * 들어오는 것은 정제된 `CardData` 와 글자 실측 함수 하나, 나오는 것은 명령 목록이다.
 * 그래서 같은 입력이면 같은 명령이 나오고, 그 명령을 해시로 떠서 결정성을 증명한다.
 *
 * 배치 규율:
 *  - **x 를 상수로 박지 않는다.** 글자 옆에 글자를 놓을 때는 앞 글자의 실측 폭에서
 *    이어 붙인다(`run`). 글꼴이 다른 기기에서 겹치는 것을 막는 유일한 방법이다.
 *  - **모든 글자는 `fit` 이나 `wrap` 을 지난다.** 폭을 넘기면 잘라 낸다.
 *    카드 밖으로 삐져나간 글자는 잘린 글자보다 나쁘다.
 *  - **한글이 안 나오는 환경이면 고정 문구를 통째로 라틴으로 바꾼다.** 점수·측정값·
 *    경계값·규칙 ID 는 원래 라틴이라, 그것만 바꾸면 카드는 여전히 판정서로 읽힌다.
 */

import type { CardOp, TextOp } from "./ops";
import { skeletonOps, type Box } from "./skeleton";
import { CARD, CARD_COLORS as C, CONTENT_WIDTH } from "./theme";
import {
  cardStrings,
  estimateMeasure,
  fitText,
  font,
  LINE_HEIGHT,
  MOTION_LATIN,
  wrapText,
  type Measure,
} from "./text";
import type { CardData, CardDeductionLine } from "./types";

/**
 * 세로 구획. 한 곳에 모아 둔다 — 구획이 겹치는지 눈으로 셀 수 있어야 하고,
 * 테스트가 "아무것도 카드 밖으로 안 나간다"를 검사하기 전에 여기서 먼저 막는다.
 */
const G = {
  headerTitleBase: 118,
  headerCourseBase: 158,
  headerRule: 180,

  scoreBase: 306,
  starsCenterY: 252,
  starRadius: 27,
  starGap: 16,
  avgBase: 338,
  heroRule: 374,

  barsCaptionBase: 416,
  barsTop: 430,
  barsHeight: 64,
  barsLabelBase: 518,

  panelTop: 548,
  panelHeight: 458,

  deductCaptionBase: 1046,
  deductRowTop: 1060,
  deductRowHeight: 64,
  deductRowGap: 12,

  footerMetaBase: 1252,
  footerNoteBase: 1290,
} as const;

const F = {
  title: font(700, 36),
  course: font(600, 28),
  date: font(500, 26),
  score: font(800, 128),
  scoreUnit: font(600, 40),
  avgLabel: font(500, 24),
  avgValue: font(700, 30),
  caption: font(600, 22),
  barLabel: font(600, 20),
  panelCaption: font(600, 22),
  roundBig: font(700, 46),
  rawLabel: font(500, 24),
  rawValue: font(800, 58),
  rawMax: font(600, 28),
  legend: font(500, 20),
  chip: font(700, 24),
  deductTitle: font(600, 26),
  deductValue: font(600, 24),
  deductBounds: font(500, 22),
  deductAmount: font(700, 28),
  footer: font(600, 20),
  note: font(500, 20),
} as const;

export interface LayoutOptions {
  /** 글자 실측기. 없으면 추정기를 쓴다(테스트·프리렌더). */
  measure?: Measure;
  /** 한글이 제대로 그려지는 환경인가. `false` 면 고정 문구가 라틴으로 바뀐다. */
  hangulOk?: boolean;
}

/** 명령을 쌓고, 글자 폭을 재고, 이어 붙이는 작은 도구. */
class Sheet {
  readonly ops: CardOp[] = [];

  constructor(private readonly measure: Measure) {}

  /** 한 덩이를 놓고 **실측 폭**을 돌려준다. 다음 글자의 x 는 이 값에서 나온다. */
  text(x: number, baseline: number, text: string, fontSpec: string, fill: string, alpha?: number): number {
    if (text.length === 0) return 0;
    const m = this.measure(text, fontSpec);
    const op: TextOp = {
      op: "text",
      x,
      y: baseline,
      text,
      font: fontSpec,
      fill,
      w: m.width,
      ascent: m.ascent,
      descent: m.descent,
    };
    if (alpha !== undefined) op.alpha = alpha;
    this.ops.push(op);
    return m.width;
  }

  width(text: string, fontSpec: string): number {
    return text.length === 0 ? 0 : this.measure(text, fontSpec).width;
  }

  fit(text: string, maxWidth: number, fontSpec: string): string {
    return fitText(text, maxWidth, fontSpec, this.measure);
  }

  wrap(text: string, maxWidth: number, fontSpec: string, maxLines = 2): string[] {
    return wrapText(text, maxWidth, fontSpec, this.measure, maxLines);
  }

  /** 여러 덩이를 이어 붙인다. 상수 x 를 쓰지 않기 위한 기본 도구. */
  run(
    x: number,
    baseline: number,
    parts: readonly { text: string; font: string; fill: string; gap?: number; alpha?: number }[],
  ): number {
    let cx = x;
    for (const p of parts) {
      cx += p.gap ?? 0;
      cx += this.text(cx, baseline, p.text, p.font, p.fill, p.alpha);
    }
    return cx - x;
  }

  /** 오른쪽 끝을 맞춰 이어 붙인다. 폭을 먼저 다 재고 시작점을 계산한다. */
  runRight(
    rightX: number,
    baseline: number,
    parts: readonly { text: string; font: string; fill: string; gap?: number; alpha?: number }[],
  ): number {
    let total = 0;
    for (const p of parts) total += (p.gap ?? 0) + this.width(p.text, p.font);
    this.run(rightX - total, baseline, parts);
    return total;
  }

  push(...ops: CardOp[]): void {
    this.ops.push(...ops);
  }
}

/** 5각 별 한 개. 외부 아이콘·폰트 글리프를 쓰지 않으려고 좌표로 그린다. */
export function starPoints(cx: number, cy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  const inner = r * 0.44;
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 === 0 ? r : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  return pts;
}

function hr(sheet: Sheet, y: number, alpha = 1): void {
  sheet.push({
    op: "line",
    x1: CARD.margin,
    y1: y,
    x2: CARD.margin + CONTENT_WIDTH,
    y2: y,
    stroke: C.line,
    lineWidth: 2,
    alpha,
  });
}

/** 카드 한 장의 명령 목록. */
export function buildCardOps(data: CardData, opts: LayoutOptions = {}): CardOp[] {
  const measure = opts.measure ?? estimateMeasure;
  const hangulOk = opts.hangulOk !== false;
  const S = cardStrings(hangulOk);
  const sheet = new Sheet(measure);
  const left = CARD.margin;
  const right = CARD.margin + CONTENT_WIDTH;

  /* 배경 — 화면(--bg → --surface)과 같은 어두운 면. */
  sheet.push({
    op: "grad",
    x: 0,
    y: 0,
    w: CARD.width,
    h: CARD.height,
    stops: [
      [0, C.bgTop],
      [0.55, C.bgTop],
      [1, C.bgBottom],
    ],
  });
  sheet.push({ op: "rect", x: 0, y: 0, w: CARD.width, h: 6, fill: C.brand, alpha: 0.9 });

  /* 머리말 — 제목 · 코스 · 날짜 */
  const courseLabel = hangulOk ? data.courseLabel : (MOTION_LATIN[data.motion] ?? data.motion);
  const dateW = sheet.width(data.dateText, F.date);
  sheet.text(left, G.headerTitleBase, sheet.fit(S.title, CONTENT_WIDTH - dateW - 32, F.title), F.title, C.fg);
  sheet.text(right - dateW, G.headerTitleBase, data.dateText, F.date, C.muted);
  sheet.text(left, G.headerCourseBase, sheet.fit(courseLabel, CONTENT_WIDTH, F.course), F.course, C.brand);
  hr(sheet, G.headerRule);

  /* 큰 점수 — 총점 + 단위. 단위 x 는 반드시 실측에서 나온다. */
  sheet.run(left, G.scoreBase, [
    { text: String(data.totalScore), font: F.score, fill: C.fg },
    { text: S.totalUnit, font: F.scoreUnit, fill: C.muted, gap: 14 },
  ]);

  /* 별 등급 — 좌표로 그린다. */
  const starTotal = 3 * G.starRadius * 2 + 2 * G.starGap;
  let starX = right - starTotal + G.starRadius;
  for (let i = 0; i < 3; i += 1) {
    const earned = i < data.stars;
    sheet.push({
      op: "poly",
      points: starPoints(starX, G.starsCenterY, G.starRadius),
      fill: earned ? C.warn : undefined,
      stroke: earned ? undefined : C.lineBright,
      lineWidth: 3,
      alpha: earned ? 1 : 0.8,
    });
    starX += G.starRadius * 2 + G.starGap;
  }
  sheet.runRight(right, G.avgBase, [
    { text: S.avgBase, font: F.avgLabel, fill: C.muted },
    { text: String(data.averageBase), font: F.avgValue, fill: C.fg, gap: 10 },
  ]);
  hr(sheet, G.heroRule);

  /* 라운드별 기본점 막대 */
  sheet.text(left, G.barsCaptionBase, `${S.roundShort} · ${S.avgBase}`, F.caption, C.muted);
  drawRoundBars(sheet, data, S.withheld, left, right);

  /* 스켈레톤 판 */
  drawPanel(sheet, data, S, left, right);

  /* 감점 줄 — 측정값과 경계값을 언제나 함께 */
  sheet.text(
    left,
    G.deductCaptionBase,
    data.deductions.length > 0 ? `${S.measured} / ${S.bounds}` : S.noDeduction,
    F.caption,
    C.muted,
  );
  data.deductions.forEach((d, i) => {
    drawDeductionRow(sheet, d, S.bounds, hangulOk, left, right, G.deductRowTop + i * (G.deductRowHeight + G.deductRowGap));
  });

  /*
   * 꼬리말 — 출처와 면책. 둘 다 카드가 스스로에 대해 말하는 부분이다.
   *
   * 값(규칙표 버전·입력원)은 바깥에서 오므로 길이를 알 수 없다. 그래서 고정 문구의
   * 폭을 먼저 다 재고 **남은 폭을 둘이 나눠 갖는다** — 이렇게 해야 어떤 문자열이
   * 들어와도 이 줄이 카드 밖으로 나가지 않는다.
   */
  const originText = hangulOk ? data.originLabel : "-";
  const fixed = [S.rulesLabel, "·", S.originLabel, "·", "poomsae-judge"];
  const fixedW = fixed.reduce((sum, t) => sum + sheet.width(t, F.footer), 0) + 8 * 2 + 12 * 4;
  const budget = Math.max(0, CONTENT_WIDTH - fixedW);
  sheet.run(left, G.footerMetaBase, [
    { text: S.rulesLabel, font: F.footer, fill: C.muted, alpha: 0.75 },
    { text: sheet.fit(data.rulesVersion, budget * 0.45, F.footer), font: F.footer, fill: C.fg, gap: 8, alpha: 0.9 },
    { text: "·", font: F.footer, fill: C.muted, gap: 12, alpha: 0.6 },
    { text: S.originLabel, font: F.footer, fill: C.muted, gap: 12, alpha: 0.75 },
    { text: sheet.fit(originText, budget * 0.55, F.footer), font: F.footer, fill: C.fg, gap: 8, alpha: 0.9 },
    { text: "·", font: F.footer, fill: C.muted, gap: 12, alpha: 0.6 },
    { text: "poomsae-judge", font: F.footer, fill: C.muted, gap: 12, alpha: 0.75 },
  ]);
  const noteLines = sheet.wrap(S.disclaimer, CONTENT_WIDTH, F.note, 2);
  noteLines.forEach((line, i) => {
    sheet.text(left, G.footerNoteBase + i * F_NOTE_LINE, line, F.note, C.muted, 0.6);
  });

  return sheet.ops;
}

const F_NOTE_LINE = 20 * LINE_HEIGHT;

function drawRoundBars(sheet: Sheet, data: CardData, withheldText: string, left: number, right: number): void {
  const rounds = data.rounds;
  if (rounds.length === 0) return;

  const gap = 14;
  const slot = (right - left - gap * (rounds.length - 1)) / rounds.length;
  const barW = Math.min(slot, 132);

  rounds.forEach((r, i) => {
    const x = left + i * (slot + gap) + (slot - barW) / 2;
    const top = G.barsTop;
    const h = G.barsHeight;

    // 홈통 — 100점이 어디인지 보이게 둔다.
    sheet.push({ op: "rect", x, y: top, w: barW, h, fill: C.surface2, radius: 10 });

    if (r.withheld) {
      sheet.push({
        op: "rect",
        x,
        y: top,
        w: barW,
        h,
        stroke: C.hold,
        lineWidth: 3,
        radius: 10,
        alpha: 0.9,
      });
      const t = sheet.fit(withheldText, barW - 16, F.barLabel);
      const w = sheet.width(t, F.barLabel);
      sheet.text(x + (barW - w) / 2, top + h / 2 + 7, t, F.barLabel, C.hold);
    } else {
      const ratio = Math.min(1, Math.max(0, (r.baseScore ?? 0) / 100));
      const fillH = Math.max(6, h * ratio);
      const isBest = r.number === data.bestRoundNumber;
      sheet.push({
        op: "rect",
        x,
        y: top + h - fillH,
        w: barW,
        h: fillH,
        fill: isBest ? C.brand : C.brandDim,
        radius: 10,
      });
      const t = String(r.baseScore ?? 0);
      const w = sheet.width(t, F.barLabel);
      sheet.text(x + (barW - w) / 2, top + h / 2 + 7, t, F.barLabel, isBest ? C.bgTop : C.fg);
    }

    const label = String(r.number);
    const lw = sheet.width(label, F.barLabel);
    sheet.text(x + (barW - lw) / 2, G.barsLabelBase, label, F.barLabel, C.muted);
  });
}

function drawPanel(
  sheet: Sheet,
  data: CardData,
  S: ReturnType<typeof cardStrings>,
  left: number,
  right: number,
): void {
  const panel = { x: left, y: G.panelTop, w: right - left, h: G.panelHeight };
  sheet.push({
    op: "rect",
    x: panel.x,
    y: panel.y,
    w: panel.w,
    h: panel.h,
    fill: C.surface,
    stroke: C.line,
    lineWidth: 2,
    radius: 24,
  });

  const box: Box = { x: panel.x + 26, y: panel.y + 24, w: 396, h: panel.h - 48 };
  sheet.push(...skeletonOps(data.skeleton, box));

  const colX = box.x + box.w + 34;
  const colRight = panel.x + panel.w - 30;
  const colW = colRight - colX;

  let y = panel.y + 52;
  sheet.text(colX, y, sheet.fit(S.bestRound, colW, F.panelCaption), F.panelCaption, C.muted);

  y += 62;
  sheet.run(colX, y, [
    { text: String(data.bestRoundNumber), font: F.roundBig, fill: C.fg },
    { text: S.roundShort, font: F.panelCaption, fill: C.muted, gap: 8 },
  ]);

  y += 34;
  sheet.push({ op: "line", x1: colX, y1: y, x2: colRight, y2: y, stroke: C.line, lineWidth: 2 });

  y += 42;
  sheet.text(colX, y, sheet.fit(S.rawScore, colW, F.rawLabel), F.rawLabel, C.muted);

  y += 66;
  sheet.run(colX, y, [
    { text: data.rawScoreText, font: F.rawValue, fill: C.brand },
    { text: `/ ${data.maxScoreText}`, font: F.rawMax, fill: C.muted, gap: 14 },
  ]);

  /* 범례 — 두 스켈레톤이 무엇인지 카드 안에서 말한다. */
  const legendY = y + 58;
  let lx = colX;
  const swatch = (color: string, hollow: boolean, label: string) => {
    sheet.push({
      op: "circle",
      x: lx + 9,
      y: legendY - 7,
      r: 9,
      fill: hollow ? undefined : color,
      stroke: hollow ? color : undefined,
      lineWidth: 3,
      alpha: hollow ? 0.9 : 1,
    });
    lx += 26;
    lx += sheet.text(lx, legendY, sheet.fit(label, 150, F.legend), F.legend, C.muted);
    lx += 22;
  };
  swatch(C.jointCore, false, S.mine);
  swatch(C.brandDim, true, S.reference);

  // 그림의 배율이 무엇에 맞춰졌는지 한 줄.
  sheet.text(box.x, panel.y + panel.h - 24, sheet.fit(S.scaleNote, box.w, F.legend), F.legend, C.muted, 0.55);
}

function drawDeductionRow(
  sheet: Sheet,
  d: CardDeductionLine,
  boundsLabel: string,
  hangulOk: boolean,
  left: number,
  right: number,
  top: number,
): void {
  const h = G.deductRowHeight;
  const tone = d.withheld ? C.hold : C.bad;
  sheet.push({ op: "rect", x: left, y: top, w: right - left, h, fill: C.surface, radius: 16 });
  sheet.push({ op: "rect", x: left, y: top, w: 6, h, fill: tone, radius: 3, alpha: 0.9 });

  const baseline = top + h / 2 + 9;

  /* 규칙 ID 칩 — 한글이 안 나와도 이 글자는 읽힌다. */
  const chipW = Math.max(62, sheet.width(d.id, F.chip) + 26);
  sheet.push({
    op: "rect",
    x: left + 20,
    y: top + 16,
    w: chipW,
    h: h - 32,
    fill: C.surface2,
    stroke: tone,
    lineWidth: 2,
    radius: 8,
  });
  const idW = sheet.width(d.id, F.chip);
  sheet.text(left + 20 + (chipW - idW) / 2, top + h / 2 + 8, d.id, F.chip, tone);

  /* 오른쪽 끝의 감점(또는 보류) — 먼저 자리를 잡아야 가운데 글자의 폭이 정해진다. */
  const amountText = d.withheld ? (hangulOk ? "보류" : "HOLD") : `−${d.deduction.toFixed(1)}`;
  const amountW = sheet.width(amountText, F.deductAmount);
  sheet.text(right - 20 - amountW, baseline, amountText, F.deductAmount, tone);

  let x = left + 20 + chipW + 18;
  const avail = right - 20 - amountW - 18 - x;

  if (hangulOk && d.title.length > 0) {
    const title = sheet.fit(d.title, Math.min(avail * 0.34, 220), F.deductTitle);
    x += sheet.text(x, baseline, title, F.deductTitle, C.fg) + 18;
  }

  const rest = right - 20 - amountW - 18 - x;
  const boundsText = `${boundsLabel} ${d.boundsText}`;
  const boundsW = Math.min(sheet.width(boundsText, F.deductBounds), Math.max(0, rest - 110));
  const measuredMax = Math.max(0, rest - boundsW - 16);
  x += sheet.text(x, baseline, sheet.fit(d.measuredText, measuredMax, F.deductValue), F.deductValue, C.fg) + 16;
  sheet.text(x, baseline, sheet.fit(boundsText, Math.max(0, right - 20 - amountW - 18 - x), F.deductBounds), F.deductBounds, C.muted);
}
