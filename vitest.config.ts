import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: true,
      wrangler: { configPath: './wrangler.jsonc', environment: 'dev' },
      miniflare: {
        bindings: { API_TOKEN: 'test-token' }
      }
    })
  ],
  test: {
    // Vectorize writes are eventually consistent — search-after-upsert can
    // take 10–30s. Bump the per-test timeout accordingly.
    testTimeout: 60_000,
    hookTimeout: 30_000
  }
})
