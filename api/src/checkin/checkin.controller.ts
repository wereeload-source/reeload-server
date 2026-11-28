import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { AccessPolicy } from '../access/access.policy.js';
import type { AuthUser } from '../common/types.js';
import { CompleteCheckin, ReleaseCheckin, VerifyCode, type CompleteCheckinInput, type ReleaseCheckinInput, type VerifyCodeInput } from './checkin.schemas.js';
import { CheckinService } from './checkin.service.js';

const uuid = () => new ParseUUIDPipe();

@Controller()
export class CheckinController {
  constructor(private readonly checkin: CheckinService) {}

  @Get('me/shoots/:jobId/checkin')
  @Can(AccessPolicy, 'workShoots')
  state(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string) {
    return this.checkin.myState(user, jobId);
  }

  /** "Reached / About to start": sends the code (3 sends, 60 s apart). */
  @Post('me/shoots/:jobId/checkin/start')
  @Can(AccessPolicy, 'workShoots')
  start(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string) {
    return this.checkin.start(user, jobId);
  }

  @Post('me/shoots/:jobId/checkin/verify')
  @Can(AccessPolicy, 'workShoots')
  verify(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string, @Body({ schema: VerifyCode }) body: VerifyCodeInput) {
    return this.checkin.verify(user, jobId, body);
  }

  /** Two live photos done. Needs both proof uploads to be finished. */
  @Post('me/shoots/:jobId/checkin/complete')
  @Can(AccessPolicy, 'workShoots')
  complete(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string, @Body({ schema: CompleteCheckin }) body: CompleteCheckinInput) {
    return this.checkin.complete(user, jobId, body);
  }

  @Get('checkins/pending')
  @Can(AccessPolicy, 'manageCheckins')
  pending() {
    return this.checkin.pending();
  }

  @Get('jobs/:jobId/checkin')
  @Can(AccessPolicy, 'manageCheckins')
  forJob(@Param('jobId', uuid()) jobId: string) {
    return this.checkin.forJob(jobId);
  }

  /** Ops approves without a code, only 5 minutes after Reached, with a written reason. */
  @Post('jobs/:jobId/checkin/release')
  @Can(AccessPolicy, 'manageCheckins')
  release(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string, @Body({ schema: ReleaseCheckin }) body: ReleaseCheckinInput) {
    return this.checkin.release(user, jobId, body);
  }
}
