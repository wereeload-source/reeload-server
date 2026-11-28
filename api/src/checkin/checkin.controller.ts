import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CompleteCheckin, ReleaseCheckin, VerifyCode, type CompleteCheckinInput, type ReleaseCheckinInput, type VerifyCodeInput } from './checkin.schemas.js';
import { CheckinService } from './checkin.service.js';

const uuid = () => new ParseUUIDPipe();

@Controller()
export class CheckinController {
  constructor(private readonly checkin: CheckinService) {}

  @Get('me/shoots/:jobId/checkin')
  @Roles('reelmaker')
  state(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string) {
    return this.checkin.myState(user, jobId);
  }

  /** "Reached / About to start": sends the code (3 sends, 60 s apart). */
  @Post('me/shoots/:jobId/checkin/start')
  @Roles('reelmaker')
  start(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string) {
    return this.checkin.start(user, jobId);
  }

  @Post('me/shoots/:jobId/checkin/verify')
  @Roles('reelmaker')
  verify(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string, @Body(new ZodPipe(VerifyCode)) body: VerifyCodeInput) {
    return this.checkin.verify(user, jobId, body);
  }

  /** Two live photos done. Needs both proof uploads to be finished. */
  @Post('me/shoots/:jobId/checkin/complete')
  @Roles('reelmaker')
  complete(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string, @Body(new ZodPipe(CompleteCheckin)) body: CompleteCheckinInput) {
    return this.checkin.complete(user, jobId, body);
  }

  @Get('checkins/pending')
  @Roles('admin', 'ops')
  pending(@CurrentUser() user: AuthUser) {
    return this.checkin.pending(user);
  }

  @Get('jobs/:jobId/checkin')
  @Roles('admin', 'ops')
  forJob(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string) {
    return this.checkin.forJob(user, jobId);
  }

  /** Ops approves without a code, only 5 minutes after Reached, with a written reason. */
  @Post('jobs/:jobId/checkin/release')
  @Roles('admin', 'ops')
  release(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string, @Body(new ZodPipe(ReleaseCheckin)) body: ReleaseCheckinInput) {
    return this.checkin.release(user, jobId, body);
  }
}
