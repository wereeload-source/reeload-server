import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { toCsv } from './ledger.csv.js';
import { LedgerQuery, RecordPayment, type LedgerQueryInput, type RecordPaymentInput } from './ledger.schemas.js';
import { LedgerService } from './ledger.service.js';

const uuid = () => new ParseUUIDPipe();

const CSV_COLUMNS = [
  { key: 'code', label: 'Job' }, { key: 'client_name', label: 'Client' }, { key: 'city', label: 'City' }, { key: 'status', label: 'Status' },
  { key: 'starts_at', label: 'Shoot date' }, { key: 'agreed_amount', label: 'Agreed' }, { key: 'approved_changes', label: 'Approved changes' },
  { key: 'advance', label: 'Advance' }, { key: 'received', label: 'Received' }, { key: 'balance', label: 'Balance' },
];

@Controller()
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('ledger')
  @Roles('admin', 'accounts', 'sales')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(LedgerQuery)) q: LedgerQueryInput) {
    return this.ledger.ledger(user, q);
  }

  @Get('ledger.csv')
  @Roles('admin', 'accounts')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="reelops-ledger.csv"')
  async csv(@CurrentUser() user: AuthUser, @Query(new ZodPipe(LedgerQuery)) q: LedgerQueryInput) {
    const { items } = await this.ledger.ledger(user, { ...q, limit: 500, offset: 0 });
    return toCsv(CSV_COLUMNS, items as Record<string, unknown>[]);
  }

  @Get('jobs/:id/payments')
  @Roles('admin', 'accounts', 'sales')
  payments(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.ledger.jobPayments(user, id);
  }

  @Post('jobs/:id/payments')
  @Roles('admin', 'accounts')
  record(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(RecordPayment)) body: RecordPaymentInput) {
    return this.ledger.recordPayment(user, id, body);
  }

  @Get('payments/:id/receipt')
  @Roles('admin', 'accounts', 'sales')
  receipt(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.ledger.receipt(user, id);
  }
}
