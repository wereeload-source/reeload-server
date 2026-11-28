import { Module } from '@nestjs/common';
import { AssignModule } from '../assign/assign.module.js';
import { ShootsController } from './shoots.controller.js';
import { ShootsService } from './shoots.service.js';

@Module({ imports: [AssignModule], controllers: [ShootsController], providers: [ShootsService] })
export class ShootsModule {}
