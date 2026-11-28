import { Module } from '@nestjs/common';
import { AssignModule } from '../assign/assign.module.js';
import { CheckinController } from './checkin.controller.js';
import { CheckinService } from './checkin.service.js';
import { WhatsAppService } from './whatsapp.service.js';

@Module({ imports: [AssignModule], controllers: [CheckinController], providers: [CheckinService, WhatsAppService], exports: [WhatsAppService] })
export class CheckinModule {}
