import { Module } from '@nestjs/common';
import { AssignModule } from '../assign/assign.module.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

@Module({ imports: [AssignModule], controllers: [JobsController], providers: [JobsService] })
export class JobsModule {}
