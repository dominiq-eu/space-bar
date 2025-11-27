/**
 * Application Configuration
 *
 * In Deno environment (tests, dev):
 * - Reads from BUILD environment variable
 *
 * In browser (bundled extension):
 * - Defaults to "production"
 * - Development mode can be enabled by setting window.__DEV__ = true
 */

// Check if we're in Deno environment or browser
const BUILD = typeof Deno !== "undefined"
  ? Deno.env.get("BUILD") || "production"
  : "production"

// In browser, allow override via globalThis.__DEV__ for debugging
const isDevelopmentOverride = typeof globalThis !== "undefined" &&
  (globalThis as { __DEV__?: boolean }).__DEV__ === true

export { BUILD }
export const isDevelopment = BUILD === "development" || isDevelopmentOverride
export const isProduction = BUILD === "production" && !isDevelopmentOverride
