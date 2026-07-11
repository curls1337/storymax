const express = require('express');
const { 
  getAllUsers, createUser, updateUser, deleteUser,
  getAllKeys, addKey, addKeysBulk, toggleKeyStatus, deleteKey,
  getAiSettings, updateAiSettings, testAiSettings
} = require('../controllers/adminController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

// Apply auth + admin verification to all admin routes
router.use(authenticateToken);
router.use(requireAdmin);

// User CRUD
router.get('/users', getAllUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

// API Keys Management
router.get('/keys', getAllKeys);
router.post('/keys', addKey);
router.post('/keys/bulk', addKeysBulk);
router.put('/keys/:id/toggle', toggleKeyStatus);
router.delete('/keys/:id', deleteKey);

// AI Settings Management
router.get('/ai-settings', getAiSettings);
router.put('/ai-settings', updateAiSettings);
router.post('/ai-settings/test', testAiSettings);

module.exports = router;
