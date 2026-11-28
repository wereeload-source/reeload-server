import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, Public } from '../auth/decorators.js';
import { Can } from '@nestjs/authorization';
import { Throttle } from '@nestjs/throttler';
import { AccessPolicy } from '../access/access.policy.js';
import type { AuthUser } from '../common/types.js';
import { CreateShareLink, type CreateShareLinkInput } from './share.schemas.js';
import { ShareService } from './share.service.js';

const uuid = () => new ParseUUIDPipe();

@Controller()
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Post('jobs/:id/share-links')
  @Can(AccessPolicy, 'manageShareLinks')
  create(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: CreateShareLink }) body: CreateShareLinkInput) {
    return this.share.create(user, id, body);
  }

  @Get('jobs/:id/share-links')
  @Can(AccessPolicy, 'manageShareLinks')
  list(@Param('id', uuid()) id: string) {
    return this.share.list(id);
  }

  @Post('share-links/:id/revoke')
  @Can(AccessPolicy, 'manageShareLinks')
  revoke(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.share.revoke(user, id);
  }

  /** The client's download page data. No sign-in: the token is the key. Rate limited against guessing. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('public/share/:token')
  resolve(@Param('token') token: string) {
    return this.share.resolve(token);
  }
}
