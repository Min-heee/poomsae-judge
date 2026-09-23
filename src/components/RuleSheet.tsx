"use client";

import { useState } from "react";
import { holdRulesFor, RULE_TABLE, type MotionKind } from "@/pose";
import styles from "@/styles/studio.module.css";

/**
 * 앱 안에서 읽는 규칙 표 (docs/PRD.md F7).
 *
 * 문서를 따로 열지 않아도 경계값을 확인할 수 있어야 한다. 그리고 이 표의 숫자는
 * 판정 코어의 상수 파일에서 직접 읽어 온 값이다 — 문서와 코드가 어긋나는 순간
 * 이 프로젝트의 주장이 무너지기 때문이다.
 */
export function RuleSheet({ motion }: { motion: MotionKind }) {
  const [open, setOpen] = useState(false);
  const table = RULE_TABLE[motion];
  // 보류 규칙도 이 동작에 걸리는 것만 띄운다 — 앞차기 표에 주춤서기 전용 조건(H7)을
  // 같이 늘어놓으면, 규칙 표가 이 동작에서 일어날 수 없는 일을 약속하게 된다.
  const holdRules = holdRulesFor(motion);

  return (
    <section className={styles.card} aria-label="규칙 표">
      <button
        type="button"
        className={styles.rulesToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} {table.title} · 경계값 보기
      </button>

      {open && (
        <>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <caption className={styles.srOnly}>
                {table.title}의 항목별 측정 방법과 등급 경계
              </caption>
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">항목</th>
                  <th scope="col">무엇을 재는가</th>
                  <th scope="col">합격</th>
                  <th scope="col">0.1 감점</th>
                  <th scope="col">0.3 감점</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{row.title}</td>
                    <td>{row.metric}</td>
                    <td>{row.pass}</td>
                    <td>{row.minor}</td>
                    <td>{row.major}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.holdList}>
            <strong>판정 보류 조건</strong>
            {holdRules.map((h) => (
              <div key={h.code}>
                <span className={styles.holdCode}>{h.code}</span>
                {h.text}
              </div>
            ))}
            <p>
              보류는 실패가 아닙니다. 검출 오차가 등급을 바꿀 수 있는 구간에서는 점수를 주지 않고,
              그 사실과 프레임 번호를 남깁니다.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
