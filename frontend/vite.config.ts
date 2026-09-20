import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: { target: 'es2023', outDir: mode === 'production' ? 'dist-live' : 'dist' },
  test: { environment: 'node', include: ['src/**/*.test.ts', '../tests/tooling/**/*.test.ts'] },
}));
