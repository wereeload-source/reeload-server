import { Module } from '@nestjs/common';
import { AssignModule } from '../assign/assign.module.js';
import { LedgerController } from './ledger.controller.js';
import { LedgerService } from './ledger.service.js';

@Module({ imports: [AssignModule], controllers: [LedgerController], providers: [LedgerService] })
export class LedgerModule {}
