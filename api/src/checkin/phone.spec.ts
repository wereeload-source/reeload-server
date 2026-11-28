import { maskPhone, toWhatsAppNumber } from './phone.js';

describe('phone numbers', () => {
  it('adds India\'s code to ten-digit numbers', () => expect(toWhatsAppNumber('98450 11122')).toBe('919845011122'));
  it('keeps numbers that already have a country code', () => expect(toWhatsAppNumber('+91 98450 11122')).toBe('919845011122'));
  it('masks all but the last three digits', () => expect(maskPhone('9845011122')).toBe('•••••••122'));
});
