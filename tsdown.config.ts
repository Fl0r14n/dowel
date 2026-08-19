import { defineConfig } from 'tsdown'

// annotated rather than exported inline: `isolatedDeclarations` cannot infer a default export
const config: ReturnType<typeof defineConfig> = defineConfig({
  // one entry per framework binding, so a vue app never pulls the react one into its graph. named rather
  // than a bare list: every binding is an `index` within its own folder, so the output names must be given
  entry: {
    index: 'src/index.ts',
    vue: 'src/vue/index.ts',
    react: 'src/react/index.ts',
    angular: 'src/angular/index.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  unbundle: false,
  publint: true,
  attw: true
})

export default config
