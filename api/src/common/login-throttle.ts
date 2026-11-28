/**
 * Slows down password guessing: after `max` failed sign-ins for the same key inside the window,
 * further tries are refused until the window passes. In memory, so it resets when the API
 * restarts and is per instance. Good enough for one internal team; use a shared store at scale.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Seconds to wait, or 0 when the key may try. */
  retryAfterSeconds(key: string, now: number = Date.now()): number {
    const list = this.recent(key, now);
    if (list.length < this.max) return 0;
    return Math.ceil((list[0]! + this.windowMs - now) / 1000);
  }

  fail(key: string, now: number = Date.now()): void {
    this.failures.set(key, [...this.recent(key, now), now]);
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }
}
