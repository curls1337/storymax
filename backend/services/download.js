// File download helper (local copy or http/https fetch).
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    // If it's a relative path on the local server, copy it directly
    if (url.startsWith('/uploads/')) {
      const relativeFilename = url.replace(/^\/?uploads\//, '');
      const srcPath = path.join(uploadsDir, relativeFilename);
      try {
        fs.copyFileSync(srcPath, destPath);
        resolve();
      } catch (err) {
        reject(err);
      }
      return;
    }

    const file = fs.createWriteStream(destPath);
    let urlParsed;
    try {
      urlParsed = new URL(url);
    } catch (e) {
      reject(new Error('Invalid URL: ' + url));
      return;
    }

    const options = {
      hostname: urlParsed.hostname,
      path: urlParsed.pathname + urlParsed.search,
      headers: {
        'User-Agent': UA
      },
      timeout: 15000 // 15s timeout
    };

    const client = url.startsWith('https') ? https : http;
    const req = client.get(options, (response) => {
      // Handle redirects (e.g. status code 301, 302)
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.on('close', () => {
          fs.unlink(destPath, () => {});
          // Recurse to follow redirect URL
          let redirectUrl = response.headers.location;
          if (!redirectUrl.startsWith('http')) {
            const origin = urlParsed.origin;
            redirectUrl = origin + (redirectUrl.startsWith('/') ? '' : '/') + redirectUrl;
          }
          downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
        });
        file.close();
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        reject(new Error(`Failed to download image. Status code: ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      file.close();
      fs.unlink(destPath, () => {});
      reject(new Error('Image download timed out.'));
    });

    req.on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

module.exports = { downloadFile };
