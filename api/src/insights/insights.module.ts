import { Module } from '@nestjs/common';
import { AssignModule } from '../assign/assign.module.js';
import { ReviewModule } from '../review/review.module.js';
import { InsightsController } from './insights.controller.js';
import { InsightsService } from './insights.service.js';

@Module({ imports: [AssignModule, ReviewModule], controllers: [InsightsController], providers: [InsightsService] })
export class InsightsModule {}
