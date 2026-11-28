import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Passwords } from '../auth/passwords.js';
import { SessionsService } from '../auth/sessions.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../common/audit.service.js';
import type { AuthUser } from '../common/types.js';
import { TX_OPTIONS } from '../prisma/db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateUserInput, UpdateUserInput } from './users.schemas.js';

const USER_SELECT = {
  id: true, fullName: true, phone: true, email: true, role: true, active: true, createdAt: true,
  reelmaker: { select: { kind: true, baseCity: true } },
} as const;

/** The list and detail shape the screens expect: reelmaker fields flattened onto the user. */
function present<T extends { reelmaker: { kind: string; baseCity: string } | null }>({ reelmaker, ...user }: T) {
  return { ...user, kind: reelmaker?.kind ?? null, baseCity: reelmaker?.baseCity ?? null };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: Passwords,
    private readonly sessions: SessionsService,
  ) {}

  async list() {
    const users = await this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: [{ active: 'desc' }, { role: 'asc' }, { fullName: 'asc' }],
    });
    return users.map(present);
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return present(user);
  }

  async create(admin: AuthUser, body: CreateUserInput) {
    const passwordHash = await this.passwords.hash(body.password);
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: body.email, passwordHash, fullName: body.full_name, phone: body.phone ?? null, role: body.role,
            ...(body.role === 'reelmaker'
              ? { reelmaker: { create: { kind: body.kind ?? 'full_time', baseCity: body.base_city! } } }
              : {}),
          },
          select: { id: true },
        });
        await this.audit.record(tx, admin.id, 'user_created', 'users', user.id, { email: body.email, role: body.role });
        return user.id;
      }, TX_OPTIONS);
      return this.get(id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A user with that email already exists');
      }
      throw e;
    }
  }

  async update(admin: AuthUser, id: string, body: UpdateUserInput) {
    // An admin who disables or demotes themselves could lock everyone out.
    if (id === admin.id && (body.active === false || (body.role !== undefined && body.role !== 'admin'))) {
      throw new BadRequestException('You cannot disable or demote your own account');
    }
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id }, select: { role: true, reelmaker: { select: { userId: true } } } });
      if (!current) throw new NotFoundException('User not found');

      await tx.user.update({
        where: { id },
        data: { fullName: body.full_name, phone: body.phone, active: body.active, role: body.role },
      });

      const role = body.role ?? current.role;
      if (role === 'reelmaker') {
        if (!current.reelmaker && !body.base_city) throw new BadRequestException("Enter the reelmaker's base city");
        await tx.reelmaker.upsert({
          where: { userId: id },
          create: { userId: id, kind: body.kind ?? 'full_time', baseCity: body.base_city! },
          update: { kind: body.kind, baseCity: body.base_city },
        });
      }
      await this.audit.record(tx, admin.id, 'user_updated', 'users', id, { ...body });
    }, TX_OPTIONS);

    // A disabled account must stop working everywhere at once.
    if (body.active === false) await this.sessions.removeAll(id);
    return this.get(id);
  }

  async resetPassword(admin: AuthUser, id: string, password: string): Promise<{ ok: true }> {
    const passwordHash = await this.passwords.hash(password);
    const done = await this.prisma.user.updateMany({ where: { id }, data: { passwordHash } });
    if (!done.count) throw new NotFoundException('User not found');
    await this.audit.record(this.prisma, admin.id, 'password_reset', 'users', id);
    await this.sessions.removeAll(id);
    return { ok: true };
  }
}
