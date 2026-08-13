import { defineConfig } from 'tsdown'

// annotated rather than exported inline: `isolatedDeclarations` cannot infer a default export
const config: ReturnType<typeof defineConfig> = defineConfig({
  // one entry per framework binding, so a vue app never pulls the react one into its graph
  entry: ['src/index.ts', 'src/vue.ts', 'src/react.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  unbundle: false,
  publint: true,
  attw: true
})

export default config
