console.log("Running on", window.location.href)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('reached2')
  if (message.action === "updateColor") {
    updateFavicon(message.color);
    sendResponse({ status: "Color updated" });
  }
});

function updateFavicon(color) {
  console.log('reached3')
  // Remove existing favicon
  let link = document.querySelector("link[rel*='icon']");
  if (link) {
    link.remove();
  }

  // Create new favicon with the specified color
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 16, 16);

  // Add the new favicon
  const faviconUrl = canvas.toDataURL("image/png");
  link = document.createElement("link");
  link.type = "image/png";
  link.rel = "icon";
  link.href = faviconUrl;
  document.head.appendChild(link);
}