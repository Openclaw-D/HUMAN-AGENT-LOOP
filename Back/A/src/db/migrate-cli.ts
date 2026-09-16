// 迁移CLI：node src/db/migrate-cli.ts [--db postgres://...]
import { loadConfig, openPool } from '../config.ts';
import { migrate } from './db.ts';

const config = loadConfig(process.argv.slice(2));
const pool = openPool(config.dbUrl);
migrate(pool)
  .then((ran) => {
    console.log(ran.length > 0 ? `[migrate] applied: ${ran.join(', ')}` : '[migrate] up-to-date');
    return pool.end();
  })
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('[migrate] failed:', error);
    process.exit(1);
  });
