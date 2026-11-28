import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { JobsService } from './jobs.service.js';
import {
  AgreedAmount, ClientLookup, CreateJob, ListJobsQuery, Reschedule, UpdateJob,
  type CreateJobInput, type ListJobsInput, type RescheduleInput, type UpdateJobInput,
} from './jobs.schemas.js';

const uuid = () => new ParseUUIDPipe();

@Controller()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('jobs')
  @Roles('admin', 'sales', 'ops')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ListJobsQuery)) q: ListJobsInput) {
    return this.jobs.list(user, q);
  }

  @Post('jobs')
  @Roles('admin', 'sales')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(CreateJob)) body: CreateJobInput) {
    return this.jobs.create(user, body);
  }

  @Get('jobs/:id')
  @Roles('admin', 'sales', 'ops', 'reelmaker')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.jobs.get(user, id);
  }

  @Patch('jobs/:id')
  @Roles('admin', 'sales')
  update(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(UpdateJob)) body: UpdateJobInput) {
    return this.jobs.update(user, id, body);
  }

  @Put('jobs/:id/amount')
  @Roles('admin', 'sales')
  setAmount(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(AgreedAmount)) body: { agreed_amount: number }) {
    return this.jobs.setAgreedAmount(user, id, body.agreed_amount);
  }

  @Post('jobs/:id/confirm')
  @Roles('admin', 'sales')
  confirm(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.jobs.confirm(user, id);
  }

  @Post('jobs/:id/reschedule')
  @Roles('admin', 'sales', 'ops')
  reschedule(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(Reschedule)) body: RescheduleInput) {
    return this.jobs.reschedule(user, id, body);
  }

  @Post('jobs/:id/release')
  @Roles('admin', 'ops')
  release(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.jobs.release(user, id);
  }

  /** Repeat clients are matched by phone number. Returns null for a new client. */
  @Get('clients/lookup')
  @Roles('admin', 'sales')
  lookup(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ClientLookup)) q: { phone: string }) {
    return this.jobs.clientByPhone(user, q.phone);
  }
}
