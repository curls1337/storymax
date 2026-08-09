document.getElementById('btnGenerate').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  const prompt = document.getElementById('promptInput').value;
  const imageUrl = document.getElementById('imageInput').value;

  statusDiv.innerHTML = '⏳ Menghubungi tab freebeat.ai...';

  // Find active tab on freebeat.ai
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url.includes('freebeat.ai')) {
    statusDiv.innerHTML = '❌ Harap buka & aktifkan tab <strong>freebeat.ai</strong> di Chrome terlebih dahulu!';
    return;
  }

  // Send message to content script
  chrome.tabs.sendMessage(tab.id, {
    action: 'GENERATE_SEEDANCE_2_5',
    data: { prompt, imageUrl }
  }, (response) => {
    if (chrome.runtime.lastError) {
      statusDiv.innerHTML = '❌ Gagal berkomunikasi dengan halaman: ' + chrome.runtime.lastError.message;
      return;
    }

    if (response && response.success) {
      statusDiv.innerHTML = '✅ <strong>Request Berhasil Dikirim!</strong><br><pre>' + JSON.stringify(response.result, null, 2) + '</pre>';
    } else {
      statusDiv.innerHTML = '⚠️ Respon Server:<br><pre>' + JSON.stringify(response ? response.error : 'Unknown', null, 2) + '</pre>';
    }
  });
});
