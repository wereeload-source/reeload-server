import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module.js';
import { ShareController } from './share.controller.js';
import { ShareService } from './share.service.js';

@Module({ imports: [UploadsModule], controllers: [ShareController], providers: [ShareService] })
export class ShareModule {}
