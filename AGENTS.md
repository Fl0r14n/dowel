# AGENTS.md

Design decisions and their reasoning. The README is the how-to; this is why it looks like that.

## layout

| file | what |
| --- | --- |
| `global.ts` | `globalSlot` — the `Symbol.for` + `globalThis` slot both pieces of shared state live in |
| `token.ts` | token types, `tokenName` for messages, `assertToken` |
| `registry.ts` | `Registry`, and the two ways to touch one: `createProvide`, `createInject` |
| `container.ts` | react's registry strategy — an explicit `Container`, plus the ambient binding |
| `binding.ts` | the framework-free `inject`, and the list of bindings it resolves through |
| `vue/index.ts` | vue binding: registry on the app instance |
| `react/index.ts` | react binding: registry in the container |
| `angular/index.ts` | angular binding: registry in angular's own injector |
| `index.ts` | framework-free entry — `inject`, the container, the types |

Vue never imports `container.ts`, and neither does angular; check `dist/vue.mjs`'s and `dist/angular.mjs`'s
imports if you change the graph. `container.ts` is framework-free on purpose (a binding without a native
injection context would reuse it), react is just its only consumer today — both other frameworks have one.

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
the variant.

`.optional` also answers `undefined` when there is **no registry at all** — no bound container, no vue injection
context — rather than throwing. The lookup a binding supplies is `(required: boolean) => Registry | undefined`,
and each returns `undefined` instead of throwing when `required` is false. Reasoning: the throw exists to stop a
resolve from silently answering off a shared fallback registry, which is one request reading another's
services. Answering `undefined` resolves from nowhere, so it cannot leak, and the caller has said absence is
acceptable. The strict path keeps the loud message, and that is where nearly every call lives.

The case that forced it: a helper like `getUrlQuery()` is callable from a client event handler, where nothing is
bound, and wants a request-scoped `RequestUrl` token that only exists on the server. The alternative was
exporting `activeContainer` so callers could peek — which hands out the container and invites a bespoke
`container.location` field instead of a token. A resolve during render still throws without a container,
because a component with no provider is a setup bug rather than an absent value.

## falsy tokens throw

`assertToken` runs before the registry is touched, on both sides. A falsy token is nearly always a class left
`undefined` by a circular import between its module and the call site — the one failure here that would
otherwise be silent, since `inject(undefined, factory)` would store a value under key `undefined` and answer
from it forever.

Ordering matters: the token is checked before the registry is looked up, so a bad token in unbound code blames
the token rather than the missing container.

## provide belongs to the registry's owner

There is no ambient `provide`. React: `container.provide(...)`. Vue: `app.providers.provide(...)`. Angular:
`provideDowel(provide => ...)`. Wiring code
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

## angular: the registry is a `providedIn: 'root'` token

Angular already owns what the other two bindings had to arrange: an injector hierarchy whose root is created
once per application, and under SSR once per request. So `PROVIDERS` is an `InjectionToken<Registry>` with
`providedIn: 'root'` and a `() => new Map()` factory, and there is nothing to install — no `app.use`, no
`<ContainerProvider>`. The registry lands on the injector angular would have used anyway.

`provideDowel(setup)` is the write door, and it is two providers, not one:

- `provideEnvironmentInitializer(...)` — resolves `PROVIDERS` and hands the setup a `provide` bound to it.
  Initializers are `multi`, so two `provideDowel` calls compose in provider order rather than the second
  dropping the first, and they run at bootstrap, so a setup that throws fails there instead of on whichever
  resolve happened to be first.
- `{ provide: PROVIDERS, useFactory: () => new Map() }` — pins the registry to this injector. Redundant in a
  bootstrapped app, where the `'root'` scope already reaches it, and load-bearing anywhere the scope does not:
  an injector from `Injector.create`, which is what the tests use.

Returns `EnvironmentProviders` rather than `Provider[]` so a component-level `providers: [provideDowel(…)]`
cannot compile — that would pin a second registry per component instance, silently.

### the setups do not run inside the registry's own factory

The first shape of this tried it: `PROVIDERS`'s factory built the map and ran the setups off a `multi` token.
It works right up to the setup that resolves a dowel service to build its value — `provide(B, new B(injectA()))`
— which re-enters the factory that is still running and gets `NG0200: Circular dependency detected for
InjectionToken dowel.providers.v1`. Eager only; a lazy `() => injectA()` inside the provided value hides it,
which is worse than failing.

An initializer resolves `PROVIDERS` first and then writes, so a setup can resolve anything — angular's services
and dowel's alike. There is a test that resolves eagerly, and it is the reason it does.

### why `assertInInjectionContext` and not a `try` around the resolve

Angular exports no boolean context check (`isInInjectionContext` is internal), so the lookup calls
`assertInInjectionContext` in a `try`. Wrapping the `ngInject(PROVIDERS)` call itself would be shorter and
wrong: that call can run a factory default, and a factory that throws would be reported as "no injection
context". The cost is one thrown-and-caught error per off-context `inject.optional`.

### the tests use `Injector.create`, not `TestBed`

`TestBed` needs `initTestEnvironment` with a platform, which means `@angular/platform-browser` and its
dependency graph. `Injector.create` + `runInInjectionContext` exercises the whole binding without one, at the
price of two things the specs say out loud: its `providers` is typed `Provider[]` and takes
`EnvironmentProviders` all the same (cast, one helper), and the injector it returns has no `'root'` scope —
which is what the pinning provider in `provideDowel` covers.

`rxjs` sits in `node_modules` because it is a non-optional peer of `@angular/core`, not because anything here
imports it. Do not add it to `package.json`.

## the framework-free `inject`

A library that ships one accessor per service cannot import a binding: `import { inject } from 'dowel-di/vue'`
inside `my-lib` decides the framework for everyone who installs it. The workaround in the field was to write the
accessor list once and generate it per framework — `occ-api`'s `scripts/gen-bindings.ts` substitutes `#inject`
into a `gen/vue` and a `gen/react` tree, two subpath export trees, `@angular/core` already in peers waiting for a
third. That is the thing `binding.ts` deletes.

Each binding calls `installBinding(lookup, hint)` **at module scope**, not from its bootstrap function: importing
`dowel-di/vue` is already the app choosing vue, and a resolve can happen before any bootstrap code runs. The one
exception is the container lookup, installed by `runInContainer` — installing it from `createContainer` would put
a second binding in every react app, and one binding is what lets a binding's own error message through.

That module-scope call is a side effect, so the binding entries are listed in `package.json`'s `sideEffects`
instead of the whole package being `false`. Without it a bundler is free to drop `import 'dowel-di/angular'` from
an app that imports nothing else from it.

Resolution order: one binding installed → `required` goes straight through to it, so the message the user reads is
"outside a vue injection context" rather than a generic one. Several → each is asked with `required: false` and
the first with a live registry answers, which is also what makes a mixed app work at all.

Dual-loaded (esm + cjs), every binding appears twice, and both entries are kept: each half's react lookup closes
over its own `createContext`, so dropping one would make a resolve during render miss the provider. The hints are
deduped when the message is composed instead.

## react has one door, not two

`useService` existed because react has no ambient injection context: `useContext` is only legal during render, so
component-side resolves needed a hook and everything else needed `runInContainer`. A library accessor cannot be
either — it is a plain function called from wherever.

React 19's `use(Context)` is legal in a condition and from a nested plain function, which is exactly the shape of
`injectCart()` called somewhere inside a component body. So the react lookup reads the container off context when
it can and falls back to the bound one, and `inject` is the only door. `useService` was removed in 2.0 rather
than aliased: an alias of a function that is no longer a hook keeps a `use` name on something the lint rules
would then police for no reason.

The react lookup also writes its own "no active container" message rather than letting `container.ts` write it.
`containerRegistry` used to take a `hint` so the binding could name `<ContainerProvider>` without the
framework-free module knowing react exists; react was its only caller, so the parameter is gone and each binding
owns its message the way vue and angular already did. React asks the container with `required: false` and throws
after.

Two details, both load-bearing:

- The `use` call is gated on react's current dispatcher being non-`null`
  (`__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H`). Calling `use` with a `null` dispatcher —
  a process where react has never rendered — is the one path that logs "Invalid hook call", and a library must not
  print that on a legitimate off-render `inject.optional`. After any render the dispatcher is a real object and
  `use` off-render throws a clean catchable error with nothing logged; there is a test asserting the console stays
  quiet. If that internals field is ever renamed the check degrades to "try anyway", not to "components stop
  resolving".
- Context wins over the bound container when both are there. Under SSR they are the same container; when they are
  not, the nearest provider is the more specific answer.

## the active container slot

`container.ts` holds a pointer to the bound container, on `globalThis` via `Symbol.for('dowel.active.v1')`, and
`binding.ts` holds the install list under `dowel.bindings.v1`. Both go through `globalSlot`.

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

One accessor per service, in every binding — react needed two while `useService` was a hook and no longer does.
A library's accessor imports `dowel-di`, not a binding, and is then the same function in all three storefronts.

## tests

- `registry.spec.ts` — resolve and write against a plain registry, no framework
- `container.spec.ts` — ownership, binding lifetime, nesting
- `vue/index.spec.ts`, `react/index.spec.tsx`, `angular/index.spec.ts` — what each binding puts in front of
  that
- `binding.spec.tsx` — one accessor resolved through all four bindings, and the error messages. It rewrites the
  global install list to hand each test the subset it needs; a binding only installs itself once per module
  instance, so a test cannot get one back by re-importing it
- `scripts/smoke.{mjs,cjs}` — run against **built** `dist/`, not src: subpath exports, dual-package resolution,
  the shared active slot across the esm and cjs instances

Keep smoke assertions honest — two of them once claimed to prove module-copy sharing while proving nothing.

## release

`publish.yml` checks that the release tag matches `package.json` before building. Bump before tagging.

`2.0.0` — the angular binding, the framework-free `inject`, and react's `useService` removed. Only that removal
is breaking; react's `inject` merely gained the render path.
