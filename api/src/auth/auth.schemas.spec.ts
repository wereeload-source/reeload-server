import { ChangePassword, ForgotPassword, Login, ResetPasswordInput, VerifyResetOtp } from './auth.schemas.js';

describe('login input', () => {
  const ok = { loginType: 'EMAIL_PASSWORD', identifier: 'kavya@reeload.local', password: 'x' } as const;
  it('accepts email or phone sign-in', () => {
    expect(Login.safeParse(ok).success).toBe(true);
    expect(Login.safeParse({ ...ok, loginType: 'PHONE_PASSWORD', identifier: '+919876500001' }).success).toBe(true);
  });
  it('rejects a missing password, an unknown login type and extra fields', () => {
    expect(Login.safeParse({ ...ok, password: '' }).success).toBe(false);
    expect(Login.safeParse({ ...ok, loginType: 'MAGIC' }).success).toBe(false);
    expect(Login.safeParse({ ...ok, role: 'admin' }).success).toBe(false);
  });
  it('wants 8 characters in a new password and refuses unknown fields', () => {
    expect(ChangePassword.safeParse({ current_password: 'a', new_password: 'short' }).success).toBe(false);
    expect(ChangePassword.safeParse({ current_password: 'a', new_password: 'long-enough' }).success).toBe(true);
    expect(ChangePassword.safeParse({ current_password: 'a', new_password: 'long-enough', extra: 1 }).success).toBe(false);
  });
});

describe('password reset input', () => {
  it('takes a 6-digit code only', () => {
    expect(VerifyResetOtp.safeParse({ identifier: '+919876500001', otp: '123456' }).success).toBe(true);
    expect(VerifyResetOtp.safeParse({ identifier: '+919876500001', otp: '12345' }).success).toBe(false);
    expect(VerifyResetOtp.safeParse({ identifier: '+919876500001', otp: 'abcdef' }).success).toBe(false);
  });
  it('allows WhatsApp for now', () => {
    expect(ForgotPassword.safeParse({ channel: 'WHATSAPP', identifier: '+919876500001' }).success).toBe(true);
    expect(ForgotPassword.safeParse({ channel: 'EMAIL', identifier: 'a@b.co' }).success).toBe(false);
  });
  it('wants exactly one of token or resetTicket, and 8 characters', () => {
    const ticket = 'a'.repeat(40);
    expect(ResetPasswordInput.safeParse({ newPassword: 'long-enough', resetTicket: ticket }).success).toBe(true);
    expect(ResetPasswordInput.safeParse({ newPassword: 'long-enough' }).success).toBe(false);
    expect(ResetPasswordInput.safeParse({ newPassword: 'long-enough', resetTicket: ticket, token: 'f'.repeat(64) }).success).toBe(false);
    expect(ResetPasswordInput.safeParse({ newPassword: 'short', resetTicket: ticket }).success).toBe(false);
  });
});
