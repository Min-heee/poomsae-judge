import type { CriterionResult } from "@/judge/types";
import { GRADE_LABEL, GRADE_TONE, axisRatio, formatMeasure, gaugeModel } from "@/pose";
import styles from "@/styles/studio.module.css";

const TONE_TEXT: Record<string, string> = {
  ok: styles.toneOk,
  warn: styles.toneWarn,
  bad: styles.toneBad,
  hold: styles.toneHold,
  mute: styles.toneMute,
};

const TONE_BG: Record<string, string> = {
  ok: styles.bgOk,
  warn: styles.bgWarn,
  bad: styles.bgBad,
  hold: styles.bgHold,
  mute: styles.bgMute,
};

/**
 * 항목 한 줄 = 측정값 + 경계값 + 등급.
 *
 * 이 컴포넌트가 이 프로젝트의 주장 그 자체다. 등급만 보여 주면 반박할 수 없고,
 * 측정값만 보여 주면 판단이 없다. 둘을 같은 줄에 놓아야 "왜 이 점수인지"가 보인다
 * (docs/PRD.md F3).
 */
export function CriterionRow({ criterion }: { criterion: CriterionResult }) {
  const tone = GRADE_TONE[criterion.grade];
  const gauge = gaugeModel(criterion);
  const hasAxis = gauge.ticks.length > 0;

  return (
    <div className={styles.criterion}>
      <div className={styles.criterionHead}>
        <div>
          <span className={styles.criterionId}>{criterion.id}</span>
          <span className={styles.criterionName}>{criterion.title}</span>
        </div>
        <div className={`${styles.measured} ${TONE_TEXT[tone]}`}>
          {formatMeasure(criterion.measured, criterion.unit)}
        </div>
      </div>

      {hasAxis && (
        <div
          className={styles.gauge}
          role="img"
          aria-label={`${criterion.title} 측정 ${formatMeasure(
            criterion.measured,
            criterion.unit,
          )}, 경계 ${criterion.boundaries.join(", ")}, 판정 ${GRADE_LABEL[criterion.grade]}`}
        >
          <div className={styles.gaugeTrack} />
          {gauge.pass && (
            <div
              className={styles.gaugePass}
              style={{
                left: `${axisRatio(gauge.pass[0], gauge.axis) * 100}%`,
                width: `${
                  (axisRatio(gauge.pass[1], gauge.axis) - axisRatio(gauge.pass[0], gauge.axis)) * 100
                }%`,
              }}
            />
          )}
          {gauge.ticks.map((tick) => (
            <span key={tick}>
              <span
                className={styles.gaugeTick}
                style={{ left: `${axisRatio(tick, gauge.axis) * 100}%` }}
              />
              <span
                className={styles.gaugeTickLabel}
                style={{ left: `${axisRatio(tick, gauge.axis) * 100}%` }}
              >
                {tick}
              </span>
            </span>
          ))}
          {gauge.position !== null && (
            <span
              className={`${styles.gaugeMarker} ${TONE_BG[tone]}`}
              style={{ left: `${gauge.position * 100}%` }}
            />
          )}
        </div>
      )}

      <div className={styles.criterionRule}>
        {criterion.rule}
        {" · "}
        <span className={TONE_TEXT[tone]}>{GRADE_LABEL[criterion.grade]}</span>
        {criterion.deduction > 0 && ` (−${criterion.deduction.toFixed(1)})`}
      </div>

      {(criterion.note || criterion.withholdReason) && (
        <p className={styles.criterionNote}>{criterion.note || criterion.withholdReason}</p>
      )}
    </div>
  );
}
