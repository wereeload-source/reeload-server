import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import { Can } from '@nestjs/authorization';
import { z } from 'zod';
import type { AuthUser } from '../common/types.js';
import { NotificationsService } from './notifications.service.js';

const ListQuery = z.object({
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** Every signed-in role reads only their own notices. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notices: NotificationsService) {}

  @Get()
  @Can.Anyone()
  list(@CurrentUser() user: AuthUser, @Query({ schema: ListQuery }) q: { unread: boolean; limit: number }) {
    return this.notices.list(user, q.unread, q.limit);
  }

  @Post('read-all')
  @Can.Anyone()
  readAll(@CurrentUser() user: AuthUser) {
    return this.notices.markAllRead(user);
  }

  @Post(':id/read')
  @Can.Anyone()
  read(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notices.markRead(user, id);
  }
}
