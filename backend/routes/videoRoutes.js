const express = require('express');
const { generateVideo, getStoryboardVideos, deleteVideo, regenerateVideoMarketingCopy, generateAllVideos, mergeStoryboardVideos, previewEffectiveVideoPrompt, deleteMergedVideo } = require('../controllers/videoController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticateToken);

router.post('/preview-prompt', previewEffectiveVideoPrompt);
router.post('/generate', generateVideo);
router.post('/generate-all', generateAllVideos);
router.get('/storyboard/:storyboardId', getStoryboardVideos);
router.delete('/:id', deleteVideo);
router.post('/:id/marketing-copy', regenerateVideoMarketingCopy);
router.post('/storyboard/:storyboardId/merge', mergeStoryboardVideos);
router.delete('/storyboard/:storyboardId/merge', deleteMergedVideo);

module.exports = router;
