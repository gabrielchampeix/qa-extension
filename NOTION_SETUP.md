# Notion setup for Page QA Pins

Follow these steps once. Takes about 5 minutes.

## 1. Create the integration (done)

You already created an integration at [notion.so/my-integrations](https://www.notion.so/my-integrations).

Copy the **Internal Integration Secret** (`secret_…`).

## 2. Create the QA database

1. In Notion, create a new page → **Table** → **Full page**.
2. Name the page **QA Comments**.
3. Set up these columns (names must match exactly):

| Column name | Type |
|-------------|------|
| **Title** | Title (rename the default "Name" column, or rename old "Comment" column) |
| **Description** | Text |
| **Reporter** | Text |
| **Pin ID** | Text |
| **Page URL** | URL |
| **Anchor** | Text |
| **Number** | Number |
| **Screenshot** | Files & media |

## 3. Connect the integration to the database

1. Open the **QA Comments** database as a full page.
2. Click **`⋯`** (top right) → **Connections**.
3. Find your integration (e.g. "Page QA Pins") → **Connect**.

Without this step the extension cannot read or write the database.

## 4. Copy the Database ID

Open the database in the browser. The URL looks like:

```
https://www.notion.so/yourname/abc123def4567890abc123def4567890?v=...
                              └──────────── Database ID ────────────┘
```

Copy the 32-character ID (dashes optional).

## 5. Configure the extension

1. Go to `chrome://extensions` → **Page QA Pins** → **Details** → **Extension options**.
2. Paste your **Integration token** and **Database ID**.
3. Click **Test connection** — you should see “Connected to QA Comments”.
4. Click **Save**.

## 6. Try it

1. Visit any website and add a QA pin.
2. Open your Notion database — a new row should appear within a few seconds.
3. Re-open the extension popup on the same page — it pulls the latest rows from Notion.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Test connection fails with 404 | Wrong Database ID |
| Test connection fails with 401 | Wrong or expired token |
| Test connection fails with 403 | Integration not connected to the database (step 3) |
| Property errors | Column names must match exactly: Title, Description, Reporter, Pin ID, Page URL, Anchor, Number, Screenshot |
| Screenshot upload fails | Add a **Files** column named **Screenshot** to your database |

## POC limitations

- Screenshots are uploaded to Notion on pin create (Files column + full image inside the page).
- Sync is pull-on-open + push-on-change, not real-time.
- All comments appear under your integration’s name in Notion.
