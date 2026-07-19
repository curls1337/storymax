const express = require('express');
const { generateVideo, getStoryboardVideos, deleteVideo, regenerateVideoMarketingCopy, generateAllVideos, mergeStoryboardVideos } = require('../controllers/videoController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticateToken);

router.post('/generate', generateVideo);
router.post('/generate-all', generateAllVideos);
router.get('/storyboard/:storyboardId', getStoryboardVideos);
router.delete('/:id', deleteVideo);
router.post('/:id/marketing-copy', regenerateVideoMarketingCopy);
router.post('/storyboard/:storyboardId/merge', mergeStoryboardVideos);

module.exports = router;
