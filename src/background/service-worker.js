importScripts("../shared/url.js", "../shared/pin.js", "screenshot.js", "notion.js");

const STORAGE_KEY = "qa_pins";

async function getAllPins() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || {};
}

function mergePins(existing, incoming) {
  const merged = [...existing];
  for (const pin of incoming) {
    if (!merged.some((p) => p.id === pin.id)) merged.push(pin);
  }
  merged.sort((a, b) => a.number - b.number);
  return merged;
}

async function resolveStorageKey(all, url) {
  const key = normalizePageUrl(url);
  let changed = false;

  for (const storedUrl of Object.keys(all)) {
    if (storedUrl === key) continue;
    if (normalizePageUrl(storedUrl) !== key) continue;

    all[key] = mergePins(all[key] || [], all[storedUrl]);
    delete all[storedUrl];
    changed = true;
  }

  if (changed) {
    await chrome.storage.local.set({ [STORAGE_KEY]: all });
  }

  return key;
}

async function getPinsForUrl(url) {
  const all = await getAllPins();
  const key = await resolveStorageKey(all, url);
  return (all[key] || []).map(normalizePinFields);
}

async function savePin(url, pin) {
  const all = await getAllPins();
  const key = await resolveStorageKey(all, url);
  const pins = all[key] || [];
  pins.push(normalizePinFields(pin));
  all[key] = pins;
  await chrome.storage.local.set({ [STORAGE_KEY]: all });
  return pin;
}

async function updatePin(url, pinId, updates) {
  const all = await getAllPins();
  const key = await resolveStorageKey(all, url);
  const pins = all[key] || [];
  const index = pins.findIndex((p) => p.id === pinId);
  if (index === -1) return null;

  pins[index] = normalizePinFields({ ...pins[index], ...updates });
  all[key] = pins;
  await chrome.storage.local.set({ [STORAGE_KEY]: all });
  return pins[index];
}

async function deletePin(url, pinId) {
  const all = await getAllPins();
  const key = await resolveStorageKey(all, url);
  const pin = (all[key] || []).find((p) => p.id === pinId);
  const pins = (all[key] || []).filter((p) => p.id !== pinId);
  if (pins.length === 0) {
    delete all[key];
  } else {
    all[key] = pins;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: all });
  return pin || null;
}

importScripts("sync.js");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "CAPTURE_PIN_SCREENSHOT": {
        const windowId = sender.tab?.windowId;
        if (!windowId) {
          sendResponse({ error: "No active tab window" });
          break;
        }
        try {
          const screenshot = await capturePinScreenshot(windowId, message.viewport);
          sendResponse({ screenshot });
        } catch (err) {
          sendResponse({ error: err.message || "Screenshot capture failed" });
        }
        break;
      }
      case "NOTION_TEST_CONNECTION": {
        try {
          const databaseId = message.databaseId.replace(/-/g, "");
          const result = await testConnection(message.token, databaseId);
          sendResponse(result);
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }
      case "SYNC_FROM_NOTION": {
        sendResponse(await pullFromNotion(message.url));
        break;
      }
      case "GET_NOTION_STATUS": {
        const config = await getNotionConfig();
        sendResponse({ configured: config.configured });
        break;
      }
      case "GET_PINS": {
        const pins = await getPinsForUrl(message.url);
        sendResponse({ pins });
        break;
      }
      case "SAVE_PIN": {
        const pin = await savePin(message.url, message.pin);
        sendResponse({ pin });
        pushPinToNotion(message.url, pin);
        break;
      }
      case "UPDATE_PIN": {
        const pin = await updatePin(message.url, message.pinId, {
          ...message.updates,
          updatedAt: message.updates.updatedAt || new Date().toISOString(),
        });
        sendResponse({ pin });
        if (pin) pushPinToNotion(message.url, pin);
        break;
      }
      case "DELETE_PIN": {
        const removed = await deletePin(message.url, message.pinId);
        if (removed) await archivePinInNotion(removed);
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ error: "Unknown message type" });
    }
  })();
  return true;
});
