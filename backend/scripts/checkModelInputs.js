const { getDb, initDb } = require('../db');
const scenarioClient = require('../services/scenarioClient');

async function check() {
  await initDb();
  const db = getDb();
  const key = await db.get('SELECT * FROM scenario_api_keys WHERE is_active = 1 LIMIT 1');
  if (!key) return;

  const res = await scenarioClient.getPublicModels(key.key_value, key.secret_value, { pageSize: 100 });
  const models = res?.models || [];
  console.log(`Found ${models.length} public models.`);
  
  const targetIds = [
    'model_google-omni-flash',
    'model_bytedance-seedance-2-0',
    'model_kling-v3-i2v-pro',
    'model_wan-2-7-i2v',
    'model_xai-grok-imagine-video-1-5',
    'model_runway-aleph-2'
  ];

  for (const tid of targetIds) {
    const found = models.find(m => m.id === tid);
    if (found) {
      console.log(`\n=================== ${found.name} (${found.id}) ===================`);
      console.log(JSON.stringify(found, null, 2));
    }
  }
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
