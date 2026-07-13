const express = require('express');
const { getUserStoryboards, generateStoryboard, deleteStoryboard, getActiveKeys, getTaskStatus, scrapeProductUrl, getActiveTasksDebug, downloadProxy } = require('../controllers/storyboardController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/debug-tasks', getActiveTasksDebug);
router.get('/download', downloadProxy);

router.use(authenticateToken);

router.get('/', getUserStoryboards);
router.get('/keys', getActiveKeys);
router.get('/tasks/:taskId', getTaskStatus);
router.post('/generate', generateStoryboard);
router.post('/scrape', scrapeProductUrl);
router.delete('/:id', deleteStoryboard);

module.exports = router;
