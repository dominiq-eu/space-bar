import { Schema, Effect, Option, pipe, ParseResult } from "effect"
import {
  Tab,
  TabGroup,
  TabId,
  WindowId,
  GroupId,
  TabGroupColor,
  TabChanges,
} from "../state-service/types.ts"
import {
  InvalidTabDataError,
  InvalidGroupDataError,
  InvalidTabUrlError,
} from "./errors.ts"

/**
 * Browser-specific URL schemes that aren't valid HTTP URLs
 * but are valid in browser context
 */
const BROWSER_URL_SCHEMES = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "edge://",
  "brave://",
  "helium://",
  "vivaldi://",
  "data:",
  "file:",
  "view-source:",
]

/**
 * Check if URL is a browser-specific URL
 */
function isBrowserUrl(url: string): boolean {
  return BROWSER_URL_SCHEMES.some((scheme) => url.startsWith(scheme))
}

/**
 * Parse URL with support for browser-specific URLs
 *
 * Effect's Schema.URL only accepts valid HTTP(S) URLs
 * This wrapper also accepts browser-specific URLs like chrome://, about:, etc.
 */
function parseTabUrl(
  urlString: string
): Effect.Effect<URL, InvalidTabUrlError> {
  // Empty URL -> use about:blank
  if (!urlString || urlString.trim() === "") {
    return Effect.succeed(new URL("about:blank"))
  }

  // Try standard URL parsing first
  const standardUrlResult = Schema.decodeUnknownEither(Schema.URL)(urlString)

  if (standardUrlResult._tag === "Right") {
    return Effect.succeed(standardUrlResult.right)
  }

  // Check if it's a browser-specific URL
  if (isBrowserUrl(urlString)) {
    // For browser URLs, we create a URL object but it might not be fully valid
    // We wrap it in a try-catch since some browser URLs aren't valid URL objects
    try {
      return Effect.succeed(new URL(urlString))
    } catch {
      // If even that fails, fall back to about:blank with the original as hash
      return Effect.succeed(new URL(`about:blank#${encodeURIComponent(urlString)}`))
    }
  }

  // Invalid URL
  return Effect.fail(
    new InvalidTabUrlError({
      url: urlString,
      reason: `Not a valid HTTP(S) URL or browser URL: ${urlString}`,
    })
  )
}

/**
 * Map Chrome Tab → Domain Tab
 *
 * Returns Effect with typed errors
 * Validates all fields and ensures domain model correctness
 */
export function mapChromeTab(
  chromeTab: chrome.tabs.Tab
): Effect.Effect<Tab, InvalidTabDataError | InvalidTabUrlError> {
  return Effect.gen(function* () {
    // Validate required fields
    if (chromeTab.id === undefined || chromeTab.windowId === undefined) {
      return yield* Effect.fail(
        new InvalidTabDataError({
          reason: "Missing required fields: id or windowId",
          data: chromeTab,
        })
      )
    }

    // Parse URL
    const url = yield* parseTabUrl(chromeTab.url || "about:blank")

    // Parse favIconUrl if present
    const favIconUrl = chromeTab.favIconUrl
      ? yield* parseTabUrl(chromeTab.favIconUrl).pipe(
          Effect.map(Option.some),
          Effect.catchAll(() => Effect.succeed(Option.none()))
        )
      : Option.none()

    // Build Tab - no need to Schema.decode since we already have validated types
    const tab: Tab = {
      id: chromeTab.id as TabId,
      windowId: chromeTab.windowId as WindowId,
      title: chromeTab.title || "Untitled",
      url,
      favIconUrl,
      active: chromeTab.active ?? false,
      groupId:
        chromeTab.groupId !== undefined && chromeTab.groupId !== -1
          ? Option.some(chromeTab.groupId as GroupId)
          : Option.none(),
      pinned: chromeTab.pinned ?? false,
    }

    return tab
  })
}

/**
 * Map array of Chrome Tabs → Domain Tabs
 *
 * Filters out invalid tabs (logs errors)
 * Returns only valid tabs
 */
export function mapChromeTabs(
  chromeTabs: chrome.tabs.Tab[]
): Effect.Effect<Tab[]> {
  return Effect.gen(function* () {
    const results = yield* Effect.forEach(
      chromeTabs,
      (chromeTab) =>
        mapChromeTab(chromeTab).pipe(
          Effect.either // Convert to Either so we can filter
        ),
      { concurrency: "unbounded" }
    )

    // Filter out errors, keep only successful tabs
    const validTabs: Tab[] = []
    for (const result of results) {
      if (result._tag === "Right") {
        validTabs.push(result.right)
      } else {
        // Log error but continue
        console.warn("Failed to map Chrome tab:", result.left)
      }
    }

    return validTabs
  })
}

/**
 * Map Chrome TabGroup → Domain TabGroup
 *
 * Returns Effect with typed errors
 */
export function mapChromeTabGroup(
  chromeGroup: chrome.tabGroups.TabGroup
): Effect.Effect<TabGroup, InvalidGroupDataError> {
  return Effect.gen(function* () {
    // Validate ID
    if (chromeGroup.id === undefined) {
      return yield* Effect.fail(
        new InvalidGroupDataError({
          reason: "Missing required field: id",
          data: chromeGroup,
        })
      )
    }

    // Build TabGroup - no need to Schema.decode since we already have the right types
    const group: TabGroup = {
      id: chromeGroup.id as GroupId,
      title:
        chromeGroup.title && chromeGroup.title.trim() !== ""
          ? Option.some(chromeGroup.title)
          : Option.none(),
      color: chromeGroup.color as typeof chromeGroup.color,
      collapsed: chromeGroup.collapsed,
    }

    return group
  })
}

/**
 * Map array of Chrome TabGroups → Domain TabGroups
 *
 * Filters out invalid groups (logs errors)
 */
export function mapChromeTabGroups(
  chromeGroups: chrome.tabGroups.TabGroup[]
): Effect.Effect<TabGroup[]> {
  return Effect.gen(function* () {
    const results = yield* Effect.forEach(
      chromeGroups,
      (chromeGroup) =>
        mapChromeTabGroup(chromeGroup).pipe(Effect.either),
      { concurrency: "unbounded" }
    )

    const validGroups: TabGroup[] = []
    for (const result of results) {
      if (result._tag === "Right") {
        validGroups.push(result.right)
      } else {
        console.warn("Failed to map Chrome tab group:", result.left)
      }
    }

    return validGroups
  })
}

/**
 * Map Chrome TabChangeInfo → Tab changes
 *
 * Only includes fields that actually changed
 */
export function mapTabChangeInfo(
  changeInfo: chrome.tabs.TabChangeInfo
): Effect.Effect<TabChanges> {
  return Effect.gen(function* () {
    const changes: TabChanges = {}

    if (changeInfo.url !== undefined) {
      const url = yield* parseTabUrl(changeInfo.url).pipe(
        Effect.catchAll(() => Effect.succeed(new URL("about:blank")))
      )
      changes.url = url
    }

    if (changeInfo.title !== undefined) {
      changes.title = changeInfo.title || "Untitled"
    }

    if (changeInfo.favIconUrl !== undefined) {
      const favIconUrl = yield* parseTabUrl(changeInfo.favIconUrl).pipe(
        Effect.map(Option.some),
        Effect.catchAll(() => Effect.succeed(Option.none()))
      )
      changes.favIconUrl = favIconUrl
    }

    if (changeInfo.pinned !== undefined) {
      changes.pinned = changeInfo.pinned
    }

    if (changeInfo.groupId !== undefined) {
      changes.groupId =
        changeInfo.groupId !== -1
          ? Option.some(changeInfo.groupId as GroupId)
          : Option.none()
    }

    return changes
  })
}
