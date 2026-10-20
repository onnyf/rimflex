
import { Temporal } from '@js-temporal/polyfill';
import { Provider } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DATABASE = 'DATABASE';

export const databaseProvider: Provider = {
  provide: DATABASE,

  useFactory: async () => {
    // Make Temporal available globally for Prisma 8.
    const globalWithTemporal = globalThis as typeof globalThis & {
      Temporal?: typeof Temporal;
    };

    if (!globalWithTemporal.Temporal) {
      globalWithTemporal.Temporal = Temporal;
    }

    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL is missing from .env');
    }

    const contractPath = resolve(
      process.cwd(),
      'prisma',
      'contract.json',
    );

    const contractJson = JSON.parse(
      readFileSync(contractPath, 'utf8'),
    );

    // Preserve the native ESM import when NestJS compiles to CommonJS.
    const loadPostgres = new Function(
      'return import("@prisma/orm-postgres/runtime")',
    ) as () => Promise<
      typeof import('@prisma/orm-postgres/runtime')
    >;

    const { default: postgres } = await loadPostgres();

    const db = postgres({
      contractJson,
      url: databaseUrl,
    });

    await db.connect();

    console.log(
      'Restaurant methods:',
      Object.getOwnPropertyNames(
        Object.getPrototypeOf(db.orm.public.Restaurant),
      ),
    );

    console.log(
      'Public namespace exists:',
      db.orm.public !== undefined,
    );

    console.log(
      'Restaurant model exists:',
      db.orm.public?.Restaurant !== undefined,
    );

    console.log('ORM namespaces:', Object.keys(db.orm));

    console.log(
      'Public models:',
      Object.keys(db.orm.public ?? {}),
    );

    console.log('PostgreSQL connection established successfully!');

    console.log(
      'Prisma PostgreSQL client methods:',
      Object.keys(db),
    );

    return db;
  },
};
