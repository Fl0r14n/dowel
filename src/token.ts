export interface AbstractType<T> {
  prototype: T
  name: string
}

export interface Type<T> {
  new (...args: any[]): T
  name: string
}

export type ProviderToken<T> = Type<T> | AbstractType<T> | string

/** For messages only — never a registry key. A minifier rewrites a class's `name`, so two tokens from
 * different chunks routinely both report `b`; the registry keys on token identity instead. */
export const tokenName = <T>(token: ProviderToken<T>): string => (typeof token === 'string' ? token : token.name) || '<anonymous>'

/** No token is legitimately falsy, so a falsy one is a bug — and nearly always the same bug: a class token
 * that is `undefined` at the call site because its module and this one import each other. Answering
 * `undefined` there (as this used to) hides it until something dereferences the result, a stack away from the
 * cause. An empty string token is caught by the same test, which is the other reason to throw rather than
 * no-op: `provide('', value)` that silently stored nothing was unreadable. */
export const assertToken = <T>(token: ProviderToken<T>, operation: 'inject' | 'provide'): void => {
  if (token) return
  const received = token === '' ? 'an empty string' : String(token)
  throw new Error(
    `[inject-braid]: ${operation} was given ${received} as its token. A class token that is \`undefined\` here is ` +
      'usually a circular import between the module that defines it and this one.'
  )
}
