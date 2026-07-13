const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const { initDb } = require('./db');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5022;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static images locally generated
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// Routes
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const storyboardRoutes = require('./routes/storyboardRoutes');
const aiRoutes = require('./routes/aiRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/storyboards', storyboardRoutes);
app.use('/api/ai', aiRoutes);

// Server static built frontend files in production
const frontendBuildPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendBuildPath));

app.get('*', (req, res) => {
  // If request doesn't match API, serve index.html (SPA routing support)
  res.sendFile(path.join(frontendBuildPath, 'index.html'), (err) => {
    if (err) {
      // Fallback if frontend is not built yet
      res.status(200).send('storymax API is running. Build frontend to view the UI.');
    }
  });
});

// Initialize DB and start server
initDb()
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`=========================================`);
      console.log(`   storymax Server Running on port ${PORT} `);
      console.log(`   Local API: http://localhost:${PORT}/api `);
      console.log(`=========================================`);
    });
    server.on('error', (err) => {
      console.error('Express server port conflict error:', err.message);
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error('Fatal Database initialization error:', err.message);
    process.exit(1);
  });
