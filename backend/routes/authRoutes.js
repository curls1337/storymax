const express = require('express');
const { register, login, getMe, changePassword, setPreferredProvider } = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticateToken, getMe);
router.post('/change-password', authenticateToken, changePassword);
router.put('/preferred-provider', authenticateToken, setPreferredProvider);

module.exports = router;
