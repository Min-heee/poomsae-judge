"use client";

/**
 * 3D 스켈레톤 뷰.
 *
 * 정면 한 각도로는 무릎이 얼마나 굽었는지 눈으로 확인하기 어렵다. 돌려 볼 수 있으면
 * "판정이 본 것"과 "내가 본 것"을 맞춰 볼 수 있다(docs/PRD.md F4).
 *
 * `@react-three/fiber` 를 쓰지 않는다. 그릴 것이 구 33개와 선분 35개뿐이고
 * 프레임을 우리가 직접 제어하므로 명령형 three.js 가 더 짧고 결정적이다.
 * 의존성도 둘 줄어든다(docs/TECH-NOTES.md 6절).
 *
 * 좌표 변환: 판정 좌표는 y가 아래로 증가한다. three.js 는 y가 위이므로 뒤집는다.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { LM, POSE_EDGES } from "@/judge/landmarks";
import type { Landmark } from "@/judge/types";
import styles from "@/styles/studio.module.css";

const JOINT_COUNT = 33;
/** 사람이 화면에 적당히 차도록 어깨너비를 이 값으로 맞춘다(미터 가정). */
const TARGET_SHOULDER = 0.44;

const CORE = new Set([11, 12, 23, 24, 25, 26, 27, 28]);

/**
 * 관절 색. 재질 색은 흰색으로 두고 인스턴스 색으로 칠한다 —
 * 그래야 같은 메시 안에서 점마다 색을 달리할 수 있다.
 */
const COLOR_JOINT = new THREE.Color(0x9fb6d6);
const COLOR_CORE = new THREE.Color(0x7aa2f7);
/** 감점·보류가 걸린 항목이 읽은 관절. 판정 패널의 '감점' 색과 맞춘다. */
const COLOR_FLAGGED = new THREE.Color(0xff6b81);

/** 참조가 매번 바뀌면 useEffect 가 헛돈다. 빈 강조는 이 하나를 공유한다. */
const NO_HIGHLIGHT: readonly number[] = [];

export interface Skeleton3DProps {
  frame: Landmark[] | null;
  /**
   * 감점·보류가 걸린 항목이 읽은 관절 번호(`judgementJoints`).
   * 이 점들만 색을 달리 칠한다 — 3D 뷰가 판정과 같은 곳을 가리키게 하는 부분이다.
   * 판정이 아무것도 짚지 않았으면 빈 배열이고, 그때는 강조도 없다.
   */
  highlight?: readonly number[];
}

export function Skeleton3D({ frame, highlight = NO_HIGHLIGHT }: Skeleton3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<{
    update(frame: Landmark[] | null, highlight: readonly number[]): void;
    dispose(): void;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x0d1117, 1);
    renderer.domElement.className = styles.threeCanvas;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute(
      "aria-label",
      "3D 스켈레톤. 끌어서 돌리고 휠로 확대합니다. 키보드 화살표로도 돌릴 수 있습니다.",
    );
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 50);

    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1.2, 2, 2.4);
    scene.add(key);

    const grid = new THREE.GridHelper(2.4, 12, 0x2b3644, 0x1c2430);
    grid.position.y = -0.95;
    scene.add(grid);

    const jointGeom = new THREE.SphereGeometry(0.022, 12, 12);
    // 흰색 재질 × 인스턴스 색 = 최종 색. 점마다 다른 색을 칠하려는 것이다.
    const jointMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const coreMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const joints = new THREE.InstancedMesh(jointGeom, jointMat, JOINT_COUNT);
    joints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(joints);

    const coreJoints = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.034, 14, 14),
      coreMat,
      CORE.size,
    );
    coreJoints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(coreJoints);

    const lineGeom = new THREE.BufferGeometry();
    const linePos = new Float32Array(POSE_EDGES.length * 2 * 3);
    lineGeom.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    const bones = new THREE.LineSegments(
      lineGeom,
      new THREE.LineBasicMaterial({ color: 0x6c88b0 }),
    );
    scene.add(bones);

    // ── 카메라 궤도 (직접 구현: OrbitControls 없이, 키보드까지 받는다) ──
    let theta = 0.35;
    let phi = Math.PI / 2 - 0.18;
    let radius = 2.35;
    let dirty = true;

    const applyCamera = () => {
      const sinPhi = Math.sin(phi);
      camera.position.set(
        radius * sinPhi * Math.sin(theta),
        radius * Math.cos(phi),
        radius * sinPhi * Math.cos(theta),
      );
      camera.lookAt(0, -0.05, 0);
    };

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const el = renderer.domElement;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      theta -= (e.clientX - lastX) * 0.008;
      phi = clampPhi(phi - (e.clientY - lastY) * 0.006);
      lastX = e.clientX;
      lastY = e.clientY;
      dirty = true;
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      radius = Math.min(6, Math.max(1.4, radius + e.deltaY * 0.0022));
      dirty = true;
    };
    const onKey = (e: KeyboardEvent) => {
      const step = 0.12;
      if (e.key === "ArrowLeft") theta += step;
      else if (e.key === "ArrowRight") theta -= step;
      else if (e.key === "ArrowUp") phi = clampPhi(phi - step);
      else if (e.key === "ArrowDown") phi = clampPhi(phi + step);
      else if (e.key === "+" || e.key === "=") radius = Math.max(1.4, radius - 0.2);
      else if (e.key === "-") radius = Math.min(6, radius + 0.2);
      else return;
      e.preventDefault();
      dirty = true;
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("keydown", onKey);

    const resize = () => {
      const w = host.clientWidth || 640;
      const h = host.clientHeight || 340;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      dirty = true;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    // ── 스켈레톤 갱신 ──
    const m = new THREE.Matrix4();
    let scale = 1;
    let scaleFixed = false;

    const update = (lms: Landmark[] | null, flagged: readonly number[]) => {
      joints.visible = lms !== null;
      coreJoints.visible = lms !== null;
      bones.visible = lms !== null;
      if (!lms) {
        dirty = true;
        return;
      }

      const flaggedSet = flagged.length > 0 ? new Set(flagged) : null;

      if (!scaleFixed) {
        const a = lms[LM.leftShoulder];
        const b = lms[LM.rightShoulder];
        const width = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
        if (width > 1e-4) {
          scale = TARGET_SHOULDER / width;
          scaleFixed = true;
        }
      }

      const px = (lm: Landmark) => [lm.x * scale, -lm.y * scale, lm.z * scale] as const;

      let coreIndex = 0;
      for (let i = 0; i < JOINT_COUNT; i += 1) {
        const [x, y, z] = px(lms[i]);
        const isFlagged = flaggedSet?.has(i) ?? false;
        if (CORE.has(i)) {
          m.makeTranslation(x, y, z);
          coreJoints.setMatrixAt(coreIndex, m);
          coreJoints.setColorAt(coreIndex, isFlagged ? COLOR_FLAGGED : COLOR_CORE);
          coreIndex += 1;
          // 큰 구가 따로 있으므로 작은 구는 화면 밖으로 치운다.
          m.makeTranslation(0, 1e6, 0);
          joints.setMatrixAt(i, m);
          joints.setColorAt(i, COLOR_JOINT);
        } else {
          m.makeTranslation(x, y, z);
          joints.setMatrixAt(i, m);
          joints.setColorAt(i, isFlagged ? COLOR_FLAGGED : COLOR_JOINT);
        }
      }
      joints.instanceMatrix.needsUpdate = true;
      coreJoints.instanceMatrix.needsUpdate = true;
      // setColorAt 이 처음 불린 뒤에야 instanceColor 가 생긴다. 없으면 건너뛴다.
      if (joints.instanceColor) joints.instanceColor.needsUpdate = true;
      if (coreJoints.instanceColor) coreJoints.instanceColor.needsUpdate = true;

      for (let e = 0; e < POSE_EDGES.length; e += 1) {
        const [a, b] = POSE_EDGES[e];
        const [ax, ay, az] = px(lms[a]);
        const [bx, by, bz] = px(lms[b]);
        const o = e * 6;
        linePos[o] = ax;
        linePos[o + 1] = ay;
        linePos[o + 2] = az;
        linePos[o + 3] = bx;
        linePos[o + 4] = by;
        linePos[o + 5] = bz;
      }
      lineGeom.attributes.position.needsUpdate = true;
      // 빼먹으면 프러스텀 컬링이 스켈레톤을 통째로 지운다.
      lineGeom.computeBoundingSphere();
      dirty = true;
    };

    let raf = 0;
    const loop = () => {
      if (dirty) {
        applyCamera();
        renderer.render(scene, camera);
        dirty = false;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    apiRef.current = {
      update,
      dispose() {
        cancelAnimationFrame(raf);
        observer.disconnect();
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("keydown", onKey);
        // InstancedMesh.dispose() 가 instanceMatrix·instanceColor 버퍼를 놓아 준다.
        // 인스턴스 색을 쓰기 시작했으므로 이걸 빼먹으면 버퍼가 남는다.
        joints.dispose();
        coreJoints.dispose();
        jointGeom.dispose();
        jointMat.dispose();
        coreMat.dispose();
        coreJoints.geometry.dispose();
        lineGeom.dispose();
        (bones.material as THREE.Material).dispose();
        grid.geometry.dispose();
        (grid.material as THREE.Material).dispose();
        renderer.dispose();
        if (el.parentNode) el.parentNode.removeChild(el);
      },
    };

    return () => {
      apiRef.current?.dispose();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    apiRef.current?.update(frame, highlight);
  }, [frame, highlight]);

  return (
    <section className={styles.card} aria-label="3D 스켈레톤">
      <h2 className={styles.cardTitle}>3D 스켈레톤 — 끌어서 돌리기</h2>
      <div className={styles.threeWrap} ref={hostRef}>
        <span className={styles.threeHint}>드래그 회전 · 휠 확대 · 화살표 키</span>
      </div>
      <p className={styles.empty}>
        {highlight.length > 0 ? (
          <>
            붉은 점은 감점·보류가 걸린 항목이 실제로 읽은 관절입니다({highlight.length}개). 돌려
            보면 판정이 무엇을 보고 그렇게 판단했는지 확인할 수 있습니다.
          </>
        ) : (
          // 전체 보류면 항목 자체가 없어 강조할 관절도 없다.
          // "감점이 없다"고 단정하지 않는 문장이어야 보류와 만점이 섞이지 않는다.
          "이 판정에서 강조할 관절이 없습니다."
        )}
      </p>
    </section>
  );
}

function clampPhi(v: number): number {
  return Math.min(Math.PI - 0.12, Math.max(0.12, v));
}
