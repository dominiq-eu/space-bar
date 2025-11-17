import { Data } from "effect"
import type { TabId, GroupId } from "../state-service/types.ts"

/**
 * Tab not found error
 * Usage: Effect.catchTag("TabNotFoundError", ...)
 */
export class TabNotFoundError extends Data.TaggedError("TabNotFoundError")<{
  readonly tabId: number
}> {}

/**
 * Invalid tab data error
 * Thrown when Chrome API returns invalid/incomplete tab data
 */
export class InvalidTabDataError extends Data.TaggedError("InvalidTabDataError")<{
  readonly reason: string
  readonly data: unknown
}> {}

/**
 * Tab already in target group
 */
export class TabAlreadyInGroupError extends Data.TaggedError("TabAlreadyInGroupError")<{
  readonly tabId: TabId
  readonly currentGroupId: GroupId
}> {}

/**
 * Tab operation failed (generic Chrome API error)
 */
export class TabOperationFailedError extends Data.TaggedError("TabOperationFailedError")<{
  readonly operation: string
  readonly reason: string
  readonly tabId?: TabId
}> {}

/**
 * Tab group not found
 */
export class GroupNotFoundError extends Data.TaggedError("GroupNotFoundError")<{
  readonly groupId: number
}> {}

/**
 * Invalid tab group data
 */
export class InvalidGroupDataError extends Data.TaggedError("InvalidGroupDataError")<{
  readonly reason: string
  readonly data: unknown
}> {}

/**
 * Invalid URL error
 * Thrown when tab URL cannot be parsed
 */
export class InvalidTabUrlError extends Data.TaggedError("InvalidTabUrlError")<{
  readonly url: string
  readonly tabId?: number
  readonly reason: string
}> {}
