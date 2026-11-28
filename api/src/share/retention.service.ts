import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditService } from '../common/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { R2Service } from '../uploads/r2.service.js';

/**
 * Daily clean-up: raw files after `raw_retention_days` (10), edited after `edited_retention_days`
 * (20; Admin may set 15 to 20), counted from the shoot date. Proof photos are small and stay.
 * Runs at 03:00 India time inside the API, so run one API instance (or move this to a single worker).
 */
@Injectable()
export class RetentionService {
  private readonly log = new Logger('Retention');

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Cron('0 3 * * *', { timeZone: 'Asia/Kolkata' })
  async scheduled(): Promise<void> {
    try {
      this.log.log(`Clean-up done: ${JSON.stringify(await this.sweep())}`);
    } catch (e) {
      this.log.error(`Clean-up failed: ${(e as Error).message}`);
    }
  }

  async sweep() {
    const result = { raw: 0, edited: 0, failed: 0 };
    for (const [kind, setting] of [['raw', 'raw_retention_days'], ['edited', 'edited_retention_days']] as const) {
      const days = await this.settings.number(setting);
      const files = await this.prisma.upload.findMany({
        where: { kind, status: { in: ['complete', 'uploading', 'aborted'] }, job: { startsAt: { lt: new Date(Date.now() - days * 86_400_000) } } },
        select: { id: true, objectKey: true, r2UploadId: true, status: true },
        orderBy: { job: { startsAt: 'asc' } },
        take: 500,
      });
      for (const f of files) {
        try {
          if (f.status === 'complete') await this.r2.deleteObject(f.objectKey);
          else if (f.r2UploadId) await this.r2.abortMultipart(f.objectKey, f.r2UploadId).catch(() => undefined);
          await this.prisma.upload.update({ where: { id: f.id }, data: { status: 'deleted', deletedAt: new Date(), r2UploadId: null } });
          result[kind]++;
        } catch (e) {
          this.log.error(`Could not delete ${f.id}: ${(e as Error).message}`);
          result.failed++;
        }
      }
    }
    await this.audit.record(this.prisma, null, 'retention_sweep', 'uploads', '-', result);
    return result;
  }
}
