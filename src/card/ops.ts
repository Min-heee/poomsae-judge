/**
 * 카드가 그리는 명령 목록(디스플레이 리스트).
 *
 * 왜 캔버스에 바로 그리지 않고 명령 목록을 한 번 거치는가 —
 * **카드가 결정적이라는 것을 증명하려면 결과를 붙잡을 수 있어야 하기 때문이다.**
 * 캔버스에 직접 그리면 확인할 수 있는 것은 픽셀뿐이고, 픽셀은 글꼴이 다른 기기에서
 * 반드시 달라진다. 명령 목록은 "무엇을 어디에 그렸는가"를 그대로 들고 있어서
 * 해시를 떠 비교할 수 있고, 캔버스 밖으로 나간 도형을 찾을 수 있고,
 * 카드에 들어간 **모든 글자를 빠짐없이 훑을 수 있다**(개인정보 검사).
 *
 * 테스트 환경은 node 하나다(`vitest.config.ts`). jsdom 도 canvas 바인딩도 없다.
 * 그 제약이 이 구조를 고르게 한 두 번째 이유다 — 레이아웃은 DOM 없이 검사하고,
 * DOM 을 만지는 코드는 `paint.ts` 한 파일에 몰아 둔다.
 */

/** 색 하나 또는 세로 그러데이션. 캔버스 객체가 아니라 값이라 비교할 수 있다. */
export type Fill = string;

export interface RectOp {
  op: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: Fill;
  stroke?: Fill;
  lineWidth?: number;
  /** 모서리 반지름. 0이면 각진 사각형. */
  radius?: number;
  alpha?: number;
}

/** 세로 방향 선형 그러데이션. 배경 한 장에만 쓴다. */
export interface GradOp {
  op: "grad";
  x: number;
  y: number;
  w: number;
  h: number;
  stops: readonly (readonly [number, string])[];
}

export interface LineOp {
  op: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: Fill;
  lineWidth: number;
  dash?: readonly number[];
  cap?: "round" | "butt";
  alpha?: number;
}

export interface CircleOp {
  op: "circle";
  x: number;
  y: number;
  r: number;
  fill?: Fill;
  stroke?: Fill;
  lineWidth?: number;
  alpha?: number;
}

/** 별·화살표처럼 코드로 그리는 도형. 외부 이미지·아이콘 폰트를 안 쓰기 위한 것. */
export interface PolyOp {
  op: "poly";
  points: readonly (readonly [number, number])[];
  fill?: Fill;
  stroke?: Fill;
  lineWidth?: number;
  alpha?: number;
}

/**
 * 글자 한 덩이.
 *
 * `x, y` 는 **왼쪽 기준선**이다. `textAlign` 을 쓰지 않는 이유는 하나다 —
 * 오른쪽 정렬을 캔버스에 맡기면 그 글자가 실제로 어디까지 뻗는지 명령 목록이
 * 모르게 되고, "캔버스 밖으로 안 나간다"를 검사할 수 없다.
 * 대신 레이아웃이 `measure` 로 폭을 재서 x 를 직접 계산하고(TECH-NOTES 12.2 ㄹ),
 * 잰 값(`w`·`ascent`·`descent`)을 명령에 같이 실어 보낸다.
 */
export interface TextOp {
  op: "text";
  x: number;
  /** 기준선(baseline) y. */
  y: number;
  text: string;
  font: string;
  fill: Fill;
  /** 실측 폭. 경계 검사가 이 값을 쓴다. */
  w: number;
  ascent: number;
  descent: number;
  alpha?: number;
}

export type CardOp = RectOp | GradOp | LineOp | CircleOp | PolyOp | TextOp;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EMPTY_BOUNDS: Bounds = {
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
};

/**
 * 명령 목록이 실제로 덮는 사각형.
 *
 * 선 굵기의 절반과 글자의 상·하한까지 넣는다 — "중심점은 안에 있는데 획이 잘렸다"를
 * 통과시키지 않기 위해서다.
 */
export function opsBounds(ops: readonly CardOp[]): Bounds {
  let b = { ...EMPTY_BOUNDS };
  const put = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    b = {
      minX: Math.min(b.minX, x),
      minY: Math.min(b.minY, y),
      maxX: Math.max(b.maxX, x),
      maxY: Math.max(b.maxY, y),
    };
  };

  for (const o of ops) {
    switch (o.op) {
      case "rect":
      case "grad": {
        const half = o.op === "rect" ? (o.stroke ? (o.lineWidth ?? 1) / 2 : 0) : 0;
        put(o.x - half, o.y - half);
        put(o.x + o.w + half, o.y + o.h + half);
        break;
      }
      case "line": {
        const half = o.lineWidth / 2;
        put(Math.min(o.x1, o.x2) - half, Math.min(o.y1, o.y2) - half);
        put(Math.max(o.x1, o.x2) + half, Math.max(o.y1, o.y2) + half);
        break;
      }
      case "circle": {
        const half = o.stroke ? (o.lineWidth ?? 1) / 2 : 0;
        put(o.x - o.r - half, o.y - o.r - half);
        put(o.x + o.r + half, o.y + o.r + half);
        break;
      }
      case "poly": {
        const half = o.stroke ? (o.lineWidth ?? 1) / 2 : 0;
        for (const [px, py] of o.points) {
          put(px - half, py - half);
          put(px + half, py + half);
        }
        break;
      }
      case "text": {
        put(o.x, o.y - o.ascent);
        put(o.x + o.w, o.y + o.descent);
        break;
      }
    }
  }
  return b;
}

/** 카드에 실제로 박힌 글자 전부. 개인정보 검사와 점수 표시 검사가 이것을 훑는다. */
export function opsText(ops: readonly CardOp[]): string[] {
  const out: string[] = [];
  for (const o of ops) if (o.op === "text") out.push(o.text);
  return out;
}

/**
 * 부동소수점 끝자리를 고정한 표준 직렬화.
 *
 * 좌표를 그대로 문자열로 만들면 `0.1 + 0.2` 같은 계산이 끝자리에서 흔들려
 * "같은 입력인데 해시가 다르다"가 난다. 카드는 2배율로 2160px 폭이므로
 * 소수 6자리 아래는 그림에 아무 영향이 없다 — 거기서 자른다.
 */
export function canonicalize(ops: readonly CardOp[]): string {
  return JSON.stringify(ops, (_k, v) =>
    typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(6)) : v,
  );
}

/**
 * 명령 목록의 지문. FNV-1a 32비트 — 의존성 없이 30줄이면 되고,
 * 우리가 쓰는 곳(같은 입력인가 아닌가)에는 충분하다. 암호용이 아니다.
 */
export function opsHash(ops: readonly CardOp[]): string {
  const s = canonicalize(ops);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193);
    // 서로게이트 쌍(이모지 등)도 상위 바이트까지 섞는다.
    const hi = s.charCodeAt(i) >> 8;
    if (hi !== 0) {
      h ^= hi;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
