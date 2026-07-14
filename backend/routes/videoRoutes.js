const express = require('express');
const { generateVideo, getStoryboardVideos, deleteVideo, regenerateVideoMarketingCopy } = require('../controllers/videoController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticateToken);

router.post('/generate', generateVideo);
router.get('/storyboard/:storyboardId', getStoryboardVideos);
router.delete('/:id', deleteVideo);
router.post('/:id/marketing-copy', regenerateVideoMarketingCopy);

module.exports = router;
