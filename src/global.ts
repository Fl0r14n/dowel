/** `Symbol.for` + `globalThis`, not a module-level `let`: the esm and cjs halves of this package are two module
 * instances, and state one half writes must be visible to a read in the other. Keys carry `.v1`, bumped when the
 * shape of what is in the slot changes. */
export const globalSlot = <T extends object>(key: string, create: () => T): T => {
  const slots = globalThis as unknown as Record<symbol, T | undefined>
  const slot = Symbol.for(key)
  const existing = slots[slot]
  if (existing) return existing
  const created = create()
  slots[slot] = created
  return created
}
