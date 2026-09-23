/**
 * 비교 층(놀이 층)의 자료형.
 *
 * **판정 층과 다른 층이다.** 판정(`src/judge`)은 "10점 만점에 9.7점, A1에서 0.3 깎였다"를
 * 말하고, 이 층은 "네 오른 무릎이 교본보다 12° 덜 굽었다"를 말한다.
 * 둘은 단위도 목적도 다르며, 이 층이 틀리면 색이 잘못 칠해질 뿐 점수는 틀리지 않는다.
 *
 * 그래서 이 폴더는 `src/judge` 를 **읽기만** 한다. 감점 상수를 고치지도, 새 판정 함수를
 * 만들지도 않는다(`docs/reference-poses.md` 7절 6번).
 */

import type { CameraView, Landmark, MotionKind } from "../judge/types";
import type { ReferencePoseId } from "../samples/reference-frames";

export type { ReferencePoseId };

/** 비교 지표의 단위. 각도(도)와 어깨 너비 대비 비율(÷S) 둘뿐이다. */
export type MetricUnit = "deg" | "ratio";

/** 사람의 몸 기준 좌우. 화면의 좌우가 아니다. */
export type BodySide = "left" | "right";

/**
 * 어깨 너비 S로 나누고 엉덩이 중점을 원점으로 옮긴 프레임.
 *
 * 이렇게 두면 키와 카메라 거리가 사라진다(PRD-game 5.3의 정렬 (1)·(2)).
 * 각도는 균등 축척·평행이동에 불변이므로 정규화 전후가 같고, 길이 지표는
 * 곧바로 ÷S 값으로 읽힌다 — 지표마다 S를 다시 나누지 않아도 된다.
 */
export interface NormalizedFrame {
  /** 33개. (p − 엉덩이중점) ÷ S. visibility 는 원본 그대로다. */
  readonly points: readonly Landmark[];
  /** 정규화에 쓴 S(미터). 화면이 "무엇으로 나눴는지" 적을 수 있게 남긴다. */
  readonly shoulderWidthM: number;
}

/**
 * 한 지표의 정의.
 *
 * 목표값(target)이 여기 없는 것이 핵심이다 — 목표값은 **기준 프레임에서 재서** 만든다.
 * 문서의 표(`docs/reference-poses.md` 5절)에 숫자를 다시 적으면 문서와 코드가
 * 조용히 갈라진다. 그 표는 이 계산이 맞는지 보는 시험값으로만 쓴다.
 */
export interface MetricSpec {
  /**
   * 지표 정의의 이름. **절대 뒤집히지 않는다** — 거울 비교에서도 같은 id다.
   * 사람의 몸 어느 쪽을 가리키는지는 `side`·`joints`·`labelKo` 가 말한다.
   */
  id: string;
  /** 좌우가 없는 이름("무릎"). 좌우 표시는 `side` 로 붙인다. */
  baseLabelKo: string;
  /** 기준 자세에서 이 지표가 보는 쪽. 좌우가 없는 지표는 null. */
  side: BodySide | null;
  /** 기준 자세 기준의 표시 이름. 거울 비교에서는 좌우가 뒤집힌 이름을 따로 만든다. */
  labelKo: string;
  unit: MetricUnit;
  /**
   * 이 지표를 재는 데 필요한 랜드마크. **하나라도 흐리면 이 지표를 읽지 않는다.**
   * 측정값이 없으면 어긋남 등급도 없다 — 색 규약의 배타성이 여기서 나온다.
   */
  readonly reads: readonly number[];
  /** 어긋났을 때 화면에서 칠할 관절. `reads` 의 부분집합이다. */
  readonly joints: readonly number[];
  /** 이 차이까지는 "맞음". 표시 전용이며 감점을 만들지 않는다. */
  ok: number;
  /** 이 차이까지는 "주의". 넘으면 "어긋남". */
  warn: number;
  /** 일치도 가중치. 한 자세의 합이 100이다. */
  weight: number;
  measure: (f: NormalizedFrame) => number;
  /** 어긋났을 때 화면에 띄울 한 줄. 사람의 몸 기준으로 쓴다(화면 좌우가 아니라). */
  hintKo: string;
}

/** 기준 프레임에서 목표값을 재어 붙인 지표. */
export interface ReferenceMetric extends MetricSpec {
  /** 기준 프레임에서 잰 값. 코드가 계산했고 사람이 적지 않았다. */
  target: number;
}

export interface ReferencePose {
  id: ReferencePoseId;
  labelKo: string;
  view: CameraView;
  /**
   * 판정 규칙이 있는 동작. **`null` 이면 점수가 없다.**
   * 주석이 아니라 타입이 말하게 한 자리다 — `null` 인 자세를 점수 라운드에 넣으면
   * 타입이 막는다(`docs/reference-poses.md` 1절).
   */
  judgedMotion: MotionKind | null;
  /** 33개, world 좌표(정규화 전). 그리기 계층이 이것을 투영해 쓴다. */
  readonly frame: readonly Landmark[];
  readonly metrics: readonly ReferenceMetric[];
  /** 화면에 그대로 띄울 근거 한 줄. */
  sourceNote: string;
}

/**
 * 한 지표(또는 관절)의 상태.
 *
 * `unreadable` 은 "읽지 못했다"이고 `off` 는 "읽었는데 어긋났다"이다.
 * 둘은 **한 관절에 동시에 올 수 없다** — 읽지 못한 관절은 측정값이 없으므로
 * 어긋남 등급을 받을 길이 없다. 화면의 두 빨강(점선 = 흐림 / 실선 = 어긋남)이
 * 겹치지 않는 근거가 이 배타성이다(PRD-game 5.3).
 *
 * `none` 은 "이 관절을 비교하지 않았다"이다 — 얼굴·손가락처럼 애초에 지표가 없거나,
 * 흐려서 읽지 않기로 한 관절이 여기 온다. 평소 색으로 그린다.
 */
export type MatchBand = "ok" | "warn" | "off" | "unreadable" | "none";

export interface MetricComparison {
  /** 지표 정의의 이름. 거울이어도 바뀌지 않는다. */
  id: string;
  /**
   * **사람의 몸 기준** 표시 이름. 거울로 비교했으면 좌우가 뒤집혀 있다 —
   * 화면 좌우가 아니라 몸의 좌우로 말해야 하기 때문이다.
   */
  labelKo: string;
  /** 사람의 몸 기준 좌우. 거울로 비교했으면 뒤집혀 있다. */
  side: BodySide | null;
  unit: MetricUnit;
  target: number;
  measured: number | null;
  /**
   * `measured − target`. **부호를 남긴다** — "12° 덜 굽었다"와 "12° 더 굽었다"는
   * 고치는 방법이 반대다. 등급은 절댓값으로 매기고 문장은 부호로 쓴다.
   */
  diff: number | null;
  band: MatchBand;
  /** 0~100. 읽지 못했으면 null(일치도의 분자·분모에서 함께 빠진다). */
  score: number | null;
  weight: number;
  /** **플레이어 프레임 기준** 랜드마크 번호. 거울로 비교했으면 짝으로 바뀌어 있다. */
  readonly joints: readonly number[];
  hintKo: string;
  /** band === "unreadable" 일 때만. 왜 읽지 못했는지 한 줄. */
  reason?: string;
}

export interface Comparison {
  poseId: ReferencePoseId;
  /** 플레이어 프레임을 좌우로 뒤집어 비교했는가. */
  mirrored: boolean;
  /** 0~100. 읽은 지표가 하나도 없으면 null — 0과 "재지 못함"은 다르다. */
  match: number | null;
  readonly metrics: readonly MetricComparison[];
  /** 어긋난 지표만. 점수가 낮은 순(같으면 지표 정의 순). */
  readonly off: readonly MetricComparison[];
  /**
   * 랜드마크 33개의 상태. **플레이어 프레임의 인덱스 공간**이다 —
   * 거울로 비교했어도 화면은 자기가 받은 프레임의 번호 그대로 색을 칠하면 된다.
   */
  readonly jointBands: readonly MatchBand[];
  /** 어긋난 관절의 랜드마크 번호(오름차순). */
  readonly offJoints: readonly number[];
  readableCount: number;
  unreadableCount: number;
  /** 정규화에 쓴 S(미터). 못 구했으면 null이고 그때는 전부 unreadable 이다. */
  shoulderWidthM: number | null;
}
