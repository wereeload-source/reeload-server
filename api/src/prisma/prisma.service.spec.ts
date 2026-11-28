import { pgOptions } from './prisma.service.js';

describe('database connection options', () => {
  it('passes the URL through when no CA certificate is set', () => {
    expect(pgOptions('postgresql://u:p@h:6543/db?sslmode=require')).toEqual({ connectionString: 'postgresql://u:p@h:6543/db?sslmode=require' });
  });
  it('verifies the server against the CA and drops URL ssl settings that would override it', () => {
    const o = pgOptions('postgresql://u:p@h:6543/db?sslmode=require&pgbouncer=true', '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----');
    expect(o.connectionString).toBe('postgresql://u:p@h:6543/db?pgbouncer=true');
    expect(o.ssl).toEqual({ ca: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----', rejectUnauthorized: true });
  });
});
