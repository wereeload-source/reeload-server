import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import {
  CompleteUpload, CreateUpload, ProofPhoto, ReviewQuery, SignPart,
  type CompleteUploadInput, type CreateUploadInput, type ProofPhotoInput, type ReviewQueryInput, type SignPartInput,
} from './uploads.schemas.js';
import { UploadsService } from './uploads.service.js';

const uuid = () => new ParseUUIDPipe();

/** Direct-to-R2 uploads from the phone, shaped for Uppy's AwsS3 multipart plugin. */
@Controller()
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('uploads')
  @Roles('reelmaker', 'ops', 'admin')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(CreateUpload)) body: CreateUploadInput) {
    return this.uploads.create(user, body);
  }

  @Post('uploads/proof')
  @Roles('reelmaker')
  proof(@CurrentUser() user: AuthUser, @Body(new ZodPipe(ProofPhoto)) body: ProofPhotoInput) {
    return this.uploads.proof(user, body);
  }

  @Post('uploads/:id/sign-part')
  @Roles('reelmaker', 'ops', 'admin')
  signPart(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(SignPart)) body: SignPartInput) {
    return this.uploads.signPart(user, id, body);
  }

  @Get('uploads/:id/parts')
  @Roles('reelmaker', 'ops', 'admin')
  parts(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.uploads.listParts(user, id);
  }

  @Post('uploads/:id/complete')
  @Roles('reelmaker', 'ops', 'admin')
  complete(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(CompleteUpload)) body: CompleteUploadInput) {
    return this.uploads.complete(user, id, body);
  }

  @Post('uploads/:id/abort')
  @Roles('reelmaker', 'ops', 'admin')
  abort(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.uploads.abort(user, id);
  }

  @Get('uploads/:id/download')
  @Roles('reelmaker', 'ops', 'admin')
  download(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.uploads.download(user, id);
  }

  @Get('jobs/:jobId/uploads')
  @Roles('reelmaker', 'ops', 'admin')
  list(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string) {
    return this.uploads.list(user, jobId);
  }

  @Get('review')
  @Roles('ops', 'admin')
  review(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ReviewQuery)) q: ReviewQueryInput) {
    return this.uploads.review(user, q);
  }
}
