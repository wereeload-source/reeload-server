import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService, one, rows, type Tx } from '../common/db.js';
import type { AuthUser } from '../common/types.js';
import { safeName } from './names.js';
import { R2Service, type Part } from './r2.service.js';
import type { CompleteUploadInput, CreateUploadInput, ProofPhotoInput, ReviewQueryInput, SignPartInput } from './uploads.schemas.js';
import {
  ABORT_UPLOAD_SQL, AUDIT_SQL, CAN_UPLOAD_SQL, COMPLETE_UPLOAD_SQL, DOWNLOAD_UPLOAD_SQL, GET_UPLOAD_SQL, INSERT_PROOF_SQL,
  INSERT_UPLOAD_SQL, IS_REELMAKER_SQL, JOB_UPLOADED_SQL, LIST_UPLOADS_SQL, OPEN_UPLOAD_SQL, REVIEW_SQL,
} from './uploads.sql.js';

interface UploadRow {
  id: string; job_id: string; kind: 'proof' | 'raw' | 'edited'; object_key: string; r2_upload_id: string | null;
  status: string; uploaded_by: string; on_behalf_of: string | null; size_bytes: string;
}

const isStaff = (u: AuthUser) => u.role === 'ops' || u.role === 'admin';

@Injectable()
export class UploadsService {
  constructor(private readonly db: DbService, private readonly r2: R2Service) {}

  private async assertCanUpload(tx: Tx, user: AuthUser, jobId: string): Promise<{ status: string }> {
    const job = await one<{ status: string }>(tx, CAN_UPLOAD_SQL, [jobId, user.id, isStaff(user)]);
    if (!job) throw new ForbiddenException('You cannot upload to this job');
    return job;
  }

  /** The caller's own upload (Admin may touch any). */
  private async own(tx: Tx, user: AuthUser, uploadId: string): Promise<UploadRow> {
    const u = await one<UploadRow>(tx, GET_UPLOAD_SQL, [uploadId]);
    if (!u) throw new NotFoundException('Upload not found');
    if (u.uploaded_by !== user.id && user.role !== 'admin') throw new ForbiddenException('Not your upload');
    return u;
  }

  /** Starts a multipart upload, or resumes an unfinished one for the same file. */
  async create(user: AuthUser, body: CreateUploadInput) {
    const prepared = await this.db.asService(async (tx) => {
      await this.assertCanUpload(tx, user, body.job_id);
      if (body.on_behalf_of) {
        if (!isStaff(user)) throw new ForbiddenException('Only Operations can upload for someone else');
        if (!(await one(tx, IS_REELMAKER_SQL, [body.on_behalf_of]))) throw new BadRequestException('Choose an active reelmaker');
      }
      return one<UploadRow>(tx, OPEN_UPLOAD_SQL, [body.job_id, user.id, body.file_name, body.size_bytes]);
    }, user.id);

    if (prepared?.r2_upload_id) {
      const parts = await this.r2.listParts(prepared.object_key, prepared.r2_upload_id);
      return { upload_id: prepared.id, key: prepared.object_key, r2_upload_id: prepared.r2_upload_id, parts, resumed: true };
    }

    const key = `jobs/${body.job_id}/${body.kind}/${randomUUID()}-${safeName(body.file_name)}`;
    const r2UploadId = await this.r2.createMultipart(key, body.content_type);
    const row = await this.db.asService((tx) =>
      one<{ id: string }>(tx, INSERT_UPLOAD_SQL, [
        body.job_id, body.kind, body.file_name, body.size_bytes, body.content_type, key, r2UploadId, user.id,
        isStaff(user) ? (body.on_behalf_of ?? null) : null,
      ]),
      user.id,
    );
    return { upload_id: row!.id, key, r2_upload_id: r2UploadId, parts: [] as Part[], resumed: false };
  }

  async signPart(user: AuthUser, uploadId: string, body: SignPartInput) {
    const u = await this.db.asService((tx) => this.own(tx, user, uploadId));
    if (u.status !== 'uploading' || !u.r2_upload_id) throw new ConflictException('Upload is not open');
    return { url: this.r2.signPart(u.object_key, u.r2_upload_id, body.part_number) };
  }

  async listParts(user: AuthUser, uploadId: string) {
    const u = await this.db.asService((tx) => this.own(tx, user, uploadId));
    if (!u.r2_upload_id) return { parts: [] as Part[] };
    return { parts: await this.r2.listParts(u.object_key, u.r2_upload_id) };
  }

  /** Finishes the file. Raw or edited work moves the job from Reached to Uploaded. */
  async complete(user: AuthUser, uploadId: string, body: CompleteUploadInput) {
    const u = await this.db.asService((tx) => this.own(tx, user, uploadId));
    if (u.status === 'complete') return { ok: true };
    if (u.status !== 'uploading') throw new ConflictException('Upload is not open');

    let size = 0;
    if (u.kind === 'proof') {
      // Photos are one PUT: make sure the file really arrived before it counts.
      const stored = await this.r2.size(u.object_key);
      if (!stored) throw new BadRequestException('The photo did not upload. Take it again.');
      size = stored;
    } else {
      if (!u.r2_upload_id) throw new ConflictException('Upload is not open');
      if (!body.parts.length) throw new BadRequestException('No parts to finish');
      await this.r2.completeMultipart(u.object_key, u.r2_upload_id, body.parts);
    }

    await this.db.asService(async (tx) => {
      await tx.query(COMPLETE_UPLOAD_SQL, [u.id, size]);
      if (u.kind !== 'proof') {
        await tx.query(JOB_UPLOADED_SQL, [u.job_id, isStaff(user)]);
        await tx.query(AUDIT_SQL, ['upload', 'jobs', u.job_id, JSON.stringify({ upload_id: u.id, kind: u.kind, on_behalf_of: u.on_behalf_of })]);
      }
    }, user.id);
    return { ok: true };
  }

  async abort(user: AuthUser, uploadId: string) {
    const u = await this.db.asService((tx) => this.own(tx, user, uploadId));
    if (u.status === 'complete') throw new ConflictException('This file is already finished');
    if (u.r2_upload_id) await this.r2.abortMultipart(u.object_key, u.r2_upload_id).catch(() => undefined);
    await this.db.asService((tx) => tx.query(ABORT_UPLOAD_SQL, [u.id]), user.id);
    return { ok: true };
  }

  /** A live photo for check-in: one signed PUT, then `complete`. Only the assigned reelmaker. */
  async proof(user: AuthUser, body: ProofPhotoInput) {
    const row = await this.db.asService(async (tx) => {
      await this.assertCanUpload(tx, user, body.job_id);
      const key = `jobs/${body.job_id}/proof/${user.id}-${body.which}-${Date.now()}.jpg`;
      const r = await one<{ id: string }>(tx, INSERT_PROOF_SQL, [body.job_id, `${body.which}.jpg`, body.size_bytes ?? 0, key, user.id]);
      return { id: r!.id, key };
    }, user.id);
    return { upload_id: row.id, url: this.r2.signPut(row.key) };
  }

  /** Files on a job. Reelmakers see only their own (Row Level Security); proof photos only for Ops/Admin. */
  list(user: AuthUser, jobId: string) {
    return this.db.asUser(user.id, (tx) => rows(tx, LIST_UPLOADS_SQL, [jobId, isStaff(user)]));
  }

  /** A short-lived link to one finished file. Visibility follows Row Level Security. */
  async download(user: AuthUser, uploadId: string) {
    const u = await this.db.asUser(user.id, (tx) => one<{ object_key: string; file_name: string }>(tx, DOWNLOAD_UPLOAD_SQL, [uploadId]));
    if (!u) throw new NotFoundException('File not found');
    return { url: this.r2.signGet(u.object_key, 15 * 60, u.file_name), expires_in: 15 * 60 };
  }

  /** Ops: shoots with raw / edited deadlines, overdue first. */
  review(user: AuthUser, q: ReviewQueryInput) {
    return this.db.asUser(user.id, (tx) => rows(tx, REVIEW_SQL, [q.overdue]));
  }
}
