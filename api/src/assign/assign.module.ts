import { Module } from '@nestjs/common';
import { AssignController } from './assign.controller.js';
import { AssignService } from './assign.service.js';
import { BookingService } from './booking.service.js';

@Module({ controllers: [AssignController], providers: [AssignService, BookingService], exports: [BookingService, AssignService] })
export class AssignModule {}
