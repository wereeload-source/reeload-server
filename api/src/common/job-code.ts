/** Job number 1 is RL-1001 (RL = Reeload). */
export const jobCode = (number: number): string => `RL-${1000 + number}`;

/** "RL-1004", "rl1004", the older "RO-1004", or "1004" -> the job number, or null when it is not a code. */
export function parseJobCode(text: string): number | null {
  const m = /^(?:(?:rl|ro)-?)?(\d{4,})$/i.exec(text.trim());
  return m ? Number(m[1]) - 1000 : null;
}
