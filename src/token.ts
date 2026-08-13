export interface AbstractType<T> {
  prototype: T
  name: string
}

export interface Type<T> {
  new (...args: any[]): T
  name: string
}

export type ProviderToken<T> = Type<T> | AbstractType<T> | string

export const injectionKey = <T>(token: ProviderToken<T>): string | undefined =>
  (typeof token === 'string' ? token : token.name) || undefined
