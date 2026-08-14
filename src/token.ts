export interface AbstractType<T> {
  prototype: T
  name: string
}

export interface Type<T> {
  new (...args: any[]): T
  name: string
}

export type ProviderToken<T> = Type<T> | AbstractType<T> | string

/** Messages only. A minifier rewrites a class's `name`, so two tokens can both report `b`. */
export const tokenName = <T>(token: ProviderToken<T>): string => (typeof token === 'string' ? token : token.name) || '<anonymous>'

/** A falsy token is nearly always a class left `undefined` by a circular import, so it throws rather than
 * keying the registry on `undefined`. */
export const assertToken = <T>(token: ProviderToken<T>, operation: 'inject' | 'provide'): void => {
  if (token) return
  const received = token === '' ? 'an empty string' : String(token)
  throw new Error(
    `[inject-braid]: ${operation} was given ${received} as its token. A class token that is \`undefined\` here is ` +
      'usually a circular import between the module that defines it and this one.'
  )
}
