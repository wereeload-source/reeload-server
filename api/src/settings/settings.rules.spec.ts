import { SETTING_DEFAULTS, SETTING_KEYS, SETTING_RULES } from './settings.rules.js';

describe('setting rules', () => {
  it('keeps edited reels 15 to 20 days', () => {
    expect(SETTING_RULES.edited_retention_days.safeParse(14).success).toBe(false);
    expect(SETTING_RULES.edited_retention_days.safeParse(15).success).toBe(true);
    expect(SETTING_RULES.edited_retention_days.safeParse(21).success).toBe(false);
  });
  it('takes a yes or no for raw sharing', () => {
    expect(SETTING_RULES.share_include_raw.safeParse(true).success).toBe(true);
    expect(SETTING_RULES.share_include_raw.safeParse('true').success).toBe(false);
  });
  it('rejects fractions', () => expect(SETTING_RULES.share_link_days.safeParse(7.5).success).toBe(false));
});

describe('setting defaults', () => {
  it('has a default that passes its own rule for every setting', () => {
    for (const key of SETTING_KEYS) expect(SETTING_RULES[key].safeParse(SETTING_DEFAULTS[key]).success).toBe(true);
  });
});
