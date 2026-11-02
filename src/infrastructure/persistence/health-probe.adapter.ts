import { DataSource } from 'typeorm';
import { HealthProbe, HealthStatus } from '../../application/ports/health-probe';
import { LATEST_MIGRATION } from './data-source';

export class TypeOrmHealthProbe implements HealthProbe {
  constructor(private readonly ds: DataSource) {}

  async check(): Promise<HealthStatus> {
    try {
      await this.ds.query('SELECT 1');
    } catch {
      return { db: false, migrations: false };
    }
    try {
      const rows: unknown[] = await this.ds.query(`SELECT 1 FROM migrations WHERE name = $1`, [
        LATEST_MIGRATION,
      ]);
      return { db: true, migrations: rows.length === 1 };
    } catch {
      return { db: true, migrations: false };
    }
  }
}
