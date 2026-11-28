import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../common/types.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** In-app notices. Every role reads only their own. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, unreadOnly: boolean, limit: number) {
    const [unread, items] = await Promise.all([
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      this.prisma.notification.findMany({
        where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
        select: { id: true, title: true, body: true, link: true, readAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);
    return { unread, items };
  }

  async markRead(user: AuthUser, id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  async markAllRead(user: AuthUser) {
    const done = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true, marked: done.count };
  }
}
