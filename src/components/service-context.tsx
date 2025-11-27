/**
 * Service Context
 *
 * Provides Effect-TS services to React/Preact components via context.
 * This eliminates the need for components to manually call Effect.provide
 * on every service operation.
 *
 * Usage:
 * 1. Wrap your app with <ServiceProvider>
 * 2. Use hooks in components: const stateService = useStateService()
 * 3. Call service methods: Effect.runPromise(stateService.createAppState)
 */

import { createContext } from "preact"
import { useContext } from "preact/hooks"
import { Context, Effect, Layer, Logger, ManagedRuntime } from "effect"
import { isDevelopment } from "../config.ts"
import { LogLevel } from "effect"

// Import service types

// Import service tags and live layers
import {
  BrowserApiService,
  ChromeApiServiceLive,
} from "../services/browser-api-service/index.ts"
import {
  StateService,
  StateServiceLive,
} from "../services/state-service/index.ts"
import {
  WindowsService,
  WindowsServiceLive,
} from "../services/windows-service/index.ts"
import {
  StorageService,
  StorageServiceLive,
} from "../services/storage-service/index.ts"
import { TabsService, TabsServiceLive } from "../services/tabs-service/index.ts"
import {
  WorkspacesService,
  WorkspacesServiceLive,
} from "../services/workspaces-service/index.ts"
import { SyncService, SyncServiceLive } from "../services/sync-service/index.ts"
import {
  DragDropService,
  DragDropServiceLive,
} from "../services/drag-drop-service/index.ts"

// ============================================================================
// Types
// ============================================================================

/**
 * Runtime context holding all service instances
 */
export interface ServiceContextType {
  readonly browserApi: Context.Tag.Service<typeof BrowserApiService>
  readonly stateService: Context.Tag.Service<typeof StateService>
  readonly windowsService: Context.Tag.Service<typeof WindowsService>
  readonly storageService: Context.Tag.Service<typeof StorageService>
  readonly tabsService: Context.Tag.Service<typeof TabsService>
  readonly workspacesService: Context.Tag.Service<typeof WorkspacesService>
  readonly syncService: Context.Tag.Service<typeof SyncService>
  readonly dragDropService: Context.Tag.Service<typeof DragDropService>
}

// ============================================================================
// Context
// ============================================================================

export const ServiceContext = createContext<ServiceContextType | null>(null)

// ============================================================================
// Runtime Setup
// ============================================================================

/**
 * Logger configuration layer
 * Development: DEBUG level
 * Production: ERROR level only
 */
const LoggerLayer = Logger.minimumLogLevel(
  isDevelopment ? LogLevel.Debug : LogLevel.Error,
)

/**
 * Build the complete application layer with all services
 *
 * ChromeApiServiceLive is merged first to expose BrowserApiService,
 * then other services are provided with it and merged.
 */
const AllServicesLayer = Layer.mergeAll(
  StateServiceLive,
  WindowsServiceLive,
  StorageServiceLive,
  TabsServiceLive,
  WorkspacesServiceLive,
  SyncServiceLive,
  DragDropServiceLive,
).pipe(
  Layer.provide(ChromeApiServiceLive),
)

const AppLayer = Layer.mergeAll(
  ChromeApiServiceLive,
  AllServicesLayer,
).pipe(
  Layer.provide(LoggerLayer),
)

const runtime = ManagedRuntime.make(AppLayer)

/**
 * Promise that resolves with all service instances
 * Used by main.tsx to initialize the app only when services are ready
 */
export const runtimePromise = runtime.runPromise(
  Effect.all({
    browserApi: BrowserApiService,
    stateService: StateService,
    workspacesService: WorkspacesService,
    syncService: SyncService,
    dragDropService: DragDropService,
    // These services are provided by StateServiceLive
    windowsService: WindowsService,
    storageService: StorageService,
    tabsService: TabsService,
  }),
)

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get the full service context
 * Throws if used outside ServiceContext.Provider
 */
export function useServices(): ServiceContextType {
  const services = useContext(ServiceContext)
  if (!services) {
    throw new Error(
      "Services not found. Make sure to wrap your app in ServiceContext.Provider",
    )
  }
  return services
}

/**
 * Get BrowserApiService instance
 */
export function useBrowserApi(): Context.Tag.Service<typeof BrowserApiService> {
  return useServices().browserApi
}

/**
 * Get StateService instance
 */
export function useStateService(): Context.Tag.Service<typeof StateService> {
  return useServices().stateService
}

/**
 * Get WindowsService instance
 */
export function useWindowsService(): Context.Tag.Service<
  typeof WindowsService
> {
  return useServices().windowsService
}

/**
 * Get StorageService instance
 */
export function useStorageService(): Context.Tag.Service<
  typeof StorageService
> {
  return useServices().storageService
}

/**
 * Get TabsService instance
 */
export function useTabsService(): Context.Tag.Service<typeof TabsService> {
  return useServices().tabsService
}

/**
 * Get WorkspacesService instance
 */
export function useWorkspacesService(): Context.Tag.Service<
  typeof WorkspacesService
> {
  return useServices().workspacesService
}

/**
 * Get SyncService instance
 */
export function useSyncService(): Context.Tag.Service<typeof SyncService> {
  return useServices().syncService
}

/**
 * Get DragDropService instance
 */
export function useDragDropService(): Context.Tag.Service<
  typeof DragDropService
> {
  return useServices().dragDropService
}
