import browser from "webextension-polyfill";

browser.action.onClicked.addListener(async (tab) => {
  if (tab.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

browser.runtime.onInstalled.addListener(() => {
  console.log("Effect-TS Chrome Extension installed successfully!");
});
