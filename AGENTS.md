# AGENTS.md

Design decisions and their reasoning. The README is the how-to; this is why it looks like that.

## layout

| file | what |
| --- | --- |
| `global.ts` | `globalSlot` — the `Symbol.for` + `globalThis` slot every piece of shared state lives in |
| `token.ts` | token types, `tokenName` for messages, `assertToken` |
| `registry.ts` | `Registry`, the declared defaults, `MISSING`, `resolveInRegistry`, `createProvide`, `createInject` |
| `binding.ts` | the installed bindings and the framework-free `inject` that resolves through them |
| `dowel.ts` | `dowel(token, factory)` — declare, and hand back the accessor |
| `container.ts` | an explicit `Container` plus the ambient binding, for code that owns its own request lifecycle |
| `vue/index.ts` | vue binding: registry on the app instance |
| `react/index.ts` | react binding: registry in the container |
| `angular/index.ts` | angular binding: no registry at all — the token goes to angular's own DI |
| `index.ts` | framework-free entry |

Only `container.ts` and `react/index.ts` share a module; vue and angular each stand alone. Check
`dist/*.mjs` imports if you change the graph.

## the declaration, not the call site

`dowel(Token, factory)` runs at module scope and returns the accessor. The factory used to be an argument to
`inject` at the point of use, which read well and cost the thing this package exists for: angular never calls
dowel, so anything angular must know has to exist before angular asks, and a lambda has not run at that point.

Consequences, all of them wanted:

- one declaration site per token, so two call sites cannot disagree about the default. A second `dowel` for the
  same token throws — that is two libraries claiming one token.
- the accessor is a value, so a library exports `injectCart` rather than a convention.
- `inject(token)` keeps no factory parameter. It stays exported for code holding a token but not its accessor.

`isolatedDeclarations` is why `Accessor<T>` is exported: an export initialised by a call needs an explicit type
under that flag, which this package sets and most consumers do not. Declarations here carry the annotation;
consumers usually let inference do it.

## keys are token identity

`Registry` is `Map<ProviderToken, any>`, keyed by the class object or string itself, never by `name`. A minifier
rewrites `name`, so two tokens from different chunks routinely both report `b`; identity has no such failure mode.
Consequence for users: an override must import the very same class object, so that module must be a single copy in
the graph. Two copies (nested `node_modules`, a bundler resolving esm and cjs both) are two distinct keys, and a
provide writes one nobody reads.

## `has`, not truthiness

`resolveInRegistry` checks `providers.has(token)` before running a default. A provided `0`, `''`, `false` or `{}`
is a value someone chose, and a resolve that treated it as absent would silently replace it.

That is also why a binding answers `MISSING` rather than `undefined`: `undefined` is a legal provided value.
`MISSING` is a `Symbol.for`, so the esm and cjs halves agree on it.

## `inject.optional` answers a declared default

For a token with no default, `optional` returns `undefined` and stores nothing, so a module providing it later
still wins. For a token *with* one, it returns the default — a token with a default is never absent.

Not a free choice: angular cannot express the difference. `inject(token, { optional: true })` consults the token's
own `providedIn` factory, and there is no way to ask "did anyone *provide* this". Rather than have `optional` mean
one thing in two bindings and another in the third, it means the same everywhere.

The same limitation is why a provided `null` is indistinguishable from absent under angular.

## the framework-free `inject`

A library that ships one accessor per service cannot import a binding: `import { inject } from 'dowel-di/vue'`
inside `my-lib` decides the framework for everyone who installs it. The workaround in the field was to write the
accessor list once and generate it per framework — substituting an import specifier into a `gen/vue` and a
`gen/react` tree, two subpath export trees, and a third framework waiting in peers. That is the thing `binding.ts`
deletes.

Each binding calls `installBinding` **at module scope**, not from its bootstrap function: importing
`dowel-di/vue` is already the app choosing vue, and a resolve can happen before any bootstrap code runs. The one
exception is the container binding, installed by `runInContainer` — installing it from `createContainer` would put
a second binding in every react app, and one binding is what lets a binding's own error message through.

That module-scope call is a side effect, so the binding entries are listed in `package.json`'s `sideEffects`
instead of the whole package being `false`. Without it a bundler is free to drop `import 'dowel-di/angular'` from
an app that imports nothing else from it.

Resolution order: one binding installed → `required` goes straight through to it, so the message the user reads is
"outside a vue injection context" rather than a generic one. Several → each is asked with `required: false` and the
first that does not answer `MISSING` wins, which is also what makes a mixed app work at all.

Dual-loaded (esm + cjs), every binding appears twice, and both entries are kept: each half's react binding closes
over its own `createContext`, so dropping one would make a resolve during render miss the provider. The hints are
deduped when the message is composed instead.

## angular has no registry

The other two bindings keep a `Map` and let `resolveInRegistry` do the has/default/store work. Angular already
owns all of that, so the binding hands the declaration over instead:

```ts
registerInjectable(Token, defineInjectable({ token: Token, providedIn: 'root', factory }))
```

`@angular/core/primitives/di` — public, no decorator, no compiler. What it buys, and none of it was available
while dowel kept its own map: `inject(Token)` from `@angular/core` with no dowel in the app, one instance per root
injector, overrides as plain providers at any injector level including one route's subtree, the injector tree in
DevTools, and `NG0200` instead of a `RangeError` on a cycle.

Details worth keeping:

- A class that already has `ɵprov` keeps it. That is a class the angular compiler already processed — an
  `@Injectable` used as a dowel token — and its own metadata wins.
- Strings cannot be keys in angular's DI, so a string token mints an `InjectionToken`. `angularToken(name)` is the
  only writer of that map and never replaces an entry, because a reference taken before the declaration ran — an
  app assembling its providers, or the other half of a dual-loaded package — has to keep matching what a resolve
  injects against; an earlier version minted a second token there and dropped the override silently. The map is
  realm-global for the same reason, and the token is minted *without* a factory so that both kinds of token take
  the one `ɵprov` path above. There is a test that captures a token before its declaration.
- `assertInInjectionContext` in a `try` is the context check, since angular exports no boolean one. Wrapping the
  resolve itself would be shorter and wrong: that call runs factory defaults, and one that throws must surface as
  its own error rather than as "no injection context".
- A resolve is `ngInject(token, { optional: true })`, so a token nobody provided reaches dowel's own "nothing
  provided X" message rather than NG0201.
- There is no provide door. Overrides are angular's, which is also why angular has no provide-before-resolve rule.

## vue: two doors onto one registry

`createProviders().install` sets up both:

- `app.provide(PROVIDERS, map)` — the read path. Consumer code five modules deep has an injection context but no
  app reference.
- `app.providers = { provide }` — the write path. A plugin's `install` has the app but no context.

Neither is derivable from the other. Verified: inside `app.runWithContext`, `hasInjectionContext()` is `true` and
`vueInject` resolves, but `getCurrentInstance()` is `null` — so consumer code cannot find its way back to the app,
and `install` runs outside any context so it cannot reach a `vueInject`.

`app.providers` needs `declare module 'vue'`, which costs two things: the type says the property is always present
when it only exists after the plugin is installed (so a missing install is a `TypeError`, not a named error — an
optional type would instead let `app.providers?.provide(…)` no-op, which is worse), and the augmentation is
program-wide once any file imports the binding. Traded for module code that imports nothing.

The dts bundler carries the `declare module` block through to `dist/vue.d.mts`; if you touch the build, check that
it survives and that a consumer importing only `dist/vue.mjs` still typechecks `app.providers.provide`.

## react has one door

`useService` existed because react has no ambient injection context: `useContext` is only legal during render, so
component-side resolves needed a hook and everything else needed `runInContainer`. A library accessor can be
neither — it is a plain function called from wherever.

React 19's `use(Context)` takes no hook slot, so it is legal in a condition and from a nested plain function, which
is exactly the shape of `injectCart()` called somewhere inside a component body. The react binding reads the
container off context when it can and falls back to the bound one, so `inject` is the only door. `useService` was
removed in 2.0 rather than aliased: a `use` name on something that is no longer a hook is a name the lint rules
would police for no reason.

Two details, both load-bearing:

- The `use` call is gated on react's current dispatcher being non-`null`
  (`__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H`). Calling `use` with a `null` dispatcher — a
  process where react has never rendered — is the one path that logs "Invalid hook call", and a library must not
  print that on a legitimate off-render `inject.optional`. After any render the dispatcher is a real object and
  `use` off-render throws a clean catchable error with nothing logged; there is a test asserting the console stays
  quiet. If that internals field is ever renamed the check degrades to "try anyway", not to "components stop
  resolving".
- Context wins over the bound container when both are there. Under SSR they are the same container; when they are
  not, the nearest provider is the more specific answer.

## provide belongs to the registry's owner

There is no ambient `provide`. React: `container.provide(...)`. Vue: `app.providers.provide(...)`. Angular: its own
providers. Wiring code always holds the owner, and providing resolves nothing, so it needs no context.

Resolving stays ambient because service code holds nothing.

## the global slots

Three, all through `globalSlot`: `dowel.active.v1` (the bound container), `dowel.bindings.v1` (the install list)
and `dowel.defaults.v1` (every declared default).

Realm-global, not module-level, because the esm and cjs halves of this package are two module instances and a
declaration made in one must be visible to a resolve in the other. `scripts/smoke.mjs` proves this by loading both
in one process — note that `import('../dist/index.mjs?copy=2')` does *not* prove it, since the entry's chunk import
carries no query and resolves to the same module.

The active container slot is safe under concurrent SSR because it lives and dies inside one synchronous frame, set
and restored in `try`/`finally`. Never put a resolved value in it — those are request-scoped and belong in a
registry.

Keys carry `.v1`, bumped when the shape of what is in the slot changes, not merely on a major: two majors sharing a
compatible slot is interop, while two majors missing each other's slot is a silent second copy of every service.

## `runInContainer` is synchronous

The binding ends when the callback returns. Returning a promise is fine — dependencies are resolved before the
request starts — but resolving after an `await` inside the callback happens with the binding unwound.

Not enforced at runtime, because `runInContainer(c, () => injectApi().fetchUsers())` is legitimate and
indistinguishable from the mistake. The "no active container" message names the await case instead.

## what is deliberately not defended

**Circular dependencies.** No detector. Nothing in an API shape can prevent a factory reaching back around, and the
failure is already loud, immediate and dev-time: `RangeError` on the first resolve, with the loop readable in the
frames. Angular's own DI reports it as NG0200.

**A default that captures request state.** `dowel(Token, () => new Thing(requestScopedValue))` at module scope
would be a factory closing over one request's data. The factory-not-value rule stops the common case; this one
needs a reader.

**Two copies of a token class.** Identity keying makes them two tokens. A bundler warning is the right layer.

## the accessor pattern

One accessor per service, exported next to it, in every binding:

```ts
export const injectMiscResource = dowel(MiscResource, miscResource)
```

A library's accessor imports `dowel-di`, not a binding, and is then the same function in all three storefronts. An
angular app can skip it and use `inject(MiscResource)` from `@angular/core`.

## tests

- `registry.spec.ts` — provide, resolve, declared defaults, falsy values, `MISSING`, no framework
- `container.spec.ts` — ownership, binding lifetime, nesting
- `vue/index.spec.ts`, `react/index.spec.tsx`, `angular/index.spec.ts` — what each binding puts in front of that
- `binding.spec.tsx` — one accessor resolved through all four bindings, and the error messages. It rewrites the
  global install list to hand each test the subset it needs; a binding only installs itself once per module
  instance, so a test cannot get one back by re-importing it
- `scripts/smoke.{mjs,cjs}` — run against **built** `dist/`, not src: subpath exports, dual-package resolution, the
  shared slots across the esm and cjs instances

Declared defaults are realm-global and one-per-token, so a test that needs a default declares its own token.

The angular specs build a root-scoped injector with `{ provide: ɵINJECTOR_SCOPE, useValue: 'root' }`, which is what
`bootstrapApplication` does internally and what a `providedIn: 'root'` factory needs. The alternative is `TestBed`,
which needs `initTestEnvironment` with a platform, which means `@angular/platform-browser` and its dependency
graph. `rxjs` sits in `node_modules` only because it is a non-optional peer of `@angular/core`; nothing here imports
it, and it does not belong in `package.json`.

## release

`publish.yml` checks that the release tag matches `package.json` before building. Bump before tagging.

`2.0.0` — `dowel(token, factory)` replaces call-site factories, the angular binding, the framework-free `inject`,
react's `useService` removed.
