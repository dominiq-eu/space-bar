import { Effect, Logger, LogLevel } from "effect"
import { isDevelopment } from "../config.ts"

/**
 * Conditional annotation helper
 *
 * In development: Adds detailed annotations to every log for debugging
 * In production: Minimal annotations (only service name) to reduce noise
 *
 * @example
 * ```typescript
 * const createTab = (props) =>
 *   Effect.gen(function* () {
 *     // ... implementation
 *   }).pipe(
 *     annotateOperation("TabsService", "createTab", {
 *       windowId: props.windowId,
 *       url: props.url
 *     })
 *   )
 * ```
 */
export const annotateOperation = (
  service: string,
  operation: string,
  context?: Record<string, unknown>,
) => {
  if (isDevelopment) {
    // Development: Full context for debugging
    return Effect.annotateLogs({
      service,
      operation,
      ...context,
    })
  } else {
    // Production: Minimal annotations to reduce log volume
    return Effect.annotateLogs({ service })
  }
}

/**
 * Log error and return fallback value
 *
 * Common pattern for operations that should never fail.
 * Logs the error with context, then returns a default value.
 *
 * @example
 * ```typescript
 * const getTabs = () =>
 *   browserApi.tabs.query({}).pipe(
 *     Effect.catchAll(
 *       logAndFallback([], "Failed to query tabs", { retry: false })
 *     )
 *   )
 * ```
 */
export const logAndFallback = <E, A>(
  fallback: A,
  message: string,
  context?: Record<string, unknown>,
) =>
(error: E): Effect.Effect<A, never> =>
  Effect.logWarning(message, error).pipe(
    context ? Effect.annotateLogs(context) : (x) => x,
    Effect.as(fallback),
  )

/**
 * Configure logger based on environment
 *
 * Development: DEBUG level
 * Production: ERROR level only
 *
 * Apply to runtime in service-context.tsx
 */
export const configureLogger = () => {
  return Logger.minimumLogLevel(
    isDevelopment ? LogLevel.Debug : LogLevel.Error,
  )
}
