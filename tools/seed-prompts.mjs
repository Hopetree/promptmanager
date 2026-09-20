#!/usr/bin/env node
// AC-7 夹具：向 $DATA_DIR 的库里直接写入 N 条中文 prompt（走 prompts 表 → FTS 触发器自动同步索引）。
// 用法：DATA_DIR=/tmp/xxx node tools/seed-prompts.mjs [count=2000]
// 前置：先 `npm run build:server`（脚本复用编译产物，保证与服务端同一套 schema/连接设置）。
import { sql } from 'kysely';
import { loadConfig } from '../dist/config.js';
import { prepareDatabase } from '../dist/db/index.js';

const count = Number.parseInt(process.argv[2] ?? '2000', 10);
if (!Number.isInteger(count) || count < 1) {
  process.stderr.write('error: count 必须是正整数\n');
  process.exit(2);
}

const dir = process.env.DATA_DIR ?? loadConfig().dataDir;
const config = loadConfig({ DATA_DIR: dir });
const { qe } = prepareDatabase(config);

const started = Date.now();
const now = new Date().toISOString();
await qe.transaction().execute(async (trx) => {
  for (let i = 0; i < count; i += 1) {
    await trx
      .insertInto('prompts')
      .values({
        title: `第 ${i} 条会话交接`,
        user_prompt: `会话交接与上下文整理 ${i}`,
        system_prompt: 'seeded',
        notes: '',
        folder_id: null,
        favorite: 0,
        version_no: 1,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }
});

const total = await qe
  .selectFrom('prompts')
  .select((eb) => eb.fn.countAll().as('total'))
  .executeTakeFirstOrThrow();
const hits = await qe
  .selectFrom('prompts_fts')
  .select((eb) => eb.fn.countAll().as('total'))
  .where(sql`prompts_fts MATCH ${'"会话交接"'}`)
  .executeTakeFirstOrThrow();

process.stdout.write(
  `ok: seeded ${count} prompts (total=${String(total.total)}, fts_hits=${String(hits.total)}) in ${dir} [${String(Date.now() - started)} ms]\n`,
);
await qe.destroy();
