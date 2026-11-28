/**
 * Creates the five demo accounts and a few sample jobs so every role can be tried.
 * Run with `pnpm db:seed`. Safe to repeat: it skips what already exists. Never run it on production data.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Passwords } from '../auth/passwords.js';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'Reeload#2025';

const USERS = [
  { email: 'admin@reeload.test', fullName: 'Aarav Admin', role: 'admin' },
  { email: 'sales@reeload.test', fullName: 'Sana Sales', role: 'sales' },
  { email: 'ops@reeload.test', fullName: 'Om Operations', role: 'ops' },
  { email: 'accounts@reeload.test', fullName: 'Anita Accounts', role: 'accounts' },
  { email: 'reelmaker@reeload.test', fullName: 'Ravi Reelmaker', role: 'reelmaker', phone: '+919876500001' },
] as const;

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const prisma = app.get(PrismaService);
  const hasher = app.get(Passwords);
  const passwordHash = await hasher.hash(DEMO_PASSWORD);

  for (const u of USERS) {
    const user = await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, passwordHash } });
    if (u.role === 'reelmaker') {
      await prisma.reelmaker.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, kind: 'full_time', baseCity: 'Hyderabad' } });
    }
  }

  const client = (await prisma.client.findFirst({ where: { phone: '+919000000001' } })) ?? (await prisma.client.create({ data: { name: 'Sample Client', phone: '+919000000001' } }));
  const jobs = await prisma.job.count();
  if (!jobs) {
    const sales = await prisma.user.findUniqueOrThrow({ where: { email: 'sales@reeload.test' } });
    const day = (n: number) => new Date(Date.now() + n * 86_400_000);
    for (const [i, city] of ['Hyderabad', 'Bengaluru', 'Chennai'].entries()) {
      await prisma.job.create({
        data: { clientId: client.id, city, status: 'confirmed', startsAt: day(2 + i), durationMinutes: 240, createdById: sales.id, money: { create: { agreedAmount: 12000 + i * 3000 } } },
      });
    }
  }
  console.log(`Seeded ${USERS.length} accounts. Password for all: ${DEMO_PASSWORD} (change it before any real use).`);
} finally {
  await app.close();
}
