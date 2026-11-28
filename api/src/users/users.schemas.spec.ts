import { CreateUser, UpdateUser } from './users.schemas.js';

const base = { email: 'new@reeload.local', password: 'password-1', full_name: 'New Person' };

describe('user input', () => {
  it('needs a base city for a reelmaker only', () => {
    expect(CreateUser.safeParse({ ...base, role: 'reelmaker' }).success).toBe(false);
    expect(CreateUser.safeParse({ ...base, role: 'reelmaker', base_city: 'Pune' }).success).toBe(true);
    expect(CreateUser.safeParse({ ...base, role: 'sales' }).success).toBe(true);
  });
  it('rejects an unknown role', () => {
    expect(CreateUser.safeParse({ ...base, role: 'owner' }).success).toBe(false);
  });
  it('needs at least one field to update', () => {
    expect(UpdateUser.safeParse({}).success).toBe(false);
    expect(UpdateUser.safeParse({ active: false }).success).toBe(true);
  });
});
