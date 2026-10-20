#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/4cc07333fc8cab06d227c4c107d126b15409eb87a3dda7d36f34dd5e3a8177ad/contract';
import endContract from '../../snapshots/4cc07333fc8cab06d227c4c107d126b15409eb87a3dda7d36f34dd5e3a8177ad/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/77c9d37c11b900a2e12d48b34fa986868364ce07c16bf793f2dbf0d44c6506d0/contract';
import startContract from '../../snapshots/77c9d37c11b900a2e12d48b34fa986868364ce07c16bf793f2dbf0d44c6506d0/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'PasswordResetIpRateLimit',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ipHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('requestCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('windowStart', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('windowType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'PasswordResetIpRateLimit',
        constraint: 'PasswordResetIpRateLimit_ipHash_windowType_windowStart_key',
        columns: ['ipHash', 'windowType', 'windowStart'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'PasswordResetIpRateLimit',
        index: 'PasswordResetIpRateLimit_windowStart_idx_4944f72a',
        columns: ['windowStart'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
