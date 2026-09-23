/**
 * 명령 목록을 캔버스에 찍는 유일한 파일.
 *
 * DOM 을 만지는 코드를 여기 한 곳에 몰아 두었다 — 배치·정제·스켈레톤은 전부
 * 순수 함수라 node 에서 그대로 시험할 수 있고, 시험할 수 없는 부분은 이 파일뿐이다.
 * 그래서 이 파일은 **아무 결정도 하지 않는다.** 명령을 그대로 옮길 뿐이다.
 *
 * 브라우저 API는 함수 안에서만 만진다(정적 내보내기의 프리렌더가 깨지지 않게).
 */

import { buildCardOps, type LayoutOptions } from "./layout";
import type { CardOp } from "./ops";
import { sanitizeCardData } from "./sanitize";
import { CARD } from "./theme";
import { hangulRenders, measurerFromContext } from "./text";
import type { CardData, CardInput } from "./types";

type Ctx2D = CanvasRenderingContext2D;

function tracePath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rr === 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  // arcTo 로 직접 그린다 — roundRect 가 없는 구현에서도 같은 그림이 나온다.
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 명령 하나하나를 그대로 옮긴다. 여기서 좌표를 고치지 않는다. */
export function paintOps(ctx: Ctx2D, ops: readonly CardOp[]): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";

  for (const o of ops) {
    ctx.save();
    if ("alpha" in o && o.alpha !== undefined) ctx.globalAlpha = o.alpha;

    switch (o.op) {
      case "grad": {
        const g = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
        for (const [stop, color] of o.stops) g.addColorStop(stop, color);
        ctx.fillStyle = g;
        ctx.fillRect(o.x, o.y, o.w, o.h);
        break;
      }
      case "rect": {
        tracePath(ctx, o.x, o.y, o.w, o.h, o.radius ?? 0);
        if (o.fill) {
          ctx.fillStyle = o.fill;
          ctx.fill();
        }
        if (o.stroke) {
          ctx.strokeStyle = o.stroke;
          ctx.lineWidth = o.lineWidth ?? 1;
          ctx.stroke();
        }
        break;
      }
      case "line": {
        ctx.beginPath();
        ctx.moveTo(o.x1, o.y1);
        ctx.lineTo(o.x2, o.y2);
        ctx.strokeStyle = o.stroke;
        ctx.lineWidth = o.lineWidth;
        ctx.lineCap = o.cap ?? "butt";
        if (o.dash) ctx.setLineDash([...o.dash]);
        ctx.stroke();
        break;
      }
      case "circle": {
        ctx.beginPath();
        ctx.arc(o.x, o.y, Math.max(0, o.r), 0, Math.PI * 2);
        if (o.fill) {
          ctx.fillStyle = o.fill;
          ctx.fill();
        }
        if (o.stroke) {
          ctx.strokeStyle = o.stroke;
          ctx.lineWidth = o.lineWidth ?? 1;
          ctx.stroke();
        }
        break;
      }
      case "poly": {
        if (o.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(o.points[0][0], o.points[0][1]);
          for (let i = 1; i < o.points.length; i += 1) ctx.lineTo(o.points[i][0], o.points[i][1]);
          ctx.closePath();
          if (o.fill) {
            ctx.fillStyle = o.fill;
            ctx.fill();
          }
          if (o.stroke) {
            ctx.strokeStyle = o.stroke;
            ctx.lineWidth = o.lineWidth ?? 1;
            ctx.stroke();
          }
        }
        break;
      }
      case "text": {
        ctx.font = o.font;
        ctx.fillStyle = o.fill;
        ctx.fillText(o.text, o.x, o.y);
        break;
      }
    }
    ctx.restore();
  }
}

/**
 * 캔버스를 카드 크기로 맞추고 명령을 찍는다.
 *
 * **배율은 상수 `CARD.scale` 이다.** `devicePixelRatio` 를 읽지 않는다 —
 * 읽으면 같은 판정이 기기마다 다른 파일이 된다(docs/TECH-NOTES.md 12.1 ㄴ).
 */
export function paintCard(canvas: HTMLCanvasElement, data: CardData, opts: LayoutOptions = {}): CardOp[] {
  canvas.width = CARD.width * CARD.scale;
  canvas.height = CARD.height * CARD.scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("카드를 그릴 2D 컨텍스트를 얻지 못했다.");

  const ops = buildCardOps(data, {
    measure: opts.measure ?? measurerFromContext(ctx),
    hangulOk: opts.hangulOk ?? hangulRenders(),
  });

  ctx.setTransform(CARD.scale, 0, 0, CARD.scale, 0, 0);
  ctx.clearRect(0, 0, CARD.width, CARD.height);
  paintOps(ctx, ops);
  return ops;
}

/** 원본 입력에서 카드 한 장까지. 정제 → 배치 → 그리기가 한 줄로 이어진다. */
export function renderCard(
  canvas: HTMLCanvasElement,
  input: CardInput,
  opts: LayoutOptions = {},
): CardOp[] {
  return paintCard(canvas, sanitizeCardData(input), opts);
}

/** 화면에 붙이지 않는 캔버스 한 장. 카드를 파일로만 뽑을 때 쓴다. */
export function createCardCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CARD.width * CARD.scale;
  canvas.height = CARD.height * CARD.scale;
  return canvas;
}
