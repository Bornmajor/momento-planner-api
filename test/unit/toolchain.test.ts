import { describe, expect, it } from 'vitest';
import { API_PREFIX, APP_NAME } from '../../src/lib/app-info.js';

// T0.1 smoke test: proves Vitest + TypeScript + ESM (.js import specifiers) resolve src/ correctly.
describe('toolchain', () => {
  it('imports from src using ESM specifiers', () => {
    expect(APP_NAME).toBe('momento-planner-api');
    expect(API_PREFIX).toBe('/api/v1');
  });
});
