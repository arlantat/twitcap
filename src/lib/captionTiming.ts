/** Pure caption timeline helpers (player sync). */

export type TimingCue = { start: number; end: number; text: string };

/**
 * Pick the caption text covering media time `t`.
 * `offsetSec` > 0 means captions lag voice → look earlier on the timeline
 * (`t_effective = t - offsetSec`).
 */
export function cueAtTime(
  cues: TimingCue[],
  t: number,
  offsetSec = 0
): string {
  const effective = t - offsetSec;
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  let best: TimingCue | undefined;
  for (const c of sorted) {
    if (c.start > effective) break;
    if (effective >= c.start && effective <= c.end) best = c;
  }
  return best?.text ?? "";
}
