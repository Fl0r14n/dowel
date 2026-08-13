/** Provider tokens. A token is either a string or a class — abstract classes are the interesting case:
 * one declaration serves as both the injection key (at runtime, via its `name`) and the resolved type
 * (at compile time, via its prototype), so a service needs no separate interface + token pair. */

export interface AbstractType<T> {
  prototype: T
  name: string
}

export interface Type<T> {
  new (...args: any[]): T
  name: string
}

export type ProviderToken<T> = Type<T> | AbstractType<T> | string

/** The registry key for a token: the string itself, or the class's `name`.
 *
 * Class `name` is why a published bundle must not mangle its token classes — minified names are
 * unstable across builds and can collide. Prefer string tokens for anything crossing a package
 * boundary; keep class tokens for app-local services. */
export const injectionKey = <T>(token: ProviderToken<T>): string | undefined =>
  (typeof token === 'string' ? token : token.name) || undefined
