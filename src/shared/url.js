/**
 * Normalize a page URL for pin storage by stripping query params and hash.
 * e.g. https://example.com/page?prc=foo#section → https://example.com/page
 */
function normalizePageUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url.split("?")[0].split("#")[0];
  }
}

/**
 * Extract a Notion database ID from a pasted URL or raw ID string.
 */
function normalizeDatabaseId(input) {
  if (!input) return "";

  const trimmed = input.trim();
  const uuidMatch = trimmed.match(
    /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i
  );

  if (uuidMatch) return uuidMatch[1].replace(/-/g, "");

  const hexOnly = trimmed.replace(/[^0-9a-f]/gi, "");
  if (hexOnly.length >= 32) return hexOnly.slice(0, 32);

  return trimmed.replace(/-/g, "");
}

function normalizeNotionPageId(pageId) {
  if (!pageId) return "";
  const match = pageId.match(
    /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i
  );
  if (!match) return pageId;
  const hex = match[1].replace(/-/g, "");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
