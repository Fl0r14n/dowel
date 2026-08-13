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
