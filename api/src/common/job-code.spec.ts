import { jobCode, parseJobCode } from './job-code.js';

describe('job codes', () => {
  it('writes RL- codes from the job number', () => {
    expect(jobCode(1)).toBe('RL-1001');
    expect(jobCode(42)).toBe('RL-1042');
  });
  it('reads new codes, old RO- codes and bare numbers', () => {
    expect(parseJobCode('RL-1004')).toBe(4);
    expect(parseJobCode('rl1004')).toBe(4);
    expect(parseJobCode('RO-1004')).toBe(4);
    expect(parseJobCode(' 1004 ')).toBe(4);
  });
  it('ignores anything that is not a code', () => {
    expect(parseJobCode('Hyderabad')).toBeNull();
    expect(parseJobCode('RL-12')).toBeNull();
  });
});
