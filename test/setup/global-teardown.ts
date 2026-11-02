import { rmSync } from 'node:fs';
import { DB_URL_FILE } from './global-setup';

export default async function globalTeardown(): Promise<void> {
  const container = (globalThis as unknown as { __PG__?: { stop(): Promise<unknown> } }).__PG__;
  await container?.stop();
  rmSync(DB_URL_FILE, { force: true });
}
