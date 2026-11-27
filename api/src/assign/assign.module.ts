import { Module } from '@nestjs/common';
import { AssignController } from './assign.controller.js';
import { AssignService } from './assign.service.js';

@Module({ controllers: [AssignController], providers: [AssignService] })
export class AssignModule {}
