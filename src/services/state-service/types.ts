import { Context, Data, Effect } from "effect"
import type { AppState, Tab, TabGroup, Window } from "./schema.ts"

// Re-export domain types for convenience
export type { AppState, Tab, TabGroup, Window } from "./schema.ts"
export type { GroupId, TabId, WindowId, WorkspaceId } from "./schema.ts"

// ============================================================================
// Tagged Errors
// ============================================================================

/**
 * State Load Error
 * Thrown when loading application state fails
 */
export class StateLoadError extends Data.TaggedError("StateLoadError")<{
  readonly reason: string
}> {}

// ============================================================================
// Service Tag & Interface
// ============================================================================

/**
 * StateService Context Tag
 *
 * Use this to inject StateService into other services or programs:
 *
 * ```typescript
 * const program = Effect.gen(function*() {
 *   const stateService = yield* StateService
 *   const appState = yield* stateService.createAppState
 *   console.log("Loaded state:", appState)
 * })
 *
 * Effect.runPromise(
 *   program.pipe(Effect.provide(StateServiceLive))
 * )
 * ```
 */
export class StateService extends Context.Tag("StateService")<
  StateService,
  {
    /**
     * Get current timestamp
     * Never fails
     */
    readonly getCurrentTime: Effect.Effect<Date, never>

    /**
     * Create complete application state
     * Loads all tabs, windows, groups, and workspace mappings
     * Enriches tab titles with bookmark names from linked workspaces
     *
     * @returns AppState with all current browser state
     * @throws StateLoadError if loading fails
     */
    readonly createAppState: Effect.Effect<AppState, StateLoadError>

    /**
     * Get all tabs across all windows
     * Includes bookmark title enrichment
     *
     * @returns Array of tabs
     * @throws StateLoadError if loading fails
     */
    readonly getTabs: Effect.Effect<Tab[], StateLoadError>

    /**
     * Get all tab groups across all windows
     *
     * @returns Array of tab groups
     * @throws StateLoadError if loading fails
     */
    readonly getTabGroups: Effect.Effect<TabGroup[], StateLoadError>

    /**
     * Get all windows
     *
     * @returns Array of windows
     * @throws StateLoadError if loading fails
     */
    readonly getWindows: Effect.Effect<Window[], StateLoadError>
  }
>() {}

// Type alias for the service interface (for use in implementations)
export type StateServiceInterface = Context.Tag.Service<StateService>
