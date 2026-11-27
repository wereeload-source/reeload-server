import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import {
  DropOut, HoursQuery, RespondShoot, ShootsQuery,
  type DropOutInput, type HoursQueryInput, type RespondShootInput, type ShootsQueryInput,
} from './shoots.schemas.js';
import { ShootsService } from './shoots.service.js';

const uuid = () => new ParseUUIDPipe();

/** The reelmaker app: "my shoots". Money is never part of these responses. */
@Controller()
export class ShootsController {
  constructor(private readonly shoots: ShootsService) {}

  @Get('me/shoots')
  @Roles('reelmaker')
  mine(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ShootsQuery)) q: ShootsQueryInput) {
    return this.shoots.mine(user, q);
  }

  @Get('me/shoots/:jobId')
  @Roles('reelmaker')
  one(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string) {
    return this.shoots.one(user, jobId);
  }

  @Post('me/shoots/:jobId/respond')
  @Roles('reelmaker')
  respond(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string, @Body(new ZodPipe(RespondShoot)) body: RespondShootInput) {
    return this.shoots.respond(user, jobId, body);
  }

  @Post('me/shoots/:jobId/drop-out')
  @Roles('reelmaker')
  dropOut(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string, @Body(new ZodPipe(DropOut)) body: DropOutInput) {
    return this.shoots.dropOut(user, jobId, body);
  }

  /** Booked and extra hours for a month. Reelmakers see their own; Admin and Ops can see everyone. */
  @Get('hours')
  @Roles('admin', 'ops', 'reelmaker')
  hours(@CurrentUser() user: AuthUser, @Query(new ZodPipe(HoursQuery)) q: HoursQueryInput) {
    return this.shoots.hours(user, q);
  }
}
