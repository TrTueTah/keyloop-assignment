// @ts-check
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Clean Architecture dependency rule (Constitution v2.0.0, Principle IV).
 * Sources may only depend inward: presentation/infrastructure -> application -> domain.
 * The composition root (src/main.ts, src/tracing.ts, src/app.module.ts, src/modules/**) is
 * deliberately not matched by any layer block below, so it may wire every layer together.
 */
const layer = (name) => `(^|/)${name}(/|$)`;

const restrict = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

export const layerRules = [
  {
    files: ['src/domain/**/*.ts'],
    rules: restrict([
      {
        // Only relative domain imports and Luxon (a pure, I/O-free library) are allowed.
        regex: '^(?!luxon$)(?!\\.)',
        message: 'domain/ may import only other domain files and luxon (Constitution IV).',
      },
      {
        regex: `${layer('application')}|${layer('infrastructure')}|${layer('presentation')}|${layer('modules')}`,
        message: 'domain/ must not depend on outer layers (Constitution IV).',
      },
    ]),
  },
  {
    files: ['src/application/**/*.ts'],
    rules: restrict([
      {
        // Only relative imports (domain/ + application/) and node:crypto (pure hashing, research R8).
        regex: '^(?!node:crypto$)(?!\\.)',
        message:
          'application/ may import only domain/ (and node:crypto). No frameworks, ORM, drivers or telemetry (Constitution IV).',
      },
      {
        regex: `${layer('infrastructure')}|${layer('presentation')}|${layer('modules')}`,
        message: 'application/ must not depend on adapters (Constitution IV).',
      },
    ]),
  },
  {
    files: ['src/presentation/**/*.ts'],
    rules: restrict([
      {
        regex: `${layer('infrastructure')}|${layer('modules')}|^typeorm|^pg$|^@nestjs/typeorm$`,
        message:
          'presentation/ must not import infrastructure, the ORM or the driver (Constitution IV).',
      },
    ]),
  },
  {
    files: ['src/infrastructure/**/*.ts'],
    rules: restrict([
      {
        regex: `${layer('presentation')}|${layer('modules')}`,
        message: 'infrastructure/ must not import presentation (Constitution IV).',
      },
    ]),
  },
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.specify/**', '.claude/**', 'specs/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  ...layerRules,
  prettier,
);
