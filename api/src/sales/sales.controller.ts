import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { AccessPolicy } from '../access/access.policy.js';
import type { AuthUser } from '../common/types.js';
import {
  ContactQuery, DecidePriceChange, LogContact, PriceChangeQuery, RecordAdvance, RequestPriceChange,
  type ContactQueryInput, type LogContactInput, type PriceChangeQueryInput, type RecordAdvanceInput, type RequestPriceChangeInput,
} from './sales.schemas.js';
import { SalesService } from './sales.service.js';

const uuid = () => new ParseUUIDPipe();

@Controller()
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('jobs/:id/summary')
  @Can(AccessPolicy, 'viewLedger')
  summary(@Param('id', uuid()) id: string) {
    return this.sales.summary(id);
  }

  @Post('jobs/:id/advance')
  @Can(AccessPolicy, 'recordAdvance')
  advance(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: RecordAdvance }) body: RecordAdvanceInput) {
    return this.sales.recordAdvance(user, id, body);
  }

  @Post('jobs/:id/price-changes')
  @Can(AccessPolicy, 'requestPriceChange')
  requestPriceChange(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: RequestPriceChange }) body: RequestPriceChangeInput) {
    return this.sales.requestPriceChange(user, id, body);
  }

  @Get('price-changes')
  @Can(AccessPolicy, 'viewPriceChanges')
  priceChanges(@Query({ schema: PriceChangeQuery }) q: PriceChangeQueryInput) {
    return this.sales.listPriceChanges(q);
  }

  @Post('price-changes/:id/decision')
  @Can(AccessPolicy, 'decidePriceChange')
  decide(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body({ schema: DecidePriceChange }) body: { approve: boolean }) {
    return this.sales.decidePriceChange(user, id, body.approve);
  }

  @Post('contacts')
  @Can(AccessPolicy, 'logContact')
  logContact(@CurrentUser() user: AuthUser, @Body({ schema: LogContact }) body: LogContactInput) {
    return this.sales.logContact(user, body);
  }

  @Get('contacts')
  @Can(AccessPolicy, 'logContact')
  contacts(@CurrentUser() user: AuthUser, @Query({ schema: ContactQuery }) q: ContactQueryInput) {
    return this.sales.contacts(user, q);
  }
}
