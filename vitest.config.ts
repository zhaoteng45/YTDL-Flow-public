import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  // Vue SFC support lets component rendering be verified from tests; the
  // existing helper/logic suites are unaffected because they never import a
  // `.vue` module.
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
