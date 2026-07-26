// Listen for tab updates (e.g., page load, tab switch)
chrome.tabs.onActivated.addListener((activeInfo) => {
  checkMemory(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    checkMemory(tabId);
  }
});

// Check memory usage periodically (every 5 seconds)
setInterval(() => {
  console.log('reached1')
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      checkMemory(tabs[0].id);
    }
  });
}, 30000);

function checkMemory(tabId) {
  console.log('reached6', {tabId})
  // let once = false;
  chrome.processes.onUpdatedWithMemory.addListener((processes) => {
  // if(once) { return }
  // else {
  // once = true;
    for (let pid in processes) {
      const process = processes[pid];
      if (process.type === "renderer" && process.tasks[0].tabId === tabId) {
        // console.log({
        //   len: Object.keys(processes).length,
        //   cpu: process.cpu * 10,
        //   heapAllocated: process.jsMemoryAllocated / 1024 / 1024,
        //   heapUsed: process.jsMemoryUsed / 1024 / 1024
        // })
        const memory = process.privateMemory / 1024 / 1024; // Convert bytes to MB
        // const mem2 = (process.jsMemoryAllocated / 1024 / 1024); // Convert bytes to MB
        const color = getColorForMemory(memory);
        // console.log({tabId, color, p: process.privateMemory, memory, mem2})
        sendColorToTab(tabId, color);
        break; // Stop after finding the tab’s process
      }
    }
  // }
  });
}

function getColorForMemory(memory) {
  console.log('reached7', memory)
  if (memory < 50) return "green";    // Low usage: < 50MB
  if (memory < 1000) return "yellow";  // Medium: 50-200MB
  return "red";                       // High: > 200MB
}

function sendColorToTab(tabId, color) {
  console.log('reached8')
  chrome.tabs.sendMessage(tabId, { action: "updateColor", color: color }, (response) => {
    if (chrome.runtime.lastError) {
      console.log("Error sending message:", chrome.runtime.lastError);
    }
  });
}