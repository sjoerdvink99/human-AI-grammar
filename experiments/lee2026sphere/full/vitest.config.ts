import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { root: '.', include: ['test/**/*.test.ts'], env: { DATA_DIR: 'data-test' } } });
