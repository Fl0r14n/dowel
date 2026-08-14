# AGENTS.md

Design decisions and their reasoning. The README is the how-to; this is why it looks like that.

## layout

| file | what |
| --- | --- |
| `token.ts` | token types, `tokenName` for messages, `assertToken` |
| `registry.ts` | `Registry`, and the two ways to touch one: `createProvide`, `createInject` |
| `container.ts` | react's registry strategy — an explicit `Container`, plus the ambient binding |
| `vue/index.ts` | vue binding: registry on the app instance |
| `react/index.ts` | react binding: registry in the container |
| `index.ts` | framework-free entry — the container and the types |

Vue never imports `container.ts`; check `dist/vue.mjs`'s imports if you change the graph. `container.ts` is
framework-free on purpose (a third binding without a native injection context would reuse it), react is just
its only consumer today.

## keys are token identity

`Registry` is `Map<ProviderToken, any>`, keyed by the class object or string itself, never by `name`. A
minifier rewrites `name`, so two tokens from different chunks routinely both report `b`; identity has no such
failure mode. Consequence for users: an override must import the very same class object, so that module must
be a single copy in the graph. Two copies (nested `node_modules`, a bundler resolving esm and cjs both) are
two distinct keys, and a provide writes one nobody reads.

## `has`, not truthiness

A resolve checks `providers.has(token)` before running a factory. A provided `0`, `''`, `false` or `{}` is a
value the caller chose; a vacancy test would overwrite it in the registry, silently and permanently.

## factory-only defaults

`inject(token, factory)` takes `() => T`, never `T`. Two reasons:

1. A value has to be built where the call is written — module scope — and that one instance then serves every
   registry that resolves it. Under SSR request B reads request A's state. This is the leak the package exists
   to prevent, and the factory form makes it unreachable. `registry.spec.ts` pins it with a cart.
2. It settles what a function argument means. It's the factory, so `inject(t, () => fn)` stores `fn` itself.

Angular's `InjectionToken` takes a `factory` for the same reason.

## missing token throws; `inject.optional` is the union

`inject` returns `T` whether or not a factory was passed. A token nobody provided, resolved without a factory,
throws naming it — handing back `undefined` defers the failure to a `TypeError` a few frames later that names
nothing, and it forces `| undefined` onto every call site that already knows better.

`inject.optional` carries the union. It stores nothing, deliberately: memoising absence would lock out a
module that provides the token later. That is also why it can't be spelled `inject(token, () => undefined)`.

It hangs off the function rather than sitting beside it so there's one name to import and autocomplete finds
the variant. `useService.optional` mirrors it.

`.optional` also answers `undefined` when there is **no registry at all** — no bound container, no vue injection
context — rather than throwing. The lookup a binding supplies is `(required: boolean) => Registry | undefined`,
and each returns `undefined` instead of throwing when `required` is false. Reasoning: the throw exists to stop a
resolve from silently answering off a shared fallback registry, which is one request reading another's
services. Answering `undefined` resolves from nowhere, so it cannot leak, and the caller has said absence is
acceptable. The strict path keeps the loud message, and that is where nearly every call lives.

The case that forced it: a helper like `getUrlQuery()` is callable from a client event handler, where nothing is
bound, and wants a request-scoped `RequestUrl` token that only exists on the server. The alternative was
exporting `activeContainer` so callers could peek — which hands out the container and invites a bespoke
`container.location` field instead of a token. `useService.optional` still throws without a `<ContainerProvider>`,
because a component with no provider is a setup bug rather than an absent value.

## falsy tokens throw

`assertToken` runs before the registry is touched, on both sides. A falsy token is nearly always a class left
`undefined` by a circular import between its module and the call site — the one failure here that would
otherwise be silent, since `inject(undefined, factory)` would store a value under key `undefined` and answer
from it forever.

Ordering matters: the token is checked before the registry is looked up, so a bad token in unbound code blames
the token rather than the missing container.

## provide belongs to the registry's owner

There is no ambient `provide`. React: `container.provide(...)`. Vue: `app.providers.provide(...)`. Wiring code
always holds the owner, and providing resolves nothing, so it needs no context. This deleted the
`app.runWithContext` wrapper every vue module used to need, and the whole class of "provide called from the
wrong place" errors.

Resolving stays ambient because service code holds nothing.

## vue: two doors onto one registry

`createProviders().install` sets up both:

- `app.provide(PROVIDERS, map)` — the read path. Consumer code five modules deep has an injection context but
  no app reference.
- `app.providers = { provide }` — the write path. A plugin's `install` has the app but no context.

Neither is derivable from the other. Verified: inside `app.runWithContext`, `hasInjectionContext()` is `true`
and `vueInject` resolves, but `getCurrentInstance()` is `null` — so consumer code cannot find its way back to
the app, and `install` runs outside any context so it cannot reach a `vueInject`.

`app.providers` needs `declare module 'vue'`, which costs two things: the type says the property is always
present when it only exists after the plugin is installed (so a missing install is a `TypeError`, not a named
error — an optional type would instead let `app.providers?.provide(…)` no-op, which is worse), and the
augmentation is program-wide once any file imports the binding. Traded for module code that imports nothing.

The dts bundler carries the `declare module` block through to `dist/vue.d.mts`; if you touch the build, check
that it survives and that a consumer importing only `dist/vue.mjs` still typechecks `app.providers.provide`.

## the active container slot

`container.ts` holds the only state outside a registry: a pointer to the bound container, on `globalThis` via
`Symbol.for('dowel.active.v1')`.

Realm-global, not module-level, because the esm and cjs halves of this package are two module instances and a
binding made in one must be visible to a resolve in the other. `scripts/smoke.mjs` proves this by loading both
in one process — note that `import('../dist/index.mjs?copy=2')` does *not* prove it, since the entry's chunk
import carries no query and resolves to the same module.

Safe under concurrent SSR because it lives and dies inside one synchronous frame, set and restored in
`try`/`finally`. Never put a resolved value in this slot — those are request-scoped and belong in a registry.

`.v1` in the key so two different majors miss each other's slot rather than sharing one. Bump on a major.

## `runInContainer` is synchronous

The binding ends when the callback returns. Returning a promise is fine — dependencies are resolved before the
request starts — but resolving after an `await` inside the callback happens with the binding unwound.

Not enforced at runtime, because `runInContainer(c, () => inject(Api).fetchUsers())` is legitimate and
indistinguishable from the mistake. The "no active container" message names the await case instead.

## what is deliberately not defended

**Circular dependencies.** No detector. Nothing in an API shape can prevent a factory reaching back around, and
the failure is already loud, immediate and dev-time: `RangeError` on the first resolve, with the loop readable
in the frames (`miscResource → resolve → httpClient → resolve`). Detecting it to reprint that as one line cost
a realm-global `Set` and a `try`/`finally` on the hot path.

Angular does detect this (NG0200, "Circular dependency in DI detected for X") because it can afford to: its
registry stores records with a value slot, so it parks a `CIRCULAR` sentinel there with no side structure.
Ours stores raw values in a `Map` that is public API, so a sentinel would be visible in `container.providers`
and would make `has(token)` true mid-flight. Angular also needs the message more — its factories are
compiler-generated, so the stack shows framework internals rather than your named functions.

If parity is ever wanted, the honest route is changing `Registry` to hold records, not adding a side Set.

**Provide landing after a resolve.** No warning. The registry takes the new value while holders of the earlier
instance keep it. Reaching that state requires inverting the order the API steers you into, which needs one of:
an `install` that resolves through `runWithContext`, an `app.use` after mount, a container reused between test
cases, or HMR re-running a module. All dev-time or deliberate. Tracking it cost a `WeakMap<Registry, Set>`.

**`activeContainer`.** Exists as a local in `container.ts`, not exported. The only thing it lets a caller write
that `inject` cannot is a provide from inside a resolve — the order inversion above. Exporting it later breaks
nobody; unexporting it later would.

## the accessor pattern

Resolving needs a context, so the call lives in a function, and that function — exported next to the service —
is where the token and its factory meet exactly once:

```ts
export const useMiscResource = () => inject(MiscResource, miscResource)
```

This is what makes call-site defaults safe: two call sites can't disagree about the default, because there's
one. It's also why a token-declared default (`token<T>('name', factory)`) would be ceremony — the convention
already gives one declaration site.

React needs two accessors for a service used both in and outside components (`useService…` and `inject…`),
since those read through different doors. Only one is needed for a service that is just another service's
dependency, because `useService` binds the container while it resolves.

## tests

- `registry.spec.ts` — resolve and write against a plain registry, no framework
- `container.spec.ts` — ownership, binding lifetime, nesting
- `vue/index.spec.ts`, `react/index.spec.tsx` — what each binding puts in front of that
- `scripts/smoke.{mjs,cjs}` — run against **built** `dist/`, not src: subpath exports, dual-package resolution,
  the shared active slot across the esm and cjs instances

Keep smoke assertions honest — two of them once claimed to prove module-copy sharing while proving nothing.

## release

`publish.yml` checks that the release tag matches `package.json` before building. Version is still `0.1.0`; the
API has broken repeatedly since (ambient `provide` removed, missing tokens throw, value defaults rejected,
`createInjector` renamed to `createInject`, `providersOf` replaced by the augmentation). Bump before tagging.
