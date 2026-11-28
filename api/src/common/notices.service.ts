import { Injectable } from '@nestjs/common';
import type { Db } from '../prisma/db.js';
import type { Role } from './types.js';

/** In-app notices (the bell). */
@Injectable()
export class NoticesService {
  toUser(db: Db, userId: string, title: string, body?: string, link?: string) {
    return db.notification.create({ data: { userId, title, body, link } });
  }

  /** Everyone holding one of the roles (active accounts only). */
  async toRoles(db: Db, roles: Role[], title: string, body?: string, link?: string) {
    const users = await db.user.findMany({ where: { role: { in: roles }, active: true }, select: { id: true } });
    if (users.length) await db.notification.createMany({ data: users.map((u) => ({ userId: u.id, title, body, link })) });
  }
}
