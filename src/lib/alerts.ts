// src/lib/alerts.ts
// New-order audio chime and vibration with user-configurable mute setting

const MUTE_KEY = 'od-sound-muted';

export function isAlertMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(MUTE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAlertMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MUTE_KEY, muted ? 'true' : 'false');
  } catch {}
}

export function playNewOrderAlert(): void {
  if (typeof window === 'undefined') return;
  if (isAlertMuted()) return;

  // 1. Vibration: double gentle pulse [100ms, 50ms pause, 100ms]
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([100, 50, 100]);
    } catch {}
  }

  // 2. Audio Chime via Web Audio API (no external asset needed)
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // Harmonic two-tone pleasant notification: C5 (523.25Hz) -> E5 (659.25Hz)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now);
    osc1.frequency.exponentialRampToValueAtTime(659.25, now + 0.15);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(659.25, now);
    osc2.frequency.exponentialRampToValueAtTime(783.99, now + 0.15); // G5

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.35);
    osc2.stop(now + 0.35);

    osc1.onended = () => {
      ctx.close().catch(() => {});
    };
  } catch {}
}
