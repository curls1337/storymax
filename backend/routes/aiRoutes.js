const express = require('express');
const { writePrompt, generateRandomIdea, generateVideoPrompts } = require('../controllers/aiController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticateToken);
router.post('/write-prompt', writePrompt);
router.post('/random-idea', generateRandomIdea);
router.post('/video-prompts', generateVideoPrompts);

module.exports = router;
