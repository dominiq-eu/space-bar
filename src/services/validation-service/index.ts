// ============================================================================
// Validation Service - Safe Type Validation for Branded IDs
// ============================================================================

import { Data, Effect, Option, Schema } from "effect"
import {
  GroupId,
  TabId,
  WindowId,
  WorkspaceId,
} from "../state-service/schema.ts"

// ============================================================================
// Error Types
// ============================================================================

/**
 * InvalidIdError
 * Thrown when ID validation fails (negative, non-integer, undefined, etc.)
 */
export class InvalidIdError extends Data.TaggedError("InvalidIdError")<{
  readonly type: "TabId" | "WindowId" | "GroupId" | "WorkspaceId"
  readonly value: unknown
  readonly reason: string
}> {}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate TabId
 * Ensures value is a positive integer before branding
 */
export const validateTabId = (
  id: unknown,
): Effect.Effect<TabId, InvalidIdError> =>
  Schema.decodeUnknown(TabId)(id).pipe(
    Effect.mapError((error) =>
      new InvalidIdError({
        type: "TabId",
        value: id,
        reason: String(error),
      })
    ),
  )

/**
 * Validate WindowId
 * Ensures value is a positive integer before branding
 */
export const validateWindowId = (
  id: unknown,
): Effect.Effect<WindowId, InvalidIdError> =>
  Schema.decodeUnknown(WindowId)(id).pipe(
    Effect.mapError((error) =>
      new InvalidIdError({
        type: "WindowId",
        value: id,
        reason: String(error),
      })
    ),
  )

/**
 * Validate GroupId
 * Ensures value is a positive integer before branding
 */
export const validateGroupId = (
  id: unknown,
): Effect.Effect<GroupId, InvalidIdError> =>
  Schema.decodeUnknown(GroupId)(id).pipe(
    Effect.mapError((error) =>
      new InvalidIdError({
        type: "GroupId",
        value: id,
        reason: String(error),
      })
    ),
  )

/**
 * Validate WorkspaceId
 * Ensures value is a non-empty string before branding
 */
export const validateWorkspaceId = (
  id: unknown,
): Effect.Effect<WorkspaceId, InvalidIdError> =>
  Schema.decodeUnknown(WorkspaceId)(id).pipe(
    Effect.mapError((error) =>
      new InvalidIdError({
        type: "WorkspaceId",
        value: id,
        reason: String(error),
      })
    ),
  )

// ============================================================================
// Optional Validation (returns None on failure instead of error)
// ============================================================================

/**
 * Validate TabId (optional)
 * Returns Option.none() if validation fails instead of throwing error
 */
export const validateTabIdOptional = (
  id: unknown,
): Effect.Effect<Option.Option<TabId>> =>
  validateTabId(id).pipe(
    Effect.map(Option.some),
    Effect.catchAll(() => Effect.succeed(Option.none())),
  )

/**
 * Validate WindowId (optional)
 * Returns Option.none() if validation fails instead of throwing error
 */
export const validateWindowIdOptional = (
  id: unknown,
): Effect.Effect<Option.Option<WindowId>> =>
  validateWindowId(id).pipe(
    Effect.map(Option.some),
    Effect.catchAll(() => Effect.succeed(Option.none())),
  )

/**
 * Validate GroupId (optional)
 * Returns Option.none() if validation fails instead of throwing error
 */
export const validateGroupIdOptional = (
  id: unknown,
): Effect.Effect<Option.Option<GroupId>> =>
  validateGroupId(id).pipe(
    Effect.map(Option.some),
    Effect.catchAll(() => Effect.succeed(Option.none())),
  )

/**
 * Validate WorkspaceId (optional)
 * Returns Option.none() if validation fails instead of throwing error
 */
export const validateWorkspaceIdOptional = (
  id: unknown,
): Effect.Effect<Option.Option<WorkspaceId>> =>
  validateWorkspaceId(id).pipe(
    Effect.map(Option.some),
    Effect.catchAll(() => Effect.succeed(Option.none())),
  )

// ============================================================================
// Convenience Export
// ============================================================================

/**
 * Validators namespace
 * Provides easy access to all validation functions
 *
 * Usage:
 * ```typescript
 * import { Validators } from "../validation-service/index.ts"
 *
 * const tabId = yield* Validators.tabId(chromeTab.id)
 * const groupId = yield* Validators.groupIdOptional(chromeTab.groupId)
 * ```
 */
export const Validators = {
  tabId: validateTabId,
  windowId: validateWindowId,
  groupId: validateGroupId,
  workspaceId: validateWorkspaceId,
  tabIdOptional: validateTabIdOptional,
  windowIdOptional: validateWindowIdOptional,
  groupIdOptional: validateGroupIdOptional,
  workspaceIdOptional: validateWorkspaceIdOptional,
} as const
