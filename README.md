# dowel-di

> A dowel is a plain wooden pin that joins two pieces from the inside — no screws, no bracket, nothing on the
> surface to see. The joint is the fit itself.

Token-based dependency injection for libraries that ship to more than one framework. Under 300 lines, no
dependencies, SSR-safe. In an angular app it disappears into angular's own DI.

```sh
npm i dowel-di   # bun add dowel-di
```

## the idea

One function. A token, its default, and the accessor you export beside it:

```ts
import { dowel } from 'dowel-di'

export abstract class Logger {
  abstract log(message: string): void
}

export const injectLogger = dowel(Logger, () => new ConsoleLogger()) // () => Logger
```

That file imports no framework. `injectLogger()` works in a vue setup, a react render, an angular field
initializer, or a plain container — whichever binding the app installed. The declaration runs once, at module
scope; the factory runs on the first resolve and its result is kept.

An abstract class is both the runtime key and the compile-time type. Strings work too. A token with no default is
declared without one:

```ts
export const injectApiContextFactory = dowel(ApiContextFactory) // no default: the app provides it
export const injectRequestUrl = dowel.optional(RequestUrl) // () => RequestUrl | undefined
```

## vue

```ts
import { createProviders } from 'dowel-di/vue'

app.use(createProviders()) // once per app
```

Resolve inside a vue injection context — component setup, store setup, `app.runWithContext`:

```ts
const logger = injectLogger()
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
import { ContainerProvider, createContainer, runInContainer } from 'dowel-di/react'

const container = createContainer() // one per request under SSR
container.provide(Logger, new RemoteLogger(endpoint)) // overrides, before render

render(<ContainerProvider container={container}>{app}</ContainerProvider>)
```

One door, in components and out. During render the container comes off context; anywhere else it is the one bound
around a **synchronous** callback:

```tsx
const Reporter = () => {
  const logger = injectLogger() // resolved off context, during render
  return <button onClick={() => logger.log('clicked')}>go</button>
}

runInContainer(container, () => injectLogger().log('boot')) // a loader, a guard, a service factory
```

An event handler runs *after* render, so resolve during render and close over the value — or bind a container
around the handler.

Accessors are plain functions, not hooks: callable in a branch, from a nested closure, and from a library that
imports no react.

## angular

Nothing to install and no dowel in your app code. A declared default becomes the token's own
`providedIn: 'root'` factory, so **angular's own `inject` resolves it**:

```ts
import { inject, Injectable } from '@angular/core'
import { Logger } from 'my-lib/angular' // importing the token is what registers it

@Injectable({ providedIn: 'root' })
export class Reporter {
  private readonly logger = inject(Logger)
}
```

One instance per root injector, which under SSR is one per request. Overrides are plain angular providers, at
whatever injector level you like:

```ts
bootstrapApplication(App, { providers: [{ provide: Logger, useValue: new RemoteLogger(url) }] })

// or for one route's subtree only
{ path: 'checkout', providers: [{ provide: Logger, useValue: checkoutLogger }], loadComponent: … }
```

Angular has no string tokens, so a string gets a minted one — `angularToken('api-url')` is the handle for
providing it.

## a library that ships for all three

Library code imports `dowel-di` and nothing else; the app picks the binding by importing it. So the accessor list
is written once, with no per-framework copies of it and no build step generating them:

```ts
// my-lib/cart.ts — no framework anywhere in this file
export const injectCart = dowel(Cart, () => cart(injectApiContext()))
```

A factory resolves inside the caller's context, so a default may resolve other tokens — `injectApiContext()` above
works in all three.

For angular, ship an entry that imports the binding and re-exports the tokens, so a consumer cannot obtain a token
without having run its registration:

```ts
// my-lib/angular.ts
import 'dowel-di/angular'
export { Cart, Logger } from './tokens'
```

## rules worth knowing

**The second argument is a factory, never a value.** A value would be built at module scope and shared by every
request, so under SSR one request would read another's state.

```ts
dowel(Cart, new Cart()) // ✗ compile error
dowel(Cart, () => new Cart()) // ✓ one per registry
```

**One declaration per token.** A second `dowel(Cart, …)` throws — two libraries claiming one token is a bug worth
a message rather than a silent winner.

**An accessor returns `T` and throws if nothing provided the token and it has no default.** When absent is a valid
answer, declare it that way: `dowel.optional(token)` gives `() => T | undefined`, stores nothing, and also answers
`undefined` when there is no registry to read at all — no bound container, no vue injection context. That is what
lets a helper callable from anywhere read a request-scoped value:

```ts
export const injectRequestUrl = dowel.optional(RequestUrl)
export const currentLocation = () => injectRequestUrl() ?? globalThis.location
```

A token *with* a default is never absent, so `dowel.optional` is for tokens declared without one.

**Provide before anything resolves** — in vue and react. Providing needs the app or container, which is bootstrap
code, and resolving needs a context that only exists once the app is running. Invert it anyway and the registry
takes the new value while whatever already captured the earlier instance keeps it, silently. Angular has no such
rule: providers are declarative, so an override is in the injector before anything can ask.

**A `runInContainer` binding ends when its callback returns.** Returning a promise is fine; resolving after an
`await` *inside* it is not.

```ts
runInContainer(container, () => injectApi().fetchUsers()) // ✓ resolved, then awaited
runInContainer(container, async () => {
  await ready
  return injectApi() // ✗ the binding already ended
})
```

**A circular dependency overflows the stack.** There's no cycle detector; you get a `RangeError` on the first
resolve with the loop visible in the frames. Under angular you get its `NG0200` instead.

**Class tokens are matched by identity**, so an override must import the very class the library declares, and that
module must be a single copy in your graph.

**Under `isolatedDeclarations`** an export initialised by a call needs an explicit type, and `Accessor<T>` is that
type — `export const injectLogger: Accessor<Logger> = dowel(Logger, factory)`. Without that flag, inference does
it for you.

**Angular cannot tell a provided `null` from an absent token**, since that is what `inject(token, {optional: true})`
answers in both cases. Vue and react keep them apart.

## exports

| entry | |
| --- | --- |
| `dowel-di` | `dowel`, `inject`, `createContainer`, `runInContainer`, `installBinding`, types |
| `dowel-di/vue` | `createProviders`, `inject`, and `app.providers.provide` via a `vue` type augmentation |
| `dowel-di/react` | `ContainerProvider`, `inject`, `createContainer`, `runInContainer` |
| `dowel-di/angular` | `inject`, `angularToken` |

Importing a binding installs it, so that import must not be dropped as unused — the binding entries are listed in
`sideEffects` for exactly that reason.

## requirements

Node 22+, Bun, Deno, or any current browser. Nothing from `node:*`. ESM and CJS both shipped. `vue`, `react` and
`@angular/core` are optional peers — you need only the one whose binding you import.

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
