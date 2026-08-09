// Content script running on freebeat.ai pages
console.log('🎬 [Storymax Bridge] Content Script Loaded on freebeat.ai');

// Listen for messages from background script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'PING') {
    sendResponse({ status: 'OK', url: window.location.href });
    return true;
  }

  if (request.action === 'GENERATE_SEEDANCE_2_5') {
    const { prompt, imageUrl, duration, resolution } = request.data;
    console.log('🚀 [Storymax Bridge] Received generation job:', request.data);

    // Call the native web fetch using browser's active cookies and session
    executeWebGeneration({ prompt, imageUrl, duration, resolution })
      .then(res => sendResponse({ success: true, result: res }))
      .catch(err => sendResponse({ success: false, error: err.message }));

    return true; // Async response
  }
});

async function executeWebGeneration({ prompt, imageUrl, duration = 30, resolution = '720p' }) {
  // Grab authToken from localStorage or cookies if available
  const authToken = localStorage.getItem('authToken') || getCookie('authToken');
  
  const payload = {
    items: [{
      generationType: imageUrl ? 1 : 0,
      model: 'seedance-2.5',
      modelId: 134,
      duration: duration,
      resolution: resolution,
      style: '',
      images: imageUrl ? [imageUrl] : [],
      prompt: prompt,
      watermark: 0,
      aspectRatio: '16:9',
      extraParams: {}
    }]
  };

  const headers = {
    'Content-Type': 'application/json',
    'accept': '*/*',
    'fb-language': 'en',
    'x-platform-type': 'web'
  };

  if (authToken) {
    headers['authorization'] = authToken;
    headers['token'] = authToken;
    headers['udt'] = authToken;
  }

  const response = await fetch('/api/proxy/v1/ai/web/createVideoBatch', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload)
  });

  const json = await response.json();
  console.log('📥 [Storymax Bridge] Web API Response:', json);
  return json;
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}
