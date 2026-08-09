const express = require('express');
const { getActiveSeedanceCookies, createSeedanceVideo, getSeedanceHistory, checkSeedanceTaskStatus, getSeedanceVideoList, getSeedanceCookieCreditInfo } = require('../controllers/seedanceController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticateToken);

router.get('/cookies', getActiveSeedanceCookies);
router.post('/create', createSeedanceVideo);
router.get('/history', getSeedanceHistory);
router.post('/check-status', checkSeedanceTaskStatus);
router.post('/list', getSeedanceVideoList);
router.get('/list', getSeedanceVideoList);
router.post('/credit-info', getSeedanceCookieCreditInfo);
router.get('/credit-info', getSeedanceCookieCreditInfo);

module.exports = router;
