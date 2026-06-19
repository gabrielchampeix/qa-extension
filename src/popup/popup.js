const qaToggle = document.getElementById("qa-toggle");
const addPinBtn = document.getElementById("add-pin-btn");
const pinList = document.getElementById("pin-list");
const emptyState = document.getElementById("empty-state");
const pageUrlEl = document.getElementById("page-url");
const syncStatusEl = document.getElementById("sync-status");
const openOptionsLink = document.getElementById("open-options");

let activeTabId = null;
let activePageKey = null;

function openNotionSettings() {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html") });
  }
  window.close();
}

openOptionsLink.addEventListener("click", openNotionSettings);

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/shared/url.js", "src/shared/pin.js", "src/content/pins.js"],
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderPinList(pins) {
  pinList.innerHTML = "";

  if (!pins.length) {
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");

  pins.forEach((pin) => {
    const pinData = normalizePinFields(pin);
    const li = document.createElement("li");
    li.className = "pin-item";
    li.innerHTML = `
      <div class="pin-item-header">
        <span class="pin-number">#${pin.number}</span>
        <div class="pin-item-actions">
          <span class="pin-date">${formatDate(pin.createdAt)}</span>
          <button type="button" class="pin-delete-btn" aria-label="Delete issue #${pin.number}">Delete</button>
        </div>
      </div>
      <p class="pin-title"></p>
      <p class="pin-description"></p>
      <p class="pin-reporter"></p>
    `;
    li.querySelector(".pin-title").textContent = pinData.title;
    li.querySelector(".pin-description").textContent = pinData.description;
    li.querySelector(".pin-reporter").textContent = pinData.reporter
      ? `Raised by ${pinData.reporter}`
      : "";
    li.querySelector(".pin-delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      deletePin(pin.id);
    });
    li.addEventListener("click", () => scrollToPinOnPage(pin.id));
    pinList.appendChild(li);
  });
}

async function scrollToPinOnPage(pinId) {
  if (!activeTabId) return;

  try {
    const result = await sendToTab(activeTabId, { type: "SCROLL_TO_PIN", pinId });
    if (result?.qaModeActive) {
      qaToggle.checked = true;
      addPinBtn.disabled = false;
    }
  } catch {
    // Tab may be unavailable.
  }
}

async function deletePin(pinId) {
  if (!activePageKey) return;

  await chrome.runtime.sendMessage({
    type: "DELETE_PIN",
    url: activePageKey,
    pinId,
  });

  if (activeTabId) {
    try {
      await sendToTab(activeTabId, { type: "REFRESH_PINS" });
    } catch {
      // Tab may be unavailable; popup list still updates below.
    }
  }

  await loadPins(activePageKey);
}

async function syncFromNotion(url) {
  const result = await chrome.runtime.sendMessage({
    type: "SYNC_FROM_NOTION",
    url: normalizePageUrl(url),
  });

  if (result?.ok) {
    syncStatusEl.textContent = `Synced with Notion (${result.count} comment${result.count === 1 ? "" : "s"})`;
    syncStatusEl.className = "sync-status ok";
  } else if (result?.reason === "not_configured") {
    syncStatusEl.textContent = "Notion not configured";
    syncStatusEl.className = "sync-status muted";
  } else if (result?.error) {
    syncStatusEl.textContent = `Sync failed: ${result.error}`;
    syncStatusEl.className = "sync-status error";
  }

  return result;
}

async function loadPins(url) {
  await syncFromNotion(url);
  const { pins } = await chrome.runtime.sendMessage({
    type: "GET_PINS",
    url: normalizePageUrl(url),
  });
  renderPinList(pins || []);

  if (activeTabId && qaToggle.checked) {
    try {
      await sendToTab(activeTabId, { type: "REFRESH_PINS" });
    } catch {
      // Tab may be unavailable.
    }
  }
}

async function init() {
  const tab = await getActiveTab();

  if (!tab?.id || !tab.url || tab.url.startsWith("chrome://")) {
    pageUrlEl.textContent = "Open a regular web page to use QA pins.";
    qaToggle.disabled = true;
    addPinBtn.disabled = true;
    return;
  }

  const pageKey = normalizePageUrl(tab.url);
  activeTabId = tab.id;
  activePageKey = pageKey;
  pageUrlEl.textContent = pageKey;
  if (pageKey !== tab.url) {
    pageUrlEl.title = tab.url;
  }

  const state = await sendToTab(tab.id, { type: "GET_QA_STATE" });
  qaToggle.checked = state?.active ?? false;
  addPinBtn.disabled = !qaToggle.checked;

  await loadPins(pageKey);

  qaToggle.addEventListener("change", async () => {
    const active = qaToggle.checked;
    await sendToTab(tab.id, { type: "SET_QA_MODE", active });
    addPinBtn.disabled = !active;
    if (active) await loadPins(pageKey);
  });

  addPinBtn.addEventListener("click", async () => {
    await sendToTab(tab.id, { type: "START_PLACING_PIN" });
    window.close();
  });
}

init().catch(() => {
  syncStatusEl.textContent = "Could not connect to this tab.";
  syncStatusEl.className = "sync-status error";
});
