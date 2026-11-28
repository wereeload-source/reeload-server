/** Job number 1 is RO-1001. */
export const jobCode = (number: number): string => `RO-${1000 + number}`;

/** "RO-1004", "ro1004" or "1004" -> the job number, or null when it is not a code. */
export function parseJobCode(text: string): number | null {
  const m = /^(?:ro-?)?(\d{4,})$/i.exec(text.trim());
  return m ? Number(m[1]) - 1000 : null;
}
