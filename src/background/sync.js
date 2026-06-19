async function pushPinToNotion(url, pin) {
  const config = await getNotionConfig();
  if (!config.configured) return { ok: false, reason: "not_configured" };

  const pageKey = normalizePageUrl(url);

  try {
    if (pin.notionPageId) {
      await updateNotionPage(config.notionToken, pin);
    } else {
      const notionPageId = await createNotionPage(
        config.notionToken,
        config.notionDatabaseId,
        pageKey,
        pin
      );
      pin.notionPageId = notionPageId;
    }

    let notionScreenshotSynced = pin.notionScreenshotSynced;
    let notionPageBodySynced = pin.notionPageBodySynced;
    let syncStatus = "synced";

    if (pin.screenshot && !notionScreenshotSynced) {
      try {
        notionScreenshotSynced = await syncScreenshotToNotion(
          config.notionToken,
          pin.notionPageId,
          pin
        );
        if (normalizePinFields(pin).description?.trim()) {
          notionPageBodySynced = true;
        }
      } catch (err) {
        syncStatus = "screenshot_error";
        console.warn("Screenshot upload failed:", err);
      }
    } else if (
      normalizePinFields(pin).description?.trim() &&
      !notionPageBodySynced
    ) {
      try {
        const result = await syncPageBodyContent(
          config.notionToken,
          pin.notionPageId,
          pin
        );
        notionPageBodySynced = result.pageBodySynced;
      } catch (err) {
        console.warn("Page body sync failed:", err);
      }
    }

    await updatePin(pageKey, pin.id, {
      notionPageId: pin.notionPageId,
      syncStatus,
      updatedAt: new Date().toISOString(),
      ...(notionScreenshotSynced ? { notionScreenshotSynced: true } : {}),
      ...(notionPageBodySynced ? { notionPageBodySynced: true } : {}),
    });

    return { ok: true, notionPageId: pin.notionPageId };
  } catch (err) {
    await updatePin(pageKey, pin.id, { syncStatus: "error" }).catch(() => {});
    return { ok: false, error: err.message };
  }
}

async function archivePinInNotion(pin) {
  const config = await getNotionConfig();
  if (!config.configured || !pin.notionPageId) return { ok: false, reason: "not_configured" };

  try {
    await archiveNotionPage(config.notionToken, pin.notionPageId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function mergePinLocalAndRemote(local, remote) {
  const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
  const remoteTime = new Date(remote.updatedAt || remote.createdAt || 0).getTime();

  if (remoteTime >= localTime) {
    return {
      ...local,
      ...remote,
      title: remote.title || local.title,
      description: remote.description || local.description,
      reporter: remote.reporter || local.reporter,
      screenshot: local.screenshot || remote.screenshot,
      notionScreenshotSynced:
        local.notionScreenshotSynced || remote.notionScreenshotSynced,
      notionPageBodySynced: local.notionPageBodySynced || remote.notionPageBodySynced,
      pageX: local.pageX || remote.pageX,
      pageY: local.pageY || remote.pageY,
      anchor: remote.anchor || local.anchor,
    };
  }

  return local;
}

async function pullFromNotion(url) {
  const config = await getNotionConfig();
  if (!config.configured) return { ok: false, reason: "not_configured" };

  const pageKey = normalizePageUrl(url);

  try {
    const remotePins = await queryPinsForUrl(
      config.notionToken,
      config.notionDatabaseId,
      pageKey
    );
    const localPins = await getPinsForUrl(pageKey);
    const remoteById = new Map(remotePins.map((p) => [p.id, p]));
    const merged = [];
    const toPush = [];

    for (const local of localPins) {
      const remote = remoteById.get(local.id);
      if (remote) {
        merged.push(mergePinLocalAndRemote(local, remote));
        remoteById.delete(local.id);
      } else if (local.notionPageId) {
        // Deleted in Notion — drop locally.
      } else {
        merged.push(local);
        toPush.push(local);
      }
    }

    for (const remote of remoteById.values()) {
      merged.push(remote);
    }

    merged.sort((a, b) => a.number - b.number);

    const all = await getAllPins();
    if (merged.length === 0) {
      delete all[pageKey];
    } else {
      all[pageKey] = merged;
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: all });

    for (const pin of toPush) {
      pushPinToNotion(pageKey, pin);
    }

    for (const local of localPins) {
      const mergedPin = merged.find((p) => p.id === local.id);
      if (!mergedPin) continue;
      const localTime = new Date(local.updatedAt || local.createdAt || 0).getTime();
      const mergedTime = new Date(mergedPin.updatedAt || mergedPin.createdAt || 0).getTime();
      if (localTime > mergedTime && mergedPin.id === local.id) {
        pushPinToNotion(pageKey, local);
      }
    }

    return { ok: true, count: merged.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
