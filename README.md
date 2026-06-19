# Page QA Pins — Chrome Extension

Pin comments on any web page for QA review. Each pin saves a cropped screenshot and syncs comments to Notion.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `chrome-qa-extension` folder

## Usage

1. Visit any web page
2. Click the extension icon
3. Turn on **QA mode**
4. Click **Add pin to page**, then click anywhere on the page
5. Enter your comment and save

Pins appear as numbered markers. Click a marker to view, edit, or delete a comment.

## Project structure

```
chrome-qa-extension/
├── manifest.json
├── icons/
├── src/
│   ├── background/service-worker.js   # Storage & messaging
│   ├── content/pins.js                # Pin overlay on pages
│   ├── content/overlay.css
│   └── popup/                         # Extension popup UI
```

## Next steps

- Notion API integration
- Optional Slack notifications
