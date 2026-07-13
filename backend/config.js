const path = require('path');

// Resolve the uploads directory path, defaulting to local public/uploads
const uploadsDir = process.env.UPLOADS_DIR 
  ? path.resolve(process.env.UPLOADS_DIR) 
  : path.resolve(__dirname, 'public', 'uploads');

module.exports = {
  uploadsDir
};
