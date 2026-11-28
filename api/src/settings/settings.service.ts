import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../common/audit.service.js';
import type { Db } from '../prisma/db.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SETTING_DEFAULTS, SETTING_KEYS, SETTING_RULES, type SettingKey } from './settings.rules.js';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** The stored value, or the default until an Admin sets one. */
  async number(key: SettingKey, db: Db = this.prisma): Promise<number> {
    const row = await db.setting.findUnique({ where: { key } });
    return typeof row?.value === 'number' ? row.value : (SETTING_DEFAULTS[key] as number);
  }

  async flag(key: SettingKey, db: Db = this.prisma): Promise<boolean> {
    const row = await db.setting.findUnique({ where: { key } });
    return typeof row?.value === 'boolean' ? row.value : (SETTING_DEFAULTS[key] as boolean);
  }

  /** Every setting with its current value (defaults filled in). */
  async list() {
    const rows = await this.prisma.setting.findMany();
    const stored = new Map(rows.map((r) => [r.key, r]));
    return SETTING_KEYS.map((key) => ({ key, value: stored.get(key)?.value ?? SETTING_DEFAULTS[key], updatedAt: stored.get(key)?.updatedAt ?? null }));
  }

  /** Admin changes a setting; the value must fit that setting's rule. */
  async update(adminId: string, key: string, value: unknown) {
    if (!(SETTING_KEYS as string[]).includes(key)) throw new NotFoundException('Unknown setting');
    const parsed = SETTING_RULES[key as SettingKey].safeParse(value);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'That value is not allowed');

    const before = await this.prisma.setting.findUnique({ where: { key } });
    const row = await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: parsed.data },
      update: { value: parsed.data },
    });
    await this.audit.record(this.prisma, adminId, 'update', 'settings', key, {
      old: (before?.value ?? SETTING_DEFAULTS[key as SettingKey]) as Prisma.InputJsonValue,
      new: parsed.data,
    });
    return { key: row.key, value: row.value, updatedAt: row.updatedAt };
  }
}
