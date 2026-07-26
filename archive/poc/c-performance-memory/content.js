// Run checkMemory immediately and then use a setInterval to re-evaluate every 5 seconds.
checkMemory(); let interval = setInterval(() => { console.log('starting-interval'); checkMemory(); }, 5000);

// https://stackoverflow.com/a/39326553/5283424
function onchange () {
  // Clear interval since someone navigated away from the tab.
  if(document.hidden)       { console.log('left page'); clearInterval(interval); }
  // Run checkMemory immediately and then use a setInterval to re-evaluate every 5 seconds.
  else if(!document.hidden) { console.log('visited page'); checkMemory(); interval = setInterval(() => { console.log('onchange-interval'); checkMemory(); }, 2000) } // Check memory usage periodically (every 5 seconds) }
  else                      { alert('should not be reached, no document was undefined?') }
}

// https://stackoverflow.com/a/39326553/5283424
document.addEventListener("visibilitychange", onchange);

function checkMemory() {
  const { totalJSHeapSize, usedJSHeapSize, jsHeapSizeLimit } = window.performance.memory;

  console.log({
    a_totalJSHeapSize: (totalJSHeapSize/1024/1024),
    b_usedJSHeapSize: (usedJSHeapSize/1024/1024),
    c_jsHeapSizeLimit: (jsHeapSizeLimit/1024/1024),
    d_uppBuffer: (totalJSHeapSize/1024/1024) - (usedJSHeapSize/1024/1024),
    e_bufferLimit: (jsHeapSizeLimit/1024/1024) - (usedJSHeapSize/1024/1024)  
  })
  const memory = totalJSHeapSize / 1024 / 1024; // Convert bytes to MB
  const color = getColorForMemory(memory);
  updateFavicon(color);
}

function getColorForMemory(memory) {
  if (memory < 50) return "green";    // Low usage: < 50MB
  if (memory < 200) return "yellow";  // Medium: 50-200MB
  return "red";                       // High: > 200MB
}

function updateFavicon(color) {
  let link = document.querySelector("link[rel*='icon']");
  let src;
  console.log({link})
  if (link) {
    link.src = src;
    link.remove();
  }

  // Get Favicon
  const img = document.createElement('img');
	  img.src = src ? src : `${window.location.origin}/favicon.ico`;

  // region Create new favicon with the specified color
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");

  setTimeout(async () => {
    try {
      ctx.drawImage(img, 0, 0, 16, 16);
    } catch (error) { 
    /* 
      You dont have an image, so you get nothing. You Lose!
      Good Day Sir!
      https://www.youtube.com/watch?v=fpK36FZmTFY&t=74s

      ... but it will still show a circle around the performance!
    */
    }
	  ctx.strokeStyle = color;
	  ctx.lineWidth = 3; // border width
    // drawSquare(ctx);
    drawCircle(ctx);
  // endregion
    
    // region Add the new favicon
    const faviconUrl = canvas.toDataURL("image/webp", 1.0);
    link = document.createElement("link");
    link.type = "image/webp";
    link.rel = "icon";
    link.href = faviconUrl;
    document.head.appendChild(link);
    // endregion
  }, 300);
}

function drawSquare (ctx) {
  ctx.strokeRect(0,0,16,16)
  return ctx;
}

function drawCircle(ctx) {
  ctx.beginPath();
  ctx.arc(8, 8, 8, 0, Math.PI * 2, true);
  ctx.stroke();
  return ctx;
}