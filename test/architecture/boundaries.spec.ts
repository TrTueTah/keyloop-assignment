import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '../..');
const ESLINT_BIN = join(ROOT, 'node_modules/.bin/eslint');

/**
 * Proves the Clean Architecture dependency rule is ENFORCED, not just documented
 * (Constitution IV + "CI's lint step MUST include the layer-boundary rules").
 */
describe('layer boundaries (ESLint no-restricted-imports)', () => {
  // Runs the real ESLint CLI (exactly what CI's lint step runs) on virtual files via stdin.
  // In-process ESLint cannot load the ESM flat config inside Jest's VM sandbox.
  async function violations(filePath: string, code: string): Promise<string[]> {
    const out = spawnSync(
      ESLINT_BIN,
      ['--stdin', '--stdin-filename', join(ROOT, filePath), '--format', 'json'],
      {
        cwd: ROOT,
        input: code,
        encoding: 'utf8',
      },
    );
    const [result] = JSON.parse(out.stdout) as {
      messages: { ruleId: string | null; message: string }[];
    }[];
    return result.messages
      .filter((m) => m.ruleId === 'no-restricted-imports')
      .map((m) => m.message);
  }

  it.each([
    ['src/domain/x.ts', `import { Injectable } from '@nestjs/common';`],
    ['src/domain/x.ts', `import { DataSource } from 'typeorm';`],
    ['src/domain/x.ts', `import { X } from '../application/x';`],
    ['src/application/x.ts', `import { DataSource } from 'typeorm';`],
    ['src/application/x.ts', `import { Injectable } from '@nestjs/common';`],
    ['src/application/x.ts', `import { trace } from '@opentelemetry/api';`],
    ['src/application/x.ts', `import { X } from '../infrastructure/persistence/x';`],
    ['src/application/use-cases/x.ts', `import { X } from '../../presentation/http/x';`],
    ['src/presentation/http/x.ts', `import { X } from '../../infrastructure/persistence/x';`],
    ['src/presentation/http/x.ts', `import { DataSource } from 'typeorm';`],
    ['src/infrastructure/x.ts', `import { X } from '../presentation/http/x';`],
  ])('%s: forbids %s', async (file, code) => {
    expect(
      await violations(file, `${code}\nexport const y = X;`.replace('X;', '1;')),
    ).not.toHaveLength(0);
  });

  it.each([
    [
      'src/domain/x.ts',
      `import { DateTime } from 'luxon';\nimport { Interval } from './interval';`,
    ],
    [
      'src/application/x.ts',
      `import { createHash } from 'node:crypto';\nimport { DomainError } from '../domain/errors';`,
    ],
    [
      'src/presentation/http/x.ts',
      `import { Controller } from '@nestjs/common';\nimport { X } from '../../application/x';`,
    ],
    [
      'src/infrastructure/x.ts',
      `import { DataSource } from 'typeorm';\nimport { X } from '../application/x';`,
    ],
    [
      'src/modules/x.module.ts',
      `import { X } from '../infrastructure/x';\nimport { Y } from '../presentation/http/y';`,
    ],
    [
      'src/main.ts',
      `import { X } from './infrastructure/x';\nimport { Y } from './presentation/http/y';`,
    ],
  ])('%s: allows its legitimate imports', async (file, code) => {
    expect(await violations(file, code)).toEqual([]);
  });
});
