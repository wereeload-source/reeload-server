import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, one, rows } from '../common/db.js';
import type { AuthUser } from '../common/types.js';
import {
  CLIENT_BY_PHONE_SQL, CONFIRM_JOB_SQL, CREATE_JOB_SQL, EDITABLE_JOB_COLUMNS, GET_JOB_SQL, JOB_STATUS_SQL,
  RELEASE_JOB_SQL, RESCHEDULE_JOB_SQL, SET_AMOUNT_SQL, listJobsSql, updateJobSql, type EditableJobColumn,
} from './jobs.sql.js';
import type { CreateJobInput, ListJobsInput, RescheduleInput, UpdateJobInput } from './jobs.schemas.js';

@Injectable()
export class JobsService {
  constructor(private readonly db: DbService) {}

  async list(user: AuthUser, q: ListJobsInput) {
    const { sql, params } = listJobsSql(q);
    const found = await this.db.asUser(user.id, (tx) => rows<{ total: string }>(tx, sql, params));
    return { items: found.map(({ total: _t, ...job }) => job), total: Number(found[0]?.total ?? 0) };
  }

  async get(user: AuthUser, id: string) {
    const job = await this.db.asUser(user.id, (tx) => one(tx, GET_JOB_SQL, [id]));
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  /** Client, job, amount, advance and optional confirmation in one all-or-nothing step. */
  async create(user: AuthUser, body: CreateJobInput) {
    return this.db.asUser(user.id, (tx) =>
      one(tx, CREATE_JOB_SQL, [
        JSON.stringify(body.client), JSON.stringify(body.job), body.agreed_amount ?? null,
        body.advance ? JSON.stringify(body.advance) : null, body.confirm,
      ]),
    );
  }

  async update(user: AuthUser, id: string, body: UpdateJobInput) {
    return this.db.asUser(user.id, async (tx) => {
      const current = await one<{ status: string }>(tx, JOB_STATUS_SQL, [id]);
      if (!current) throw new NotFoundException('Job not found');
      const locked = !['lead', 'draft'].includes(current.status);
      if (locked && (body.starts_at !== undefined || body.duration_minutes !== undefined)) {
        throw new BadRequestException('This job is confirmed. Use reschedule to change the date, time or duration.');
      }
      const columns = EDITABLE_JOB_COLUMNS.filter((c) => body[c] !== undefined) as EditableJobColumn[];
      const updated = await one(tx, updateJobSql(columns), [id, ...columns.map((c) => body[c] ?? null)]);
      if (!updated) throw new NotFoundException('Job not found');
      return updated;
    });
  }

  /** Set or change the agreed amount while the job is a lead or draft (locked after confirmation). */
  setAgreedAmount(user: AuthUser, id: string, amount: number) {
    return this.db.asUser(user.id, (tx) => one(tx, SET_AMOUNT_SQL, [id, amount]));
  }

  confirm(user: AuthUser, id: string) {
    return this.db.asUser(user.id, (tx) => one(tx, CONFIRM_JOB_SQL, [id]));
  }

  reschedule(user: AuthUser, id: string, body: RescheduleInput) {
    return this.db.asUser(user.id, (tx) =>
      one(tx, RESCHEDULE_JOB_SQL, [id, body.starts_at, body.duration_minutes ?? null, body.reason ?? null]),
    );
  }

  release(user: AuthUser, id: string) {
    return this.db.asUser(user.id, (tx) => one(tx, RELEASE_JOB_SQL, [id]));
  }

  /** Repeat clients are matched by phone, so the new-job form can fill itself in. */
  async clientByPhone(user: AuthUser, phone: string) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6) throw new BadRequestException('Enter the phone number');
    return this.db.asUser(user.id, (tx) => one(tx, CLIENT_BY_PHONE_SQL, [digits]));
  }
}
