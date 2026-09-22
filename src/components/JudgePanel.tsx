import type { CoachAdvice } from "@/judge/coach";
import type { Judgement } from "@/judge/types";
import { GRADE_TONE, MOTION_LABEL, euroRo, type FrameReadout, type MotionKind } from "@/pose";
import { CriterionRow } from "./CriterionRow";
import { Notice } from "./Notice";
import styles from "@/styles/studio.module.css";

const TONE_TEXT: Record<string, string> = {
  ok: styles.toneOk,
  warn: styles.toneWarn,
  bad: styles.toneBad,
  hold: styles.toneHold,
  mute: styles.toneMute,
};

/** 코칭 줄의 색. 감점 줄과 같은 팔레트를 쓴다. */
const COACH_TONE: Record<CoachAdvice["points"][number]["tone"], string> = {
  good: styles.toneOk,
  fix: styles.toneBad,
  hold: styles.toneHold,
};

export interface JudgePanelProps {
  motion: MotionKind;
  judgement: Judgement | null;
  /** 판정을 문장으로 옮긴 것. 판정이 없으면 null. */
  advice: CoachAdvice | null;
  readout: FrameReadout;
  frameCount: number;
  onSeekFrame(index: number): void;
}

/**
 * 오른쪽 판정 패널.
 *
 * 위에서 아래로: 점수 → 무엇이 깎였나 → 무엇을 보류했나 → 애초에 무엇을 안 쟀나
 * → 코칭 문장 → 지금 프레임의 값. 마지막 칸이 타임라인과 연동되는 부분이다
 * (docs/PRD.md F4).
 *
 * 코칭은 숫자 아래에 둔다. 근거(측정값·경계값)를 먼저 보이고 그다음에 말로
 * 풀어 주는 순서여야, 문장이 근거를 가리지 않는다.
 */
export function JudgePanel({
  motion,
  judgement,
  advice,
  readout,
  frameCount,
  onSeekFrame,
}: JudgePanelProps) {
  const deductions = (judgement?.criteria ?? []).filter((c) => c.deduction > 0);
  const withheldCriteria = (judgement?.criteria ?? []).filter((c) => c.grade === "withheld");

  return (
    <section className={styles.card} aria-label="판정 결과">
      <div className={styles.scoreRow}>
        {judgement === null ? (
          <div className={styles.scoreHeld}>점수 없음</div>
        ) : judgement.status === "withheld" || judgement.score === null ? (
          <div className={styles.scoreHeld}>판정 보류</div>
        ) : (
          <>
            <div className={styles.scoreValue}>{judgement.score.toFixed(1)}</div>
            <div className={styles.scoreMax}>/ {judgement.maxScore.toFixed(1)}</div>
          </>
        )}
      </div>

      <p className={styles.scoreMeta}>
        {MOTION_LABEL[motion]}
        {judgement && (
          <>
            {/*
              보류일 때 '감점 합계'라고 적으면 부분 채점처럼 읽힌다. 보류는 0점이
              아니라 '채점하지 않음'이므로, 무엇을 쟀는지는 남기되 총계라고 부르지 않는다.
            */}
            {judgement.status === "withheld"
              ? " · 참고: 보류 전까지 관측된 감점 "
              : " · 감점 합계 "}
            {judgement.totalDeduction.toFixed(1)}
            {" · 규칙 "}
            {judgement.rulesVersion}
            <br />
            판정 구간 프레임 {judgement.frameStats.judgedFrom ?? "—"}~
            {judgement.frameStats.judgedTo ?? "—"} · 무효{" "}
            {(judgement.frameStats.invalidRatio * 100).toFixed(0)}%
            {judgement.frameStats.interpolated > 0 &&
              ` · 보간 ${judgement.frameStats.interpolated}프레임`}
          </>
        )}
      </p>

      <h3 className={styles.sectionLabel}>감점</h3>
      {deductions.length === 0 ? (
        <p className={styles.empty}>
          {judgement === null ? "판정 결과가 없습니다." : "감점 항목이 없습니다."}
        </p>
      ) : (
        <div>
          {deductions.map((c) => (
            <div key={c.id} className={styles.deduction}>
              <span className={`${styles.deductionPoints} ${TONE_TEXT[GRADE_TONE[c.grade]]}`}>
                −{c.deduction.toFixed(1)}
              </span>
              <span>
                <strong>
                  {c.id} {c.title}
                </strong>
                <br />
                {c.note || c.rule}
                {c.atFrame !== null && (
                  <button
                    type="button"
                    className={styles.deductionFrame}
                    onClick={() => onSeekFrame(c.atFrame as number)}
                  >
                    {`프레임 ${c.atFrame}${euroRo(c.atFrame)} 이동`}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {(judgement?.withheld.length ?? 0) > 0 || withheldCriteria.length > 0 ? (
        <>
          <h3 className={styles.sectionLabel}>판정 보류</h3>
          <div>
            {judgement?.withheld.map((w, i) => (
              <div key={`${w.code}-${i}`} className={styles.deduction}>
                <span className={`${styles.deductionPoints} ${styles.toneHold}`}>{w.code}</span>
                <span>
                  {w.message}
                  {w.frames && w.frames.length > 0 && (
                    <button
                      type="button"
                      className={styles.deductionFrame}
                      onClick={() => onSeekFrame(Math.min(...(w.frames ?? [0])))}
                    >
                      {`첫 프레임(${Math.min(...w.frames)})${euroRo(Math.min(...w.frames))} 이동`}
                    </button>
                  )}
                </span>
              </div>
            ))}
            {withheldCriteria.map((c) => (
              <div key={`c-${c.id}`} className={styles.deduction}>
                <span className={`${styles.deductionPoints} ${styles.toneHold}`}>H4</span>
                <span>
                  <strong>
                    {c.id} {c.title}
                  </strong>
                  <br />
                  {c.withholdReason ?? c.note}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {judgement && judgement.notMeasured.length > 0 && (
        <>
          <h3 className={styles.sectionLabel}>측정하지 않은 것</h3>
          <div>
            {judgement.notMeasured.map((n) => (
              <div key={n.id} className={styles.deduction}>
                <span className={`${styles.deductionPoints} ${styles.toneMute}`}>—</span>
                <span>
                  <strong>{n.title}</strong>
                  <br />
                  {n.reason}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {advice && (
        <>
          <h3 className={styles.sectionLabel}>코칭</h3>
          <p className={styles.criterionNote}>
            <strong>{advice.headline}</strong>
          </p>
          <div>
            {advice.points.map((p, i) => (
              <div key={`${p.criterionId ?? "general"}-${i}`} className={styles.deduction}>
                <span className={`${styles.deductionPoints} ${COACH_TONE[p.tone]}`}>
                  {p.criterionId ?? "·"}
                </span>
                <span>
                  {p.text}
                  {p.atFrame !== null && (
                    <button
                      type="button"
                      className={styles.deductionFrame}
                      onClick={() => onSeekFrame(p.atFrame as number)}
                    >
                      {`프레임 ${p.atFrame}${euroRo(p.atFrame)} 이동`}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className={styles.empty}>{advice.sourceNote}</p>
        </>
      )}

      <h3 className={styles.sectionLabel}>
        지금 프레임 ({readout.frameIndex + 1}/{frameCount}, {(readout.timeMs / 1000).toFixed(2)}초)
      </h3>
      <p className={styles.empty}>
        타임라인을 옮기면 같이 바뀌는 <strong>관측값</strong>입니다. 등급 색은 같은 경계값으로
        칠했지만, 실제 감점은 규칙이 정한 프레임(주춤서기는 멈춘 구간, 앞차기는 정점)에서만
        매겨집니다 — 위 &lsquo;감점&rsquo; 칸이 그 결과입니다.
      </p>

      {readout.invalid && (
        <Notice tone="bad" tag="무효 프레임">
          {readout.invalid}
        </Notice>
      )}

      {readout.hold && (
        <p className={styles.criterionNote}>
          <strong className={readout.hold.ok ? styles.toneOk : styles.toneWarn}>
            유지 {readout.hold.seconds.toFixed(2)}초
          </strong>{" "}
          / 필요 {readout.hold.required.toFixed(1)}초 (A5)
        </p>
      )}

      {readout.phase && (
        <p className={styles.criterionNote}>
          국면 <strong className={styles.toneOk}>{readout.phase.id}</strong> {readout.phase.label}
          {readout.kickingLeg && ` · 차는 다리 ${readout.kickingLeg === "left" ? "왼쪽" : "오른쪽"}`}
        </p>
      )}

      {readout.criteria.map((c) => (
        <CriterionRow key={c.id} criterion={c} />
      ))}
    </section>
  );
}
