import { ConflictException, GoneException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../common/audit.service.js';
import { HashService } from '../common/hash.service.js';
import { jobCode } from '../common/job-code.js';
import type { AuthUser } from '../common/types.js';
import { WorkflowService } from '../common/workflow.service.js';
import type { Env } from '../config/env.js';
import { TX_OPTIONS } from '../prisma/db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { R2Service } from '../uploads/r2.service.js';
import { BookingService } from '../assign/booking.service.js';
import { linkState, linkVerdict } from './share.rules.js';
import type { CreateShareLinkInput } from './share.schemas.js';

@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly hash: HashService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly settings: SettingsService,
    private readonly booking: BookingService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Ops make a link once the job is Paid; Admin may make one earlier (audited). The token is shown once. */
  async create(user: AuthUser, jobId: string, body: CreateShareLinkInput) {
    return this.prisma.$transaction(async (tx) => {
      await this.booking.lockJob(tx, jobId);
      const job = await tx.job.findUnique({ where: { id: jobId }, select: { status: true, number: true } });
      if (!job) throw new NotFoundException('Job not found');
      const verdict = linkVerdict(user.role, job.status);
      if (!verdict.ok) throw new HttpException({ statusCode: verdict.status, message: verdict.message }, verdict.status);

      const includeRaw = (await this.settings.flag('share_include_raw', tx)) && body.include_raw === true;
      const kinds = includeRaw ? (['edited', 'raw'] as const) : (['edited'] as const);
      const files = await tx.upload.count({ where: { jobId, status: 'complete', kind: { in: [...kinds] } } });
      if (!files) throw new ConflictException('There are no finished edited files to share yet');

      const days = await this.settings.number('share_link_days', tx);
      const token = this.hash.token();
      const link = await tx.shareLink.create({
        data: { jobId, tokenHash: this.hash.sha256(token), includeRaw, expiresAt: new Date(Date.now() + days * 86_400_000), createdById: user.id },
      });
      await this.audit.record(tx, user.id, 'insert', 'share_links', link.id, { jobId, includeRaw });
      if (verdict.early) await this.audit.record(tx, user.id, 'early_link', 'jobs', jobId, { code: jobCode(job.number), status: job.status });
      if (job.status === 'paid') await this.workflow.transition(tx, jobId, 'delivered', user.id);

      const clientUrl = this.config.get('CLIENT_URL', { infer: true }).replace(/\/+$/, '');
      return { id: link.id, url: `${clientUrl}/d/${token}`, expiresAt: link.expiresAt, includeRaw, early: verdict.early };
    }, TX_OPTIONS);
  }

  /** The links on a job (never the token: only its hash is stored). */
  async list(jobId: string) {
    const links = await this.prisma.shareLink.findMany({
      where: { jobId },
      select: { id: true, includeRaw: true, expiresAt: true, revokedAt: true, createdAt: true, createdBy: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const now = Date.now();
    return links.map(({ createdBy, ...l }) => ({ ...l, createdByName: createdBy?.fullName ?? null, state: linkState(l, now) }));
  }

  async revoke(user: AuthUser, linkId: string) {
    const link = await this.prisma.shareLink.findFirst({ where: { id: linkId, revokedAt: null }, select: { id: true, jobId: true } });
    if (!link) throw new NotFoundException('Link not found, or already revoked');
    await this.prisma.shareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
    await this.audit.record(this.prisma, user.id, 'revoke_link', 'jobs', link.jobId, { linkId: link.id });
    return { ok: true };
  }

  /** The public download page (no sign-in). The token is the only key; it is checked by hash. */
  async resolve(token: string) {
    if (token.length < 20 || token.length > 100) throw new NotFoundException('This link is not valid');
    const link = await this.prisma.shareLink.findUnique({
      where: { tokenHash: this.hash.sha256(token) },
      include: { job: { select: { number: true, startsAt: true, client: { select: { name: true } } } } },
    });
    if (!link || link.revokedAt) throw new NotFoundException('This link is not valid');
    if (link.expiresAt.getTime() < Date.now()) throw new GoneException('This link has expired');

    const files = await this.prisma.upload.findMany({
      where: { jobId: link.jobId, status: 'complete', kind: { in: link.includeRaw ? ['edited', 'raw'] : ['edited'] } },
      select: { kind: true, fileName: true, sizeBytes: true, objectKey: true },
      orderBy: [{ kind: 'desc' }, { createdAt: 'asc' }],
    });
    return {
      client: link.job.client.name,
      job: jobCode(link.job.number),
      shotOn: link.job.startsAt,
      expiresAt: link.expiresAt,
      files: files.map((f) => ({ name: f.fileName, kind: f.kind, sizeBytes: Number(f.sizeBytes), url: this.r2.signGet(f.objectKey, 30 * 60, f.fileName) })),
    };
  }
}
