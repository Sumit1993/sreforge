import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://todo:todopass@127.0.0.1:5432/tododb';
const pool = new pg.Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);

const prismaClient = new PrismaClient({
  adapter,
  log:
    process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
});

@Global()
@Module({
  providers: [
    {
      provide: PrismaClient,
      useValue: prismaClient,
    },
  ],
  exports: [PrismaClient],
})
export class DatabaseModule implements OnModuleDestroy {
  async onModuleDestroy() {
    await prismaClient.$disconnect();
    await pool.end();
  }
}
