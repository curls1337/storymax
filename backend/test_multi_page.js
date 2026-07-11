const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const http = require('http');

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    let urlParsed = new URL(url);
    const options = {
      hostname: urlParsed.hostname,
      path: urlParsed.pathname + urlParsed.search,
      headers: { 'User-Agent': UA },
      timeout: 15000
    };
    const client = url.startsWith('https') ? https : http;
    const req = client.get(options, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlink(destPath, () => {});
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error(`Failed download. Status: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function runFreebeat(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const winPath = 'C:\\Users\\mnkpr\\AppData\\Roaming\\npm\\node_modules\\freebeat-cli\\dist\\index.js';
    const spawnArgs = [
      winPath,
      '--api-key', apiKey,
      'image', 'generate',
      '--model', '80',
      '--prompt', prompt,
      '--count', '1',
      '--json'
    ];
    const child = spawn('node', spawnArgs);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => stdout += d.toString());
    child.stderr.on('data', (d) => stderr += d.toString());
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `CLI failed with code ${code}`));
      try {
        const json = JSON.parse(stdout.trim());
        const batchId = json.data?.batchId || json.batchId;
        const serialNo = json.data?.items?.[0]?.serialNo || (json.items && json.items[0] && json.items[0].serialNo);
        resolve({ batchId, serialNo });
      } catch (e) {
        reject(new Error(`Failed to parse CLI output: ${stdout}`));
      }
    });
  });
}

function pollStatus(apiKey, batchId, serialNo) {
  return new Promise((resolve, reject) => {
    let pollCount = 0;
    const interval = setInterval(() => {
      pollCount++;
      const winPath = 'C:\\Users\\mnkpr\\AppData\\Roaming\\npm\\node_modules\\freebeat-cli\\dist\\index.js';
      const spawnArgs = [
        winPath,
        '--api-key', apiKey,
        'task', 'status',
        batchId,
        '--json'
      ];
      if (serialNo) spawnArgs.push('--serial-no', serialNo);
      
      const child = spawn('node', spawnArgs);
      let stdout = '';
      child.stdout.on('data', (d) => stdout += d.toString());
      child.on('close', () => {
        try {
          const json = JSON.parse(stdout.trim());
          const dataObj = json.data || json;
          const item = dataObj?.items?.[0] || (dataObj?.results && dataObj?.results[0]);
          if (item) {
            const status = item.status || dataObj.status;
            console.log(`Polling task ${batchId} - Status: ${status} (${pollCount})`);
            if (status === 'SUCCESS') {
              clearInterval(interval);
              const url = item.imageUrl || item.videoUrl || item.url || dataObj.imageUrl || dataObj.url;
              resolve(url);
            } else if (status === 'FAILED' || status === 'ERROR') {
              clearInterval(interval);
              reject(new Error(item.errorMessage || 'Failed rendering on server'));
            }
          }
        } catch (e) {
          // Ignore parsing error for intermediate logs
        }
      });
    }, 15000);
  });
}

async function main() {
  const dbPath = 'E:\\nihese\\backend\\database.sqlite';
  console.log('Loading SQLite DB from:', dbPath);
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  
  const keyRecord = await db.get('SELECT * FROM api_keys WHERE is_active = 1 LIMIT 1');
  if (!keyRecord) {
    console.error('No active API key found!');
    return;
  }
  console.log('Using API key:', keyRecord.label);
  
  const prompts = [
    "A professional 2D anime style lego assembly storyboard sheet, inspired by Makoto Shinkai art style. Page 1 of 4, Scenes 1-6. Starry sky header titled 'STORYBOARD - DIY LEGO SCOOTER' with subtitle '2D ANIME STYLE • DURASI 60 DETIK • PAGE 1 OF 4'. Main body features 6 horizontal rows. Each row has a dark blue pill badge for scene number & time (e.g. '01 0:00 - 0:02.5'), a bold yellow/gold uppercase title, and detailed icons for camera, action and sound cues. On the right side is a beautiful horizontal wide cinematic anime image of assembling lego pieces. Rich aesthetic sunset lighting, highly detailed. --ar 3:4",
    "A professional 2D anime style lego assembly storyboard sheet, inspired by Makoto Shinkai art style. Page 2 of 4, Scenes 7-12. Starry sky header titled 'STORYBOARD - DIY LEGO SCOOTER' with subtitle '2D ANIME STYLE • DURASI 60 DETIK • PAGE 2 OF 4'. Main body features 6 horizontal rows. Each row has a dark blue pill badge for scene number & time (e.g. '07 0:15 - 0:17.5'), a bold yellow/gold uppercase title, and detailed icons for camera, action and sound cues. On the right side is a beautiful horizontal wide cinematic anime image of assembling lego pieces. Rich aesthetic sunset lighting, highly detailed. --ar 3:4",
    "A professional 2D anime style lego assembly storyboard sheet, inspired by Makoto Shinkai art style. Page 3 of 4, Scenes 13-18. Starry sky header titled 'STORYBOARD - DIY LEGO SCOOTER' with subtitle '2D ANIME STYLE • DURASI 60 DETIK • PAGE 3 OF 4'. Main body features 6 horizontal rows. Each row has a dark blue pill badge for scene number & time (e.g. '13 0:30 - 0:32.5'), a bold yellow/gold uppercase title, and detailed icons for camera, action and sound cues. On the right side is a beautiful horizontal wide cinematic anime image of assembling lego pieces. Rich aesthetic sunset lighting, highly detailed. --ar 3:4",
    "A professional 2D anime style lego assembly storyboard sheet, inspired by Makoto Shinkai art style. Page 4 of 4, Scenes 19-24. Starry sky header titled 'STORYBOARD - DIY LEGO SCOOTER' with subtitle '2D ANIME STYLE • DURASI 60 DETIK • PAGE 4 OF 4'. Main body features 6 horizontal rows. Each row has a dark blue pill badge for scene number & time (e.g. '19 0:45 - 0:47.5'), a bold yellow/gold uppercase title, and detailed icons for camera, action and sound cues. On the right side is a beautiful horizontal wide cinematic anime image of assembling lego pieces. Rich aesthetic sunset lighting, highly detailed. --ar 3:4"
  ];
  
  console.log('Triggering sequential generation for all 4 pages...');
  const results = [];
  for (let idx = 0; idx < prompts.length; idx++) {
    const pageNum = idx + 1;
    try {
      console.log(`\nLaunching Page ${pageNum}...`);
      const { batchId, serialNo } = await runFreebeat(keyRecord.key_value, prompts[idx]);
      console.log(`Page ${pageNum} launched successfully. Batch ID: ${batchId}`);
      
      const url = await pollStatus(keyRecord.key_value, batchId, serialNo);
      console.log(`Page ${pageNum} rendering completed! URL: ${url}`);
      
      const dest = path.join(__dirname, `page_${pageNum}.png`);
      await downloadFile(url, dest);
      console.log(`Page ${pageNum} downloaded to: ${dest}`);
      results.push(dest);
    } catch (e) {
      console.error(`Page ${pageNum} failed:`, e.message);
      results.push(null);
    }
  }
  
  console.log('\n--- ALL GENERATIONS COMPLETE ---');
  console.log('Results:', results.filter(r => r !== null));
}

main().catch(console.error);
