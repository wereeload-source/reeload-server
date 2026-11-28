import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators.js';
import type { AuthUser } from '../common/types.js';
import { NotificationsService } from './notifications.service.js';

/** In-app notices. Every role reads only their own. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notices: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('unread') unread?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number.parseInt(limit ?? '30', 10) || 30, 1), 100);
    return this.notices.list(user, unread === 'true', n);
  }

  @Post('read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.notices.markAllRead(user);
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notices.markRead(user, id);
  }
}
