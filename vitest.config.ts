import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include:     ['tests/unit/**/*.test.ts'],
    alias:       { '@': resolve(__dirname, './src') },
  },
});
