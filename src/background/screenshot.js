const CROP_WIDTH = 480;
const CROP_HEIGHT = 360;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function capturePinScreenshot(windowId, viewport) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "jpeg",
    quality: 85,
  });

  const response = await fetch(dataUrl);
  const bitmap = await createImageBitmap(await response.blob());

  const dpr = viewport.devicePixelRatio || 1;
  const cropW = Math.round(CROP_WIDTH * dpr);
  const cropH = Math.round(CROP_HEIGHT * dpr);

  const centerX = viewport.viewportX * dpr;
  const centerY = viewport.viewportY * dpr;

  let sx = Math.round(centerX - cropW / 2);
  let sy = Math.round(centerY - cropH / 2);

  sx = Math.max(0, Math.min(bitmap.width - cropW, sx));
  sy = Math.max(0, Math.min(bitmap.height - cropH, sy));

  const actualW = Math.min(cropW, bitmap.width - sx);
  const actualH = Math.min(cropH, bitmap.height - sy);

  const canvas = new OffscreenCanvas(actualW, actualH);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, actualW, actualH, 0, 0, actualW, actualH);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  return blobToDataUrl(blob);
}
