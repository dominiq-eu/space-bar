import { Effect, Console, pipe, Schema } from "effect";
import { render } from "preact";
import { useState, useEffect } from "preact/hooks";

const TabGroup = Schema.Struct({
  id: Schema.Number,
  title: Schema.optional(Schema.String),
  color: Schema.String,
  collapsed: Schema.Boolean,
});

const Tab = Schema.Struct({
  id: Schema.optional(Schema.Number),
  windowId: Schema.optional(Schema.Number),
  title: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  favIconUrl: Schema.optional(Schema.String),
  active: Schema.Boolean,
  groupId: Schema.optional(Schema.Number),
  pinned: Schema.Boolean,
});

const Window = Schema.Struct({
  id: Schema.optional(Schema.Number),
  focused: Schema.Boolean,
  type: Schema.optional(Schema.String),
});

const AppState = Schema.Struct({
  timestamp: Schema.Date,
  tabs: Schema.Array(Tab),
  tabGroups: Schema.Array(TabGroup),
  windows: Schema.Array(Window),
});

type TabGroup = Schema.Schema.Type<typeof TabGroup>;
type Tab = Schema.Schema.Type<typeof Tab>;
type Window = Schema.Schema.Type<typeof Window>;
type AppState = Schema.Schema.Type<typeof AppState>;

const getCurrentTime = () => Effect.succeed(new Date());

const getTabs = () =>
  Effect.async<Tab[]>((resume) => {
    chrome.tabs.query({}, (tabs) => {
      const decodeResults = tabs.map((tab) =>
        Schema.decodeUnknown(Tab)({
          id: tab.id,
          windowId: tab.windowId,
          title: tab.title || "Untitled",
          url: tab.url,
          favIconUrl: tab.favIconUrl,
          active: tab.active,
          groupId: tab.groupId !== -1 ? tab.groupId : undefined,
          pinned: tab.pinned,
        }),
      );

      Effect.all(decodeResults).pipe(Effect.runSync, (result) =>
        resume(Effect.succeed(result)),
      );
    });
  });

const getTabGroups = () =>
  Effect.async<TabGroup[]>((resume) => {
    chrome.tabGroups.query({}, (groups) => {
      const decodeResults = groups.map((group) =>
        Schema.decodeUnknown(TabGroup)({
          id: group.id,
          title: group.title || undefined,
          color: group.color,
          collapsed: group.collapsed,
        }),
      );

      Effect.all(decodeResults).pipe(Effect.runSync, (result) =>
        resume(Effect.succeed(result)),
      );
    });
  });

const getWindows = () =>
  Effect.async<Window[]>((resume) => {
    chrome.windows.getAll({}, (windows) => {
      const decodeResults = windows.map((window) =>
        Schema.decodeUnknown(Window)({
          id: window.id,
          focused: window.focused,
          type: window.type,
        }),
      );

      Effect.all(decodeResults).pipe(Effect.runSync, (result) =>
        resume(Effect.succeed(result)),
      );
    });
  });

const createAppState = () =>
  Effect.all({
    timestamp: getCurrentTime(),
    tabs: getTabs(),
    tabGroups: getTabGroups(),
    windows: getWindows(),
  });

const colorMap: Record<string, string> = {
  grey: "#5f6368",
  blue: "#1a73e8",
  red: "#d93025",
  yellow: "#f9ab00",
  green: "#1e8e3e",
  pink: "#d01884",
  purple: "#9334e6",
  cyan: "#007b83",
  orange: "#e8710a",
};

// Storage keys
const STORAGE_KEY_WINDOW_WORKSPACE_MAP = "windowWorkspaceMap";

// Global flag to prevent sync during workspace loading
let isLoadingWorkspace = false;

// Window to Workspace Mapping
const linkWindowToWorkspace = (
  windowId: number,
  workspaceId: string,
): Effect.Effect<void> =>
  Effect.async<void>((resume) => {
    chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
      const map = result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {};

      // Remove any existing link to this workspace from other windows
      // (a workspace can only be linked to one window at a time)
      for (const [existingWindowId, existingWorkspaceId] of Object.entries(map)) {
        if (existingWorkspaceId === workspaceId && existingWindowId !== String(windowId)) {
          delete map[existingWindowId];
        }
      }

      map[windowId] = workspaceId;
      chrome.storage.local.set(
        { [STORAGE_KEY_WINDOW_WORKSPACE_MAP]: map },
        () => resume(Effect.succeed(undefined)),
      );
    });
  });

const unlinkWindow = (windowId: number): Effect.Effect<void> =>
  Effect.async<void>((resume) => {
    chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
      const map = result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {};
      delete map[windowId];
      chrome.storage.local.set(
        { [STORAGE_KEY_WINDOW_WORKSPACE_MAP]: map },
        () => resume(Effect.succeed(undefined)),
      );
    });
  });

const getWorkspaceForWindow = (
  windowId: number,
): Effect.Effect<string | undefined> =>
  Effect.async<string | undefined>((resume) => {
    chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
      const map = result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {};
      resume(Effect.succeed(map[windowId]));
    });
  });

const cleanupWindowWorkspaceMap = (): Effect.Effect<void> =>
  Effect.async<void>((resume) => {
    // Get all currently open windows
    chrome.windows.getAll({}, (windows) => {
      const openWindowIds = new Set(windows.map((w) => String(w.id)));

      // Get bookmarks bar to check which workspaces exist
      Effect.runPromise(getBookmarksBar).then((bookmarksBar) => {
        chrome.bookmarks.getChildren(bookmarksBar.id, (children) => {
          const existingWorkspaceIds = new Set(
            children.filter((child) => !child.url).map((child) => child.id),
          );

          chrome.storage.local.get(
            [STORAGE_KEY_WINDOW_WORKSPACE_MAP],
            (result) => {
              const map: Record<string, string> =
                result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {};
              const cleanedMap: Record<string, string> = {};

              // Only keep entries for windows that are currently open
              // AND workspaces that still exist
              for (const [windowId, workspaceId] of Object.entries(map)) {
                if (
                  openWindowIds.has(windowId) &&
                  existingWorkspaceIds.has(workspaceId)
                ) {
                  cleanedMap[windowId] = workspaceId;
                }
              }

              chrome.storage.local.set(
                { [STORAGE_KEY_WINDOW_WORKSPACE_MAP]: cleanedMap },
                () => resume(Effect.succeed(undefined)),
              );
            },
          );
        });
      });
    });
  });

// Workspace Management Functions
const getBookmarksBar = Effect.async<chrome.bookmarks.BookmarkTreeNode>(
  (resume) => {
    chrome.bookmarks.getTree((tree) => {
      const bookmarksBar = tree[0]?.children?.find(
        (node) => node.title === "Bookmarks bar" || node.id === "1",
      );
      if (bookmarksBar) {
        resume(Effect.succeed(bookmarksBar));
      }
    });
  },
);

const saveWorkspace = (workspaceName: string, state: AppState) =>
  Effect.gen(function* () {
    const bookmarksBar = yield* getBookmarksBar;

    // Create or find workspace folder
    const workspaceFolder =
      yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
        chrome.bookmarks.create(
          {
            parentId: bookmarksBar.id,
            title: workspaceName,
          },
          (folder) => resume(Effect.succeed(folder)),
        );
      });

    // Get current window tabs and groups
    const currentWindow = state.windows.find((w) => w.focused);
    if (!currentWindow?.id) {
      return workspaceFolder;
    }

    const windowTabs = state.tabs.filter(
      (tab) => tab.windowId === currentWindow.id && !tab.pinned,
    );
    const windowGroups = state.tabGroups.filter((group) =>
      windowTabs.some((tab) => tab.groupId === group.id),
    );

    // Create a map of tab groups
    const tabGroupMap = new Map<number, TabGroup>();
    windowGroups.forEach((group) => tabGroupMap.set(group.id, group));

    const renderedGroups = new Set<number>();

    // Save tabs and groups in order
    for (const tab of windowTabs) {
      if (tab.groupId !== undefined && !renderedGroups.has(tab.groupId)) {
        // Save entire group
        const group = tabGroupMap.get(tab.groupId);
        if (group) {
          const groupTabs = windowTabs.filter((t) => t.groupId === tab.groupId);

          // Create folder for group
          const collapsedMarker = group.collapsed ? "[collapsed]" : "";
          const groupFolder =
            yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
              chrome.bookmarks.create(
                {
                  parentId: workspaceFolder.id,
                  title: `[${group.color}]${collapsedMarker} ${group.title || "Unnamed Group"}`,
                },
                (folder) => resume(Effect.succeed(folder)),
              );
            });

          // Add tabs to group folder
          for (const groupTab of groupTabs) {
            if (groupTab.url && groupTab.title) {
              yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>(
                (resume) => {
                  chrome.bookmarks.create(
                    {
                      parentId: groupFolder.id,
                      title: groupTab.title,
                      url: groupTab.url,
                    },
                    (bookmark) => resume(Effect.succeed(bookmark)),
                  );
                },
              );
            }
          }

          renderedGroups.add(tab.groupId);
        }
      } else if (tab.groupId === undefined) {
        // Save ungrouped tab
        if (tab.url && tab.title) {
          yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
            chrome.bookmarks.create(
              {
                parentId: workspaceFolder.id,
                title: tab.title,
                url: tab.url,
              },
              (bookmark) => resume(Effect.succeed(bookmark)),
            );
          });
        }
      }
    }

    return workspaceFolder;
  });

const syncWorkspace = (windowId: number, workspaceId: string) =>
  Effect.gen(function* () {
    // Get current state
    const state = yield* createAppState();

    // Get workspace bookmark
    const results = yield* Effect.async<chrome.bookmarks.BookmarkTreeNode[]>(
      (resume) => {
        chrome.bookmarks.getSubTree(workspaceId, (results) =>
          resume(Effect.succeed(results)),
        );
      },
    );

    const workspace = results[0];
    if (!workspace) {
      return;
    }

    // Delete all children (tabs and groups)
    if (workspace.children) {
      for (const child of workspace.children) {
        yield* Effect.async<void>((resume) => {
          chrome.bookmarks.removeTree(child.id, () =>
            resume(Effect.succeed(undefined)),
          );
        });
      }
    }

    // Get tabs for this window
    const windowTabs = state.tabs.filter(
      (tab) => tab.windowId === windowId && !tab.pinned,
    );
    const windowGroups = state.tabGroups.filter((group) =>
      windowTabs.some((tab) => tab.groupId === group.id),
    );

    // Create a map of tab groups
    const tabGroupMap = new Map<number, TabGroup>();
    windowGroups.forEach((group) => tabGroupMap.set(group.id, group));

    const renderedGroups = new Set<number>();

    // Save tabs and groups in order
    for (const tab of windowTabs) {
      if (tab.groupId !== undefined && !renderedGroups.has(tab.groupId)) {
        // Save entire group
        const group = tabGroupMap.get(tab.groupId);
        if (group) {
          const groupTabs = windowTabs.filter((t) => t.groupId === tab.groupId);

          // Create folder for group
          const collapsedMarker = group.collapsed ? "[collapsed]" : "";
          const groupFolder =
            yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
              chrome.bookmarks.create(
                {
                  parentId: workspaceId,
                  title: `[${group.color}]${collapsedMarker} ${group.title || "Unnamed Group"}`,
                },
                (folder) => resume(Effect.succeed(folder)),
              );
            });

          // Add tabs to group folder
          for (const groupTab of groupTabs) {
            if (groupTab.url && groupTab.title) {
              yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>(
                (resume) => {
                  chrome.bookmarks.create(
                    {
                      parentId: groupFolder.id,
                      title: groupTab.title,
                      url: groupTab.url,
                    },
                    (bookmark) => resume(Effect.succeed(bookmark)),
                  );
                },
              );
            }
          }

          renderedGroups.add(tab.groupId);
        }
      } else if (tab.groupId === undefined) {
        // Save ungrouped tab
        if (tab.url && tab.title) {
          yield* Effect.async<chrome.bookmarks.BookmarkTreeNode>((resume) => {
            chrome.bookmarks.create(
              {
                parentId: workspaceId,
                title: tab.title,
                url: tab.url,
              },
              (bookmark) => resume(Effect.succeed(bookmark)),
            );
          });
        }
      }
    }
  });

const loadWorkspaceInWindow = (workspaceId: string, windowId: number) =>
  Effect.gen(function* () {
    // Set flag to prevent sync during loading
    isLoadingWorkspace = true;

    try {
      // First, unlink the window from any existing workspace
      yield* unlinkWindow(windowId);

      // Get workspace folder
      const results = yield* Effect.async<chrome.bookmarks.BookmarkTreeNode[]>(
        (resume) => {
          chrome.bookmarks.getSubTree(workspaceId, (results) =>
            resume(Effect.succeed(results)),
          );
        },
      );

      const workspace = results[0];
      if (!workspace?.children) {
        isLoadingWorkspace = false;
        return;
      }

      // Get current tabs in the window BEFORE loading new ones
      const currentTabs = yield* Effect.async<chrome.tabs.Tab[]>((resume) => {
        chrome.tabs.query({ windowId }, (tabs) => resume(Effect.succeed(tabs)));
      });

      const unpinnedTabIds = currentTabs
        .filter((tab) => !tab.pinned && tab.id)
        .map((tab) => tab.id!);

      // First, restore tabs and groups from workspace
      for (const item of workspace.children) {
        if (item.url) {
          // It's a bookmark (ungrouped tab)
          yield* Effect.async<chrome.tabs.Tab>((resume) => {
            chrome.tabs.create(
              {
                windowId,
                url: item.url,
                active: false,
              },
              (tab) => resume(Effect.succeed(tab)),
            );
          });
        } else if (item.children) {
          // It's a folder (tab group)
          // Parse format: [color][collapsed] Title or [color] Title
          const collapsedMatch = item.title.match(/\[collapsed\]/);
          const isCollapsed = collapsedMatch !== null;

          const colorMatch = item.title.match(/^\[(.*?)\]/);
          const color = colorMatch?.[1] || "grey";

          const groupTitle = item.title
            .replace(/^\[.*?\]/, "") // Remove color
            .replace(/\[collapsed\]/, "") // Remove collapsed marker
            .trim();

          // Create tabs first
          const tabIds: number[] = [];
          for (const bookmark of item.children) {
            if (bookmark.url) {
              const tab = yield* Effect.async<chrome.tabs.Tab>((resume) => {
                chrome.tabs.create(
                  {
                    windowId,
                    url: bookmark.url,
                    active: false,
                  },
                  (tab) => resume(Effect.succeed(tab)),
                );
              });
              if (tab.id) tabIds.push(tab.id);
            }
          }

          // Group the tabs
          if (tabIds.length > 0) {
            const groupId = yield* Effect.async<number>((resume) => {
              chrome.tabs.group({ tabIds }, (groupId) =>
                resume(Effect.succeed(groupId)),
              );
            });

            // Update group properties
            const validColors = [
              "grey",
              "blue",
              "red",
              "yellow",
              "green",
              "pink",
              "purple",
              "cyan",
              "orange",
            ];
            const groupColor = validColors.includes(color) ? color : "grey";

            yield* Effect.async<chrome.tabGroups.TabGroup>((resume) => {
              chrome.tabGroups.update(
                groupId,
                {
                  title: groupTitle,
                  color: groupColor as chrome.tabGroups.ColorEnum,
                  collapsed: isCollapsed,
                },
                (group) => resume(Effect.succeed(group)),
              );
            });
          }
        }
      }

      // Now link the window to the new workspace
      yield* linkWindowToWorkspace(windowId, workspaceId);

      // Finally, close all old unpinned tabs AFTER loading the new ones
      if (unpinnedTabIds.length > 0) {
        yield* Effect.async<void>((resume) => {
          chrome.tabs.remove(unpinnedTabIds, () =>
            resume(Effect.succeed(undefined)),
          );
        });
      }
    } finally {
      // Reset flag after loading is complete
      isLoadingWorkspace = false;
    }
  });

const restoreWorkspace = (workspaceId: string) =>
  Effect.gen(function* () {
    // Get workspace folder
    const results = yield* Effect.async<chrome.bookmarks.BookmarkTreeNode[]>(
      (resume) => {
        chrome.bookmarks.getSubTree(workspaceId, (results) =>
          resume(Effect.succeed(results)),
        );
      },
    );

    const workspace = results[0];
    if (!workspace?.children) {
      return;
    }

    // Create new window for workspace
    const newWindow = yield* Effect.async<chrome.windows.Window>((resume) => {
      chrome.windows.create({}, (window) => {
        if (window) {
          resume(Effect.succeed(window));
        }
      });
    });

    const windowId = newWindow.id;
    if (!windowId) {
      return;
    }

    // Link window to workspace
    yield* linkWindowToWorkspace(windowId, workspaceId);

    // Close the default new tab
    const firstTab = newWindow.tabs?.[0];
    if (firstTab?.id) {
      yield* Effect.async<void>((resume) => {
        chrome.tabs.remove(firstTab.id!, () =>
          resume(Effect.succeed(undefined)),
        );
      });
    }

    // Restore tabs and groups
    for (const item of workspace.children) {
      if (item.url) {
        // It's a bookmark (ungrouped tab)
        yield* Effect.async<chrome.tabs.Tab>((resume) => {
          chrome.tabs.create(
            {
              windowId,
              url: item.url,
              active: false,
            },
            (tab) => resume(Effect.succeed(tab)),
          );
        });
      } else if (item.children) {
        // It's a folder (tab group)
        // Parse format: [color][collapsed] Title or [color] Title
        const collapsedMatch = item.title.match(/\[collapsed\]/);
        const isCollapsed = collapsedMatch !== null;

        const colorMatch = item.title.match(/^\[(.*?)\]/);
        const color = colorMatch?.[1] || "grey";

        const groupTitle = item.title
          .replace(/^\[.*?\]/, "") // Remove color
          .replace(/\[collapsed\]/, "") // Remove collapsed marker
          .trim();

        // Create tabs first
        const tabIds: number[] = [];
        for (const bookmark of item.children) {
          if (bookmark.url) {
            const tab = yield* Effect.async<chrome.tabs.Tab>((resume) => {
              chrome.tabs.create(
                {
                  windowId,
                  url: bookmark.url,
                  active: false,
                },
                (tab) => resume(Effect.succeed(tab)),
              );
            });
            if (tab.id) tabIds.push(tab.id);
          }
        }

        // Group the tabs
        if (tabIds.length > 0) {
          const groupId = yield* Effect.async<number>((resume) => {
            chrome.tabs.group({ tabIds }, (groupId) =>
              resume(Effect.succeed(groupId)),
            );
          });

          // Update group properties
          const validColors = [
            "grey",
            "blue",
            "red",
            "yellow",
            "green",
            "pink",
            "purple",
            "cyan",
            "orange",
          ];
          const groupColor = validColors.includes(color) ? color : "grey";

          yield* Effect.async<chrome.tabGroups.TabGroup>((resume) => {
            chrome.tabGroups.update(
              groupId,
              {
                title: groupTitle,
                color: groupColor as chrome.tabGroups.ColorEnum,
                collapsed: isCollapsed,
              },
              (group) => resume(Effect.succeed(group)),
            );
          });
        }
      }
    }

    return newWindow;
  });

// Preact Components
function TabItem({
  tab,
  currentWindowId,
  tabGroup,
  allTabGroups,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging,
}: {
  tab: Tab;
  currentWindowId?: number;
  tabGroup?: TabGroup;
  allTabGroups?: TabGroup[];
  onDragStart?: (tab: Tab) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (tab: Tab) => void;
  isDragging?: boolean;
}) {
  const handleClick = () => {
    if (!tab.id) return;

    // If tab is in a different window, open URL in new tab in current window
    if (currentWindowId && tab.windowId !== currentWindowId && tab.url) {
      chrome.tabs.create(
        {
          windowId: currentWindowId,
          url: tab.url,
          active: true,
        },
        (newTab) => {
          // If the original tab was in a group, add the new tab to a matching group
          if (tabGroup && newTab.id) {
            // Find existing group with same name and color in current window
            const matchingGroup = allTabGroups?.find(
              (g) => g.title === tabGroup.title && g.color === tabGroup.color,
            );

            if (matchingGroup) {
              // Add to existing group
              chrome.tabs.group({
                tabIds: [newTab.id],
                groupId: matchingGroup.id,
              });
            } else {
              // Create new group with same properties
              chrome.tabs.group({ tabIds: [newTab.id] }, (groupId) => {
                const validColors = [
                  "grey",
                  "blue",
                  "red",
                  "yellow",
                  "green",
                  "pink",
                  "purple",
                  "cyan",
                  "orange",
                ];
                const groupColor = validColors.includes(tabGroup.color)
                  ? tabGroup.color
                  : "grey";

                chrome.tabGroups.update(groupId, {
                  title: tabGroup.title,
                  color: groupColor as chrome.tabGroups.ColorEnum,
                  collapsed: tabGroup.collapsed,
                });
              });
            }
          }
        },
      );
    } else {
      chrome.tabs.update(tab.id, { active: true });
    }
  };

  const handleClose = (e: MouseEvent) => {
    e.stopPropagation();
    if (tab.id) {
      chrome.tabs.remove(tab.id);
    }
  };

  const handleDragStart = (e: DragEvent) => {
    e.stopPropagation();
    if (onDragStart) {
      onDragStart(tab);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onDragOver) {
      onDragOver(e);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onDrop) {
      onDrop(tab);
    }
  };

  const getFaviconUrl = () => {
    if (tab.favIconUrl) {
      return tab.favIconUrl;
    }

    // Use Chrome Extension favicon API for URLs without favicons
    if (tab.url) {
      // Normalize any browser-specific scheme to chrome:// (helium://, edge://, brave://, etc.)
      // Keep standard web protocols (http, https, file, data, ftp) unchanged
      const normalizedUrl = tab.url.replace(
        /^([a-z]+):\/\//,
        (match, scheme) => {
          const standardSchemes = [
            "http",
            "https",
            "file",
            "data",
            "ftp",
            "chrome",
          ];
          return standardSchemes.includes(scheme) ? match : "chrome://";
        },
      );

      const extensionId = chrome.runtime.id;
      const encodedUrl = encodeURIComponent(normalizedUrl);
      const size = 32;
      return `chrome-extension://${extensionId}/_favicon/?pageUrl=${encodedUrl}&size=${size}`;
    }

    return null;
  };

  const faviconUrl = getFaviconUrl();

  return (
    <div
      draggable={!!tab.id}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      class={`group font-mono text-xs overflow-hidden flex items-center gap-2 cursor-pointer hover:bg-gray-200 px-1 py-0.5 rounded transition-colors ${isDragging ? "opacity-50" : ""}`}
      onClick={handleClick}
    >
      <div class="flex items-center gap-2 flex-1 min-w-0">
        {tab.active && <span>🔸</span>}
        {faviconUrl ? (
          <img src={faviconUrl} alt="" class="w-4 h-4 flex-shrink-0" />
        ) : (
          <span class="w-4 h-4 flex-shrink-0 text-center">📄</span>
        )}
        <span class="truncate">{tab.title || "Untitled"}</span>
      </div>
      <button
        class="opacity-0 group-hover:opacity-100 flex-shrink-0 hover:bg-gray-300 rounded px-1 transition-opacity"
        onClick={handleClose}
      >
        ×
      </button>
    </div>
  );
}

function PinnedTabs({
  tabs,
  currentWindowId,
  currentWindowTabGroups,
  onDragStart,
  draggedTab,
}: {
  tabs: Tab[];
  currentWindowId?: number;
  currentWindowTabGroups?: TabGroup[];
  onDragStart: (tab: Tab) => void;
  draggedTab: DragData | null;
}) {
  if (tabs.length === 0) return null;

  return (
    <div class="mb-3">
      <div class="font-bold mb-1">📌 Pinned Tabs ({tabs.length}):</div>
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          currentWindowId={currentWindowId}
          allTabGroups={currentWindowTabGroups}
          onDragStart={onDragStart}
          isDragging={draggedTab?.tabId === tab.id}
        />
      ))}
    </div>
  );
}

function GroupedTabs({
  group,
  tabs,
  currentWindowId,
  currentWindowTabGroups,
  onDragStart,
  onDropOnGroup,
  draggedTab,
}: {
  group: TabGroup;
  tabs: Tab[];
  currentWindowId?: number;
  currentWindowTabGroups?: TabGroup[];
  onDragStart: (tab: Tab) => void;
  onDropOnGroup: (groupId: number) => void;
  draggedTab: DragData | null;
}) {
  if (tabs.length === 0) return null;

  const handleToggle = () => {
    chrome.tabGroups.update(group.id, { collapsed: !group.collapsed });
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDropOnGroup(group.id);
  };

  const handleCloseGroup = (e: MouseEvent) => {
    e.stopPropagation();
    const tabIds = tabs
      .map((tab) => tab.id)
      .filter((id): id is number => id !== undefined);
    if (tabIds.length > 0) {
      chrome.tabs.remove(tabIds);
    }
  };

  return (
    <div class="mb-3">
      <div
        class="group font-bold mb-1 cursor-pointer hover:opacity-70 transition-opacity rounded px-2 py-1 flex items-center justify-between"
        style={{
          color: colorMap[group.color] || "#000",
          backgroundColor: draggedTab ? "rgba(0,0,0,0.05)" : "transparent",
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div onClick={handleToggle} class="flex-1">
          {group.collapsed ? "▶ " : "▼ "}
          {group.title || "Unnamed Group"} ({tabs.length})
        </div>
        <button
          class="opacity-0 group-hover:opacity-100 flex-shrink-0 hover:bg-gray-300 rounded px-1 transition-opacity"
          onClick={handleCloseGroup}
        >
          ×
        </button>
      </div>
      {!group.collapsed &&
        tabs.map((tab) => (
          <div key={tab.id} class="pl-4">
            <TabItem
              tab={tab}
              currentWindowId={currentWindowId}
              tabGroup={group}
              allTabGroups={currentWindowTabGroups}
              onDragStart={onDragStart}
              isDragging={draggedTab?.tabId === tab.id}
            />
          </div>
        ))}
    </div>
  );
}

function WindowSection({
  window,
  tabs,
  tabGroups,
  currentWindowId,
  currentWindowTabGroups,
  linkedWorkspaceName,
  onLinkWorkspace,
  onDragStart,
  onDropOnGroup,
  onDropOnWindow,
  draggedTab,
  collapsed,
  onToggleCollapsed,
}: {
  window: Window;
  tabs: Tab[];
  tabGroups: TabGroup[];
  currentWindowId?: number;
  currentWindowTabGroups?: TabGroup[];
  linkedWorkspaceName?: string;
  onLinkWorkspace: (windowId: number) => void;
  onDragStart: (tab: Tab) => void;
  onDropOnGroup: (groupId: number) => void;
  onDropOnWindow: (windowId: number) => void;
  draggedTab: DragData | null;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const pinnedTabs = tabs.filter((tab) => tab.pinned);
  const unpinnedTabs = tabs.filter((tab) => !tab.pinned);

  // Create a map of tab groups for quick lookup
  const tabGroupMap = new Map<number, TabGroup>();
  tabGroups.forEach((group) => tabGroupMap.set(group.id, group));

  // Build ordered items (tabs and tab groups)
  const items: Array<
    { type: "tab"; tab: Tab } | { type: "group"; group: TabGroup; tabs: Tab[] }
  > = [];
  const renderedGroups = new Set<number>();

  unpinnedTabs.forEach((tab) => {
    if (tab.groupId !== undefined && !renderedGroups.has(tab.groupId)) {
      // This is the first tab of a group, render the entire group
      const group = tabGroupMap.get(tab.groupId);
      if (group) {
        const groupTabs = unpinnedTabs.filter((t) => t.groupId === tab.groupId);
        items.push({ type: "group", group, tabs: groupTabs });
        renderedGroups.add(tab.groupId);
      }
    } else if (tab.groupId === undefined) {
      // This is an ungrouped tab
      items.push({ type: "tab", tab });
    }
  });

  return (
    <div class="mb-4">
      <div
        class="flex items-center justify-between mb-2 px-3 py-2 bg-gray-200 rounded cursor-pointer hover:bg-gray-300 transition-colors"
        onClick={onToggleCollapsed}
      >
        <div class="font-bold">
          {collapsed !== undefined && (
            <span class="mr-2">{collapsed ? "▶" : "▼"}</span>
          )}
          Window {window.id} ({tabs.length} tabs)
        </div>
        <div class="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {linkedWorkspaceName ? (
            <span class="text-xs bg-green-500 text-white px-2 py-0.5 rounded">
              {linkedWorkspaceName}
            </span>
          ) : (
            window.id && (
              <button
                class="px-2 py-0.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
                onClick={() => onLinkWorkspace(window.id!)}
              >
                Link to Workspace
              </button>
            )
          )}
        </div>
      </div>
      {!collapsed && (
        <div
          class="px-2 min-h-[100px]"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (window.id) {
              onDropOnWindow(window.id);
            }
          }}
        >
          <PinnedTabs
            tabs={pinnedTabs}
            currentWindowId={currentWindowId}
            currentWindowTabGroups={currentWindowTabGroups}
            onDragStart={onDragStart}
            draggedTab={draggedTab}
          />
          {items.map((item, index) => {
            if (item.type === "tab") {
              return (
                <div key={`tab-${item.tab.id}-${index}`} class="mb-3">
                  <TabItem
                    tab={item.tab}
                    currentWindowId={currentWindowId}
                    allTabGroups={currentWindowTabGroups}
                    onDragStart={onDragStart}
                    isDragging={draggedTab?.tabId === item.tab.id}
                  />
                </div>
              );
            } else {
              return (
                <GroupedTabs
                  key={`group-${item.group.id}`}
                  group={item.group}
                  tabs={item.tabs}
                  currentWindowId={currentWindowId}
                  currentWindowTabGroups={currentWindowTabGroups}
                  onDragStart={onDragStart}
                  onDropOnGroup={onDropOnGroup}
                  draggedTab={draggedTab}
                />
              );
            }
          })}
        </div>
      )}
    </div>
  );
}

function WorkspaceManager({ state }: { state: AppState }) {
  const [workspaces, setWorkspaces] = useState<
    chrome.bookmarks.BookmarkTreeNode[]
  >([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");

  const loadWorkspaces = () => {
    Effect.runPromise(getBookmarksBar).then((bookmarksBar) => {
      chrome.bookmarks.getChildren(bookmarksBar.id, (children) => {
        // Filter to only show folders (workspaces)
        setWorkspaces(children.filter((child) => !child.url));
      });
    });
  };

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const handleSaveWorkspace = () => {
    if (!workspaceName.trim()) return;

    Effect.runPromise(saveWorkspace(workspaceName, state))
      .then(() => {
        setWorkspaceName("");
        setShowSaveDialog(false);
        loadWorkspaces();
      })
      .catch((error) => {
        console.error("Failed to save workspace:", error);
      });
  };

  const handleRestoreWorkspace = (workspaceId: string) => {
    Effect.runPromise(restoreWorkspace(workspaceId)).catch((error) => {
      console.error("Failed to restore workspace:", error);
    });
  };

  const handleDeleteWorkspace = (workspaceId: string) => {
    if (confirm("Delete this workspace?")) {
      chrome.bookmarks.removeTree(workspaceId, () => {
        loadWorkspaces();
      });
    }
  };

  return (
    <div class="mb-4 p-3 bg-white rounded border border-gray-300">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-bold text-sm">Workspaces</h2>
        <button
          class="px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
          onClick={() => setShowSaveDialog(!showSaveDialog)}
        >
          {showSaveDialog ? "Cancel" : "Save Current"}
        </button>
      </div>

      {showSaveDialog && (
        <div class="mb-3 p-2 bg-gray-50 rounded">
          <input
            type="text"
            placeholder="Workspace name..."
            class="w-full px-2 py-1 text-xs border border-gray-300 rounded mb-2"
            value={workspaceName}
            onInput={(e) => setWorkspaceName(e.currentTarget.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSaveWorkspace()}
          />
          <button
            class="w-full px-2 py-1 bg-green-500 text-white text-xs rounded hover:bg-green-600 transition-colors"
            onClick={handleSaveWorkspace}
          >
            Save Workspace
          </button>
        </div>
      )}

      <div class="space-y-1">
        {workspaces.length === 0 ? (
          <div class="text-xs text-gray-500 italic">No workspaces saved</div>
        ) : (
          workspaces.map((workspace) => (
            <div
              key={workspace.id}
              class="flex items-center justify-between p-2 bg-gray-50 rounded hover:bg-gray-100 transition-colors"
            >
              <span class="text-xs truncate flex-1">{workspace.title}</span>
              <div class="flex gap-1">
                <button
                  class="px-2 py-0.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
                  onClick={() => handleRestoreWorkspace(workspace.id)}
                >
                  Restore
                </button>
                <button
                  class="px-2 py-0.5 bg-red-500 text-white text-xs rounded hover:bg-red-600 transition-colors"
                  onClick={() => handleDeleteWorkspace(workspace.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function WorkspaceBar({
  currentWindowId,
  linkedWorkspaceId,
  state,
}: {
  currentWindowId: number | null;
  linkedWorkspaceId?: string;
  state: AppState;
}) {
  const [workspaces, setWorkspaces] = useState<
    chrome.bookmarks.BookmarkTreeNode[]
  >([]);
  const [contextMenu, setContextMenu] = useState<{
    workspaceId: string;
    x: number;
    y: number;
  } | null>(null);
  const [workspaceDialog, setWorkspaceDialog] = useState<{
    mode: "create" | "rename";
    workspaceId?: string;
    currentName: string;
  } | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const loadWorkspaces = () => {
    Effect.runPromise(getBookmarksBar).then((bookmarksBar) => {
      chrome.bookmarks.getChildren(bookmarksBar.id, (children) => {
        setWorkspaces(children.filter((child) => !child.url));
      });
    });
  };

  useEffect(() => {
    loadWorkspaces();

    // Listen for bookmark changes to update the workspace bar
    const onBookmarksChanged = () => {
      loadWorkspaces();
    };

    chrome.bookmarks.onCreated.addListener(onBookmarksChanged);
    chrome.bookmarks.onRemoved.addListener(onBookmarksChanged);
    chrome.bookmarks.onChanged.addListener(onBookmarksChanged);

    return () => {
      chrome.bookmarks.onCreated.removeListener(onBookmarksChanged);
      chrome.bookmarks.onRemoved.removeListener(onBookmarksChanged);
      chrome.bookmarks.onChanged.removeListener(onBookmarksChanged);
    };
  }, []);

  useEffect(() => {
    if (contextMenu) {
      const handleClickOutside = () => setContextMenu(null);
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [contextMenu]);

  useEffect(() => {
    if (workspaceDialog) {
      // Focus the input field when dialog opens
      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>(
          'input[placeholder="Workspace name..."]',
        );
        if (input) {
          input.focus();
          input.select();
        }
      }, 0);
    }
  }, [workspaceDialog]);

  const handleLoadWorkspace = (workspaceId: string) => {
    if (!currentWindowId) return;

    setIsLoading(true);
    Effect.runPromise(loadWorkspaceInWindow(workspaceId, currentWindowId))
      .then(() => {
        setIsLoading(false);
      })
      .catch((error) => {
        console.error("Failed to load workspace:", error);
        setIsLoading(false);
      });
  };

  const handleRestoreWorkspace = (workspaceId: string) => {
    Effect.runPromise(restoreWorkspace(workspaceId)).catch((error) => {
      console.error("Failed to restore workspace:", error);
    });
    setContextMenu(null);
  };

  const handleDeleteWorkspace = (workspaceId: string) => {
    if (confirm("Delete this workspace?")) {
      chrome.bookmarks.removeTree(workspaceId, () => {
        loadWorkspaces();
      });
    }
    setContextMenu(null);
  };

  const handleRenameWorkspace = (workspaceId: string) => {
    const workspace = workspaces.find((w) => w.id === workspaceId);
    if (workspace) {
      setWorkspaceDialog({
        mode: "rename",
        workspaceId,
        currentName: workspace.title || "",
      });
      setWorkspaceName(workspace.title || "");
    }
    setContextMenu(null);
  };

  const handleCreateWorkspace = () => {
    setWorkspaceDialog({
      mode: "create",
      currentName: "",
    });
    setWorkspaceName("");
  };

  const handleConfirmDialog = () => {
    if (!workspaceDialog || !workspaceName.trim()) return;

    if (workspaceDialog.mode === "rename") {
      // Rename existing workspace
      if (!workspaceDialog.workspaceId) return;

      // Check if another workspace with the same name already exists
      const duplicateName = workspaces.some(
        (w) => w.id !== workspaceDialog.workspaceId && w.title === workspaceName.trim(),
      );

      if (duplicateName) {
        alert("A workspace with this name already exists. Please choose a different name.");
        return;
      }

      chrome.bookmarks.update(
        workspaceDialog.workspaceId,
        { title: workspaceName },
        () => {
          loadWorkspaces();
          setWorkspaceDialog(null);
          setWorkspaceName("");
        },
      );
    } else {
      // Create new workspace
      if (!currentWindowId) return;

      // Check if a workspace with the same name already exists
      const duplicateName = workspaces.some(
        (w) => w.title === workspaceName.trim(),
      );

      if (duplicateName) {
        alert("A workspace with this name already exists. Please choose a different name.");
        return;
      }

      Effect.runPromise(saveWorkspace(workspaceName, state))
        .then((workspaceFolder) => {
          setWorkspaceName("");
          setWorkspaceDialog(null);
          loadWorkspaces();

          // Automatically link the new workspace to the current window
          if (workspaceFolder.id) {
            Effect.runPromise(linkWindowToWorkspace(currentWindowId, workspaceFolder.id))
              .catch((error) => {
                console.error("Failed to link workspace:", error);
              });
          }
        })
        .catch((error) => {
          console.error("Failed to save workspace:", error);
        });
    }
  };

  const handleContextMenu = (
    e: MouseEvent,
    workspaceId: string,
  ) => {
    e.preventDefault();

    // Estimate context menu height (2 buttons with padding)
    const menuHeight = 80; // Approximate height
    const menuWidth = 150; // Approximate width

    // Calculate position, opening upward if not enough space below
    let x = e.clientX;
    let y = e.clientY;

    // Check vertical overflow
    if (y + menuHeight > window.innerHeight) {
      y = e.clientY - menuHeight;
    }

    // Check horizontal overflow
    if (x + menuWidth > window.innerWidth) {
      x = e.clientX - menuWidth;
    }

    setContextMenu({
      workspaceId,
      x,
      y,
    });
  };

  return (
    <div class="fixed bottom-0 left-0 right-0 bg-gray-100 border-t border-gray-300 p-2">
      <div class="flex gap-2 overflow-x-auto">
        <button
          class="px-3 py-1 text-xs rounded-full transition-colors whitespace-nowrap flex-shrink-0 bg-green-500 text-white hover:bg-green-600 font-bold"
          onClick={handleCreateWorkspace}
          title="Save current workspace"
        >
          +
        </button>
        {workspaces.map((workspace) => {
          const isLinked = linkedWorkspaceId === workspace.id;
          return (
            <button
              key={workspace.id}
              class={`px-3 py-1 text-xs rounded-full transition-colors whitespace-nowrap flex-shrink-0 ${
                isLinked
                  ? "bg-blue-500 text-white hover:bg-blue-600"
                  : "bg-gray-300 text-gray-700 hover:bg-gray-400"
              }`}
              onClick={() => handleLoadWorkspace(workspace.id)}
              onContextMenu={(e) => handleContextMenu(e, workspace.id)}
            >
              {workspace.title}
            </button>
          );
        })}
      </div>
      {contextMenu && (
        <div
          class="fixed bg-white border border-gray-300 rounded shadow-lg z-50"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            class="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 transition-colors"
            onClick={() => handleRestoreWorkspace(contextMenu.workspaceId)}
          >
            Restore
          </button>
          <button
            class="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 transition-colors"
            onClick={() => handleRenameWorkspace(contextMenu.workspaceId)}
          >
            Rename
          </button>
          <button
            class="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 transition-colors text-red-600"
            onClick={() => handleDeleteWorkspace(contextMenu.workspaceId)}
          >
            Delete
          </button>
        </div>
      )}
      {workspaceDialog && (
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-white p-4 rounded shadow-lg max-w-sm w-full mx-4">
            <h3 class="font-bold mb-3 text-sm">
              {workspaceDialog.mode === "create" ? "Create Workspace" : "Rename Workspace"}
            </h3>
            <input
              type="text"
              placeholder="Workspace name..."
              class="w-full px-2 py-1 text-xs border border-gray-300 rounded mb-3"
              value={workspaceName}
              onInput={(e) => setWorkspaceName(e.currentTarget.value)}
              onKeyPress={(e) => e.key === "Enter" && handleConfirmDialog()}
              autoFocus
            />
            <div class="flex gap-2">
              <button
                class="flex-1 px-3 py-2 bg-blue-500 text-white text-xs rounded hover:bg-blue-600 transition-colors"
                onClick={handleConfirmDialog}
              >
                {workspaceDialog.mode === "create" ? "Create" : "Rename"}
              </button>
              <button
                class="flex-1 px-3 py-2 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400 transition-colors"
                onClick={() => {
                  setWorkspaceDialog(null);
                  setWorkspaceName("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {isLoading && (
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-white p-6 rounded shadow-lg">
            <div class="flex flex-col items-center gap-3">
              <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
              <p class="text-sm font-medium text-gray-700">Loading workspace...</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type DragData = {
  type: "tab";
  tabId: number;
  windowId: number;
  groupId?: number;
};

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [windowWorkspaceMap, setWindowWorkspaceMap] = useState<
    Record<number, string>
  >({});
  const [workspaceNames, setWorkspaceNames] = useState<Record<string, string>>(
    {},
  );
  const [showLinkDialog, setShowLinkDialog] = useState<number | null>(null);
  const [draggedTab, setDraggedTab] = useState<DragData | null>(null);
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);
  const [collapsedWindows, setCollapsedWindows] = useState<Set<number>>(
    new Set(),
  );

  const loadState = () => {
    Effect.runPromise(createAppState()).then((newState) => {
      setState(newState);
    });
  };

  // Debounced version to prevent too many updates
  const loadStateDebounced = (() => {
    let timeoutId: number | null = null;
    const debounce = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        loadState();
        timeoutId = null;
      }, 100);
    };
    debounce.cancel = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    return debounce;
  })();

  const loadCurrentWindowId = () => {
    chrome.windows.getCurrent((window) => {
      if (window.id) {
        setCurrentWindowId(window.id);
      }
    });
  };

  const loadWindowWorkspaceMap = () => {
    chrome.storage.local.get([STORAGE_KEY_WINDOW_WORKSPACE_MAP], (result) => {
      setWindowWorkspaceMap(result[STORAGE_KEY_WINDOW_WORKSPACE_MAP] || {});
    });
  };

  const loadWorkspaceNames = () => {
    Effect.runPromise(getBookmarksBar).then((bookmarksBar) => {
      chrome.bookmarks.getChildren(bookmarksBar.id, (children) => {
        const names: Record<string, string> = {};
        children
          .filter((child) => !child.url)
          .forEach((workspace) => {
            names[workspace.id] = workspace.title || "Unnamed Workspace";
          });
        setWorkspaceNames(names);
      });
    });
  };

  const handleLinkWorkspace = (windowId: number) => {
    setShowLinkDialog(windowId);
  };

  const handleConfirmLink = (windowId: number, workspaceId: string) => {
    Effect.runPromise(linkWindowToWorkspace(windowId, workspaceId))
      .then(() => {
        loadWindowWorkspaceMap();
        setShowLinkDialog(null);
        // Trigger initial sync
        Effect.runPromise(syncWorkspace(windowId, workspaceId));
      })
      .catch((error) => {
        console.error("Failed to link workspace:", error);
      });
  };

  const handleDragStart = (tab: Tab) => {
    if (tab.id && tab.windowId !== undefined) {
      setDraggedTab({
        type: "tab",
        tabId: tab.id,
        windowId: tab.windowId,
        groupId: tab.groupId,
      });
    }
  };

  const handleDragEnd = () => {
    setDraggedTab(null);
  };

  const handleDropOnGroup = (targetGroupId: number) => {
    if (!draggedTab) return;

    const { tabId, groupId } = draggedTab;

    // If already in target group, do nothing
    if (groupId === targetGroupId) {
      handleDragEnd();
      return;
    }

    // Add tab to group
    chrome.tabs.group({ tabIds: [tabId], groupId: targetGroupId }, () => {
      handleDragEnd();
      loadStateDebounced();
    });
  };

  const handleDropOnWindow = (targetWindowId: number) => {
    if (!draggedTab) return;

    const { tabId, windowId } = draggedTab;

    // If already in target window, ungroup if needed
    if (windowId === targetWindowId) {
      // Ungroup the tab
      chrome.tabs.ungroup([tabId], () => {
        handleDragEnd();
        loadStateDebounced();
      });
    } else {
      // Move to different window
      chrome.tabs.move(tabId, { windowId: targetWindowId, index: -1 }, () => {
        handleDragEnd();
        loadStateDebounced();
      });
    }
  };

  useEffect(() => {
    const handleGlobalDragEnd = () => {
      handleDragEnd();
    };

    document.addEventListener("dragend", handleGlobalDragEnd);
    return () => {
      document.removeEventListener("dragend", handleGlobalDragEnd);
    };
  }, []);

  // Initialize other windows as collapsed
  useEffect(() => {
    if (state && currentWindowId !== null) {
      const otherWindowIds = state.windows
        .map((w) => w.id)
        .filter((id) => id !== undefined && id !== currentWindowId) as number[];

      setCollapsedWindows(new Set(otherWindowIds));
    }
  }, [currentWindowId, state?.windows.length]);

  const syncIfLinked = (tabId?: number, windowId?: number) => {
    // Skip sync if workspace is currently being loaded
    if (isLoadingWorkspace) {
      return;
    }

    const getWindowId = () => {
      if (windowId !== undefined) {
        return Promise.resolve(windowId);
      }
      if (tabId !== undefined) {
        return new Promise<number | undefined>((resolve) => {
          chrome.tabs.get(tabId, (tab) => {
            resolve(tab?.windowId);
          });
        });
      }
      return Promise.resolve(undefined);
    };

    getWindowId().then((wId) => {
      if (wId !== undefined) {
        Effect.runPromise(getWorkspaceForWindow(wId)).then((workspaceId) => {
          if (workspaceId) {
            Effect.runPromise(syncWorkspace(wId, workspaceId)).catch(
              (error) => {
                console.error("Failed to sync workspace:", error);
              },
            );
          }
        });
      }
    });
  };

  useEffect(() => {
    // Cleanup window-workspace mappings for closed windows
    Effect.runPromise(cleanupWindowWorkspaceMap()).catch((error) => {
      console.error("Failed to cleanup window-workspace map:", error);
    });

    // Initial load
    loadState();
    loadWindowWorkspaceMap();
    loadCurrentWindowId();
    loadWorkspaceNames();

    // Listen for storage changes to update workspace map
    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
    ) => {
      if (changes[STORAGE_KEY_WINDOW_WORKSPACE_MAP]) {
        loadWindowWorkspaceMap();
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);

    // Listen for bookmark changes to update workspace names
    const onBookmarksChanged = () => {
      loadWorkspaceNames();
    };
    chrome.bookmarks.onCreated.addListener(onBookmarksChanged);
    chrome.bookmarks.onRemoved.addListener(onBookmarksChanged);
    chrome.bookmarks.onChanged.addListener(onBookmarksChanged);

    // Listen for tab updates (sync only on URL changes)
    const onTabUpdated = (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      loadStateDebounced();
      // Sync workspace only if URL changed
      if (changeInfo.url) {
        syncIfLinked(tabId, tab.windowId);
      }
    };
    const onTabCreated = (tab: chrome.tabs.Tab) => {
      loadStateDebounced();
      syncIfLinked(tab.id, tab.windowId);
    };
    const onTabRemoved = (
      tabId: number,
      removeInfo: chrome.tabs.TabRemoveInfo,
    ) => {
      loadStateDebounced();
      syncIfLinked(undefined, removeInfo.windowId);
    };
    const onTabMoved = (tabId: number, moveInfo: chrome.tabs.TabMoveInfo) => {
      loadStateDebounced();
      syncIfLinked(tabId, moveInfo.windowId);
    };
    const onTabAttached = (
      tabId: number,
      attachInfo: chrome.tabs.TabAttachInfo,
    ) => {
      loadStateDebounced();
      syncIfLinked(tabId, attachInfo.newWindowId);
    };
    const onTabDetached = (
      tabId: number,
      detachInfo: chrome.tabs.TabDetachInfo,
    ) => {
      loadStateDebounced();
      syncIfLinked(undefined, detachInfo.oldWindowId);
    };

    chrome.tabs.onUpdated.addListener(onTabUpdated);
    chrome.tabs.onCreated.addListener(onTabCreated);
    chrome.tabs.onRemoved.addListener(onTabRemoved);
    chrome.tabs.onMoved.addListener(onTabMoved);
    chrome.tabs.onAttached.addListener(onTabAttached);
    chrome.tabs.onDetached.addListener(onTabDetached);

    // Listen for tab group updates
    const onTabGroupUpdated = (group: chrome.tabGroups.TabGroup) => {
      loadStateDebounced();
      syncIfLinked(undefined, group.windowId);
    };
    const onTabGroupCreated = (group: chrome.tabGroups.TabGroup) => {
      loadStateDebounced();
      syncIfLinked(undefined, group.windowId);
    };
    const onTabGroupRemoved = (group: chrome.tabGroups.TabGroup) => {
      loadStateDebounced();
      syncIfLinked(undefined, group.windowId);
    };

    chrome.tabGroups.onUpdated.addListener(onTabGroupUpdated);
    chrome.tabGroups.onCreated.addListener(onTabGroupCreated);
    chrome.tabGroups.onRemoved.addListener(onTabGroupRemoved);

    // Listen for window updates
    const onWindowCreated = () => loadStateDebounced();
    const onWindowRemoved = (windowId: number) => {
      loadStateDebounced();
      Effect.runPromise(unlinkWindow(windowId));
    };
    const onWindowFocusChanged = () => loadStateDebounced();

    chrome.windows.onCreated.addListener(onWindowCreated);
    chrome.windows.onRemoved.addListener(onWindowRemoved);
    chrome.windows.onFocusChanged.addListener(onWindowFocusChanged);

    // Cleanup listeners
    return () => {
      loadStateDebounced.cancel();
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      chrome.tabs.onCreated.removeListener(onTabCreated);
      chrome.tabs.onRemoved.removeListener(onTabRemoved);
      chrome.tabs.onMoved.removeListener(onTabMoved);
      chrome.tabs.onAttached.removeListener(onTabAttached);
      chrome.tabs.onDetached.removeListener(onTabDetached);
      chrome.tabGroups.onUpdated.removeListener(onTabGroupUpdated);
      chrome.tabGroups.onCreated.removeListener(onTabGroupCreated);
      chrome.tabGroups.onRemoved.removeListener(onTabGroupRemoved);
      chrome.windows.onCreated.removeListener(onWindowCreated);
      chrome.windows.onRemoved.removeListener(onWindowRemoved);
      chrome.windows.onFocusChanged.removeListener(onWindowFocusChanged);
      chrome.storage.onChanged.removeListener(onStorageChanged);
      chrome.bookmarks.onCreated.removeListener(onBookmarksChanged);
      chrome.bookmarks.onRemoved.removeListener(onBookmarksChanged);
      chrome.bookmarks.onChanged.removeListener(onBookmarksChanged);
    };
  }, []);

  if (!state) {
    return null;
  }

  // Group tabs by window
  const tabsByWindow = new Map<number, Tab[]>();
  state.tabs.forEach((tab) => {
    const windowId = tab.windowId;
    if (windowId !== undefined) {
      if (!tabsByWindow.has(windowId)) {
        tabsByWindow.set(windowId, []);
      }
      tabsByWindow.get(windowId)!.push(tab);
    }
  });

  // Group tab groups by window (based on tabs)
  const tabGroupsByWindow = new Map<number, TabGroup[]>();
  state.tabGroups.forEach((group) => {
    const groupTab = state.tabs.find((tab) => tab.groupId === group.id);
    if (groupTab?.windowId !== undefined) {
      if (!tabGroupsByWindow.has(groupTab.windowId)) {
        tabGroupsByWindow.set(groupTab.windowId, []);
      }
      tabGroupsByWindow.get(groupTab.windowId)!.push(group);
    }
  });

  // Sort windows: current window (where sidepanel is open) first, then others
  const sortedWindows = [...state.windows].sort((a, b) => {
    if (a.id === currentWindowId) return -1;
    if (b.id === currentWindowId) return 1;
    return 0;
  });

  const currentWindow = sortedWindows[0];
  const otherWindows = sortedWindows.slice(1);

  // Get tab groups for current window
  const currentWindowTabGroups = currentWindowId
    ? tabGroupsByWindow.get(currentWindowId) || []
    : [];

  const handleToggleWindow = (windowId: number) => {
    setCollapsedWindows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(windowId)) {
        newSet.delete(windowId);
      } else {
        newSet.add(windowId);
      }
      return newSet;
    });
  };

  return (
    <>
      <div class="pb-16">
        {showLinkDialog !== null && (
          <LinkWorkspaceDialog
            windowId={showLinkDialog}
            onConfirm={handleConfirmLink}
            onCancel={() => setShowLinkDialog(null)}
          />
        )}
        {currentWindow && (
          <WindowSection
            key={currentWindow.id}
            window={currentWindow}
            tabs={tabsByWindow.get(currentWindow.id!) || []}
            tabGroups={tabGroupsByWindow.get(currentWindow.id!) || []}
            currentWindowId={currentWindowId || undefined}
            currentWindowTabGroups={currentWindowTabGroups}
            linkedWorkspaceName={
              currentWindow.id && windowWorkspaceMap[currentWindow.id]
                ? workspaceNames[windowWorkspaceMap[currentWindow.id]]
                : undefined
            }
            onLinkWorkspace={handleLinkWorkspace}
            onDragStart={handleDragStart}
            onDropOnGroup={handleDropOnGroup}
            onDropOnWindow={handleDropOnWindow}
            draggedTab={draggedTab}
          />
        )}
        {otherWindows.length > 0 && (
          <>
            <div class="mt-6 mb-3 px-3 py-2 bg-gray-100 rounded">
              <h3 class="font-bold text-sm">Other Windows</h3>
            </div>
            {otherWindows.map((window) => (
              <WindowSection
                key={window.id}
                window={window}
                tabs={tabsByWindow.get(window.id!) || []}
                tabGroups={tabGroupsByWindow.get(window.id!) || []}
                currentWindowId={currentWindowId || undefined}
                currentWindowTabGroups={currentWindowTabGroups}
                linkedWorkspaceName={
                  window.id && windowWorkspaceMap[window.id]
                    ? workspaceNames[windowWorkspaceMap[window.id]]
                    : undefined
                }
                onLinkWorkspace={handleLinkWorkspace}
                onDragStart={handleDragStart}
                onDropOnGroup={handleDropOnGroup}
                onDropOnWindow={handleDropOnWindow}
                draggedTab={draggedTab}
                collapsed={collapsedWindows.has(window.id!)}
                onToggleCollapsed={() =>
                  window.id && handleToggleWindow(window.id)
                }
              />
            ))}
          </>
        )}
      </div>
      <WorkspaceBar
        currentWindowId={currentWindowId}
        linkedWorkspaceId={
          currentWindowId ? windowWorkspaceMap[currentWindowId] : undefined
        }
        state={state}
      />
    </>
  );
}

function LinkWorkspaceDialog({
  windowId,
  onConfirm,
  onCancel,
}: {
  windowId: number;
  onConfirm: (windowId: number, workspaceId: string) => void;
  onCancel: () => void;
}) {
  const [workspaces, setWorkspaces] = useState<
    chrome.bookmarks.BookmarkTreeNode[]
  >([]);

  useEffect(() => {
    Effect.runPromise(getBookmarksBar).then((bookmarksBar) => {
      chrome.bookmarks.getChildren(bookmarksBar.id, (children) => {
        setWorkspaces(children.filter((child) => !child.url));
      });
    });
  }, []);

  return (
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white p-4 rounded shadow-lg max-w-sm w-full">
        <h3 class="font-bold mb-3">Link Window to Workspace</h3>
        <div class="space-y-2 mb-3 max-h-64 overflow-y-auto">
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              class="w-full text-left px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded transition-colors text-sm"
              onClick={() => onConfirm(windowId, workspace.id)}
            >
              {workspace.title}
            </button>
          ))}
        </div>
        <button
          class="w-full px-3 py-2 bg-gray-300 hover:bg-gray-400 rounded transition-colors text-sm"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const program = Effect.sync(() => {
  const outputElement = document.getElementById("output");
  if (outputElement) {
    render(<App />, outputElement);
  }
  Console.log("Effect-TS program executed successfully!");
});

Effect.runSync(program);
