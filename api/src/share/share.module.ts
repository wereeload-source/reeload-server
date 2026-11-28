import { Module } from '@nestjs/common';
import { AssignModule } from '../assign/assign.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { RetentionService } from './retention.service.js';
import { ShareController } from './share.controller.js';
import { ShareService } from './share.service.js';

@Module({ imports: [AssignModule, UploadsModule], controllers: [ShareController], providers: [ShareService, RetentionService] })
export class ShareModule {}
