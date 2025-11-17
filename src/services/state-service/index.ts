import { Effect } from "effect"
import { getWindows } from "../windows-service/index.ts"
import { getTabs, getTabGroups } from "../tabs-service/index.ts"

/**
 * Get current timestamp
 */
export const getCurrentTime = () => Effect.succeed(new Date())

/**
 * Create complete app state by fetching all data
 */
export const createAppState = () =>
  Effect.all({
    timestamp: getCurrentTime(),
    tabs: getTabs(),
    tabGroups: getTabGroups(),
    windows: getWindows(),
  })

// Re-export types for convenience
export type { Tab, TabGroup, Window, AppState } from "./types.ts"
