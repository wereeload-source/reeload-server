import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AssignJob, LeaveInput, LeaveQuery, type AssignJobInput, type LeaveInputT, type LeaveQueryInput } from './assign.schemas.js';
import { AssignService } from './assign.service.js';

const uuid = () => new ParseUUIDPipe();

@Controller()
export class AssignController {
  constructor(private readonly assign: AssignService) {}

  /** Unassigned confirmed jobs (soonest first, flagged inside 48 h) and jobs waiting for a reply. */
  @Get('assign/queue')
  @Roles('admin', 'ops')
  queue(@CurrentUser() user: AuthUser) {
    return this.assign.queue(user);
  }

  @Get('jobs/:id/candidates')
  @Roles('admin', 'ops')
  candidates(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.assign.candidates(user, id);
  }

  @Post('jobs/:id/assign')
  @Roles('admin', 'ops')
  assignJob(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(AssignJob)) body: AssignJobInput) {
    return this.assign.assign(user, id, body);
  }

  @Get('reelmakers')
  @Roles('admin', 'ops', 'sales')
  reelmakers(@CurrentUser() user: AuthUser, @Query('include_inactive') inactive?: string) {
    return this.assign.reelmakers(user, inactive === 'true');
  }

  @Get('leave')
  @Roles('admin', 'ops')
  leave(@CurrentUser() user: AuthUser, @Query(new ZodPipe(LeaveQuery)) q: LeaveQueryInput) {
    return this.assign.leave(user, q);
  }

  @Post('leave')
  @Roles('admin', 'ops')
  addLeave(@CurrentUser() user: AuthUser, @Body(new ZodPipe(LeaveInput)) body: LeaveInputT) {
    return this.assign.addLeave(user, body);
  }

  @Delete('leave/:id')
  @Roles('admin', 'ops')
  removeLeave(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.assign.removeLeave(user, id);
  }
}
