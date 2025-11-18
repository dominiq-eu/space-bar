import { Data } from "effect"

/**
 * Storage operation failed error
 */
export class StorageOperationFailedError extends Data.TaggedError("StorageOperationFailedError")<{
  readonly operation: string
  readonly reason: string
  readonly key?: string
}> {}
