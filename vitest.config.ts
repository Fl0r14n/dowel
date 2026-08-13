import { defineConfig } from 'vitest/config'

// node by default — the core and the vue binding both resolve outside a DOM. `react.spec.tsx` opts itself
// into jsdom with a `@vitest-environment` docblock, which keeps the DOM cost on the one file that needs it.
const config: ReturnType<typeof defineConfig> = defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx']
  }
})

export default config
