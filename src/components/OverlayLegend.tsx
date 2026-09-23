/**
 * 교본 오버레이의 범례 — **두 화면이 같은 한 벌을 쓴다.**
 *
 * 전에는 판정 화면과 게임 화면에 범례가 각각 복붙돼 있었고, 한쪽만 밴드 상수를 읽고
 * 다른 쪽은 `15° 초과`·`6~15° 주의` 를 손으로 적고 있었다. 문턱을 고치는 날 한 화면만
 * 조용히 거짓말을 시작한다 — 이 저장소가 `types.ts`·`reference.ts` 주석에서 스스로
 * 금지한 "같은 숫자를 두 곳에 적기" 바로 그 패턴이다.
 *
 * 그리고 단위도 고친다. 기준 자세의 지표는 **각도만이 아니다** — 주춤서기에서 가장
 * 무거운 지표인 발 간격은 `·S` 비율이고(밴드도 따로 넓다), 발·무릎 높이와 주먹 위치도
 * 전부 비율이다. 그런데 범례는 모든 색을 "15° 초과 어긋남"이라고만 설명하고 있었다.
 * 발이 0.7·S 어긋나 발목이 칠해진 순간 화면이 틀린 단위로 그 색을 설명하는 셈이다.
 *
 * 숫자는 전부 밴드 상수에서 보간한다. **`@/follow` 가 아니라 `@/follow/bands` 에서**
 * 직접 받는 것이 중요하다 — 판정 화면(홈)은 비교 코어를 동적 import 로 떼어 두는데,
 * 여기서 배럴을 타면 그 노력이 통째로 홈 번들로 돌아온다.
 */

import { ANGLE_BAND, FEET_GAP_BAND, LENGTH_BAND } from "@/follow/bands";
import type { MotionKind } from "@/judge/types";
import { OVERLAY_COLORS } from "./overlay";
import styles from "./overlayLegend.module.css";

const ratio = (v: number) => `${v.toFixed(2)}·S`;

export interface OverlayLegendProps {
  /**
   * 이 화면이 지금 보고 있는 동작. 앞차기 교본은 **정점 한 순간**이라
   * 그 순간이 아닌 프레임이 어긋나 보이는 것이 당연하다 — 그 사실을 화면에 적는다.
   */
  motion?: MotionKind | null;
}

export function OverlayLegend({ motion = null }: OverlayLegendProps) {
  const items: { color: string; dashed?: boolean; text: string }[] = [
    { color: OVERLAY_COLORS.weak, dashed: true, text: "빨강 점선 = 읽지 못함(흐림)" },
    {
      color: OVERLAY_COLORS.off,
      text: `자홍 실선 = 교본과 어긋남 (각도 ${ANGLE_BAND.warn}° 초과 · 길이 ${ratio(
        LENGTH_BAND.warn,
      )} 초과 · 발 간격만 ${ratio(FEET_GAP_BAND.warn)} 초과)`,
    },
    {
      color: OVERLAY_COLORS.warn,
      text: `옅은 자홍 = 주의 (각도 ${ANGLE_BAND.ok}~${ANGLE_BAND.warn}° · 길이 ${ratio(
        LENGTH_BAND.ok,
      )}~${ratio(LENGTH_BAND.warn)})`,
    },
    { color: OVERLAY_COLORS.ghost, text: "파랑 = 교본" },
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        {items.map((it) => (
          <span key={it.text} className={styles.item}>
            <span
              aria-hidden="true"
              className={`${styles.swatch} ${it.dashed ? styles.swatchDashed : ""}`}
              style={{ borderTopColor: it.color }}
            />
            {it.text}
          </span>
        ))}
      </div>
      <p className={styles.note}>
        자홍은 <strong>감점 색이 아닙니다.</strong> 교본과의 차이는 점수를 깎지 않습니다 —
        감점은 판정 카드의 빨강이 말하고, 여기 자홍은 &lsquo;교본과 얼마나 다른가&rsquo;만
        말합니다.
        {motion === "frontKick"
          ? " 앞차기 교본은 정점 한 순간이라, 그 순간이 아닌 프레임이 어긋나 보이는 것은 당연합니다."
          : ""}
      </p>
    </div>
  );
}
