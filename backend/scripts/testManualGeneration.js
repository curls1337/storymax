const { getDb, initDb } = require('../db');
const scenarioClient = require('../services/scenarioClient');
const fs = require('fs');
const path = require('path');

async function test() {
  await initDb();
  const db = getDb();
  const key = await db.get('SELECT * FROM scenario_api_keys WHERE is_active = 1 LIMIT 1');
  if (!key) return;

  // Create a 1x1 test png base64
  const testPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  console.log('Uploading asset...');
  const assetRes = await scenarioClient.uploadAsset(key.key_value, key.secret_value, testPng, 'test_sample.png');
  const assetId = assetRes?.asset?.id || assetRes?.id;
  console.log('Asset ID:', assetId);

  console.log('\nTesting model_google-omni-flash with referenceImages...');
  try {
    const res1 = await scenarioClient.generateCustom(key.key_value, key.secret_value, 'model_google-omni-flash', {
      prompt: 'a red car drifting',
      duration: 5,
      aspectRatio: '16:9',
      referenceImages: [assetId]
    });
    console.log('Google Omni referenceImages response:', JSON.stringify(res1));
  } catch (e) {
    console.log('Google Omni referenceImages error:', e.message, e.data);
  }

  console.log('\nTesting model_google-omni-flash with image property...');
  try {
    const res2 = await scenarioClient.generateCustom(key.key_value, key.secret_value, 'model_google-omni-flash', {
      prompt: 'a red car drifting',
      duration: 5,
      aspectRatio: '16:9',
      image: assetId
    });
    console.log('Google Omni image response:', JSON.stringify(res2));
  } catch (e) {
    console.log('Google Omni image error:', e.message, e.data);
  }

  console.log('\nTesting model_xai-grok-imagine-video-1-5 with image & referenceImages...');
  try {
    const res3 = await scenarioClient.generateCustom(key.key_value, key.secret_value, 'model_xai-grok-imagine-video-1-5', {
      prompt: 'a red car drifting',
      duration: 5,
      aspectRatio: '16:9',
      image: assetId,
      referenceImages: [assetId]
    });
    console.log('Grok Imagine response:', JSON.stringify(res3));
  } catch (e) {
    console.log('Grok Imagine error:', e.message, e.data);
  }
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
