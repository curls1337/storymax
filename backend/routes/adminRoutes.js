const express = require('express');
const { 
  getAllUsers, createUser, updateUser, deleteUser,
  getAllKeys, addKey, addKeysBulk, toggleKeyStatus, deleteKey, deleteKeysBulk,
  getAiSettings, updateAiSettings, testAiSettings,
  getStorageFiles, deleteStorageFile
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
router.post('/keys/bulk-delete', deleteKeysBulk);
router.put('/keys/:id/toggle', toggleKeyStatus);
router.delete('/keys/:id', deleteKey);

const { getGoogleSettings, saveGoogleSettings } = require('../controllers/googleController');

// AI Settings Management
router.get('/ai-settings', getAiSettings);
router.put('/ai-settings', updateAiSettings);
router.post('/ai-settings/test', testAiSettings);

// Google Drive & Sheets Settings
router.get('/google-settings', getGoogleSettings);
router.put('/google-settings', saveGoogleSettings);

// File Manager / Storage Management
router.get('/files', getStorageFiles);
router.delete('/files', deleteStorageFile);

module.exports = router;
