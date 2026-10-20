#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2712c2a3db6485d9b56d92b166ddd29f53d78b0351f1be007522393f64d8513e/contract';
import endContract from '../../snapshots/2712c2a3db6485d9b56d92b166ddd29f53d78b0351f1be007522393f64d8513e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/80832a90955bc037ede8f89debac6bd7ebaec7f3470c9732f0015c3ee4625cab/contract';
import startContract from '../../snapshots/80832a90955bc037ede8f89debac6bd7ebaec7f3470c9732f0015c3ee4625cab/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'EmailVerificationCode',
        columns: [
          col('attemptCount', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('codeHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('consumedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('expiresAt', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'EmailVerificationCode',
        index: 'EmailVerificationCode_expiresAt_idx_6b6b8c10',
        columns: ['expiresAt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'EmailVerificationCode',
        index: 'EmailVerificationCode_userId_idx_a489d58a',
        columns: ['userId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
