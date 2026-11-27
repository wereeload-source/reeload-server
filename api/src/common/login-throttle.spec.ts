import { LoginThrottle } from './login-throttle.js';

describe('LoginThrottle', () => {
  it('allows tries until the limit, then asks to wait', () => {
    const t = new LoginThrottle(3, 60_000);
    for (let i = 0; i < 3; i++) {
      expect(t.retryAfterSeconds('a', 1000 + i)).toBe(0);
      t.fail('a', 1000 + i);
    }
    expect(t.retryAfterSeconds('a', 2000)).toBeGreaterThan(0);
  });

  it('lets the key try again once the window has passed', () => {
    const t = new LoginThrottle(2, 60_000);
    t.fail('a', 0);
    t.fail('a', 1);
    expect(t.retryAfterSeconds('a', 30_000)).toBeGreaterThan(0);
    expect(t.retryAfterSeconds('a', 61_000)).toBe(0);
  });

  it('keeps keys apart, and a good sign-in clears the record', () => {
    const t = new LoginThrottle(1, 60_000);
    t.fail('a', 0);
    expect(t.retryAfterSeconds('a', 1)).toBeGreaterThan(0);
    expect(t.retryAfterSeconds('b', 1)).toBe(0);
    t.succeed('a');
    expect(t.retryAfterSeconds('a', 2)).toBe(0);
  });
});
