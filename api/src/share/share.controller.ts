import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, Public, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CreateShareLink, type CreateShareLinkInput } from './share.schemas.js';
import { ShareService } from './share.service.js';

const uuid = () => new ParseUUIDPipe();

@Controller()
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Post('jobs/:id/share-links')
  @Roles('ops', 'admin')
  create(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(CreateShareLink)) body: CreateShareLinkInput) {
    return this.share.create(user, id, body);
  }

  @Get('jobs/:id/share-links')
  @Roles('ops', 'admin')
  list(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.share.list(user, id);
  }

  @Post('share-links/:id/revoke')
  @Roles('ops', 'admin')
  revoke(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.share.revoke(user, id);
  }

  /** The client's download page data. No sign-in: the token is the key. */
  @Public()
  @Get('public/share/:token')
  resolve(@Param('token') token: string) {
    return this.share.resolve(token);
  }

  /** Daily clean-up, called by a scheduler. Needs the `x-cron-secret` header. */
  @Public()
  @Post('retention/sweep')
  @HttpCode(200)
  sweep(@Headers('x-cron-secret') secret?: string) {
    return this.share.sweep(secret);
  }
}
