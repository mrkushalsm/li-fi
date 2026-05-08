"use client";

import { useRef } from 'react';
import useFluidClock, { LazyClockRef } from './useFluidClock';
import styles from './clock.module.css';

export default function FluidClockPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lazyClockRef = useRef<LazyClockRef | null>(null);

  // The hook owns sizing, timing updates, and particle drawing.
  useFluidClock(canvasRef, lazyClockRef);

  return (
    <main className={styles.main}>
      <canvas ref={canvasRef} className={styles.canvas} />
    </main>
  );
}
