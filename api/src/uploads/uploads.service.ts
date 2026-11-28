import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit.service.js';
import { isStaff, type AuthUser } from '../common/types.js';
import { WorkflowService } from '../common/workflow.service.js';
import { TX_OPTIONS } from '../prisma/db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { safeName } from './names.js';
import { R2Service, type Part } from './r2.service.js';
import type { CompleteUploadInput, CreateUploadInput, ProofPhotoInput, SignPartInput } from './uploads.schemas.js';

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
  ) {}

  /** Ops and Admin may put files on any job; a reelmaker only on a shoot they accepted. */
  private async assertCanUpload(user: AuthUser, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, ...(isStaff(user.role) ? {} : { assignments: { some: { reelmakerId: user.id, status: 'accepted' } } }) },
      select: { id: true },
    });
    if (!job) throw new ForbiddenException('You cannot upload to this job');
  }

  /** The caller's own upload (Admin may touch any). */
  private async own(user: AuthUser, uploadId: string) {
    const u = await this.prisma.upload.findUnique({ where: { id: uploadId } });
    if (!u) throw new NotFoundException('Upload not found');
    if (u.uploadedById !== user.id && user.role !== 'admin') throw new ForbiddenException('Not your upload');
    return u;
  }

  /** Starts a multipart upload, or resumes an unfinished one for the same file. */
  async create(user: AuthUser, body: CreateUploadInput) {
    await this.assertCanUpload(user, body.job_id);
    if (body.on_behalf_of) {
      if (!isStaff(user.role)) throw new ForbiddenException('Only Operations can upload for someone else');
      const rm = await this.prisma.user.findFirst({ where: { id: body.on_behalf_of, role: 'reelmaker', active: true }, select: { id: true } });
      if (!rm) throw new BadRequestException('Choose an active reelmaker');
    }

    // Choosing the same file again resumes the unfinished upload.
    const open = await this.prisma.upload.findFirst({
      where: { jobId: body.job_id, uploadedById: user.id, fileName: body.file_name, sizeBytes: BigInt(body.size_bytes), status: 'uploading', kind: { not: 'proof' } },
    });
    if (open?.r2UploadId) {
      const parts = await this.r2.listParts(open.objectKey, open.r2UploadId);
      return { uploadId: open.id, key: open.objectKey, r2UploadId: open.r2UploadId, parts, resumed: true };
    }

    const key = `jobs/${body.job_id}/${body.kind}/${randomUUID()}-${safeName(body.file_name)}`;
    const r2UploadId = await this.r2.createMultipart(key, body.content_type);
    const row = await this.prisma.upload.create({
      data: {
        jobId: body.job_id, kind: body.kind, fileName: body.file_name, sizeBytes: BigInt(body.size_bytes), contentType: body.content_type,
        objectKey: key, r2UploadId, uploadedById: user.id, onBehalfOfId: isStaff(user.role) ? (body.on_behalf_of ?? null) : null,
      },
    });
    return { uploadId: row.id, key, r2UploadId, parts: [] as Part[], resumed: false };
  }

  async signPart(user: AuthUser, uploadId: string, body: SignPartInput) {
    const u = await this.own(user, uploadId);
    if (u.status !== 'uploading' || !u.r2UploadId) throw new ConflictException('Upload is not open');
    return { url: this.r2.signPart(u.objectKey, u.r2UploadId, body.part_number) };
  }

  async listParts(user: AuthUser, uploadId: string) {
    const u = await this.own(user, uploadId);
    if (!u.r2UploadId) return { parts: [] as Part[] };
    return { parts: await this.r2.listParts(u.objectKey, u.r2UploadId) };
  }

  /** Finishes the file. Raw or edited work moves the job from Reached to Uploaded. */
  async complete(user: AuthUser, uploadId: string, body: CompleteUploadInput) {
    const u = await this.own(user, uploadId);
    if (u.status === 'complete') return { ok: true };
    if (u.status !== 'uploading') throw new ConflictException('Upload is not open');

    let size = 0;
    if (u.kind === 'proof') {
      // Photos are one PUT: make sure the file really arrived before it counts.
      const stored = await this.r2.size(u.objectKey);
      if (!stored) throw new BadRequestException('The photo did not upload. Take it again.');
      size = stored;
    } else {
      if (!u.r2UploadId) throw new ConflictException('Upload is not open');
      if (!body.parts.length) throw new BadRequestException('No parts to finish');
      await this.r2.completeMultipart(u.objectKey, u.r2UploadId, body.parts);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.upload.update({
        where: { id: u.id },
        data: { status: 'complete', completedAt: new Date(), r2UploadId: null, ...(size > 0 ? { sizeBytes: BigInt(size) } : {}) },
      });
      if (u.kind !== 'proof') {
        const job = await tx.job.findUniqueOrThrow({ where: { id: u.jobId }, select: { status: true } });
        // Ops may also upload for a shoot that is accepted but not yet checked in.
        if (job.status === 'reached' || (isStaff(user.role) && job.status === 'accepted')) {
          await this.workflow.transition(tx, u.jobId, 'uploaded', user.id);
        }
        await this.audit.record(tx, user.id, 'upload', 'jobs', u.jobId, { uploadId: u.id, kind: u.kind, onBehalfOf: u.onBehalfOfId });
      }
    }, TX_OPTIONS);
    return { ok: true };
  }

  async abort(user: AuthUser, uploadId: string) {
    const u = await this.own(user, uploadId);
    if (u.status === 'complete') throw new ConflictException('This file is already finished');
    if (u.r2UploadId) await this.r2.abortMultipart(u.objectKey, u.r2UploadId).catch(() => undefined);
    await this.prisma.upload.update({ where: { id: u.id }, data: { status: 'aborted' } });
    return { ok: true };
  }

  /** A live photo for check-in: one signed PUT, then `complete`. Only the assigned reelmaker. */
  async proof(user: AuthUser, body: ProofPhotoInput) {
    await this.assertCanUpload(user, body.job_id);
    const key = `jobs/${body.job_id}/proof/${user.id}-${body.which}-${Date.now()}.jpg`;
    const row = await this.prisma.upload.create({
      data: {
        jobId: body.job_id, kind: 'proof', fileName: `${body.which}.jpg`, sizeBytes: BigInt(body.size_bytes ?? 0),
        contentType: 'image/jpeg', objectKey: key, uploadedById: user.id,
      },
    });
    return { uploadId: row.id, url: this.r2.signPut(key) };
  }

  /** Files on a job. Reelmakers see only their own; proof photos only for Ops and Admin. */
  async list(user: AuthUser, jobId: string) {
    const staff = isStaff(user.role);
    const files = await this.prisma.upload.findMany({
      where: { jobId, status: { in: ['uploading', 'complete'] }, ...(staff ? {} : { uploadedById: user.id, kind: { not: 'proof' } }) },
      select: {
        id: true, kind: true, fileName: true, contentType: true, sizeBytes: true, status: true, createdAt: true, completedAt: true,
        uploadedById: true, uploadedBy: { select: { fullName: true } }, onBehalfOfId: true, onBehalfOf: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return files.map(({ uploadedBy, onBehalfOf, ...f }) => ({ ...f, uploadedByName: uploadedBy.fullName, onBehalfOfName: onBehalfOf?.fullName ?? null }));
  }

  /** A short-lived link to one finished file. A reelmaker may only open their own. */
  async download(user: AuthUser, uploadId: string) {
    const u = await this.prisma.upload.findFirst({
      where: { id: uploadId, status: 'complete', ...(isStaff(user.role) ? {} : { uploadedById: user.id }) },
      select: { objectKey: true, fileName: true },
    });
    if (!u) throw new NotFoundException('File not found');
    return { url: this.r2.signGet(u.objectKey, 15 * 60, u.fileName), expiresIn: 15 * 60 };
  }
}
