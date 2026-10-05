// Clicking the toolbar button opens the app in a tab (or focuses it if it is already open).
// The app runs in a regular tab rather than a popup because a scan can take minutes
// and a popup is destroyed as soon as it loses focus.

const APP_URL = chrome.runtime.getURL('app.html');

chrome.action.onClicked.addListener(async () => {
  const [existing] = await chrome.runtime.getContexts({
    contextTypes: ['TAB'],
    documentUrls: [APP_URL],
  });

  if (existing && existing.tabId > 0) {
    await chrome.tabs.update(existing.tabId, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }

  await chrome.tabs.create({ url: APP_URL });
});
