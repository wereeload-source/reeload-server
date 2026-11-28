import { Module } from '@nestjs/common';
import { CheckinController } from './checkin.controller.js';
import { CheckinService } from './checkin.service.js';
import { WhatsAppService } from './whatsapp.service.js';

@Module({ controllers: [CheckinController], providers: [CheckinService, WhatsAppService] })
export class CheckinModule {}
