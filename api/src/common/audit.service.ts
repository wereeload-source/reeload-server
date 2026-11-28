import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { Db } from '../prisma/db.js';

/** The audit trail. It only ever adds rows: nothing here updates or deletes one. */
@Injectable()
export class AuditService {
  record(db: Db, actorId: string | null, action: string, entity: string, entityId: string, details: Record<string, unknown> = {}) {
    return db.auditLog.create({
      data: { actorId, action, entity, entityId, details: details as Prisma.InputJsonObject },
    });
  }
}
