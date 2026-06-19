const form = document.getElementById("settings-form");
const tokenInput = document.getElementById("notion-token");
const databaseInput = document.getElementById("notion-database-id");
const testBtn = document.getElementById("test-btn");
const statusEl = document.getElementById("status");

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

async function loadSettings() {
  const { notionToken, notionDatabaseId } = await chrome.storage.sync.get([
    "notionToken",
    "notionDatabaseId",
  ]);
  if (notionToken) tokenInput.value = notionToken;
  if (notionDatabaseId) databaseInput.value = notionDatabaseId;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const notionDatabaseId = normalizeDatabaseId(databaseInput.value);
  await chrome.storage.sync.set({
    notionToken: tokenInput.value.trim(),
    notionDatabaseId,
  });
  databaseInput.value = notionDatabaseId;
  setStatus("Settings saved.", "ok");
});

testBtn.addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  const databaseId = normalizeDatabaseId(databaseInput.value);

  if (!token || !databaseId) {
    setStatus("Enter both the integration token and database ID.", "error");
    return;
  }

  setStatus("Testing connection…");

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(parseNotionError(response.status, body));
    }

    const db = await response.json();
    const title = db.title?.map((t) => t.plain_text).join("") || "Database";
    setStatus(`Connected to “${title}”.`, "ok");
  } catch (err) {
    setStatus(err.message || "Connection failed.", "error");
  }
});

function parseNotionError(status, body) {
  try {
    const data = JSON.parse(body);
    if (data.message) return `Notion API ${status}: ${data.message}`;
  } catch {
    // use raw body below
  }
  return `Notion API ${status}: ${body}`;
}

loadSettings();
