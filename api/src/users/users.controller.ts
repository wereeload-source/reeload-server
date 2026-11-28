import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators.js';
import { Can } from '@nestjs/authorization';
import { AccessPolicy } from '../access/access.policy.js';
import type { AuthUser } from '../common/types.js';
import { CreateUser, ResetPassword, UpdateUser, type CreateUserInput, type UpdateUserInput } from './users.schemas.js';
import { UsersService } from './users.service.js';

/** User management is Admin only. */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Can(AccessPolicy, 'manageUsers')
  list() {
    return this.users.list();
  }

  @Post()
  @Can(AccessPolicy, 'manageUsers')
  create(@CurrentUser() admin: AuthUser, @Body({ schema: CreateUser }) body: CreateUserInput) {
    return this.users.create(admin, body);
  }

  @Patch(':id')
  @Can(AccessPolicy, 'manageUsers')
  update(@CurrentUser() admin: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body({ schema: UpdateUser }) body: UpdateUserInput) {
    return this.users.update(admin, id, body);
  }

  @Post(':id/password')
  @Can(AccessPolicy, 'manageUsers')
  @HttpCode(200)
  resetPassword(@CurrentUser() admin: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body({ schema: ResetPassword }) body: { password: string }) {
    return this.users.resetPassword(admin, id, body.password);
  }
}
