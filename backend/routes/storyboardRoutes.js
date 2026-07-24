const express = require('express');
const { getUserStoryboards, generateStoryboard, deleteStoryboard, bulkDeleteStoryboards, getActiveKeys, getTaskStatus, scrapeProductUrl, getActiveTasksDebug, downloadProxy, regenerateStoryboardPage, generateRefImage } = require('../controllers/storyboardController');
const { regenerateStoryboardMarketingCopy } = require('../controllers/videoController');
const { authenticateToken, requireAdmin, authenticateTokenAllowQuery } = require('../middleware/authMiddleware');

const router = express.Router();

// /download is opened via browser navigation / window.open on mobile, which cannot
// send an Authorization header — so it authenticates via ?token= (or the header).
// A valid signed JWT is still required, so it is NOT an open proxy. Mounted BEFORE
// the global header-only auth so the query token is honored for this route only.
router.get('/download', authenticateTokenAllowQuery, downloadProxy);

// C1: every route below requires authentication. Previously /debug-tasks and
// /download were mounted BEFORE the auth middleware, leaking task state and
// acting as an open download proxy to any unauthenticated caller.
router.use(authenticateToken);

const { exportToGoogleSheets, exportToCSV } = require('../controllers/googleController');

router.get('/', getUserStoryboards);
router.get('/keys', getActiveKeys);
router.get('/tasks/:taskId', getTaskStatus);
router.get('/debug-tasks', requireAdmin, getActiveTasksDebug); // admin-only
router.post('/generate', generateStoryboard);
router.post('/generate-ref-image', generateRefImage);
router.post('/scrape', scrapeProductUrl);
router.post('/export-google-sheets', exportToGoogleSheets);
router.post('/export-csv', exportToCSV);
router.post('/bulk-delete', bulkDeleteStoryboards);
router.post('/:id/regenerate-page', regenerateStoryboardPage);
router.post('/:id/scenes/:sceneIdx/marketing-copy', regenerateStoryboardMarketingCopy);
router.delete('/:id', deleteStoryboard);

module.exports = router;
