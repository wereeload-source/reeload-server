import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { AccessPolicy } from '../access/access.policy.js';
import type { AuthUser } from '../common/types.js';
import {
  CompleteUpload, CreateUpload, ProofPhoto, SignPart,
  type CompleteUploadInput, type CreateUploadInput, type ProofPhotoInput, type SignPartInput,
} from './uploads.schemas.js';
import { UploadsService } from './uploads.service.js';

const uuid = () => new ParseUUIDPipe();

/** Direct-to-R2 uploads from the phone, shaped for Uppy's AwsS3 multipart plugin. */
@Controller()
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('uploads')
  @Can(AccessPolicy, 'useUploads')
  create(@CurrentUser() user: AuthUser, @Body({ schema: CreateUpload }) body: CreateUploadInput) {
    return this.uploads.create(user, body);
  }

  @Post('uploads/proof')
  @Can(AccessPolicy, 'workShoots')
  proof(@CurrentUser() user: AuthUser, @Body({ schema: ProofPhoto }) body: ProofPhotoInput) {
    return this.uploads.proof(user, body);
  }

  @Post('uploads/:id/sign-part')
  @Can(AccessPolicy, 'useUploads')
  signPart(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: SignPart }) body: SignPartInput) {
    return this.uploads.signPart(user, id, body);
  }

  @Get('uploads/:id/parts')
  @Can(AccessPolicy, 'useUploads')
  parts(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.uploads.listParts(user, id);
  }

  @Post('uploads/:id/complete')
  @Can(AccessPolicy, 'useUploads')
  complete(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: CompleteUpload }) body: CompleteUploadInput) {
    return this.uploads.complete(user, id, body);
  }

  @Post('uploads/:id/abort')
  @Can(AccessPolicy, 'useUploads')
  abort(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.uploads.abort(user, id);
  }

  @Get('uploads/:id/download')
  @Can(AccessPolicy, 'useUploads')
  download(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.uploads.download(user, id);
  }

  @Get('jobs/:jobId/uploads')
  @Can(AccessPolicy, 'useUploads')
  list(@CurrentUser() user: AuthUser, @Param('jobId', uuid()) jobId: string) {
    return this.uploads.list(user, jobId);
  }
}
