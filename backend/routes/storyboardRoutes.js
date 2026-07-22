const express = require('express');
const { getUserStoryboards, generateStoryboard, deleteStoryboard, getActiveKeys, getTaskStatus, scrapeProductUrl, getActiveTasksDebug, downloadProxy, regenerateStoryboardPage } = require('../controllers/storyboardController');
const { regenerateStoryboardMarketingCopy } = require('../controllers/videoController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

// C1: every route below requires authentication. Previously /debug-tasks and
// /download were mounted BEFORE the auth middleware, leaking task state and
// acting as an open download proxy to any unauthenticated caller.
router.use(authenticateToken);

router.get('/', getUserStoryboards);
router.get('/keys', getActiveKeys);
router.get('/tasks/:taskId', getTaskStatus);
router.get('/download', downloadProxy);
router.get('/debug-tasks', requireAdmin, getActiveTasksDebug); // admin-only
router.post('/generate', generateStoryboard);
router.post('/scrape', scrapeProductUrl);
router.post('/:id/regenerate-page', regenerateStoryboardPage);
router.post('/:id/scenes/:sceneIdx/marketing-copy', regenerateStoryboardMarketingCopy);
router.delete('/:id', deleteStoryboard);

module.exports = router;
