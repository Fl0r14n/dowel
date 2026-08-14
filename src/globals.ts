/** Realm-global slots, keyed by `Symbol.for`.
 *
 * Not module-level `let`s: two evaluated copies of a module — a nested install, a bundler that fails to
 * dedupe, the esm and cjs halves of this very package — would each hold their own state, and then one copy's
 * bookkeeping is invisible to the other's. Anything that must be true across the whole realm lives here.
 *
 * **What may live in a slot: frame-scoped stack state only** — which container is bound right now, which tokens
 * are mid-resolve. Never a resolved value, and never anything a lookup can answer from. Resolved values are
 * request-scoped and belong in the registry, which is the vue app instance or the react `Container`; a value in
 * here would be one request reading another's services, which is the leak this package exists to prevent.
 *
 * That is safe under concurrent SSR because a slot's contents live and die inside one *synchronous* frame:
 * set and restored (or added and `delete`d) in `try`/`finally`, so nothing survives into the next request.
 * Module scope would not have helped — it is shared by every request in the process too, just not across
 * copies. Anything put here that outlives a frame breaks SSR, whichever scope it sits in.
 *
 * Every key carries a `.v1` suffix so two *different* majors cannot land in one slot. That tree is
 * unsupported anyway; the suffix only makes it fail instead of letting v1 read what v2 wrote. Bump on a major.
 */

const slots = globalThis as unknown as Record<symbol, unknown>

export const globalSlot = <T>(key: string, create: () => T): T => {
  const slot = Symbol.for(key)
  const existing = slots[slot] as T | undefined
  if (existing) return existing
  const created = create()
  slots[slot] = created
  return created
}
