# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Chrome extension with sidepanel that provides **bidirectional synchronization** between browser tabs and bookmarks using a Virtual DOM-inspired reconciliation pattern. Built with **Deno**, **TypeScript**, **Effect-TS**, and **Preact**.

## Build & Development Commands

```bash
# Build everything (CSS + Background + Sidepanel)
deno task build

# Type checking
deno task check              # Check all TypeScript files
deno check <specific-file>   # Check single file

# Code quality
deno task check              # Typecheck project
deno task lint               # Lint with Deno linter
deno task fmt                # Format code
```

## Core Architecture Principles

This codebase follows a **strict Effect-TS-first architecture** with the following non-negotiable principles:

### 1. **Effect-TS Everywhere**

- **ALL side-effects** must be wrapped in `Effect.Effect<Success, Error, Requirements>`
- **NO raw Promises** (except at boundaries when calling Effect.runPromise)
- **NO callbacks** (wrap in Effect.async)
- **NO exceptions** (use typed errors with Data.TaggedError)

### 2. **Schema over TypeScript Types**

- **Domain models** are defined with `Schema.Struct`, not TypeScript interfaces
- **Branded types** use `Schema.brand()` for type-safe IDs (TabId, WindowId, etc.)
- **Runtime validation** via `Schema.decode` for all external data (Chrome API, Storage)
- TypeScript `interface` is ONLY used for **service interfaces**, never for data

### 3. **Services with Layer Pattern**

- **Every service** must follow the Effect-TS Service pattern:
  - Interface: `export interface MyService { ... }`
  - Tag: `export const MyService = Context.GenericTag<MyService>("MyService")`
  - Implementation: `const make = Effect.gen(function*() { ... })`
  - Layer: `export const MyServiceLive = Layer.scoped(MyService, make)`
- **NO exported functions** as service operations
- **ALL operations return Effect**

### 4. **Immutability**

- **NO mutable global state** (use `SubscriptionRef` inside services)
- **NO mutations** of objects (use spread operator for updates)
- **NO array mutations** (use `.map()`, `.filter()`, etc.)

### 5. **Dependency Injection**

- Services declare dependencies via `yield* OtherService`
- Layer.provide for composing dependencies
- Chrome API access ONLY through BrowserApiService abstraction

### 6. **Implementation Examples**

#### **CORRECT Service Implementation:**

```typescript
// ===========================================================================
// 1. SCHEMA DEFINITIONS (in types.ts or inline)
// ===========================================================================

import { Context, Data, Effect, Layer, Schema } from "effect"

// Use Schema for ALL data types
const MyDataSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.brand("MyDataId")),
  name: Schema.String.pipe(Schema.minLength(1)),
  timestamp: Schema.Date,
})
type MyData = Schema.Schema.Type<typeof MyDataSchema>

// ===========================================================================
// 2. TAGGED ERRORS (in errors.ts)
// ===========================================================================

export class MyDataNotFoundError
  extends Data.TaggedError("MyDataNotFoundError")<{
    readonly id: number
  }> {}

export class MyOperationFailedError
  extends Data.TaggedError("MyOperationFailedError")<{
    readonly operation: string
    readonly reason: string
  }> {}

// ===========================================================================
// 3. SERVICE INTERFACE
// ===========================================================================

class MyService extends Context.Tag("MyService")<
  MyService,
  Readonly<{
    // All operations return Effect
    readonly getData: (id: number) => Effect.Effect<
      MyData,
      MyDataNotFoundError
    >

    readonly createData: (name: string) => Effect.Effect<
      MyData,
      MyOperationFailedError
    >

    readonly updateData: (
      id: number,
      updates: Partial<MyData>,
    ) => Effect.Effect<
      MyData,
      MyDataNotFoundError | MyOperationFailedError
    >

    // State access (if service has state)
    readonly currentState: Effect.Effect<MyData[], never>
  }>
>() {}

// ===========================================================================
// 4. SERVICE IMPLEMENTATION (private)
// ===========================================================================

const make = Effect.gen(function* () {
  // --- Declare Dependencies ---
  const browserApi = yield* BrowserApiService
  const otherService = yield* OtherService

  // --- Internal State (if needed) ---
  const stateRef = yield* SubscriptionRef.make<MyData[]>([])

  // --- Lifecycle Management (if needed) ---
  yield* Effect.acquireRelease(
    // Setup (e.g., event listeners)
    Effect.sync(() => {
      const listener = (data: unknown) => {
        // Handle event
        Effect.runFork(
          Effect.gen(function* () {
            const validated = yield* Schema.decode(MyDataSchema)(data)
            yield* SubscriptionRef.update(
              stateRef,
              (arr) => [...arr, validated],
            )
          }),
        )
      }

      browserApi.events.onMyEvent(listener)
      return listener
    }),
    // Cleanup
    (listener) =>
      Effect.sync(() => {
        browserApi.events.offMyEvent(listener)
      }),
  )

  // --- Return Service Implementation ---
  return {
    getData: (id) =>
      Effect.gen(function* () {
        // Use browserApi, not direct chrome.* calls
        const rawData = yield* browserApi.myApi.get(id)

        // Validate with Schema
        const validated = yield* Schema.decode(MyDataSchema)(rawData)

        return validated
      }),

    createData: (name) =>
      Effect.gen(function* () {
        const rawData = yield* browserApi.myApi.create({ name })
        return yield* Schema.decode(MyDataSchema)(rawData)
      }),

    updateData: (id, updates) =>
      Effect.gen(function* () {
        const rawData = yield* browserApi.myApi.update(id, updates)
        return yield* Schema.decode(MyDataSchema)(rawData)
      }),

    currentState: SubscriptionRef.get(stateRef),
  } satisfies MyService
})

// ===========================================================================
// 5. LAYER (scoped if cleanup needed, otherwise effect)
// ===========================================================================

export const MyServiceLive = Layer.scoped(MyService, make).pipe(
  Layer.provide(BrowserApiServiceLive),
  Layer.provide(OtherServiceLive),
)
```

#### ❌ **INCORRECT Patterns (DO NOT USE):**

##### ❌ Exported Functions (NO Service Pattern)

```typescript
// ❌ WRONG - This is NOT a service!
export const getData = (id: number): Effect.Effect<MyData, Error> => {
  return Effect.async((resume) => {
    chrome.api.get(id, (data) => { // ❌ Direct chrome call!
      resume(Effect.succeed(data))
    })
  })
}
```

##### ❌ Global Mutable State

```typescript
// ❌ WRONG - Mutable global state
let currentData: MyData[] = [] // ❌ Global mutation!

export const addData = (data: MyData) => {
  currentData.push(data) // ❌ Mutation!
}
```

##### ❌ Direct Chrome API Calls in Services

```typescript
// ❌ WRONG - Direct chrome.* call
const make = Effect.gen(function* () {
  return {
    getData: Effect.async((resume) => {
      chrome.tabs.query({}, (tabs) => { // ❌ Should use BrowserApiService!
        resume(Effect.succeed(tabs))
      })
    }),
  }
})
```

##### ❌ TypeScript Interfaces for Data

```typescript
// ❌ WRONG - Use Schema instead!
interface MyData {
  id: number
  name: string
}

// ✅ CORRECT
const MyData = Schema.Struct({
  id: Schema.Number.pipe(Schema.brand("MyDataId")),
  name: Schema.String.pipe(Schema.minLength(1)),
})
type MyData = Schema.Schema.Type<typeof MyData>
```

---

## Project Structure

- Folder names are in kebab-case

```
src/
├── services/                    # Effect-TS Services (Business Logic)
│   ├── browser-api-service/     # ← Abstraction for Chrome API (ONLY layer that calls chrome.*)
│   │   ├── types.ts             # BrowserApiService interface
│   │   └── chrome-api.ts        # ChromeApiServiceLive implementation
│   │
│   ├── state-service/           # Application State Management
│   │   ├── types.ts             # Schema definitions (Tab, Window, AppState, etc.)
│   │   └── index.ts             # StateService (Effect-TS Service)
│   │
│   ├── tabs-service/            # Tab Management
│   │   ├── types.ts             # Tab-related Schemas & Events
│   │   ├── errors.ts            # TaggedErrors (TabNotFoundError, etc.)
│   │   └── index.ts             # TabsService (Effect-TS Service)
│   │
│   ├── windows-service/         # Window Management
│   ├── workspaces-service/      # Workspace (Bookmarks) Management
│   ├── storage-service/         # Chrome Storage Wrapper
│   ├── sync-service/            # Workspace ↔ Window Sync
│   └── drag-drop-service/       # Drag & Drop State
│
├── components/                  # UI Components (Presentation)
│   ├── app.tsx
│   ├── tab-item.tsx
│   └── ...
│
├── hooks/                       # Hooks for Effect-TS Services
│   ├── use-app-state.ts
│   └── ...
│
└── utils/                       # Pure utility functions
    └── type-conversions.ts      # Option<T> ↔ T | undefined, etc.
```

### Service Layer (Functional, Effect-TS based)

All services follow a **functional programming** pattern with Effect-TS for composable, type-safe error handling.

**Key Services:**

1. **`browser-api-service/`** - Chrome API wrappers with Effect
   - All Chrome API calls wrapped in `Effect.Effect<Success, Error>`
   - Provides: `tabs`, `bookmarks`, `tabGroups`, `storage`, `events`
   - Context Tag: `BrowserApiService`

2. **`sync-service/`** - Bidirectional Reconciliation Engine
   - **Core Pattern**: Virtual DOM-inspired diff/patch algorithm
   - Files:
     - `reconciliation.ts` - Pure diff algorithm (URL-based matching with multi-map for duplicates)
     - `mappers.ts` - Chrome Types → NormalizedState
     - `apply.ts` - Operations → Chrome API calls
     - `index.ts` - Event listeners, queue, lock mechanism
   - See `RECONCILIATION_SYNC.md` for detailed architecture

3. **`state-service/`** - Application state types
   - Uses **Effect Schema** for validation
   - Branded types: `TabId`, `WindowId`, `GroupId`, `WorkspaceId`
   - `Tab`, `TabGroup`, `Window`, `AppState`

4. **`workspaces-service/`** - Bookmark workspace management
   - Metadata encoding in bookmark titles: `[*]` (renamed), `[color]`
   - Pinned tabs are stored in a `[pinned]` folder
   - TabGroups are loaded collapsed by default
   - Functions: `loadWorkspaceInWindow()`, `renameTabBookmark()`, `createWorkspace()`

5. **`tabs-service/`** - Tab operations (pin, unpin, group, move)

6. **`storage-service/`** - Chrome storage wrapper (window ↔ workspace mapping)

### Reconciliation Deep Dive

**Critical Concepts:**

1. **URL-based Matching with Multi-Map**
   - Items matched by URL, NOT by ID (IDs change between tabs/bookmarks)
   - **Multiple items can have same URL** (e.g., github.com/repo1 x2)
   - Uses `Map<string, NormalizedItem[]>` to handle duplicates
   - Pairs matched by index within URL group

2. **Local vs Global Indices**
   - **Bookmarks**: Use LOCAL indices within parent folder (hierarchical)
   - **Tabs**: Use ABSOLUTE indices in window (flat)
   - `MOVE_ITEM` operations contain LOCAL indices
   - `applyOperationsToTabs()` converts local → absolute

3. **Title Sync Direction**
   - Title changes sync **ONLY** Bookmarks → Tabs
   - Tabs → Bookmarks does NOT sync titles (prevents overwriting user renames)
   - `renamed` flag marks user-renamed bookmarks (`[*]` marker)
   - Tab title updates do NOT trigger sync

4. **Operation Priorities**
   ```typescript
   Priority order in apply.ts:
   0. ADD_GROUP
   1. ADD_ITEM
   2. UPDATE_GROUP
   3. UPDATE_ITEM
   4. MOVE_ITEM
   5. DELETE_ITEM
   6. DELETE_GROUP
   ```

5. **Loop Prevention**
   - Lock mechanism with `currentJob.direction`
   - Events from opposite direction ignored during sync
   - `isLoadingWorkspace` flag prevents sync during bulk loads

### UI Layer (JSX Components)

Components should NEVER contain business logic or Chrome API calls

**Components in `src/components/`:**

- `app.tsx` - Root component, state loading
- `workspace-bar.tsx` - Workspace selection/creation
- `tab-list.tsx` - Tab rendering with drag-drop
- `tab-item.tsx` - Individual tab with context menu (rename, pin, close)

**State Management:**

- Uses `use-app-state` hook with Effect-TS
- State loaded via `createAppState()` from `state-service`
- Bookmark titles enriched in `mapChromeTabs()` via `bookmarkTitleMap`

---

## Error Handling

### Always use TaggedErrors

```typescript
// ✅ Define typed errors
export class TabNotFoundError extends Data.TaggedError("TabNotFoundError")<{
  readonly tabId: TabId
}> {}

// ✅ Use catchTag for specific error handling
const program = myService.getTab(tabId).pipe(
  Effect.catchTag("TabNotFoundError", (error) => Effect.succeed(null) // Return fallback
  ),
  Effect.catchAll((error) => Effect.logError(error).pipe(Effect.as(null))),
)
```

### Never swallow errors

```typescript
// ❌ WRONG - Errors disappear
.catch(() => {})

// ❌ WRONG - Only logging
.catch(console.error)

// ✅ CORRECT - Type-safe error handling
.pipe(
  Effect.catchTag("SpecificError", handleSpecificError),
  Effect.catchAll((error) =>
    Effect.logError(error).pipe(
      Effect.flatMap(() => showErrorToUser(error.message))
    )
  )
)
```

---

## Common Patterns

### Making Chrome API Calls

```typescript
import { BrowserApiService } from "./services/browser-api-service/index.ts"

Effect.gen(function* () {
  const browserApi = yield* BrowserApiService

  // All operations return Effect
  const tabs = yield* browserApi.tabs.query({ currentWindow: true })
  yield* browserApi.tabs.update(tabId, { pinned: true })
})
```

### Adding Event Listeners

Event listeners in `effect-ts` follow this pattern:

```typescript
yield * Effect.acquireRelease(
  Effect.sync(() => {
    const cleanup = browserApi.events.onTabUpdated((tabId, changeInfo, tab) => {
      Effect.runFork(
        Effect.gen(function* () {
          // Check lock
          const locked = yield* isSyncLocked()
          if (locked && currentJob?.direction === "opposite-direction") {
            return // Prevent loops
          }

          // Enqueue sync
          yield* enqueueSyncJob({ direction, windowId, workspaceId })
        }),
      )
    })
    return cleanup
  }),
  (cleanup) => Effect.sync(() => cleanup()),
)
```

```typescript
// ✅ CORRECT Component Pattern
import { Effect } from "effect"
import { MyService } from "../services/my-service/index.ts"

export function MyComponent() {
  const [data, setData] = useState<MyData>()

  // Get service from context (via hook)
  const myService = useMyService()

  const handleClick = () => {
    // Call service operation
    Effect.runPromise(
      myService.getData(123),
    )
      .then(setData)
      .catch(console.error)
  }

  return (
    <div onClick={handleClick}>
      {data?.name || "Loading..."}
    </div>
  )
}
```

## Anti-Patterns to Avoid

1. **❌ Mixing Promises and Effect**
   ```typescript
   // ❌ WRONG
   const data = await Effect.runPromise(myEffect)
   return Promise.resolve(data)

   // ✅ CORRECT - Stay in Effect
   return myEffect
   ```

2. **❌ Using `as` type assertions**
   ```typescript
   // ❌ WRONG
   const tabId = chromeTabId as TabId

   // ✅ CORRECT
   const tabId = Schema.decodeSync(TabId)(chromeTabId)
   ```

3. **❌ Non-null assertions (`!`)**
   ```typescript
   // ❌ WRONG
   const tab = tabs.find((t) => t.id === id)!

   // ✅ CORRECT
   const tab = tabs.find((t) => t.id === id)
   if (!tab) {
     return Effect.fail(new TabNotFoundError({ tabId: id }))
   }
   ```

4. **❌ Mutating arrays/objects**
   ```typescript
   // ❌ WRONG
   tabs.push(newTab)
   tab.title = "New Title"

   // ✅ CORRECT
   const newTabs = [...tabs, newTab]
   const updatedTab = { ...tab, title: "New Title" }
   ```

5. __❌ Direct chrome._ calls outside BrowserApiService_*
   ```typescript
   // ❌ WRONG - in any service other than BrowserApiService
   chrome.tabs.query({}, callback)

   // ✅ CORRECT
   const browserApi = yield * BrowserApiService
   const tabs = yield * browserApi.tabs.query({})
   ```
6. **Never use `null` until it's absolutely necessary**

```typescript
// ❌ WRONG - Unneccessary use of `null`
const [workspaceDialog, setWorkspaceDialog] = useState<
  {
    mode: "create" | "rename"
    workspaceId?: string
    currentName: string
  } | null
>(null)

// ✅ CORRECT - the `null` state is better handled by `undefined`
const [workspaceDialog, setWorkspaceDialog] = useState<
  {
    mode: "create" | "rename"
    workspaceId?: string
    currentName: string
  }
>()
```

---

## Schema Guidelines

### Schema-based Validation

```typescript
import { Schema } from "effect"

const TabId = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.brand("TabId"),
)
type TabId = Schema.Schema.Type<typeof TabId>
```

### Branded Types for IDs

```typescript
// ✅ Always brand IDs to prevent mixups
export const TabId = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.brand("TabId"),
)

export const WindowId = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.brand("WindowId"),
)

// ❌ WRONG - Plain numbers can be mixed up
type TabId = number
type WindowId = number
```

### Option instead of undefined/null

```typescript
// ✅ Use Schema.OptionFromSelf for optional fields
const MySchema = Schema.Struct({
  id: Schema.Number,
  optionalField: Schema.OptionFromSelf(Schema.String), // Option<string>
})

// ❌ WRONG
interface MyData {
  id: number
  optionalField?: string // undefined/null
}
```

### Runtime Validation

```typescript
// ✅ Validate ALL external data
const validateChromeTab = (chromeTab: chrome.tabs.Tab) =>
  Effect.gen(function* () {
    // Validate with Schema
    const validated = yield* Schema.decode(Tab)(chromeTab).pipe(
      Effect.catchAll((error) =>
        Effect.fail(new InvalidTabDataError({ reason: error.message }))
      ),
    )
    return validated
  })

// ❌ WRONG - Trust external data
const mapChromeTab = (chromeTab: chrome.tabs.Tab): Tab => {
  return chromeTab as Tab // ❌ No validation!
}
```

---

## Important Constraints

1. **Chrome API Limitations**
   - Tab titles CANNOT be changed via API (website controls title)
   - Tab groups matched by title+color (Chrome doesn't provide stable IDs)

2. **Bookmark Metadata Format**
   - `[pinned]/Title` - Pinned bookmarks live in the `[pinned]` folder
   - `[*] Title` - User-renamed bookmark
   - `[blue] Group Name` - Group folder (color)

3. **Index Handling**
   - NEVER use global indices for bookmark operations
   - ALWAYS calculate local indices within parent folder
   - `reconciliation.ts` groups by parent before generating MOVE_ITEM

4. **Duplicate URLs**
   - System supports multiple tabs/bookmarks with same URL
   - Matching uses multi-map: `Map<URL, Item[]>`
   - Pairs matched by array index position
   - `renameTabBookmark()` uses tab position among same-URL tabs

---

## Debugging Sync Issues

**Console Logs to Check:**

```
[SyncService] === RECONCILIATION START ===
[SyncService] Direction: tabs-to-bookmarks
[SyncService] Source state loaded: { totalItems: X, ... }
[SyncService] Diff completed: N operations
  [0] ADD_ITEM { item: { url: "..." } }
  [1] UPDATE_ITEM { itemId: "...", changes: { pinned: true } }
[SyncService] === RECONCILIATION COMPLETE ===
```

**Common Issues:**

- **Sync loops**: Check for "Ignoring [event type]" logs. If missing, lock not working.
- **Items disappearing**: Check for duplicate URLs. System uses multi-map, verify matching logic.
- **Wrong item updated**: Verify local index calculation in parent groups.
- **Title not syncing**: Check `renamed` flag. Tabs → Bookmarks doesn't sync titles.
- **"Bookmark not found"**: Multiple items with same URL. `renameTabBookmark()` uses position-based matching.

---

## Testing Chrome Extensions

No automated tests currently. Manual testing workflow:

1. Build: `deno task build`
2. Load in Chrome
3. Open sidepanel (click extension icon)
4. Link a workspace to current window
5. Test scenarios:
   - Pin/unpin tabs
   - Create/delete tabs
   - Rename tabs (right-click context menu)
   - Move bookmarks in Bookmark Manager
   - Create duplicate URL tabs

---

## Code Style

- **Pure functions preferred** (especially in reconciliation.ts)
- **Effect-TS for error handling** (no try/catch unless necessary)
- **Schema validation** for domain types
- **No classes** for business logic (functional approach)
- **Deno formatting**: 2 spaces, no semicolons, double quotes

---

## Key Files to Understand

Start with these files to understand the system:

1. `src/services/sync-service/reconciliation.ts` - Core diff algorithm
2. `src/services/sync-service/index.ts` - Event handling & queue
3. `src/services/state-service/types.ts` - Domain types
4. `RECONCILIATION_SYNC.md` - Sync architecture deep dive

---

## Effect-TS Patterns Used

- **Context** (`BrowserApiService`) for dependency injection
- **Effect.gen** for imperative-style async flows
- **Effect.acquireRelease** for resource management (event listeners)
- **Schema** for runtime validation and branded types
- **Option** instead of null/undefined (`Option.some()`, `Option.none()`)
- **Either** for error handling in mappers

---

## Further Reading

- [Effect-TS Services Documentation](https://effect.website/docs/requirements-management/services/)
- [Effect-TS Schema Documentation](https://effect.website/docs/schema/introduction/)
- [Effect-TS Error Handling](https://effect.website/docs/error-management/expected-errors/)
- [Effect-TS Layer Documentation](https://effect.website/docs/requirements-management/layers/)

---

**Remember:** This is not just a guideline—it's the architecture. Any deviation requires explicit discussion and documentation.
- Run: ```deno run fmt && deno run check && deno run build && deno run test``` after every changeset to verify the last changes.
- Dependencies from services to other services should be provided as fast as possible