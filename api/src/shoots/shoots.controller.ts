import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import { Can } from '@nestjs/authorization';
import { AccessPolicy } from '../access/access.policy.js';
import type { AuthUser } from '../common/types.js';
import {
  DropOut, HoursQuery, RespondShoot, ShootsQuery,
  type DropOutInput, type HoursQueryInput, type RespondShootInput, type ShootsQueryInput,
} from './shoots.schemas.js';
import { ShootsService } from './shoots.service.js';

const uuid = () => new ParseUUIDPipe();

/** The reelmaker app: "my shoots". */
@Controller()
export class ShootsController {
  constructor(private readonly shoots: ShootsService) {}

  @Get('me/shoots')
  @Can(AccessPolicy, 'workShoots')
  mine(@CurrentUser() user: AuthUser, @Query({ schema: ShootsQuery }) q: ShootsQueryInput) {
    return this.shoots.mine(user, q);
  }

  @Get('me/shoots/:jobId')
  @Can(AccessPolicy, 'workShoots')
  one(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string) {
    return this.shoots.one(user, jobId);
  }

  @Post('me/shoots/:jobId/respond')
  @Can(AccessPolicy, 'workShoots')
  respond(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string, @Body({ schema: RespondShoot }) body: RespondShootInput) {
    return this.shoots.respond(user, jobId, body);
  }

  @Post('me/shoots/:jobId/drop-out')
  @Can(AccessPolicy, 'workShoots')
  dropOut(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string, @Body({ schema: DropOut }) body: DropOutInput) {
    return this.shoots.dropOut(user, jobId, body);
  }

  @Get('hours')
  @Can(AccessPolicy, 'viewHours')
  hours(@CurrentUser() user: AuthUser, @Query({ schema: HoursQuery }) q: HoursQueryInput) {
    return this.shoots.hours(user, q);
  }
}
