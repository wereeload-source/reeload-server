import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, one, rows } from '../common/db.js';
import type { AuthUser } from '../common/types.js';
import {
  AUDIT_SQL, GET_USER_SQL, HAS_REELMAKER_SQL, INSERT_AUTH_USER_SQL, INSERT_PROFILE_SQL, LIST_USERS_SQL,
  SET_PASSWORD_ADMIN_SQL, UPSERT_REELMAKER_SQL, updateProfileSql, type UpdatableColumn,
} from './users.sql.js';
import type { CreateUserInput, UpdateUserInput } from './users.schemas.js';

@Injectable()
export class UsersService {
  constructor(private readonly db: DbService) {}

  list(admin: AuthUser) {
    return this.db.asUser(admin.id, (tx) => rows(tx, LIST_USERS_SQL));
  }

  async create(admin: AuthUser, body: CreateUserInput) {
    const id = await this.db
      .asService(async (tx) => {
        const created = await one<{ id: string }>(tx, INSERT_AUTH_USER_SQL, [body.email, body.password, body.full_name]);
        const userId = created!.id;
        await tx.query(INSERT_PROFILE_SQL, [userId, body.full_name, body.phone ?? null, body.email, body.role]);
        if (body.role === 'reelmaker') {
          await tx.query(UPSERT_REELMAKER_SQL, [userId, body.kind ?? null, body.base_city ?? null]);
        }
        await tx.query(AUDIT_SQL, ['user_created', userId, JSON.stringify({ email: body.email, role: body.role })]);
        return userId;
      }, admin.id)
      .catch((e: unknown) => {
        if ((e as { code?: string }).code === '23505') throw new ConflictException('A user with that email already exists');
        throw e;
      });
    return this.get(admin, id);
  }

  async get(admin: AuthUser, id: string) {
    const user = await this.db.asUser(admin.id, (tx) => one(tx, GET_USER_SQL, [id]));
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(admin: AuthUser, id: string, body: UpdateUserInput) {
    // An admin who disables or demotes themselves could lock everyone out.
    if (id === admin.id && (body.active === false || (body.role !== undefined && body.role !== 'admin'))) {
      throw new BadRequestException('You cannot disable or demote your own account');
    }

    await this.db.asUser(admin.id, async (tx) => {
      const columns = (['full_name', 'phone', 'active', 'role'] as const).filter((c) => body[c] !== undefined) as UpdatableColumn[];
      if (columns.length) {
        const updated = await one(tx, updateProfileSql(columns), [id, ...columns.map((c) => body[c] ?? null)]);
        if (!updated) throw new NotFoundException('User not found');
      } else if (!(await one(tx, GET_USER_SQL, [id]))) {
        throw new NotFoundException('User not found');
      }

      const current = await one<{ role: string }>(tx, 'select role from public.profiles where id = $1::uuid', [id]);
      if (current?.role === 'reelmaker') {
        const exists = await one(tx, HAS_REELMAKER_SQL, [id]);
        if (!exists && !body.base_city) throw new BadRequestException("Enter the reelmaker's base city");
        if (!exists || body.kind !== undefined || body.base_city !== undefined) {
          await tx.query(UPSERT_REELMAKER_SQL, [id, body.kind ?? null, body.base_city ?? null]);
        }
      }
    });
    return this.get(admin, id);
  }

  async resetPassword(admin: AuthUser, id: string, password: string): Promise<{ ok: true }> {
    const done = await this.db.asService(async (tx) => {
      const r = await one(tx, SET_PASSWORD_ADMIN_SQL, [id, password]);
      if (r) await tx.query(AUDIT_SQL, ['password_reset', id, '{}']);
      return r;
    }, admin.id);
    if (!done) throw new NotFoundException('User not found');
    return { ok: true };
  }
}
