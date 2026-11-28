import { Injectable } from '@nestjs/common';
import { DbService, one, rows } from '../common/db.js';
import type { AuthUser } from '../common/types.js';
import { LIST_NOTICES_SQL, MARK_ALL_READ_SQL, MARK_READ_SQL, UNREAD_COUNT_SQL } from './notifications.sql.js';

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DbService) {}

  list(user: AuthUser, unreadOnly: boolean, limit: number) {
    return this.db.asUser(user.id, async (tx) => ({
      unread: (await one<{ unread: number }>(tx, UNREAD_COUNT_SQL))?.unread ?? 0,
      items: await rows(tx, LIST_NOTICES_SQL, [unreadOnly, limit]),
    }));
  }

  async markRead(user: AuthUser, id: string) {
    await this.db.asUser(user.id, (tx) => rows(tx, MARK_READ_SQL, [id]));
    return { ok: true };
  }

  async markAllRead(user: AuthUser) {
    const done = await this.db.asUser(user.id, (tx) => rows(tx, MARK_ALL_READ_SQL));
    return { ok: true, marked: done.length };
  }
}
