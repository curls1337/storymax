const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const { initDb } = require('./db');

// Load environment variables
dotenv.config();

const { uploadsDir } = require('./config');

const app = express();
const PORT = process.env.PORT || 5022;

// Middleware
app.use(cors());
app.use(express.json({ limit: '1000mb' }));
app.use(express.urlencoded({ limit: '1000mb', extended: true }));

// Serve previews from local folder shipped with git so they are never lost on volumes
app.use('/uploads/previews', express.static(path.join(__dirname, 'public', 'uploads', 'previews')));

// Serve static images locally generated
app.use('/uploads', express.static(uploadsDir));

// Routes
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const storyboardRoutes = require('./routes/storyboardRoutes');
const aiRoutes = require('./routes/aiRoutes');
const videoRoutes = require('./routes/videoRoutes');
const magicaRoutes = require('./routes/magicaRoutes');
const magicaWebhookRoutes = require('./routes/magicaWebhook');
const googleAuthRoutes = require('./routes/googleAuthRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/storyboards', storyboardRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/videos', videoRoutes);
// Public Magica webhook (no JWT) — MUST be mounted before the authenticated /api/magica router.
app.use('/api/magica/webhook', magicaWebhookRoutes);
app.use('/api/magica', magicaRoutes);
// Per-user Google OAuth (connect account, callback, status, disconnect).
app.use('/api/google/oauth', googleAuthRoutes);

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

    // Auto resume monitoring any processing videos and storyboards at startup
    try {
      const { resumeProcessingVideos } = require('./controllers/videoController');
      const { resumeProcessingStoryboardsOnStartup } = require('./controllers/storyboardController');
      const { startAutoBackupCronJob } = require('./controllers/googleController');
      const { getDb } = require('./db');
      resumeProcessingVideos();
      resumeProcessingStoryboardsOnStartup();
      startAutoBackupCronJob(getDb());
    } catch (e) {
      console.error('Error starting video, storyboard recovery, or auto backup cron:', e);
    }
  })
  .catch((err) => {
    console.error('Fatal Database initialization error:', err.message);
    process.exit(1);
  });
