// src/domain/timer.ts
// Order Ticket Age Timer & Lateness Calculator
// Rules from docs/DESIGN.md:96 & docs/04-ui-ux-design-brief.md:
// Neutral by default, amber near promised time, red ONLY when late.

export type TimerSeverity = 'neutral' | 'amber' | 'red';

export interface AgeTimerInfo {
  ageMinutes: number;
  dueInMinutes: number | null;
  severity: TimerSeverity;
  isLate: boolean;
  minutesLate: number;
  displayTimer: string;
}

export function getAgeTimerInfo(
  createdAtIso: string,
  dueAtIso?: string | null,
  now: Date = new Date()
): AgeTimerInfo {
  const createdTime = new Date(createdAtIso).getTime();
  const nowTime = now.getTime();
  const ageMs = Math.max(0, nowTime - createdTime);
  const ageMinutes = Math.floor(ageMs / 60_000);

  if (!dueAtIso) {
    // If no promised time, stays neutral unless older than 45 min
    const severity: TimerSeverity = ageMinutes >= 45 ? 'amber' : 'neutral';
    return {
      ageMinutes,
      dueInMinutes: null,
      severity,
      isLate: false,
      minutesLate: 0,
      displayTimer: `${ageMinutes}m`,
    };
  }

  const dueTime = new Date(dueAtIso).getTime();
  const diffMs = dueTime - nowTime;
  const dueInMinutes = Math.round(diffMs / 60_000);

  // Late: now has passed dueAt
  if (nowTime > dueTime) {
    const minutesLate = Math.max(1, Math.floor((nowTime - dueTime) / 60_000));
    return {
      ageMinutes,
      dueInMinutes,
      severity: 'red',
      isLate: true,
      minutesLate,
      displayTimer: `+${minutesLate}m`,
    };
  }

  // Total promised duration
  const totalDurationMs = Math.max(60_000, dueTime - createdTime);
  const elapsedRatio = ageMs / totalDurationMs;

  // Amber if within 5 minutes of due time OR >= 80% elapsed
  if (dueInMinutes <= 5 || elapsedRatio >= 0.8) {
    return {
      ageMinutes,
      dueInMinutes,
      severity: 'amber',
      isLate: false,
      minutesLate: 0,
      displayTimer: `${ageMinutes}m`,
    };
  }

  // Neutral by default
  return {
    ageMinutes,
    dueInMinutes,
    severity: 'neutral',
    isLate: false,
    minutesLate: 0,
    displayTimer: `${ageMinutes}m`,
  };
}
