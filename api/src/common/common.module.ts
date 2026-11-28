import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { HashService } from './hash.service.js';
import { NoticesService } from './notices.service.js';
import { WorkflowService } from './workflow.service.js';

/** Helpers every feature uses: audit trail, notices, hashing, job status changes. */
@Global()
@Module({ providers: [AuditService, NoticesService, HashService, WorkflowService], exports: [AuditService, NoticesService, HashService, WorkflowService] })
export class CommonModule {}
