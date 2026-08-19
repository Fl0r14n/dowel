# dowel-di

> A dowel is a plain wooden pin that joins two pieces from the inside — no screws, no bracket, nothing on the
> surface to see. The joint is the fit itself.

Token-based dependency injection with no registration step. ~160 lines, no dependencies, SSR-safe.

Services join the same way: a token, a factory at the point of use, and no container to wire.

```sh
npm i dowel-di   # bun add dowel-di
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
import { createProviders, inject } from 'dowel-di/vue'

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
import { ContainerProvider, createContainer } from 'dowel-di/react'

const container = createContainer() // one per request under SSR
container.provide(Logger, new RemoteLogger(endpoint)) // overrides, before render

render(<ContainerProvider container={container}>{app}</ContainerProvider>)
```

One `inject`, in components and out. During render it reads the container off context; anywhere else it reads the
one bound around a **synchronous** callback:

```ts
import { inject, runInContainer } from 'dowel-di/react'

export const injectLogger = () => inject(Logger, consoleLogger)

const Cart = () => <span>{injectLogger().status()}</span> // resolved off context
runInContainer(container, () => injectLogger()) // a loader, a guard, a service factory
```

It is a plain function, not a hook: callable from a nested closure, callable in a branch, and callable by a
library that imports no react. `useService` was the component-side door in 1.x and is gone in 2.0 — `inject`
does both.

## angular

Nothing to install: the registry is a `providedIn: 'root'` token, so it appears on the first resolve — one per
root injector, which under SSR is one per request.

Resolve inside an angular injection context — a field initializer, a constructor, a factory, or
`runInInjectionContext(injector, fn)`:

```ts
@Component({ selector: 'user-list', template: '' })
export class UserList {
  private readonly logger = injectLogger()
}
```

Override at bootstrap, with `provideDowel`:

```ts
import { provideDowel } from 'dowel-di/angular'

bootstrapApplication(App, {
  providers: [provideDowel(provide => provide(Logger, new RemoteLogger(endpoint)))]
})
```

The setup runs in an injection context, so a value can be built out of angular's own services — that `inject`
is angular's:

```ts
provideDowel(provide => provide(Api, new Api(inject(HttpClient))))
```

Provider order decides, and the last override of a token wins. `provideDowel` returns `EnvironmentProviders`,
so it will not compile on a component — a component-level registry would be a fresh one per instance.

Accessors read `injectLogger`, not `useLogger`, here — angular's own naming, and `use` on something that is not
a react hook trips lint. A file that needs both `inject`s can rename one:
`import { inject as injectService } from 'dowel-di/angular'`; module code that goes through accessors never has
the clash.

A setup runs at bootstrap and can resolve dowel services too, so an override can be built out of one:
`provideDowel(provide => provide(Cache, new TieredCache(injectStore())))`.

## a library that ships for all three

Library code must not import a binding — that would choose vue for everyone who installs it. It imports the root
instead, and resolves through whichever binding the app set up:

```ts
// my-lib/logger.ts — no framework anywhere in this file
import { inject } from 'dowel-di'

export abstract class Logger {
  abstract log(message: string): void
}
export const injectLogger = () => inject(Logger, () => new ConsoleLogger())
```

The app picks the binding by importing it — `createProviders()` (vue), `<ContainerProvider>` (react),
`provideDowel()` (angular) — and the accessor works unchanged in all three. One accessor list, no per-framework
copies of it, no build step generating them.

Resolve inside that binding's context, exactly as if you had imported it directly. Off context the message names
the installed binding and its door; with several installed, each is asked in turn and the first with a live
registry answers.

## rules worth knowing

**The second argument is a factory, never a value.** A value would be built at module scope and shared by
every request, so under SSR one request would read another's state.

```ts
inject(Cart, new Cart()) // ✗ compile error
inject(Cart, () => new Cart()) // ✓ one per registry
```

**`inject` returns `T`, and throws if nothing provided the token and no factory was given.** When absent is a
valid answer, ask for it — `inject.optional(token)` returns `T | undefined` and stores nothing, so a module
providing it later still wins.

`inject.optional` also answers `undefined` when there is no registry to read at all — no bound container, no vue
injection context — where plain `inject` throws. That's what lets a helper callable from anywhere read a
request-scoped value:

```ts
export const currentLocation = () => inject.optional(RequestUrl) ?? globalThis.location
```

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
| `dowel-di` | `inject` (through the installed binding), `createContainer`, `runInContainer`, `installBinding`, types |
| `dowel-di/vue` | `createProviders`, `inject`, and `app.providers.provide` via a `vue` type augmentation |
| `dowel-di/react` | `ContainerProvider`, `inject`, `createContainer`, `runInContainer` |
| `dowel-di/angular` | `inject`, `provideDowel` |

Importing a binding installs it for the root `inject`, so that import must not be dropped as unused — the
binding entries are listed in `sideEffects` for exactly that reason.

## requirements

Node 22+, Bun, Deno, or any current browser. Nothing from `node:*`. ESM and CJS both shipped. `vue`, `react`
and `@angular/core` are optional peers — you need only the one whose binding you import.

## development

```sh
bun install
bun run check   # lint + type-check + test
bun run build   # tsdown → dist, validated by publint and attw
bun run smoke   # import the built dist/ under plain node, esm and cjs
```

Design decisions and their reasoning live in [AGENTS.md](https://github.com/Fl0r14n/dowel/blob/main/AGENTS.md) — it is not in the npm tarball.

## licence

MIT
