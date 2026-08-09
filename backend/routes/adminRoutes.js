const express = require('express');
const { 
  getAllUsers, createUser, updateUser, deleteUser,
  getAllKeys, addKey, addKeysBulk, toggleKeyStatus, deleteKey, deleteKeysBulk,
  getAiSettings, updateAiSettings, testAiSettings,
  getStorageFiles, deleteStorageFile,
  backupDatabase, restoreDatabase, restoreChunkDatabase, getRestoreStatus,
  getMagicaKeys, addMagicaKey, addMagicaKeysBulk, toggleMagicaKey, deleteMagicaKey, deleteMagicaKeysBulk,
  testMagicaConnection, getMagicaBalances, setUserMagicaAccess, setUserHdAccess, setUserSeedanceAccess,
  getSeedanceCookies, addSeedanceCookie, addSeedanceCookiesBulk, toggleSeedanceCookie, deleteSeedanceCookie, deleteSeedanceCookiesBulk, testSeedanceCookieConnection
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

const { getGoogleSettings, saveGoogleSettings, testAutoDriveBackup } = require('../controllers/googleController');

// AI Settings Management
router.get('/ai-settings', getAiSettings);
router.put('/ai-settings', updateAiSettings);
router.post('/ai-settings/test', testAiSettings);

// Google Drive & Sheets Settings
router.get('/google-settings', getGoogleSettings);
router.put('/google-settings', saveGoogleSettings);
router.post('/google-settings/test-backup', testAutoDriveBackup);

// File Manager / Storage Management
router.get('/files', getStorageFiles);
router.delete('/files', deleteStorageFile);

// Database Backup & Restore (server migration)
router.get('/backup', backupDatabase);
router.get('/restore-status', getRestoreStatus);
router.post('/restore', express.raw({ type: '*/*', limit: '1000mb' }), restoreDatabase);
router.post('/restore-chunk', express.raw({ type: '*/*', limit: '50mb' }), restoreChunkDatabase);

// Magica (multi-provider) API key pool + per-user access
router.get('/magica/keys', getMagicaKeys);
router.get('/magica/balances', getMagicaBalances);
router.post('/magica/keys', addMagicaKey);
router.post('/magica/keys/bulk', addMagicaKeysBulk);
router.post('/magica/keys/bulk-delete', deleteMagicaKeysBulk);
router.put('/magica/keys/:id/toggle', toggleMagicaKey);
router.delete('/magica/keys/:id', deleteMagicaKey);
router.post('/magica/test', testMagicaConnection);
router.put('/users/:id/magica-access', setUserMagicaAccess);
router.put('/users/:id/hd-access', setUserHdAccess);
router.put('/users/:id/seedance-access', setUserSeedanceAccess);

// SeedDance 2.5 Web Cookies Pool
router.get('/seedance-cookies', getSeedanceCookies);
router.post('/seedance-cookies', addSeedanceCookie);
router.post('/seedance-cookies/bulk', addSeedanceCookiesBulk);
router.post('/seedance-cookies/bulk-delete', deleteSeedanceCookiesBulk);
router.put('/seedance-cookies/:id/toggle', toggleSeedanceCookie);
router.delete('/seedance-cookies/:id', deleteSeedanceCookie);
router.post('/seedance-cookies/test', testSeedanceCookieConnection);

module.exports = router;
