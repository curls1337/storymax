const express = require('express');
const { authenticateToken } = require('../middleware/authMiddleware');
const { getDb } = require('../db');
const magicaGen = require('../services/magicaGen');

const router = express.Router();
router.use(authenticateToken);

// Provider-aware catalog for the Generator + Video Studio pickers when a user is on
// Magica: active Magica keys + image/video models with their methods (submodels).
router.get('/catalog', async (req, res) => {
  try {
    const catalog = await magicaGen.getCatalog(getDb());
    res.json(catalog);
  } catch (err) {
    res.status(502).json({ message: 'Gagal mengambil katalog Magica.', error: err.message });
  }
});

module.exports = router;
