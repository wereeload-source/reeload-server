import { ChangePassword, Login } from './auth.schemas.js';

describe('login input', () => {
  it('lower-cases and trims the email', () => {
    expect(Login.parse({ email: '  Kavya@ReelOps.local ', password: 'x' }).email).toBe('kavya@reelops.local');
  });
  it('rejects a missing password or a bad email', () => {
    expect(Login.safeParse({ email: 'kavya@reelops.local', password: '' }).success).toBe(false);
    expect(Login.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });
  it('wants 8 characters in a new password', () => {
    expect(ChangePassword.safeParse({ current_password: 'a', new_password: 'short' }).success).toBe(false);
    expect(ChangePassword.safeParse({ current_password: 'a', new_password: 'long-enough' }).success).toBe(true);
  });
});
