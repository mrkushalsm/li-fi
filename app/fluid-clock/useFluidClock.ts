import { useEffect, useRef } from 'react';

const SLOT_COUNT = 4;
const DIGIT_MAX = 9;
const PARTICLES_PER_UNIT = 16;
const GRAVITY = 0.22;
const DAMPING = 0.992;
const SPAWN_INTERVAL_MS = 38;
const DRAIN_INTERVAL_MS = 22;

type SlotRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type SlotState = {
  digit: number;
  targetCount: number;
  spawnClock: number;
  drainClock: number;
  readability: number;
};

type ParticleState = 'moving' | 'resting' | 'quit';

type SandParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  slot: number;
  hue: number;
  active: boolean;
  draining: boolean;
  effortScore: number;
  state: ParticleState;
};

type PersonalityMoment = 
  | 'none'
  | 'monday_morning'
  | 'lunchtime'
  | 'post_lunch'
  | 'five_oclock'
  | 'midnight_collapse'
  | 'midnight_reform';

type MidnightPhase = 'normal' | 'trembling' | 'falling' | 'heaped' | 'silence' | 'rising' | 'alive';

export type LazyClockRef = {
  laziness: number;
  slotReadability: number[];
  currentMoment: PersonalityMoment;
};

function randomIn(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function hhmmDigits(d: Date): [number, number, number, number] {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return [Number(hh[0]), Number(hh[1]), Number(mm[0]), Number(mm[1])];
}

function minuteKey(d: Date): string {
  return `${d.getHours()}:${d.getMinutes()}`;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w * 0.2, h * 0.2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

export default function useFluidClock(canvasRef: React.RefObject<HTMLCanvasElement | null>, lazyClockRef: React.MutableRefObject<LazyClockRef | null>): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let dpr = Math.max(1, window.devicePixelRatio || 1);
    let width = window.innerWidth;
    let height = window.innerHeight;
    let bgGradient: CanvasGradient | null = null;

    const slots: SlotRect[] = Array.from({ length: SLOT_COUNT }, () => ({ x: 0, y: 0, w: 0, h: 0 }));
    const slotStates: SlotState[] = Array.from({ length: SLOT_COUNT }, () => ({
      digit: 0,
      targetCount: 0,
      spawnClock: 0,
      drainClock: 0,
      readability: 1,
    }));
    const particles: SandParticle[] = [];
    const slotHues = [42, 38, 34, 30];
    let lastMinute = minuteKey(new Date());

    // Lazy Clock state
    let laziness = 0;
    let currentMoment: PersonalityMoment = 'none';
    let midnightPhase: MidnightPhase = 'normal';
    let midnightPhaseTime = 0;
    let attractStrength = 0.12;
    let lastPersonalityCheck = 0;

    const computeLaziness = (): number => {
      const now = new Date();
      const totalMins = now.getHours() * 60 + now.getMinutes();
      return totalMins / (24 * 60);
    };

    const getPersonalityMoment = (now: Date): PersonalityMoment => {
      const hour = now.getHours();
      const minute = now.getMinutes();

      if ((hour === 8 && minute === 59) || (hour === 9 && minute === 0)) return 'monday_morning';
      if (hour === 12 && minute === 0) return 'lunchtime';
      if (hour === 14 && minute === 30) return 'post_lunch';
      if (hour === 17 && minute === 0) return 'five_oclock';
      if ((hour === 23 && minute === 59) || (hour === 0 && minute === 0)) return 'midnight_collapse';
      if (hour === 0 && minute === 1) return 'midnight_reform';
      return 'none';
    };

    const countActiveInSlot = (slot: number): number => {
      let count = 0;
      for (const p of particles) {
        if (p.active && !p.draining && p.slot === slot && p.state !== 'quit') {
          count += 1;
        }
      }
      return count;
    };

    const updateSlotReadability = (): void => {
      for (let slot = 0; slot < SLOT_COUNT; slot++) {
        const state = slotStates[slot];
        const activeCount = countActiveInSlot(slot);
        const target = state.targetCount;
        state.readability = target > 0 ? Math.max(0, Math.min(1, activeCount / target)) : 0;
      }
    };

    const spawnParticle = (slot: number, settled: boolean): void => {
      const rect = slots[slot];
      const r = randomIn(1.6, 2.4);
      const effortScore = Math.random();
      particles.push({
        x: randomIn(rect.x + r + 4, rect.x + rect.w - r - 4),
        y: settled ? randomIn(rect.y + rect.h * 0.45, rect.y + rect.h - r - 2) : randomIn(rect.y - 80, rect.y - 8),
        vx: randomIn(-0.25, 0.25),
        vy: settled ? randomIn(-0.2, 0.4) : randomIn(0.4, 1.3),
        r,
        slot,
        hue: slotHues[slot],
        active: true,
        draining: false,
        effortScore,
        state: 'moving',
      });
    };

    const markOneParticleDraining = (slot: number): void => {
      // We drain one particle at a time to keep transitions legible and smooth.
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.active && !p.draining && p.slot === slot) {
          p.draining = true;
          p.vx = randomIn(-0.2, 0.2);
          p.vy = randomIn(1.2, 2.0);
          return;
        }
      }
    };

    const applyTimeTargets = (d: Date, initial: boolean): void => {
      const digits = hhmmDigits(d);
      for (let i = 0; i < SLOT_COUNT; i++) {
        slotStates[i].digit = digits[i];
        slotStates[i].targetCount = digits[i] * PARTICLES_PER_UNIT;
      }

      if (initial) {
        particles.length = 0;
        for (let i = 0; i < SLOT_COUNT; i++) {
          const count = slotStates[i].targetCount;
          for (let j = 0; j < count; j++) {
            spawnParticle(i, true);
          }
        }
      }
    };

    const computeLayout = (): void => {
      const usableWidth = Math.min(width * 0.88, 1100);
      const gap = Math.max(16, usableWidth * 0.03);
      const slotWidth = (usableWidth - gap * (SLOT_COUNT - 1)) / SLOT_COUNT;
      const slotHeight = Math.min(height * 0.5, 480);
      const totalHeight = slotHeight + 88;
      const startX = (width - usableWidth) / 2;
      const startY = Math.max(24, (height - totalHeight) / 2);

      for (let i = 0; i < SLOT_COUNT; i++) {
        slots[i].x = startX + i * (slotWidth + gap);
        slots[i].y = startY;
        slots[i].w = slotWidth;
        slots[i].h = slotHeight;
      }
    };

    const resizeCanvas = (): void => {
      dpr = Math.max(1, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      computeLayout();

      bgGradient = ctx.createLinearGradient(0, 0, 0, height);
      bgGradient.addColorStop(0, '#fafaf8');
      bgGradient.addColorStop(1, '#f0ebe4');
    };

    const drawScale = (slot: number, activeCount: number): void => {
      const rect = slots[slot];
      const state = slotStates[slot];
      const labelY = rect.y + rect.h + 28;

      ctx.fillStyle = 'rgba(32, 32, 32, 0.92)';
      ctx.font = '700 32px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${state.digit}`, rect.x + rect.w / 2, labelY + 36);

      // Readability label based on laziness
      const readLabel = describeDigit(state.digit, state.readability, laziness);
      ctx.fillStyle = `rgba(120, 120, 120, ${0.4 + laziness * 0.3})`;
      ctx.font = '400 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(readLabel, rect.x + rect.w / 2, labelY + 56);
    };

    const describeDigit = (digit: number, readability: number, laz: number): string => {
      if (laz > 0.9) {
        if (readability > 0.85) return `${digit}`;
        if (readability > 0.65) return `~${digit}?`;
        if (readability > 0.45) return `prob ${digit}`;
        if (readability > 0.25) return `was ${digit}`;
        return `trust us`;
      }
      if (readability > 0.9) return `${digit}`;
      if (readability > 0.75) return `~${digit}`;
      if (readability > 0.55) return `${digit}?`;
      return `...`;
    };

    const drawFrame = (): void => {
      ctx.clearRect(0, 0, width, height);

      if (bgGradient) {
        ctx.fillStyle = bgGradient;
      } else {
        ctx.fillStyle = '#f5f1ed';
      }
      ctx.fillRect(0, 0, width, height);

      for (let slot = 0; slot < SLOT_COUNT; slot++) {
        const rect = slots[slot];

        ctx.fillStyle = 'rgba(245, 241, 237, 0.5)';
        roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
        ctx.fill();

        ctx.strokeStyle = 'rgba(180, 170, 160, 0.5)';
        ctx.lineWidth = 1.2;
        roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 14);
        ctx.stroke();

        ctx.save();
        roundedRect(ctx, rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, 13);
        ctx.clip();

        for (const p of particles) {
          if (!p.active || p.draining || p.slot !== slot || p.state === 'quit') continue;
          ctx.fillStyle = `hsl(${p.hue}, 65%, 52%)`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();

        drawScale(slot, countActiveInSlot(slot));
      }

      for (const p of particles) {
        if (!p.active || !p.draining) continue;
        ctx.fillStyle = `hsl(${p.hue}, 68%, 48%)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      const gapCenterX = (slots[1].x + slots[1].w + slots[2].x) / 2;
      const dotY = slots[0].y + slots[0].h * 0.36;
      ctx.fillStyle = 'rgba(140, 130, 120, 0.5)';
      ctx.beginPath();
      ctx.arc(gapCenterX, dotY, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(gapCenterX, dotY + 40, 4.5, 0, Math.PI * 2);
      ctx.fill();
    };

    resizeCanvas();
    applyTimeTargets(new Date(), true);

    let rafId = 0;
    let prev = performance.now();

    const tick = (t: number): void => {
      const dt = Math.min(34, t - prev);
      prev = t;

      const now = new Date();
      laziness = computeLaziness();
      
      // Check personality moments once per minute
      if (now.getSeconds() === 0 && (t - lastPersonalityCheck) > 500) {
        currentMoment = getPersonalityMoment(now);
        lastPersonalityCheck = t;
      }

      // Handle midnight collapse state machine
      if (now.getHours() === 23 && now.getMinutes() === 59 && now.getSeconds() >= 0) {
        midnightPhaseTime += dt;
        if (midnightPhase === 'normal') {
          midnightPhase = 'trembling';
        } else if (midnightPhase === 'trembling' && midnightPhaseTime > 3000) {
          midnightPhase = 'falling';
          attractStrength = 0;
          // make all particles fall hard
          for (const p of particles) {
            if (p.active && !p.draining && p.state !== 'quit') {
              p.state = 'quit';
              p.vy = 0;
            }
          }
          midnightPhaseTime = 0;
        } else if (midnightPhase === 'falling' && midnightPhaseTime > 2000) {
          midnightPhase = 'heaped';
          midnightPhaseTime = 0;
        } else if (midnightPhase === 'heaped' && midnightPhaseTime > 2000) {
          midnightPhase = 'silence';
          midnightPhaseTime = 0;
        } else if (midnightPhase === 'silence' && midnightPhaseTime > 2000) {
          midnightPhase = 'rising';
          // Reset everything
          attractStrength = 0.12;
          for (const p of particles) {
            p.state = 'moving';
          }
          midnightPhaseTime = 0;
        } else if (midnightPhase === 'rising' && midnightPhaseTime > 3000) {
          midnightPhase = 'alive';
          midnightPhaseTime = 0;
        }
      } else if (now.getHours() !== 23 || now.getMinutes() !== 59) {
        // Reset midnight state outside of 23:59
        if (midnightPhase !== 'normal') {
          midnightPhase = 'normal';
          midnightPhaseTime = 0;
        }
      }

      // Apply lazy attractStrength overrides
      if (currentMoment === 'post_lunch') {
        attractStrength = 0.03;
      } else {
        attractStrength = 0.12 * (1 - Math.max(0, laziness - 0.6) * 0.5);
      }

      const currentMinute = minuteKey(now);
      if (currentMinute !== lastMinute) {
        applyTimeTargets(now, false);
        lastMinute = currentMinute;
      }

      for (let slot = 0; slot < SLOT_COUNT; slot++) {
        const state = slotStates[slot];
        let activeCount = countActiveInSlot(slot);

        if (activeCount < state.targetCount) {
          state.spawnClock += dt;
          while (state.spawnClock >= SPAWN_INTERVAL_MS && activeCount < state.targetCount) {
            spawnParticle(slot, false);
            state.spawnClock -= SPAWN_INTERVAL_MS;
            activeCount += 1;
          }
        } else if (activeCount > state.targetCount) {
          state.drainClock += dt;
          while (state.drainClock >= DRAIN_INTERVAL_MS && activeCount > state.targetCount) {
            markOneParticleDraining(slot);
            state.drainClock -= DRAIN_INTERVAL_MS;
            activeCount -= 1;
          }
        }
      }

      for (const p of particles) {
        if (!p.active) continue;

        if (p.state === 'quit') {
          // Quitter particles fall to bottom
          p.vy += GRAVITY * 1.8;
          p.vx *= 0.96;
          p.x += p.vx;
          p.y += p.vy;
          if (p.y > height + 40) {
            p.active = false;
          }
          continue;
        }

        if (p.draining) {
          p.vy += GRAVITY * 1.24;
          p.vx *= 0.99;
          p.x += p.vx;
          p.y += p.vy;
          if (p.y > height + 40) {
            p.active = false;
          }
          continue;
        }

        const rect = slots[p.slot];

        // Lazy behavior: check if this particle should give up
        if (laziness > 0.7 && p.effortScore < laziness - 0.5) {
          p.state = 'quit';
          p.vy = randomIn(0.5, 1.2);
          continue;
        }

        // Apply gravity and damping
        p.vy += GRAVITY;
        p.vx *= DAMPING;
        p.vy *= DAMPING;

        // Add drift if tired
        if (p.state === 'resting' && p.effortScore < laziness) {
          p.vx += (Math.random() - 0.5) * 0.04 * laziness;
          p.vy += (Math.random() - 0.5) * 0.04 * laziness;
        }

        p.x += p.vx;
        p.y += p.vy;

        const left = rect.x + p.r + 2;
        const right = rect.x + rect.w - p.r - 2;
        const top = rect.y + p.r + 2;
        const bottom = rect.y + rect.h - p.r - 2;

        // Collide with container walls
        if (p.x < left) {
          p.x = left;
          p.vx = Math.abs(p.vx) * 0.36;
        } else if (p.x > right) {
          p.x = right;
          p.vx = -Math.abs(p.vx) * 0.36;
        }

        if (p.y < top) {
          p.y = top;
          p.vy = Math.abs(p.vy) * 0.22;
        } else if (p.y > bottom) {
          p.y = bottom;
          p.state = 'resting';
          p.vy *= -0.18;
          p.vx *= 0.95;
          if (Math.abs(p.vy) < 0.08) {
            p.vy = 0;
          }

          // Lazy particles stop short of target
          if (laziness > 0.4 && p.effortScore > (1 - laziness)) {
            const stopGap = randomIn(8, 40) * Math.min(1, laziness);
            p.y = Math.max(p.y - stopGap, top);
          }
        }
      }

      updateSlotReadability();

      if (lazyClockRef && lazyClockRef.current) {
        lazyClockRef.current.laziness = laziness;
        lazyClockRef.current.slotReadability = slotStates.map(s => s.readability);
        lazyClockRef.current.currentMoment = currentMoment;
      }

      drawFrame();
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    window.addEventListener('resize', resizeCanvas);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(rafId);
    };
  }, [canvasRef, lazyClockRef]);
}
