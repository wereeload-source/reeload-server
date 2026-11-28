import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { AccessPolicy } from '../access/access.policy.js';
import { toWire } from '../common/snake-case.interceptor.js';
import type { AuthUser } from '../common/types.js';
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
  @Can(AccessPolicy, 'viewLedger')
  list(@Query({ schema: LedgerQuery }) q: LedgerQueryInput) {
    return this.ledger.ledger(q);
  }

  @Get('ledger.csv')
  @Can(AccessPolicy, 'exportLedger')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="reelops-ledger.csv"')
  async csv(@Query({ schema: LedgerQuery }) q: LedgerQueryInput) {
    const { items } = await this.ledger.ledger({ ...q, limit: 500, offset: 0 });
    return toCsv(CSV_COLUMNS, toWire(items) as Record<string, unknown>[]);
  }

  @Get('jobs/:id/payments')
  @Can(AccessPolicy, 'viewLedger')
  payments(@Param('id', uuid()) id: string) {
    return this.ledger.jobPayments(id);
  }

  @Post('jobs/:id/payments')
  @Can(AccessPolicy, 'recordPayment')
  record(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: RecordPayment }) body: RecordPaymentInput) {
    return this.ledger.recordPayment(user, id, body);
  }

  @Get('payments/:id/receipt')
  @Can(AccessPolicy, 'viewLedger')
  receipt(@Param('id', uuid()) id: string) {
    return this.ledger.receipt(id);
  }
}
