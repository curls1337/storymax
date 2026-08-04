const express = require('express');
const {
  getUserCharacters,
  getCharacterById,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  generateCharacterAI,
  generateCharacterSheetImage,
  duplicateCharacter
} = require('../controllers/characterController');
const { authenticateToken } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authenticateToken);

router.get('/', getUserCharacters);
router.get('/:id', getCharacterById);
router.post('/', createCharacter);
router.post('/generate-ai', generateCharacterAI);
router.post('/generate-sheet-image', generateCharacterSheetImage);
router.post('/:id/duplicate', duplicateCharacter);
router.put('/:id', updateCharacter);
router.delete('/:id', deleteCharacter);

module.exports = router;
