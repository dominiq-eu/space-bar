import { createContext } from "preact"
import { useContext } from "preact/hooks"
import { Effect, Layer, ManagedRuntime } from "effect"
import { SyncService, SyncServiceLive } from "../services/sync-service/index.ts"
import {
  DragDropService,
  DragDropServiceLive,
} from "../services/drag-drop-service/index.ts"

interface ServiceContextType {
  syncService: SyncService
  dragDropService: DragDropService
}

// Create a runtime to instantiate the services
const AppLayer = Layer.merge(SyncServiceLive, DragDropServiceLive)
const runtime = ManagedRuntime.make(AppLayer)

// We need to synchronously get the services for the context default value,
// OR we initialize the context with null and throw if not present.
// Since ManagedRuntime is async in nature for resource acquisition,
// we might need to handle this carefully.
// However, for this client-side app, we can just runSync if the layers are simple,
// but SyncService starts background fibers.

// Let's use a pattern where we initialize the services asynchronously
// and render the app only when ready.

export const ServiceContext = createContext<ServiceContextType | null>(null)

export const useServices = (): ServiceContextType => {
  const services = useContext(ServiceContext)
  if (!services) {
    throw new Error(
      "Services not found. Make sure to wrap your app in ServiceContext.Provider",
    )
  }
  return services
}

export const runtimePromise = runtime.runPromise(
  Effect.all([SyncService, DragDropService]),
)
