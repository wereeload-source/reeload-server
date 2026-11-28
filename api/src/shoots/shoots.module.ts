import { Module } from '@nestjs/common';
import { ShootsController } from './shoots.controller.js';
import { ShootsService } from './shoots.service.js';

@Module({ controllers: [ShootsController], providers: [ShootsService] })
export class ShootsModule {}
