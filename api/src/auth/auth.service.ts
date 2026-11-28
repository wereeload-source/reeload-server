import { BadRequestException, HttpException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DbService, one } from '../common/db.js';
import { env } from '../common/env.js';
import { signToken } from '../common/jwt.js';
import { LoginThrottle } from '../common/login-throttle.js';
import { LOGIN_SQL, ME_SQL, PASSWORD_OK_SQL, SET_PASSWORD_SQL } from './auth.sql.js';

@Injectable()
export class AuthService {
  private readonly throttle = new LoginThrottle(5, 15 * 60_000);

  constructor(private readonly db: DbService) {}

  async login(email: string, password: string) {
    const wait = this.throttle.retryAfterSeconds(email);
    if (wait > 0) throw new HttpException(`Too many wrong passwords. Try again in ${Math.ceil(wait / 60)} minutes.`, 429);

    const found = await this.db.asService((tx) => one<{ id: string }>(tx, LOGIN_SQL, [email, password]));
    if (!found) {
      this.throttle.fail(email);
      // Same message for a wrong password, an unknown email and a disabled account.
      throw new UnauthorizedException('Wrong email or password');
    }
    this.throttle.succeed(email);

    const ttl = env.jwtTtlHours * 3600;
    const token = signToken(found.id, env.jwtSecret, ttl);
    const user = await this.me(found.id);
    return { token, expires_at: new Date(Date.now() + ttl * 1000).toISOString(), user };
  }

  async me(userId: string) {
    const user = await this.db.asUser(userId, (tx) => one(tx, ME_SQL, [userId]));
    if (!user) throw new NotFoundException('Profile not found');
    return user;
  }

  async changePassword(userId: string, current: string, next: string): Promise<{ ok: true }> {
    await this.db.asService(async (tx) => {
      if (!(await one(tx, PASSWORD_OK_SQL, [userId, current]))) throw new BadRequestException('Your current password is wrong');
      await one(tx, SET_PASSWORD_SQL, [userId, next]);
    }, userId);
    return { ok: true };
  }
}
