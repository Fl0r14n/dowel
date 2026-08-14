# inject-braid

Token-based dependency injection with no registration step. ~160 lines, no dependencies, SSR-safe.

```sh
npm i inject-braid   # bun add inject-braid
```

## the idea

A service declares its own default where it's used, and the first call runs the factory and stores it:

```ts
const logger = inject(Logger, () => new ConsoleLogger())
```

Every later `inject(Logger)` — any module — gets that same instance. The factory *is* the registration.

Tokens are classes or strings. An abstract class is both the runtime key and the compile-time type:

```ts
export abstract class Logger {
  abstract log(message: string): void
}
```

In practice you export one accessor per service, next to it, and consumers call that:

```ts
// logger.ts
const consoleLogger = () => new ConsoleLogger()

export const useLogger = () => inject(Logger, consoleLogger)
```

## vue

```ts
import { createProviders, inject } from 'inject-braid/vue'

app.use(createProviders()) // once per app
```

Resolve inside a vue injection context — component setup, store setup, `app.runWithContext`:

```ts
const logger = useLogger()
```

Override by providing on the app, before anything resolves. Installing the plugin puts `providers` on the app:

```ts
export const myModule = (endpoint: string) => ({
  install: (app: App) => app.providers.provide(Logger, new RemoteLogger(endpoint))
})

app.use(createProviders())
app.use(myModule('https://logs.example')) // app.use order decides; last one wins
```

## react

```tsx
import { ContainerProvider, createContainer, useService } from 'inject-braid/react'

const container = createContainer() // one per request under SSR
container.provide(Logger, new RemoteLogger(endpoint)) // overrides, before render

render(<ContainerProvider container={container}>{app}</ContainerProvider>)
```

In components, `useService`:

```tsx
export const useLogger = () => useService(Logger, consoleLogger)
```

Outside components — loaders, guards, service factories — bind the container around a **synchronous** callback:

```ts
import { inject, runInContainer } from 'inject-braid/react'

runInContainer(container, () => inject(Logger, consoleLogger))
```

## rules worth knowing

**The second argument is a factory, never a value.** A value would be built at module scope and shared by
every request, so under SSR one request would read another's state.

```ts
inject(Cart, new Cart()) // ✗ compile error
inject(Cart, () => new Cart()) // ✓ one per registry
```

**`inject` returns `T`, and throws if nothing provided the token and no factory was given.** When absent is a
valid answer, ask for it — `inject.optional(token)` returns `T | undefined` and stores nothing, so a module
providing it later still wins. `useService.optional` is the component-side counterpart.

**Provide before anything resolves.** You get that for free: providing needs the app or container, which is
bootstrap code, and resolving needs a context that only exists once the app is running. Invert it anyway — an
`app.use` after mount, a container reused between tests — and the registry takes the new value while whatever
already captured the earlier instance keeps it, silently.

**A `runInContainer` binding ends when its callback returns.** Returning a promise is fine; resolving after an
`await` *inside* it is not.

```ts
runInContainer(container, () => inject(Api, api).fetchUsers()) // ✓ resolved, then awaited
runInContainer(container, async () => {
  await ready
  return inject(Api) // ✗ the binding already ended
})
```

**A circular dependency overflows the stack.** There's no cycle detector; you get a `RangeError` on the first
resolve with the loop visible in the frames.

**Class tokens are matched by identity**, so an override must import the very class the library injects, and
that module must be a single copy in your graph.

## exports

| entry | |
| --- | --- |
| `inject-braid` | `createContainer`, `runInContainer`, types |
| `inject-braid/vue` | `createProviders`, `inject`, and `app.providers.provide` via a `vue` type augmentation |
| `inject-braid/react` | `ContainerProvider`, `useService`, `inject`, `createContainer`, `runInContainer` |

## requirements

Node 22+, Bun, Deno, or any current browser. Nothing from `node:*`. ESM and CJS both shipped. `vue` and
`react` are optional peers — you need only the one whose binding you import.

## development

```sh
bun install
bun run check   # lint + type-check + test
bun run build   # tsdown → dist, validated by publint and attw
bun run smoke   # import the built dist/ under plain node, esm and cjs
```

Design decisions and their reasoning live in [AGENTS.md](https://github.com/Fl0r14n/inject-braid/blob/main/AGENTS.md) — it is not in the npm tarball.

## licence

MIT
