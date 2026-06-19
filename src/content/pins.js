(function () {
  const ROOT_ID = "qa-extension-root";
  const PLACING_CLASS = "qa-placing-mode";
  const VOID_TAGS = new Set([
    "AREA", "BASE", "BR", "COL", "EMBED", "HR", "IMG", "INPUT",
    "LINK", "META", "SOURCE", "TRACK", "WBR",
  ]);

  let qaModeActive = false;
  let placingPin = false;
  let rootEl = null;
  let currentUrl = normalizePageUrl(window.location.href);
  let pinnedMarkers = new Map();
  let openPopoverPinId = null;
  let popoverRepositionHandler = null;

  function syncCurrentUrl() {
    const next = normalizePageUrl(window.location.href);
    if (next === currentUrl) return;
    currentUrl = next;
    if (qaModeActive) renderPins();
  }

  function hookHistoryChanges() {
    ["pushState", "replaceState"].forEach((method) => {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        syncCurrentUrl();
        return result;
      };
    });
    window.addEventListener("popstate", syncCurrentUrl);
  }

  hookHistoryChanges();

  function generateId() {
    return `pin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function sendMessage(message) {
    return chrome.runtime.sendMessage(message);
  }

  function ensureRoot() {
    if (rootEl && document.body.contains(rootEl)) return rootEl;

    rootEl = document.createElement("div");
    rootEl.id = ROOT_ID;
    document.body.appendChild(rootEl);
    resizePlacingOverlay();
    window.addEventListener("resize", resizePlacingOverlay);
    return rootEl;
  }

  function resizePlacingOverlay() {
    if (!rootEl) return;
    const height = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      window.innerHeight
    );
    rootEl.style.height = `${height}px`;
  }

  function getElementAtPoint(clientX, clientY) {
    if (!rootEl) return document.elementFromPoint(clientX, clientY);

    const prev = rootEl.style.pointerEvents;
    rootEl.style.pointerEvents = "none";
    const target = document.elementFromPoint(clientX, clientY);
    rootEl.style.pointerEvents = prev;
    return target;
  }

  function getElementSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    if (el.closest(`#${ROOT_ID}`)) return null;

    for (const attr of ["data-testid", "data-test", "data-cy", "data-qa", "id"]) {
      const val = el.getAttribute(attr);
      if (!val || (attr === "id" && val.startsWith("qa-"))) continue;

      const sel =
        attr === "id"
          ? `#${CSS.escape(val)}`
          : `[${attr}="${CSS.escape(val)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }

    const parts = [];
    let current = el;

    while (current && current !== document.body) {
      let part = current.tagName.toLowerCase();

      if (current.classList.length > 0) {
        const classes = [...current.classList]
          .filter((c) => !c.startsWith("qa-"))
          .slice(0, 2)
          .map((c) => `.${CSS.escape(c)}`)
          .join("");
        part += classes;
      }

      const parent = current.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter(
          (s) => s.tagName === current.tagName
        );
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }

      parts.unshift(part);
      current = current.parentElement;
      if (parts.length >= 5) break;
    }

    return parts.join(" > ");
  }

  function canHostPin(el) {
    if (!el || el === document.documentElement) return false;
    if (VOID_TAGS.has(el.tagName)) return false;
    if (el.closest(`#${ROOT_ID}, .qa-pin-anchor`)) return false;
    return true;
  }

  function findPinHost(target) {
    let el = target;
    let fallbackHost = null;

    while (el && el !== document.body) {
      if (!canHostPin(el)) {
        el = el.parentElement;
        continue;
      }

      fallbackHost = el;
      const style = getComputedStyle(el);
      const clips =
        style.overflow === "hidden" ||
        style.overflowX === "hidden" ||
        style.overflowY === "hidden";

      if (!clips) return el;
      el = el.parentElement;
    }

    return fallbackHost || document.body;
  }

  function resolveAnchorElement(anchor) {
    if (!anchor?.selector) return null;
    try {
      const el = document.querySelector(anchor.selector);
      return el && canHostPin(el) ? el : null;
    } catch {
      return null;
    }
  }

  function buildAnchor(target, clientX, clientY) {
    const hostEl = findPinHost(target);
    const rect = hostEl.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;

    return {
      selector: getElementSelector(hostEl),
      hostTag: hostEl.tagName.toLowerCase(),
      offsetX,
      offsetY,
      offsetXRatio: rect.width > 0 ? offsetX / rect.width : 0,
      offsetYRatio: rect.height > 0 ? offsetY / rect.height : 0,
    };
  }

  function ensurePinHost(hostEl) {
    if (hostEl === document.body) return;

    const style = getComputedStyle(hostEl);
    if (style.position === "static") {
      hostEl.dataset.qaHadStaticPosition = "true";
      hostEl.style.position = "relative";
    }
    hostEl.classList.add("qa-pin-host");
  }

  function cleanupPinHost(hostEl) {
    if (!hostEl || hostEl === document.body) return;
    if (hostEl.querySelector(".qa-pin-anchor")) return;

    hostEl.classList.remove("qa-pin-host");
    if (hostEl.dataset.qaHadStaticPosition === "true") {
      hostEl.style.position = "";
      delete hostEl.dataset.qaHadStaticPosition;
    }
  }

  function getPinRatios(pin) {
    if (pin.anchor?.offsetXRatio != null && pin.anchor?.offsetYRatio != null) {
      return {
        x: pin.anchor.offsetXRatio,
        y: pin.anchor.offsetYRatio,
      };
    }

    const hostEl = resolveAnchorElement(pin.anchor);
    if (hostEl && pin.anchor?.offsetX != null) {
      const rect = hostEl.getBoundingClientRect();
      return {
        x: rect.width > 0 ? pin.anchor.offsetX / rect.width : 0,
        y: rect.height > 0 ? pin.anchor.offsetY / rect.height : 0,
      };
    }

    return { x: 0.5, y: 0.5 };
  }

  function resolvePinPagePosition(pin) {
    const hostEl = resolveAnchorElement(pin.anchor);
    if (hostEl) {
      const rect = hostEl.getBoundingClientRect();
      const ratios = getPinRatios(pin);
      return {
        pageX: rect.left + window.scrollX + ratios.x * rect.width,
        pageY: rect.top + window.scrollY + ratios.y * rect.height,
      };
    }
    return { pageX: pin.pageX, pageY: pin.pageY };
  }

  function createPinMarkerButton(pin) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "qa-pin-marker";
    marker.dataset.pinId = pin.id;
    marker.title = getPinDisplayTitle(pin);
    marker.textContent = String(pin.number);

    marker.addEventListener("click", (e) => {
      e.stopPropagation();
      showPinPopover(pin, marker);
    });

    return marker;
  }

  function mountPin(pin) {
    const hostEl = resolveAnchorElement(pin.anchor);
    const isFallback = !hostEl;
    const mountTarget = hostEl || document.body;

    if (!isFallback) ensurePinHost(mountTarget);

    const anchorEl = document.createElement("div");
    anchorEl.className = "qa-pin-anchor";
    anchorEl.dataset.pinId = pin.id;

    if (isFallback) {
      anchorEl.classList.add("qa-pin-fallback");
      const { pageX, pageY } = resolvePinPagePosition(pin);
      anchorEl.style.left = `${pageX}px`;
      anchorEl.style.top = `${pageY}px`;
    } else {
      const ratios = getPinRatios(pin);
      anchorEl.style.left = `${ratios.x * 100}%`;
      anchorEl.style.top = `${ratios.y * 100}%`;
    }

    const marker = createPinMarkerButton(pin);
    if (isFallback) {
      marker.classList.add("qa-pin-unanchored");
      marker.title = `${marker.title} (element not found — showing last known position)`;
    }

    anchorEl.appendChild(marker);
    mountTarget.appendChild(anchorEl);

    pinnedMarkers.set(pin.id, { anchorEl, marker, hostEl: mountTarget, pin, isFallback });
    return anchorEl;
  }

  function removeAllPinMarkers() {
    pinnedMarkers.forEach(({ anchorEl, hostEl }) => {
      anchorEl?.remove();
      cleanupPinHost(hostEl);
    });
    pinnedMarkers.clear();
    document.querySelectorAll(".qa-pin-anchor").forEach((el) => el.remove());
  }

  function positionPopoverNearMarker(popover, marker) {
    const rect = marker.getBoundingClientRect();
    popover.style.position = "fixed";
    popover.style.left = `${Math.max(8, rect.left - 126)}px`;
    popover.style.top = `${rect.bottom + 8}px`;

    requestAnimationFrame(() => {
      const popRect = popover.getBoundingClientRect();
      const maxLeft = window.innerWidth - popRect.width - 8;
      const maxTop = window.innerHeight - popRect.height - 8;

      popover.style.left = `${Math.min(Math.max(8, rect.left - popRect.width / 2), maxLeft)}px`;
      popover.style.top = `${Math.min(rect.bottom + 8, maxTop)}px`;
    });
  }

  function bindPopoverReposition(popover, marker) {
    unbindPopoverReposition();
    popoverRepositionHandler = () => positionPopoverNearMarker(popover, marker);
    window.addEventListener("resize", popoverRepositionHandler);
    window.addEventListener("scroll", popoverRepositionHandler, { passive: true });
    window.visualViewport?.addEventListener("resize", popoverRepositionHandler);
    window.visualViewport?.addEventListener("scroll", popoverRepositionHandler);
  }

  function unbindPopoverReposition() {
    if (!popoverRepositionHandler) return;
    window.removeEventListener("resize", popoverRepositionHandler);
    window.removeEventListener("scroll", popoverRepositionHandler);
    window.visualViewport?.removeEventListener("resize", popoverRepositionHandler);
    window.visualViewport?.removeEventListener("scroll", popoverRepositionHandler);
    popoverRepositionHandler = null;
  }

  function showPinPopover(pin, marker) {
    closePopover();
    openPopoverPinId = pin.id;

    const popover = document.createElement("div");
    popover.className = "qa-pin-popover";
    popover.dataset.pinId = pin.id;

    const pinData = normalizePinFields(pin);
    const reporterHtml = pinData.reporter
      ? `<p class="qa-popover-reporter">Raised by ${escapeHtml(pinData.reporter)}</p>`
      : "";
    const descriptionHtml = pinData.description
      ? `<p class="qa-popover-description">${escapeHtml(pinData.description)}</p>`
      : "";

    popover.innerHTML = `
      <div class="qa-popover-header">
        <strong>#${pin.number} · ${escapeHtml(pinData.title)}</strong>
        <button type="button" class="qa-popover-close" aria-label="Close">&times;</button>
      </div>
      ${reporterHtml}
      ${descriptionHtml}
      <div class="qa-popover-meta">${formatDate(pin.createdAt)}</div>
      <div class="qa-popover-actions">
        <button type="button" class="qa-btn qa-btn-secondary qa-edit-btn">Edit</button>
        <button type="button" class="qa-btn qa-btn-danger qa-delete-btn">Delete</button>
      </div>
    `;

    popover.querySelector(".qa-popover-close").addEventListener("click", closePopover);
    popover.querySelector(".qa-edit-btn").addEventListener("click", () => {
      closePopover();
      showCommentModal({ pin, isEdit: true });
    });
    popover.querySelector(".qa-delete-btn").addEventListener("click", async () => {
      await sendMessage({ type: "DELETE_PIN", url: currentUrl, pinId: pin.id });
      closePopover();
      await renderPins();
    });

    document.body.appendChild(popover);
    positionPopoverNearMarker(popover, marker);
    bindPopoverReposition(popover, marker);
  }

  function closePopover() {
    openPopoverPinId = null;
    unbindPopoverReposition();
    document.querySelector(".qa-pin-popover")?.remove();
  }

  function closeModal() {
    rootEl?.querySelector(".qa-comment-modal-backdrop")?.remove();
    placingPin = false;
    rootEl?.classList.remove(PLACING_CLASS);
  }

  function setPinsVisible(visible) {
    document.querySelectorAll(".qa-pin-anchor").forEach((el) => {
      el.style.visibility = visible ? "visible" : "hidden";
    });
    if (rootEl) rootEl.style.visibility = visible ? "visible" : "hidden";
  }

  function waitForPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function prepareViewportForScreenshot(pageX, pageY) {
    let viewportX = pageX - window.scrollX;
    let viewportY = pageY - window.scrollY;

    const margin = 40;
    const needsScroll =
      viewportX < margin ||
      viewportX > window.innerWidth - margin ||
      viewportY < margin ||
      viewportY > window.innerHeight - margin;

    if (needsScroll) {
      window.scrollTo({
        left: Math.max(0, pageX - window.innerWidth / 2),
        top: Math.max(0, pageY - window.innerHeight / 2),
        behavior: "instant",
      });
      await waitForPaint();
      viewportX = pageX - window.scrollX;
      viewportY = pageY - window.scrollY;
    }

    return {
      viewportX,
      viewportY,
      devicePixelRatio: window.devicePixelRatio,
    };
  }

  async function captureScreenshotForPin(pageX, pageY) {
    setPinsVisible(false);
    await waitForPaint();
    await waitMs(50);

    try {
      const viewport = await prepareViewportForScreenshot(pageX, pageY);
      await waitForPaint();
      const result = await sendMessage({
        type: "CAPTURE_PIN_SCREENSHOT",
        viewport,
      });
      return result.screenshot || null;
    } catch {
      return null;
    } finally {
      setPinsVisible(true);
    }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString();
  }

  async function getDefaultReporter() {
    const { defaultReporter } = await chrome.storage.sync.get("defaultReporter");
    return defaultReporter?.trim() || "";
  }

  function showCommentModal({ pageX, pageY, anchor, pin, isEdit = false }) {
    closeModal();

    const backdrop = document.createElement("div");
    backdrop.className = "qa-comment-modal-backdrop";
    backdrop.innerHTML = `
      <div class="qa-comment-modal" role="dialog" aria-label="${isEdit ? "Edit issue" : "Report issue"}">
        <h3>${isEdit ? "Edit issue" : "Report issue"}</h3>
        <label class="qa-field">
          <span class="qa-field-label">Issue title</span>
          <input type="text" class="qa-comment-input qa-title-input" placeholder="Short summary of the issue" />
        </label>
        <label class="qa-field">
          <span class="qa-field-label">Description</span>
          <textarea class="qa-comment-input qa-description-input" placeholder="Steps to reproduce, expected vs actual behaviour..." rows="4"></textarea>
        </label>
        <label class="qa-field">
          <span class="qa-field-label">Raised by</span>
          <input type="text" class="qa-comment-input qa-reporter-input" placeholder="Your name" />
        </label>
        <div class="qa-modal-actions">
          <button type="button" class="qa-btn qa-btn-secondary qa-cancel-btn">Cancel</button>
          <button type="button" class="qa-btn qa-btn-primary qa-save-btn">${isEdit ? "Save" : "Pin issue"}</button>
        </div>
      </div>
    `;

    const titleInput = backdrop.querySelector(".qa-title-input");
    const descriptionInput = backdrop.querySelector(".qa-description-input");
    const reporterInput = backdrop.querySelector(".qa-reporter-input");

    if (isEdit) {
      const pinData = normalizePinFields(pin);
      titleInput.value = pinData.title;
      descriptionInput.value = pinData.description;
      reporterInput.value = pinData.reporter;
    } else {
      getDefaultReporter().then((name) => {
        if (name) reporterInput.value = name;
      });
    }

    backdrop.querySelector(".qa-cancel-btn").addEventListener("click", closeModal);

    const saveBtn = backdrop.querySelector(".qa-save-btn");
    saveBtn.addEventListener("click", async () => {
      const title = titleInput.value.trim();
      const description = descriptionInput.value.trim();
      const reporter = reporterInput.value.trim();

      if (!title) {
        titleInput.focus();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = isEdit ? "Saving..." : "Capturing...";

      if (reporter) {
        chrome.storage.sync.set({ defaultReporter: reporter });
      }

      const issueFields = { title, description, reporter, updatedAt: new Date().toISOString() };

      if (isEdit) {
        await sendMessage({
          type: "UPDATE_PIN",
          url: currentUrl,
          pinId: pin.id,
          updates: issueFields,
        });
        closeModal();
        await renderPins();
        return;
      }

      closeModal();

      const draftPin = { pageX, pageY, anchor };
      const resolved = resolvePinPagePosition(draftPin);
      const screenshot = await captureScreenshotForPin(resolved.pageX, resolved.pageY);
      const { pins } = await sendMessage({ type: "GET_PINS", url: currentUrl });
      const newPin = normalizePinFields({
        id: generateId(),
        number: (pins?.length || 0) + 1,
        pageX: resolved.pageX,
        pageY: resolved.pageY,
        anchor: anchor || null,
        title,
        description,
        reporter,
        screenshot,
        createdAt: new Date().toISOString(),
      });
      await sendMessage({ type: "SAVE_PIN", url: currentUrl, pin: newPin });
      await renderPins();
    });

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal();
    });

    ensureRoot().appendChild(backdrop);
    titleInput.focus();
  }

  async function renderPins() {
    removeAllPinMarkers();
    closePopover();

    const { pins } = await sendMessage({ type: "GET_PINS", url: currentUrl });
    (pins || []).forEach((pin) => mountPin(pin));
    resizePlacingOverlay();
  }

  async function scrollToPin(pinId) {
    if (!qaModeActive) {
      await setQaMode(true);
    } else if (!pinnedMarkers.has(pinId)) {
      await renderPins();
    }

    const entry = pinnedMarkers.get(pinId);
    if (entry?.marker) {
      entry.marker.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      highlightPin(entry.marker);
      return { ok: true, qaModeActive };
    }

    const { pins } = await sendMessage({ type: "GET_PINS", url: currentUrl });
    const pin = pins?.find((p) => p.id === pinId);
    if (!pin) return { ok: false };

    const hostEl = resolveAnchorElement(pin.anchor);
    if (hostEl) {
      hostEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      return { ok: true, qaModeActive };
    }

    const { pageX, pageY } = resolvePinPagePosition(pin);
    window.scrollTo({
      left: Math.max(0, pageX - window.innerWidth / 2),
      top: Math.max(0, pageY - window.innerHeight / 2),
      behavior: "smooth",
    });
    return { ok: true, qaModeActive };
  }

  function highlightPin(marker) {
    marker.classList.add("qa-pin-highlight");
    window.setTimeout(() => marker.classList.remove("qa-pin-highlight"), 2000);
  }

  function onOverlayClick(e) {
    if (!placingPin) return;
    if (e.target.closest(".qa-comment-modal, .qa-pin-popover, .qa-pin-anchor")) return;

    e.preventDefault();
    e.stopPropagation();

    const target = getElementAtPoint(e.clientX, e.clientY);
    if (!target) return;

    const pageX = e.pageX;
    const pageY = e.pageY;
    const anchor = buildAnchor(target, e.clientX, e.clientY);

    placingPin = false;
    rootEl.classList.remove(PLACING_CLASS);
    showCommentModal({ pageX, pageY, anchor });
  }

  async function setQaMode(active) {
    qaModeActive = active;
    const root = ensureRoot();

    if (active) {
      root.classList.add("qa-mode-active");
      root.addEventListener("click", onOverlayClick, true);
      await renderPins();
    } else {
      root.classList.remove("qa-mode-active", PLACING_CLASS);
      root.removeEventListener("click", onOverlayClick, true);
      closeModal();
      closePopover();
      removeAllPinMarkers();
    }
  }

  function startPlacingPin() {
    if (!qaModeActive) return;
    placingPin = true;
    ensureRoot().classList.add(PLACING_CLASS);
    resizePlacingOverlay();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case "SET_QA_MODE":
        setQaMode(message.active).then(() => {
          sendResponse({ ok: true, active: qaModeActive });
        });
        return true;
      case "START_PLACING_PIN":
        if (qaModeActive) startPlacingPin();
        sendResponse({ ok: true, placing: placingPin });
        return false;
      case "GET_QA_STATE":
        sendResponse({ active: qaModeActive, placing: placingPin, url: currentUrl });
        return false;
      case "REFRESH_PINS":
        if (qaModeActive) renderPins();
        sendResponse({ ok: true });
        return false;
      case "SCROLL_TO_PIN":
        scrollToPin(message.pinId).then(sendResponse);
        return true;
      default:
        return false;
    }
  });
})();
