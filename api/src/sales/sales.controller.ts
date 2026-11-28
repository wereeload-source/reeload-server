import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import {
  ContactQuery, DecidePriceChange, LogContact, PriceChangeQuery, RecordAdvance, RequestPriceChange,
  type ContactQueryInput, type LogContactInput, type PriceChangeQueryInput, type RecordAdvanceInput, type RequestPriceChangeInput,
} from './sales.schemas.js';
import { SalesService } from './sales.service.js';

const uuid = () => new ParseUUIDPipe();

@Controller()
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /** Agreed amount, approved changes, advance, received and balance for one job. */
  @Get('jobs/:id/summary')
  @Roles('admin', 'sales', 'accounts')
  summary(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string) {
    return this.sales.summary(user, id);
  }

  @Post('jobs/:id/advance')
  @Roles('admin', 'sales')
  advance(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(RecordAdvance)) body: RecordAdvanceInput) {
    return this.sales.recordAdvance(user, id, body);
  }

  @Post('jobs/:id/price-changes')
  @Roles('admin', 'sales')
  requestChange(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(RequestPriceChange)) body: RequestPriceChangeInput) {
    return this.sales.requestPriceChange(user, id, body);
  }

  @Get('price-changes')
  @Roles('admin', 'sales')
  listChanges(@CurrentUser() user: AuthUser, @Query(new ZodPipe(PriceChangeQuery)) q: PriceChangeQueryInput) {
    return this.sales.listPriceChanges(user, q);
  }

  @Post('price-changes/:id/decision')
  @Roles('admin')
  decide(@CurrentUser() user: AuthUser, @Param('id', uuid()) id: string, @Body(new ZodPipe(DecidePriceChange)) body: { approve: boolean }) {
    return this.sales.decidePriceChange(user, id, body.approve);
  }

  @Post('contacts')
  @Roles('admin', 'sales')
  log(@CurrentUser() user: AuthUser, @Body(new ZodPipe(LogContact)) body: LogContactInput) {
    return this.sales.logContact(user, body);
  }

  @Get('contacts')
  @Roles('admin', 'sales')
  contacts(@CurrentUser() user: AuthUser, @Query(new ZodPipe(ContactQuery)) q: ContactQueryInput) {
    return this.sales.contacts(user, q);
  }
}
