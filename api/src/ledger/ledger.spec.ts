import { csvCell, toCsv } from './ledger.csv.js';
import { ledgerTotals, receiptNumber } from './ledger.js';

describe('ledger totals', () => {
  it('adds agreed amount and approved changes, and counts only positive balances as outstanding', () => {
    const t = ledgerTotals([
      { agreed_amount: '5000.00', approved_changes: '500.00', advance: '1000.00', received: '2000.00', balance: '3500.00' },
      { agreed_amount: '3000.00', approved_changes: '0', advance: '3000.00', received: '3200.00', balance: '-200.00' },
    ]);
    expect(t.total).toBe(8500);
    expect(t.received).toBe(5200);
    expect(t.balance).toBe(3300);
    expect(t.outstanding).toBe(3500);
  });
  it('treats missing money as zero', () => expect(ledgerTotals([{}]).total).toBe(0));
});

describe('receipt numbers', () => {
  it('is the job code plus six characters of the payment id', () => expect(receiptNumber('RL-1042', 'ab12cd34-0000-0000-0000-000000000000')).toBe('RCPT-RL-1042-AB12CD'));
});

describe('CSV export', () => {
  it('quotes commas, quotes and new lines', () => {
    expect(csvCell('Rao, Sons')).toBe('"Rao, Sons"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
  it('defuses spreadsheet formulas but keeps negative numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toContain("'=");
    expect(csvCell('-200.00')).toBe('-200.00');
  });
  it('writes a header and one line per job', () => {
    const csv = toCsv([{ key: 'code', label: 'Job' }, { key: 'balance', label: 'Balance' }], [{ code: 'RL-1', balance: '10.00' }]);
    expect(csv).toBe('Job,Balance\r\nRL-1,10.00\r\n');
  });
});
