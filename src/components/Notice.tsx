import type { ReactNode } from "react";
import styles from "@/styles/studio.module.css";

export type NoticeTone = "info" | "warn" | "bad";

const TONE_CLASS: Record<NoticeTone, string> = {
  info: styles.noticeInfo,
  warn: styles.noticeWarn,
  bad: styles.noticeBad,
};

/**
 * 화면 위쪽 알림 띠.
 *
 * 이 앱에서 "조용히 넘어가는 실패"는 없어야 한다. 샘플이 없어서 내장 시퀀스로
 * 떨어졌다거나, 판정 코어가 아직 안 붙었다거나, 카메라 권한이 거부됐다거나 —
 * 전부 여기로 나온다.
 */
export function Notice({
  tone = "info",
  tag,
  children,
}: {
  tone?: NoticeTone;
  tag: string;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.notice} ${TONE_CLASS[tone]}`} role="status">
      <span className={styles.noticeTag}>{tag}</span>
      <span>{children}</span>
    </div>
  );
}
