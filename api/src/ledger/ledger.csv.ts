/** One CSV cell: quoted when needed, and a leading = + - @ is neutralised so a spreadsheet does not run it as a formula. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean | bigint);
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: { key: string; label: string }[], items: Record<string, unknown>[]): string {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const lines = items.map((r) => columns.map((c) => csvCell(r[c.key])).join(','));
  return [head, ...lines].join('\r\n') + '\r\n';
}
