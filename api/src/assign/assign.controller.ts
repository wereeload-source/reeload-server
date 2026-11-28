import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { z } from 'zod';
import { AccessPolicy } from '../access/access.policy.js';
import type { AuthUser } from '../common/types.js';
import {
  AssignJob, LeaveInput, LeaveQuery, type AssignJobInput, type LeaveInputT, type LeaveQueryInput,
} from './assign.schemas.js';
import { AssignService } from './assign.service.js';

const uuid = () => new ParseUUIDPipe();
const IncludeInactive = z.object({ include_inactive: z.enum(['true', 'false']).optional().transform((v) => v === 'true') });

@Controller()
export class AssignController {
  constructor(private readonly assign: AssignService) {}

  @Get('assign/queue')
  @Can(AccessPolicy, 'assignWork')
  queue() {
    return this.assign.queue();
  }

  @Get('jobs/:id/candidates')
  @Can(AccessPolicy, 'assignWork')
  candidates(@Param('id', uuid()) id: string) {
    return this.assign.candidates(id);
  }

  @Post('jobs/:id/assign')
  @Can(AccessPolicy, 'assignWork')
  assignJob(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: AssignJob }) body: AssignJobInput) {
    return this.assign.assign(user, id, body);
  }

  @Get('reelmakers')
  @Can(AccessPolicy, 'viewReelmakers')
  reelmakers(@Query({ schema: IncludeInactive }) q: { include_inactive: boolean }) {
    return this.assign.reelmakers(q.include_inactive);
  }

  @Get('leave')
  @Can(AccessPolicy, 'assignWork')
  leave(@Query({ schema: LeaveQuery }) q: LeaveQueryInput) {
    return this.assign.leave(q);
  }

  @Post('leave')
  @Can(AccessPolicy, 'assignWork')
  addLeave(@CurrentUser() user: AuthUser, @Body({ schema: LeaveInput }) body: LeaveInputT) {
    return this.assign.addLeave(user, body);
  }

  @Delete('leave/:id')
  @Can(AccessPolicy, 'assignWork')
  removeLeave(@Param('id', uuid()) id: string) {
    return this.assign.removeLeave(id);
  }
}
