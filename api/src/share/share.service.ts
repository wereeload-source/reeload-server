import { ConflictException, GoneException, HttpException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DbService, one, rows } from '../common/db.js';
import { makeToken, safeEqual, sha256 } from '../common/crypto.js';
import { env } from '../common/env.js';
import type { AuthUser } from '../common/types.js';
import { R2Service } from '../uploads/r2.service.js';
import { linkState, linkVerdict } from './share.rules.js';
import type { CreateShareLinkInput } from './share.schemas.js';
import {
  AUDIT_SQL, EXPIRED_FILES_SQL, INSERT_LINK_SQL, JOB_DELIVERED_SQL, JOB_FOR_LINK_SQL, LINK_FILES_SQL, LIST_LINKS_SQL, MARK_DELETED_SQL,
  RESOLVE_LINK_SQL, REVOKE_LINK_SQL, SETTING_BOOL_SQL, SETTING_SQL, SHAREABLE_COUNT_SQL,
} from './share.sql.js';

@Injectable()
export class ShareService {
  private readonly log = new Logger('Share');

  constructor(private readonly db: DbService, private readonly r2: R2Service) {}

  /** Ops make a link once the job is Paid; Admin may make one earlier (audited). The token is shown once. */
  async create(user: AuthUser, jobId: string, body: CreateShareLinkInput) {
    return this.db.asService(async (tx) => {
      const job = await one<{ id: string; code: string; status: string }>(tx, JOB_FOR_LINK_SQL, [jobId]);
      if (!job) throw new NotFoundException('Job not found');
      const verdict = linkVerdict(user.role, job.status);
      if (!verdict.ok) throw new HttpException({ statusCode: verdict.status, message: verdict.message }, verdict.status);

      const allowRaw = (await one<{ value: boolean }>(tx, SETTING_BOOL_SQL, ['share_include_raw']))?.value === true;
      const includeRaw = allowRaw && body.include_raw === true;
      const kinds = includeRaw ? ['edited', 'raw'] : ['edited'];
      const files = await one<{ n: number }>(tx, SHAREABLE_COUNT_SQL, [jobId, kinds]);
      if (!files?.n) throw new ConflictException('There are no finished edited files to share yet');

      const days = (await one<{ value: number | null }>(tx, SETTING_SQL, ['share_link_days']))?.value ?? 7;
      const token = makeToken();
      const link = await one<{ id: string; expires_at: Date }>(tx, INSERT_LINK_SQL, [jobId, sha256(token), includeRaw, days, user.id]);
      if (verdict.early) await tx.query(AUDIT_SQL, ['early_link', 'jobs', jobId, JSON.stringify({ code: job.code, status: job.status })]);
      await tx.query(JOB_DELIVERED_SQL, [jobId]);
      return { id: link!.id, url: `${env.clientUrl}/d/${token}`, expires_at: link!.expires_at, include_raw: includeRaw, early: verdict.early };
    }, user.id);
  }

  /** The links on a job (never the token: only its hash is stored). */
  async list(user: AuthUser, jobId: string) {
    const links = await this.db.asUser(user.id, (tx) => rows<{ revoked_at: Date | null; expires_at: Date }>(tx, LIST_LINKS_SQL, [jobId]));
    const now = Date.now();
    return links.map((l) => ({ ...l, state: linkState(l, now) }));
  }

  async revoke(user: AuthUser, linkId: string) {
    const done = await this.db.asService(async (tx) => {
      const r = await one<{ id: string; job_id: string }>(tx, REVOKE_LINK_SQL, [linkId]);
      if (r) await tx.query(AUDIT_SQL, ['revoke_link', 'jobs', r.job_id, JSON.stringify({ link_id: r.id })]);
      return r;
    }, user.id);
    if (!done) throw new NotFoundException('Link not found, or already revoked');
    return { ok: true };
  }

  /** The public download page (no sign-in). The token is the only key; it is checked by hash. */
  async resolve(token: string) {
    if (token.length < 20 || token.length > 100) throw new NotFoundException('This link is not valid');
    const link = await this.db.asService((tx) => one<{
      job_id: string; include_raw: boolean; expires_at: Date; revoked_at: Date | null; code: string; starts_at: Date | null; client_name: string;
    }>(tx, RESOLVE_LINK_SQL, [sha256(token)]));
    if (!link || link.revoked_at) throw new NotFoundException('This link is not valid');
    if (new Date(link.expires_at).getTime() < Date.now()) throw new GoneException('This link has expired');

    const files = await this.db.asService((tx) =>
      rows<{ kind: string; file_name: string; size_bytes: string; object_key: string }>(tx, LINK_FILES_SQL, [link.job_id, link.include_raw ? ['edited', 'raw'] : ['edited']]),
    );
    return {
      client: link.client_name,
      job: link.code,
      shot_on: link.starts_at,
      expires_at: link.expires_at,
      files: files.map((f) => ({ name: f.file_name, kind: f.kind, size_bytes: Number(f.size_bytes), url: this.r2.signGet(f.object_key, 30 * 60, f.file_name) })),
    };
  }

  /**
   * Daily clean-up: raw files after raw_retention_days (10), edited after edited_retention_days
   * (20, Admin may set 15 to 20), counted from the shoot date. Proof photos are small and stay.
   * Called by a scheduler with the shared secret.
   */
  async sweep(secret: string | undefined) {
    let expected: string;
    try {
      expected = env.cronSecret;
    } catch {
      throw new UnauthorizedException('Clean-up is not set up');
    }
    if (!secret || !safeEqual(secret, expected)) throw new UnauthorizedException('Unauthorized');

    const result = { raw: 0, edited: 0, failed: 0 };
    for (const [kind, setting, fallback] of [['raw', 'raw_retention_days', 10], ['edited', 'edited_retention_days', 20]] as const) {
      const days = (await this.db.asService((tx) => one<{ value: number | null }>(tx, SETTING_SQL, [setting])))?.value ?? fallback;
      const files = await this.db.asService((tx) => rows<{ id: string; object_key: string; r2_upload_id: string | null; status: string }>(tx, EXPIRED_FILES_SQL, [kind, days]));
      for (const f of files) {
        try {
          if (f.status === 'complete') await this.r2.deleteObject(f.object_key);
          else if (f.r2_upload_id) await this.r2.abortMultipart(f.object_key, f.r2_upload_id).catch(() => undefined);
          await this.db.asService((tx) => tx.query(MARK_DELETED_SQL, [f.id]));
          result[kind]++;
        } catch (e) {
          this.log.error(`Could not delete ${f.id}: ${(e as Error).message}`);
          result.failed++;
        }
      }
    }
    await this.db.asService((tx) => tx.query(AUDIT_SQL, ['retention_sweep', 'uploads', '-', JSON.stringify(result)]));
    return result;
  }
}
