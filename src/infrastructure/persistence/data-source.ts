import { DataSource, DataSourceOptions } from 'typeorm';
import { ORM_ENTITIES } from './orm-entities';
import { ReferenceSchema1762000000001 } from './migrations/1762000000001-ReferenceSchema';
import { AppointmentSchema1762000000002 } from './migrations/1762000000002-AppointmentSchema';

/** Ordered list of hand-written migrations: the schema's single source of truth (research R3). */
export const MIGRATIONS = [ReferenceSchema1762000000001, AppointmentSchema1762000000002];
export const LATEST_MIGRATION = AppointmentSchema1762000000002.name;

export interface DataSourceConfig {
  databaseUrl: string;
  dbPoolMax: number;
}

/**
 * NEVER enable `synchronize` or use `migration:generate`: TypeORM diffs exclusion constraints and
 * FKs by name only and would drop the ones it does not model (research R3, Constitution V).
 */
export function dataSourceOptions(cfg: DataSourceConfig): DataSourceOptions {
  return {
    type: 'postgres',
    url: cfg.databaseUrl,
    entities: ORM_ENTITIES,
    migrations: MIGRATIONS,
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: { max: cfg.dbPoolMax },
  };
}

export function createDataSource(cfg: DataSourceConfig): DataSource {
  return new DataSource(dataSourceOptions(cfg));
}
