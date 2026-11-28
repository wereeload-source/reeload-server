import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../prisma/db.js';
import { AuditService } from './audit.service.js';
import { jobCode } from './job-code.js';
import type { JobStatus } from './types.js';

/** The one place a job's status changes, so every change lands in the audit trail. */
@Injectable()
export class WorkflowService {
  constructor(private readonly audit: AuditService) {}

  /** Moves a job to a new status. Returns the updated job. */
  async transition(db: Db, jobId: string, to: JobStatus, actorId: string | null, data: Prisma.JobUpdateInput = {}) {
    const before = await db.job.findUniqueOrThrow({ where: { id: jobId }, select: { status: true, number: true } });
    const job = await db.job.update({ where: { id: jobId }, data: { ...data, status: to } });
    if (before.status !== to) {
      await this.audit.record(db, actorId, 'status', 'jobs', jobId, { code: jobCode(before.number), from: before.status, to });
    }
    return job;
  }
}
