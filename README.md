# inject-braid

Token-based dependency injection with **no registration step**, in ~115 lines with no dependencies.

```sh
npm i inject-braid   # bun add inject-braid
```

- **No container wiring.** `inject(Token, () => new Thing())` resolves and memoises on first use. There is no
  `bind`, no module, no `@injectable`, no decorator metadata, no build-step transform.
- **One core, two bindings.** `inject-braid/vue` and `inject-braid/react` differ only in where the registry
  lives. Resolution itself is shared, so behaviour cannot drift between them.
- **SSR by construction.** A registry per vue app, or a per-request `Container` under react. No ambient
  module-level map holding one request's cart while the next request reads it.

## The idea

A service declares its own default, at the injection site:

```ts
const cart = inject(CartService, () => new CartService())
```

First call runs the factory and **stores** it, so every later `inject(CartService)` — anywhere, in any
module — returns that same instance. The factory *is* the registration, which is why there is no separate
registration phase to keep in sync with the consumers.

Overriding is `provide` before anything resolves:

```ts
provide(CartService, new MockCartService()) // tests, or a tenant-specific implementation
```

Tokens are strings or classes. Abstract classes are the interesting case — one declaration is both the
runtime key (its `name`) and the compile-time type (its `prototype`), so a service needs no separate
interface + token pair:

```ts
export abstract class CartService {
  abstract add(sku: string): Promise<void>
}
```

## vue

The registry lives on the app instance via `app.provide`, so one map per app — and therefore one per request
under SSR — with no ambient global involved.

```ts
import { createProviders, createVueInjector } from 'inject-braid/vue'

app.use(createProviders()) // once per app

export const { provide, inject } = createVueInjector({
  hint: 'Resolve inside a component setup, a store setup or a navigation guard.'
})
```

Every call needs a vue injection context — component setup, store setup, `app.runWithContext`. Off-context it
**throws** rather than answering from a fallback, because a silent wrong answer under SSR is cross-request
data. `hint` is appended to that error; name your app's own bootstrap and valid call sites there.

A bare `provide`/`inject` pair is exported too, for apps that don't need a custom hint.

## react

React has no injection context of its own, so the registry is an explicit `Container`, reached two ways:
through React context inside components, and through the ambient active container everywhere else — service
factories, route loaders, guards.

```tsx
import { ContainerProvider, createContainer, useService } from 'inject-braid/react'

const container = createContainer(url) // one per request under SSR
;<ContainerProvider container={container}>{app}</ContainerProvider>

const cart = useService(CartService, () => new CartService())
```

Outside components, bind the container for the duration of a **synchronous** callback:

```ts
import { inject, runInContainer } from 'inject-braid/react'

runInContainer(container, () => inject(CartService, () => new CartService()))
```

Synchronous on purpose: service factories only wire dependencies, they never await, so concurrent SSR renders
cannot interleave inside the callback and steal each other's container.

## Vacancy, and what counts as "already provided"

A stored value is treated as absent — and so replaced by your default — when it is `null`, `undefined`, a
primitive, or an **empty plain object**. A class instance is never absent: its methods live on the prototype,
so `Object.keys` is empty and a naive emptiness check would clobber a provided override.

One consequence worth knowing: `provide('flag', false)` then `inject('flag', true)` returns `true`. Primitives
are vacant. Wrap primitives in a config object, or provide them and never pass a default.

## Two duplicate-copy hazards this is built around

Both are the "two copies of React" failure: module-level state duplicated because the module got evaluated
twice — two installed versions, a nested install, a bundler that fails to dedupe. Everything type-checks and
resolves; it breaks only at runtime.

1. **A bare `Symbol('providers')`** is minted fresh per evaluation, so two copies hold two distinct keys and
   the map installed by one is invisible to the other — every resolve throws.
2. **A module-level `let active`** duplicates the same way, but resolution then falls through to the shared
   fallback map instead of throwing. Silent, and under SSR that shared map is cross-request leakage.

Hence `Symbol.for('inject-braid.providers')` for the vue registry key, and a `globalThis`-held active slot
under `Symbol.for('inject-braid.active.v1')`.

Only one of the two carries a version, and the asymmetry is deliberate. The vue key holds a bare
`Map<string, any>` — no shape to be incompatible about, so two majors sharing it resolve each other's
services, which beats each installing a registry the other cannot see. The active slot holds a `Container`,
whose shape can gain fields in a future major; versioning it keeps v2 from reading a v1-written container and
finding it malformed.

## What this deliberately is not

No scopes, no transient lifetimes, no hierarchical child injectors, no async resolution, no multi-providers,
no circular-dependency detection. One registry per app or per request, one instance per token, resolved
lazily. If you need any of the above, [brandi](https://www.npmjs.com/package/brandi) is the better tool and
this is the wrong package.

Class tokens key off `Function.prototype.name`, so **a published bundle must not mangle its token classes** —
minified names are unstable across builds and can collide. Prefer string tokens for anything crossing a
package boundary; keep class tokens for app-local services.

## API

| Export | What |
| --- | --- |
| `createInjector(registry)` | `provide`/`inject` over any `() => Registry` thunk — what the bindings are built from |
| `createContainer(location?)` | a `Container`: a `Map` of providers plus the request url |
| `runInContainer(container, fn)` | binds a container for a synchronous callback, restoring the previous one |
| `activeContainer()` | the currently bound container, if any |
| `containerRegistry()` | the active container's map, or a shared fallback |
| `injectionKey(token)` | the registry key for a token — the string, or the class `name` |
| `ProviderToken`, `Type`, `AbstractType`, `Registry`, `Injector`, `Container` | types |

From `inject-braid/vue`: `createProviders`, `createVueInjector`, `provide`, `inject`.

From `inject-braid/react`: `ContainerProvider`, `useContainer`, `useService`, `provide`, `inject`, plus
`createContainer`, `runInContainer`, `activeContainer` and the `Container` type re-exported from the core —
so a route loader and a component import from the same place.

The root entry exports no bound `provide`/`inject` on purpose — which registry is in play is the binding's
decision, and a default here would resolve against the wrong one half the time. Reach for the root when you
are writing a binding of your own: `createInjector(containerRegistry)` is the whole of the react one.

## Requirements

Node 22+, Bun, Deno, or any current browser. Nothing is imported from `node:*`. ESM and CJS both shipped.
`vue` and `react` are optional peers — you only need the one whose binding you import.

## Development

```sh
bun install
bun run check   # lint + type-check + test
bun run build   # tsdown → dist, validated by publint and attw
bun run smoke   # import the built dist/ under plain node, esm and cjs
```

## Licence

MIT
