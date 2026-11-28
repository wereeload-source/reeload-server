import { Module } from '@nestjs/common';
import { R2Service } from './r2.service.js';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

@Module({ controllers: [UploadsController], providers: [UploadsService, R2Service], exports: [R2Service] })
export class UploadsModule {}
