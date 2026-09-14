import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

void test('cloud review inbox: dates, idempotence and denied browser access', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      'create schema private; create role anon; create role authenticated; grant usage on schema private to anon, authenticated;',
    );
    await db.exec(readFileSync('database/cloud_review_inbox.sql', 'utf8'));
    const insert = `insert into private.cloud_health_reviews(period_start,period_end,status,summary,evidence,raw_responses) values ('2020-01-04','2020-01-10','ready','Synthetic review','{}','[]') on conflict do nothing`;
    await db.exec(insert);
    await db.exec(insert);
    assert.equal(
      (
        await db.query<{ n: number }>(
          'select count(*)::int n from private.cloud_health_reviews',
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(
      db.exec(
        `insert into private.cloud_health_reviews(period_start,period_end,status,summary,evidence,raw_responses) values ('2020-01-05','2020-01-11','ready','Invalid Sunday','{}','[]')`,
      ),
    );
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(
        db.exec('select * from private.cloud_health_reviews'),
        /permission denied/,
      );
      await assert.rejects(db.exec(insert), /permission denied/);
      await db.exec('reset role');
    }
  } finally {
    await db.close();
  }
});
