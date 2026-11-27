import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators.js';
import type { AuthUser } from '../common/types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CreateUser, ResetPassword, UpdateUser, type CreateUserInput, type UpdateUserInput } from './users.schemas.js';
import { UsersService } from './users.service.js';

/** User management is Admin only (the profiles table's policy says the same). */
@Controller('users')
@Roles('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() admin: AuthUser) {
    return this.users.list(admin);
  }

  @Post()
  create(@CurrentUser() admin: AuthUser, @Body(new ZodPipe(CreateUser)) body: CreateUserInput) {
    return this.users.create(admin, body);
  }

  @Patch(':id')
  update(@CurrentUser() admin: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(UpdateUser)) body: UpdateUserInput) {
    return this.users.update(admin, id, body);
  }

  @Post(':id/password')
  @HttpCode(200)
  resetPassword(@CurrentUser() admin: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(ResetPassword)) body: { password: string }) {
    return this.users.resetPassword(admin, id, body.password);
  }
}
