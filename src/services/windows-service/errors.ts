import { Data } from "effect"
import type { WindowId } from "../state-service/schema.ts"

/**
 * Window not found error
 */
export class WindowNotFoundError
  extends Data.TaggedError("WindowNotFoundError")<{
    readonly windowId: number
  }> {}

/**
 * Invalid window data error
 * Thrown when Chrome API returns invalid/incomplete window data
 */
export class InvalidWindowDataError
  extends Data.TaggedError("InvalidWindowDataError")<{
    readonly reason: string
    readonly data: unknown
  }> {}

/**
 * Window operation failed (generic Chrome API error)
 */
export class WindowOperationFailedError
  extends Data.TaggedError("WindowOperationFailedError")<{
    readonly operation: string
    readonly reason: string
    readonly windowId?: WindowId
  }> {}
