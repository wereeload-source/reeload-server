import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { AccessPolicy } from '../access/access.policy.js';
import type { AuthUser } from '../common/types.js';
import {
  AddExtraTime, DecideExtraTime, ExtraTimeQuery, HoursDetailQuery, ReviewQuery, SendBack,
  type AddExtraTimeInput, type ReviewQueryInput, type DecideExtraTimeInput, type ExtraTimeQueryInput, type HoursDetailQueryInput, type SendBackInput,
} from './review.schemas.js';
import { ReviewService } from './review.service.js';

const uuid = () => new ParseUUIDPipe();

/** After the shoot: send back, extra time and hours. (Release is `POST /jobs/:id/release`.) */
@Controller()
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Post('jobs/:id/send-back')
  @Can(AccessPolicy, 'reviewWork')
  sendBack(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: SendBack }) body: SendBackInput) {
    return this.review.sendBack(user, id, body);
  }

  @Post('jobs/:id/extra-time')
  @Can(AccessPolicy, 'addExtraTime')
  addExtra(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: AddExtraTime }) body: AddExtraTimeInput) {
    return this.review.addExtraTime(user, id, body);
  }

  @Get('extra-time')
  @Can(AccessPolicy, 'viewExtraTime')
  listExtra(@Query({ schema: ExtraTimeQuery }) q: ExtraTimeQueryInput) {
    return this.review.listExtraTime(q);
  }

  @Get('review')
  @Can(AccessPolicy, 'reviewWork')
  queue(@Query({ schema: ReviewQuery }) q: ReviewQueryInput) {
    return this.review.queue(q);
  }

  @Post('extra-time/:id/decision')
  @Can(AccessPolicy, 'decideExtraTime')
  decide(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: DecideExtraTime }) body: DecideExtraTimeInput) {
    return this.review.decideExtraTime(user, id, body);
  }

  @Get('hours/:reelmakerId')
  @Can(AccessPolicy, 'viewHours')
  hoursDetail(@CurrentUser() user: AuthUser, @Param('reelmakerId', uuid()) reelmakerId: string, @Query({ schema: HoursDetailQuery }) q: HoursDetailQueryInput) {
    return this.review.hoursDetail(user, reelmakerId, q);
  }
}
