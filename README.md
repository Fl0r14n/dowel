# inject-braid

Token-based dependency injection with no registration step. ~120 lines, no dependencies, SSR-safe.

```sh
npm i inject-braid   # bun add inject-braid
```

A service declares its own default, at the point of use:

```ts
const cart = inject(CartService, () => new CartService())
```

The first call runs the factory and stores it, so every later `inject(CartService)` — anywhere, any module —
returns that same instance. The factory *is* the registration. There is no container to wire, no `bind`, no
decorators, no build step.

Override it by providing first:

```ts
provide(CartService, new MockCartService())
```

Tokens are strings or classes. An abstract class is both the runtime key (its `name`) and the compile-time
type (its `prototype`), so a service needs no separate interface and token:

```ts
export abstract class CartService {
  abstract add(sku: string): Promise<void>
}
```

Pick one of the three entries below. `inject-braid/vue` and `inject-braid/react` never pull each other into
your bundle.

## vue

The registry lives on the app instance, so one per app — and therefore one per request under SSR.

```ts
import { createProviders, inject, provide } from 'inject-braid/vue'

app.use(createProviders()) // once per app

const cart = inject(CartService, () => new CartService())
```

Calls need a vue injection context — component setup, store setup, `app.runWithContext`. Off-context it
throws rather than guessing, since answering from a fallback would mean one request reading another's
services.

## react

React has no injection context, so the registry is an explicit `Container` you make per request.

```tsx
import { ContainerProvider, createContainer, useService } from 'inject-braid/react'

const container = createContainer()
;<ContainerProvider container={container}>{app}</ContainerProvider>

const cart = useService(CartService, () => new CartService())
```

Outside components — loaders, guards, service factories — bind the container around a **synchronous**
callback:

```ts
import { inject, runInContainer } from 'inject-braid/react'

runInContainer(container, () => inject(CartService, () => new CartService()))
```

Synchronous on purpose: factories only wire dependencies, they never await, so concurrent SSR renders cannot
interleave and steal each other's container.

With no container bound, resolving **throws**. There is no shared fallback registry — one would read as
working right up until SSR, where it is one request resolving another request's services.

| Export | What |
| --- | --- |
| `ContainerProvider` | holds the per-request container for the tree |
| `useService(token, default?)` | resolve against the container in React context |
| `useContainer()` | the container itself |
| `provide`, `inject` | resolve against the bound container, for non-component code |
| `createContainer`, `runInContainer` | re-exported from the core, so one import site |

## agnostic

The root entry carries no framework and no bound `provide`/`inject` — which registry is in play is the
binding's decision. What's here is the container and the token types:

| Export | What |
| --- | --- |
| `createContainer()` | a `Container` — a `Map` of providers |
| `runInContainer(container, fn)` | binds a container for a sync callback, restoring the previous one |
| `ProviderToken`, `Type`, `AbstractType`, `Registry`, `Container` | types |

Useful for the code that owns request lifecycle — an SSR entry making one container per request, or a test
harness — without dragging react or vue into that module's graph.

## Things that will bite you

**Primitives count as absent.** `provide('flag', false)` then `inject('flag', true)` returns `true`. A stored
value is replaced by your default when it is nullish, a primitive, or an empty plain object — a class instance
never is, since its methods live on the prototype. Wrap primitives in a config object.

**Don't mangle token classes.** Class tokens key off `name`, and minified names are unstable across builds and
can collide. Use string tokens across package boundaries, class tokens for app-local services.

**One instance per token, and that's all.** No scopes, no transient lifetimes, no child injectors, no async
resolution, no multi-providers. If you need those, [brandi](https://www.npmjs.com/package/brandi) is the
better tool.

**Keep one copy in the tree.** Two majors installed side by side — a library pinning an older range — is not
supported. Check with `npm ls inject-braid`, force one copy with `overrides` / `resolutions`.

## Requirements

Node 22+, Bun, Deno, or any current browser. Nothing from `node:*`. ESM and CJS both shipped. `vue` and
`react` are optional peers — you need only the one whose binding you import.

## Development

```sh
bun install
bun run check   # lint + type-check + test
bun run build   # tsdown → dist, validated by publint and attw
bun run smoke   # import the built dist/ under plain node, esm and cjs
```

## Licence

MIT
