const express = require('express');
const {
  getManualVideoModels,
  submitManualVideoJob,
  listManualVideoJobs,
  deleteManualVideoJob
} = require('../controllers/manualVideoController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();
router.use(authenticateToken);

router.get('/models', getManualVideoModels);
router.post('/generate', submitManualVideoJob);
router.get('/jobs', listManualVideoJobs);
router.delete('/jobs/:id', deleteManualVideoJob);

module.exports = router;
