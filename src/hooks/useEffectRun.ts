import { Effect, Fiber } from "effect"
import { useEffect } from "preact/hooks"

/**
 * Hook to run an Effect in a React/Preact component.
 * Automatically handles cleanup/cancellation when component unmounts.
 *
 * @param effect - The Effect to run
 * @param dependencies - Dependency array for useEffect
 */
export const useEffectRun = <A, E>(
  effect: Effect.Effect<A, E>,
  dependencies: ReadonlyArray<unknown> = [],
): void => {
  useEffect(() => {
    // Fork the effect into a fiber
    const fiber = Effect.runFork(effect)

    // Cleanup: Interrupt the fiber when component unmounts or dependencies change
    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }, dependencies)
}
