import { Option } from "effect"

/**
 * Type conversion utilities for bridging domain types and Chrome API types
 *
 * Domain types (URL, Option<T>, branded types) need conversion when:
 * - Calling Chrome APIs (domain → Chrome)
 * - Reading from components that use Chrome-style types
 */

// ============================================================================
// URL Conversions
// ============================================================================

/**
 * Convert URL to string for Chrome APIs
 */
export function urlToString(url: URL): string {
  return url.href
}

/**
 * Convert optional URL to string | undefined for Chrome APIs
 */
export function optionalUrlToString(
  url: Option.Option<URL>,
): string | undefined {
  return Option.match(url, {
    onNone: () => undefined,
    onSome: (u) => u.href,
  })
}

// ============================================================================
// Option<T> Conversions
// ============================================================================

/**
 * Convert Option<T> to T | undefined for Chrome APIs and components
 */
export function optionToUndefined<T>(option: Option.Option<T>): T | undefined {
  return Option.getOrUndefined(option)
}

/**
 * Convert T | undefined to Option<T> when receiving from Chrome APIs
 */
export function undefinedToOption<T>(value: T | undefined): Option.Option<T> {
  return value !== undefined ? Option.some(value) : Option.none()
}

/**
 * Check if Option contains a specific value
 */
export function optionContains<T>(option: Option.Option<T>, value: T): boolean {
  return Option.contains(option, value)
}

/**
 * Type guard to check if Option is Some
 */
export function isSome<T>(option: Option.Option<T>): option is Option.Some<T> {
  return Option.isSome(option)
}

/**
 * Type guard to check if Option is None
 */
export function isNone<T>(option: Option.Option<T>): option is Option.None<T> {
  return Option.isNone(option)
}

/**
 * Get value from Option or provide default
 */
export function getOrElse<T>(option: Option.Option<T>, defaultValue: T): T {
  return Option.getOrElse(option, () => defaultValue)
}

/**
 * Map over Option if Some, otherwise return None
 */
export function mapOption<T, U>(
  option: Option.Option<T>,
  fn: (value: T) => U,
): Option.Option<U> {
  return Option.map(option, fn)
}
