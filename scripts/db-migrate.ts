import { createDataSource } from '../src/infrastructure/persistence/data-source';
import { loadConfig } from '../src/infrastructure/config/env';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const ds = await createDataSource(cfg).initialize();
  try {
    const applied = await ds.runMigrations({ transaction: 'each' });
    console.log(
      `migrations applied: ${applied.map((m) => m.name).join(', ') || 'none (up to date)'}`,
    );
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
