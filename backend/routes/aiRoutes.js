const express = require('express');
const { writePrompt } = require('../controllers/aiController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticateToken);
router.post('/write-prompt', writePrompt);

module.exports = router;
