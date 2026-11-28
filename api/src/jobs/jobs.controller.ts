import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { AccessPolicy } from '../access/access.policy.js';
import type { AuthUser } from '../common/types.js';
import {
  AgreedAmount, ClientLookup, CreateJob, ListJobsQuery, Reschedule, UpdateJob,
  type CreateJobInput, type ListJobsInput, type RescheduleInput, type UpdateJobInput,
} from './jobs.schemas.js';
import { JobsService } from './jobs.service.js';

const uuid = () => new ParseUUIDPipe();

@Controller()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('jobs')
  @Can(AccessPolicy, 'listJobs')
  list(@CurrentUser() user: AuthUser, @Query({ schema: ListJobsQuery }) q: ListJobsInput) {
    return this.jobs.list(user, q);
  }

  @Post('jobs')
  @Can(AccessPolicy, 'createJob')
  create(@CurrentUser() user: AuthUser, @Body({ schema: CreateJob }) body: CreateJobInput) {
    return this.jobs.create(user, body);
  }

  @Get('jobs/:id')
  @Can(AccessPolicy, 'viewJob')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.jobs.get(user, id);
  }

  @Patch('jobs/:id')
  @Can(AccessPolicy, 'editJob')
  update(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: UpdateJob }) body: UpdateJobInput) {
    return this.jobs.update(user, id, body);
  }

  @Put('jobs/:id/amount')
  @Can(AccessPolicy, 'editJob')
  setAmount(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: AgreedAmount }) body: { agreed_amount: number }) {
    return this.jobs.setAgreedAmount(user, id, body.agreed_amount);
  }

  @Post('jobs/:id/confirm')
  @Can(AccessPolicy, 'confirmJob')
  confirm(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.jobs.confirm(user, id);
  }

  @Post('jobs/:id/reschedule')
  @Can(AccessPolicy, 'rescheduleJob')
  reschedule(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: Reschedule }) body: RescheduleInput) {
    return this.jobs.reschedule(user, id, body);
  }

  @Post('jobs/:id/release')
  @Can(AccessPolicy, 'releaseJob')
  release(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.jobs.release(user, id);
  }

  @Get('clients/lookup')
  @Can(AccessPolicy, 'lookupClient')
  lookup(@Query({ schema: ClientLookup }) q: { phone: string }) {
    return this.jobs.clientByPhone(q.phone);
  }
}
