const NOTION_VERSION = "2022-06-28";
const NOTION_FILE_VERSION = "2026-03-11";
const API_BASE = "https://api.notion.com/v1";

// Property names must match your Notion database exactly.
const PROPS = {
  title: "Title",
  description: "Description",
  reporter: "Reporter",
  commentLegacy: "Comment",
  pinId: "Pin ID",
  pageUrl: "Page URL",
  anchor: "Anchor",
  number: "Number",
  screenshot: "Screenshot",
};

async function notionFetch(token, path, options = {}, version = NOTION_VERSION) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": version,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Notion API ${response.status}: ${body}`);
  }

  return response.json();
}

function getTitle(prop) {
  return prop?.title?.map((t) => t.plain_text).join("") || "";
}

function getRichText(prop) {
  return prop?.rich_text?.map((t) => t.plain_text).join("") || "";
}

function getNumber(prop) {
  return prop?.number ?? null;
}

function richText(value) {
  return { rich_text: [{ text: { content: String(value).slice(0, 2000) } }] };
}

function titleText(value) {
  return { title: [{ text: { content: String(value).slice(0, 2000) } }] };
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function uploadDataUrlAsFile(token, dataUrl, filename) {
  const blob = dataUrlToBlob(dataUrl);
  const contentType = blob.type || "image/jpeg";

  const upload = await notionFetch(
    token,
    "/file_uploads",
    {
      method: "POST",
      body: JSON.stringify({ filename, content_type: contentType }),
    },
    NOTION_FILE_VERSION
  );

  const form = new FormData();
  form.append("file", blob, filename);

  const sendUrl = upload.upload_url || `${API_BASE}/file_uploads/${upload.id}/send`;
  const sendResponse = await fetch(sendUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_FILE_VERSION,
    },
    body: form,
  });

  if (!sendResponse.ok) {
    const body = await sendResponse.text();
    throw new Error(`Notion file upload ${sendResponse.status}: ${body}`);
  }

  const result = await sendResponse.json();
  if (result.status !== "uploaded") {
    throw new Error(`Notion file upload did not complete (status: ${result.status})`);
  }

  return upload.id;
}

function screenshotFileRef(fileUploadId, pin) {
  return {
    name: `qa-pin-${pin.number}.jpg`,
    type: "file_upload",
    file_upload: { id: fileUploadId },
  };
}

function splitTextChunks(text, maxLen = 2000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

function buildDescriptionBlocks(description) {
  const trimmed = description?.trim();
  if (!trimmed) return [];

  return [
    {
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "Description" } }],
      },
    },
    ...splitTextChunks(trimmed).map((chunk) => ({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: chunk } }],
      },
    })),
  ];
}

function buildScreenshotBlocks(fileUploadId) {
  return [
    {
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "Screenshot" } }],
      },
    },
    {
      object: "block",
      type: "image",
      image: {
        caption: [],
        type: "file_upload",
        file_upload: { id: fileUploadId },
      },
    },
  ];
}

async function appendBlocksToPage(token, pageId, children) {
  if (!children.length) return;

  await notionFetch(
    token,
    `/blocks/${normalizeNotionPageId(pageId)}/children`,
    {
      method: "PATCH",
      body: JSON.stringify({ children }),
    },
    NOTION_FILE_VERSION
  );
}

async function syncPageBodyContent(token, pageId, pin, { fileUploadId = null } = {}) {
  const normalized = normalizePinFields(pin);
  const children = [];

  if (normalized.description?.trim() && !pin.notionPageBodySynced) {
    children.push(...buildDescriptionBlocks(normalized.description));
  }

  if (fileUploadId && !pin.notionScreenshotSynced) {
    children.push(...buildScreenshotBlocks(fileUploadId));
  }

  await appendBlocksToPage(token, pageId, children);

  const addedDescription = Boolean(normalized.description?.trim() && !pin.notionPageBodySynced);

  return {
    pageBodySynced: pin.notionPageBodySynced || addedDescription,
    screenshotSynced: Boolean(fileUploadId),
  };
}

async function attachScreenshotToNotionPage(token, pageId, pin, fileUploadId) {
  const fileRef = screenshotFileRef(fileUploadId, pin);
  const normalizedPageId = normalizeNotionPageId(pageId);

  await notionFetch(token, `/pages/${normalizedPageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [PROPS.screenshot]: { files: [fileRef] },
      },
    }),
  });

  await syncPageBodyContent(token, pageId, pin, { fileUploadId });
}

async function syncScreenshotToNotion(token, pageId, pin) {
  if (!pin.screenshot || pin.notionScreenshotSynced) return false;

  const fileUploadId = await uploadDataUrlAsFile(
    token,
    pin.screenshot,
    `qa-pin-${pin.number}.jpg`
  );
  await attachScreenshotToNotionPage(token, pageId, pin, fileUploadId);
  return true;
}

async function getNotionConfig() {
  const stored = await chrome.storage.sync.get(["notionToken", "notionDatabaseId"]);
  const notionToken = stored.notionToken?.trim();
  const notionDatabaseId = normalizeDatabaseId(stored.notionDatabaseId || "");
  return {
    notionToken,
    notionDatabaseId,
    configured: Boolean(notionToken && notionDatabaseId),
  };
}

async function testConnection(token, databaseId) {
  const db = await notionFetch(token, `/databases/${normalizeDatabaseId(databaseId)}`);
  return { ok: true, title: db.title?.map((t) => t.plain_text).join("") || "Database" };
}

function notionPageToPin(page) {
  const anchorRaw = getRichText(page.properties[PROPS.anchor]);
  let anchor = null;
  try {
    anchor = anchorRaw ? JSON.parse(anchorRaw) : null;
  } catch {
    anchor = null;
  }

  const title =
    getTitle(page.properties[PROPS.title]) ||
    getTitle(page.properties[PROPS.commentLegacy]) ||
    "";

  return normalizePinFields({
    id: getRichText(page.properties[PROPS.pinId]),
    notionPageId: page.id,
    number: getNumber(page.properties[PROPS.number]) ?? 1,
    title,
    description: getRichText(page.properties[PROPS.description]),
    reporter: getRichText(page.properties[PROPS.reporter]),
    anchor,
    pageX: 0,
    pageY: 0,
    createdAt: page.created_time,
    updatedAt: page.last_edited_time,
    syncStatus: "synced",
    notionScreenshotSynced: Boolean(page.properties[PROPS.screenshot]?.files?.length),
    notionPageBodySynced: Boolean(
      getRichText(page.properties[PROPS.description]) ||
        getTitle(page.properties[PROPS.title])
    ),
  });
}

async function queryPinsForUrl(token, databaseId, url) {
  const pages = [];
  let cursor;
  const dbId = normalizeDatabaseId(databaseId);

  do {
    const body = {
      filter: {
        property: PROPS.pageUrl,
        url: { equals: url },
      },
    };
    if (cursor) body.start_cursor = cursor;

    const result = await notionFetch(token, `/databases/${dbId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    pages.push(...result.results);
    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);

  return pages.map(notionPageToPin).filter((pin) => pin.id);
}

async function createNotionPage(token, databaseId, url, pin) {
  const normalized = normalizePinFields(pin);
  const page = await notionFetch(token, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: normalizeDatabaseId(databaseId) },
      properties: {
        [PROPS.title]: titleText(normalized.title),
        [PROPS.description]: richText(normalized.description),
        [PROPS.reporter]: richText(normalized.reporter),
        [PROPS.pinId]: richText(normalized.id),
        [PROPS.pageUrl]: { url },
        [PROPS.anchor]: richText(JSON.stringify(normalized.anchor || null)),
        [PROPS.number]: { number: normalized.number },
      },
    }),
  });
  return page.id;
}

async function updateNotionPage(token, pin) {
  const normalized = normalizePinFields(pin);
  await notionFetch(token, `/pages/${normalizeNotionPageId(pin.notionPageId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [PROPS.title]: titleText(normalized.title),
        [PROPS.description]: richText(normalized.description),
        [PROPS.reporter]: richText(normalized.reporter),
        [PROPS.anchor]: richText(JSON.stringify(normalized.anchor || null)),
        [PROPS.number]: { number: normalized.number },
      },
    }),
  });
}

async function archiveNotionPage(token, notionPageId) {
  await notionFetch(token, `/pages/${normalizeNotionPageId(notionPageId)}`, {
    method: "PATCH",
    body: JSON.stringify({ archived: true }),
  });
}
