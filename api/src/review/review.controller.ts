import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import {
  AddExtraTime, DecideExtraTime, ExtraTimeQuery, HoursDetailQuery, SendBack,
  type AddExtraTimeInput, type DecideExtraTimeInput, type ExtraTimeQueryInput, type HoursDetailQueryInput, type SendBackInput,
} from './review.schemas.js';
import { ReviewService } from './review.service.js';

const uuid = () => new ParseUUIDPipe();

/** After the shoot: send back, extra time and hours. (Release is `POST /jobs/:id/release`.) */
@Controller()
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Post('jobs/:id/send-back')
  @Roles('admin', 'ops')
  sendBack(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(SendBack)) body: SendBackInput) {
    return this.review.sendBack(user, id, body);
  }

  @Post('jobs/:id/extra-time')
  @Roles('admin', 'ops')
  addExtra(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(AddExtraTime)) body: AddExtraTimeInput) {
    return this.review.addExtraTime(user, id, body);
  }

  @Get('extra-time')
  @Roles('admin', 'sales', 'ops')
  listExtra(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ExtraTimeQuery)) q: ExtraTimeQueryInput) {
    return this.review.listExtraTime(user, q);
  }

  @Post('extra-time/:id/decision')
  @Roles('admin', 'sales')
  decide(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(DecideExtraTime)) body: DecideExtraTimeInput) {
    return this.review.decideExtraTime(user, id, body);
  }

  @Get('hours/:reelmakerId')
  @Roles('admin', 'ops', 'reelmaker')
  hoursDetail(@CurrentUser() user: AuthUser, @Param('reelmakerId', uuid()) reelmakerId: string, @Query(new ZodPipe(HoursDetailQuery)) q: HoursDetailQueryInput) {
    return this.review.hoursDetail(user, reelmakerId, q);
  }
}
