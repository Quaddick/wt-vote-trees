import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

/**
 * Два набора: «node» — общие функции, скрипты, сервер; «web» — страница в jsdom.
 * Playwright (`e2e/`) vitest не трогает.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['shared/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/server/**/*.test.ts', 'tests/seed/**/*.test.ts'],
        },
      },
      {
        plugins: [preact()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}', 'tests/web/**/*.test.{ts,tsx}'],
        },
      },
    ],
    passWithNoTests: true,
  },
});
