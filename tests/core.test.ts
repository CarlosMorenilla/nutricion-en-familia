import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { unzipSync, strFromU8 } from 'fflate';
import { demoData } from '../lib/nutrition/demo';
import {
  type DayPlan,
  decimal,
  monday,
  addDays,
  adherence,
  weeklyWeights,
  validatePlan,
  today,
  publishedPlan,
} from '../lib/nutrition/model';
import { exportData, csvCell } from '../lib/nutrition/export';
void test('fechas, coma decimal, ausencia de datos y medias', () => {
  assert.equal(decimal('74,85'), 74.85);
  assert.equal(decimal(''), null);
  assert.equal(decimal('7,5', 0, 24), 7.5);
  assert.equal(decimal('0', 0, 24), 0);
  assert.throws(() => decimal('24,5', 0, 24));
  assert.throws(() => decimal('74,8kg'));
  assert.throws(() => decimal('-2'));
  assert.throws(() => decimal('999'));
  assert.equal(monday('2026-09-06'), '2026-08-31');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  const data = demoData();
  const rows = [
    {
      member_id: 'carlitos' as const,
      date: '2026-09-01',
      diet: null,
      training: null,
      comment: '',
    },
  ];
  assert.deepEqual(adherence(rows, 'diet'), {
    count: 0,
    done: 0,
    partial: 0,
    percent: null,
  });
  assert.deepEqual(
    weeklyWeights([
      { ...data.measurements[0], date: '2026-09-01', weight: 70 },
      { ...data.measurements[0], date: '2026-09-03', weight: 72 },
      { ...data.measurements[0], date: '2026-09-04', weight: null },
    ]),
    [{ week: '2026-08-31', count: 2, average: 71 }],
  );
});
void test('publicación y exportación con privacidad y contexto', () => {
  const data = demoData(),
    p = data.plans[0];
  validatePlan(p);
  const missing = structuredClone(p);
  missing.shared[0].title = '';
  assert.throws(() => validatePlan(missing));
  data.daily[0].comment = '=HYPERLINK("https://example.com")';
  const files = unzipSync(
    exportData(data, 'carlitos', '2000-01-01', '2099-01-01'),
  );
  assert.ok(strFromU8(files['registros.csv']).includes("'=HYPERLINK"));
  assert.ok(!strFromU8(files['planes_personales.csv']).includes('"mama"'));
  assert.ok(strFromU8(files['comidas.csv']).includes('plato_compartido'));
  assert.ok(!files['respaldo.json']);
  const backup = unzipSync(exportData(data, 'all', '', '', true));
  assert.equal(
    JSON.parse(strFromU8(backup['respaldo.json'])).profiles.length,
    3,
  );
  assert.ok(csvCell('  +1').startsWith('"\''));
  assert.equal(publishedPlan(data.plans, today(), 'mama')?.id, p.id);
  assert.equal(
    publishedPlan(data.plans, addDays(today(), 7), 'mama'),
    undefined,
  );
});
void test('SQL real: RLS, Google autorizado, publicación atómica, historial y conflictos', async () => {
  const db = new PGlite();
  await db.exec(`create role anon nologin;create role authenticated nologin;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
  await db.exec(
    readFileSync(new URL('../database/schema.sql', import.meta.url), 'utf8'),
  );
  const ids = {
    carlitos: '00000000-0000-4000-8000-000000000001',
    mama: '00000000-0000-4000-8000-000000000002',
    papa: '00000000-0000-4000-8000-000000000003',
    outsider: '00000000-0000-4000-8000-000000000004',
  };
  for (const [person, id] of Object.entries(ids)) {
    if (person !== 'outsider')
      await db.query('insert into private.allowed_emails values ($1,$2)', [
        person,
        person + '@example.test',
      ]);
    await db.query(
      'insert into auth.users values($1,$2,now(),\'{"provider":"google"}\')',
      [id, person + '@example.test'],
    );
  }
  const asUser = async (who: keyof typeof ids) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      ids[who],
    ]);
    await db.exec('set role authenticated');
  };
  await asUser('carlitos');
  assert.equal((await db.query('select * from profiles')).rows.length, 3);
  const p = demoData().plans[0];
  p.status = 'draft';
  p.revision = 0;
  await db.query('select save_family_plan($1::jsonb,false)', [
    JSON.stringify(p),
  ]);
  await asUser('mama');
  assert.equal((await db.query('select * from plan_versions')).rows.length, 0);
  assert.equal((await db.query('select * from member_plans')).rows.length, 0);
  await asUser('carlitos');
  p.revision = 1;
  p.shared[0].title = '';
  await assert.rejects(
    db.query('select save_family_plan($1::jsonb,true)', [JSON.stringify(p)]),
    /comidas|cenas/i,
  );
  assert.equal(
    (await db.query<{ revision: number }>('select revision from plan_versions'))
      .rows[0].revision,
    1,
  );
  p.shared[0].title = 'Plato compartido';
  await db.query('select save_family_plan($1::jsonb,true)', [
    JSON.stringify(p),
  ]);
  await db.query("update meal_bases set title='Alterado' where plan_id=$1", [
    p.id,
  ]);
  assert.equal(
    (
      await db.query<{ title: string }>(
        "select title from meal_bases where plan_id=$1 and day=0 and slot='comida'",
        [p.id],
      )
    ).rows[0].title,
    'Plato compartido',
  );
  await asUser('mama');
  assert.equal((await db.query('select * from profiles')).rows.length, 1);
  await db.query(
    "insert into daily_records(member_id,date,sleep_hours,sleep_quality) values('mama',$1,7.5,4)",
    [today()],
  );
  await assert.rejects(
    db.query("update daily_records set sleep_hours=25 where member_id='mama'"),
    /check constraint/i,
  );
  await assert.rejects(
    db.query("update daily_records set sleep_quality=0 where member_id='mama'"),
    /check constraint/i,
  );
  await assert.rejects(
    db.query(
      "insert into daily_records(member_id,date,sleep_hours) values('carlitos',$1,7)",
      [today()],
    ),
    /policy|security/i,
  );
  await db.query(
    "update daily_records set sleep_hours=null,sleep_quality=null where member_id='mama'",
  );
  assert.equal(
    (
      await db.query<{ sleep_hours: number | null }>(
        'select sleep_hours from daily_records',
      )
    ).rows[0].sleep_hours,
    null,
  );
  assert.equal((await db.query('select * from member_plans')).rows.length, 1);
  assert.equal((await db.query('select * from plan_versions')).rows.length, 1);
  assert.equal(
    (await db.query("select * from member_plans where member_id='carlitos'"))
      .rows.length,
    0,
  );
  await db.query(
    "insert into measurements(member_id,date,weight) values('mama',$1,67.5)",
    [today()],
  );
  await assert.rejects(
    db.query(
      "insert into measurements(member_id,date,weight) values('carlitos',$1,70)",
      [today()],
    ),
    /policy|security/i,
  );
  await assert.rejects(
    db.query(
      "update measurements set member_id='carlitos' where member_id='mama'",
    ),
    /policy|security/i,
  );
  await assert.rejects(
    db.query('select save_family_plan($1::jsonb,false)', [JSON.stringify(p)]),
    /administrador/i,
  );
  await assert.rejects(
    db.query(
      "insert into daily_records(member_id,date,diet) values('mama',$1,'done')",
      [addDays(today(), 1)],
    ),
    /check constraint/i,
  );
  await assert.rejects(
    db.query("insert into weekly_reviews values('mama',$1,6,3,3,'')", [
      monday(today()),
    ]),
    /check constraint/i,
  );
  await asUser('outsider');
  for (const table of [
    'profiles',
    'plan_versions',
    'member_plans',
    'meal_bases',
    'measurements',
    'daily_records',
  ])
    assert.equal((await db.query('select * from ' + table)).rows.length, 0);
  await asUser('carlitos');
  const next = structuredClone(p);
  next.id = crypto.randomUUID();
  next.revision = 0;
  await db.query('select save_family_plan($1::jsonb,false)', [
    JSON.stringify(next),
  ]);
  await assert.rejects(
    db.query('select save_family_plan($1::jsonb,false)', [
      JSON.stringify(next),
    ]),
    /sesión/i,
  );
  next.revision = 1;
  next.members[0].days[0].meals.comida.portion = 'Nueva ración';
  await db.query('select save_family_plan($1::jsonb,true)', [
    JSON.stringify(next),
  ]);
  const old = await db.query<{ days: DayPlan[] }>(
    "select days from member_plans where plan_id=$1 and member_id='carlitos'",
    [p.id],
  );
  assert.notEqual(old.rows[0].days[0].meals.comida.portion, 'Nueva ración');
  await db.exec('reset role');
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from measurements'), /permission/i);
  await db.close();
});
