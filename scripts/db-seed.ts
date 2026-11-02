import { createDataSource } from '../src/infrastructure/persistence/data-source';
import { loadConfig } from '../src/infrastructure/config/env';
import { seed } from '../src/infrastructure/persistence/seed/seed';

async function main(): Promise<void> {
  const ds = await createDataSource(loadConfig()).initialize();
  try {
    await seed(ds);
    console.log('seed applied (idempotent)');
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
