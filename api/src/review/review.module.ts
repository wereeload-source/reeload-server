import { Module } from '@nestjs/common';
import { AssignModule } from '../assign/assign.module.js';
import { ReviewController } from './review.controller.js';
import { ReviewService } from './review.service.js';

@Module({ imports: [AssignModule], controllers: [ReviewController], providers: [ReviewService], exports: [ReviewService] })
export class ReviewModule {}
