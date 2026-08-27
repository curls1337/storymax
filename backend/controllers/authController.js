const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db');
const { JWT_SECRET } = require('../middleware/authMiddleware');

async function register(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    const db = getDb();
    
    // Check if user already exists
    const existingUser = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(400).json({ message: 'Username already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await db.run(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hashedPassword, 'user']
    );

    res.status(201).json({ message: 'User registered successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Error registering user.', error: error.message });
  }
}

async function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    const db = getDb();
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

    if (!user) {
      return res.status(400).json({ message: 'Invalid username or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid username or password.' });
    }

    // Sign Token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Login error.', error: error.message });
  }
}

async function getMe(req, res) {
  try {
    const db = getDb();
    const user = await db.get('SELECT id, username, role, can_use_magica, can_use_scenario, can_use_seedance, allow_hd_resolutions, preferred_provider FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }
    if (user.role === 'admin') {
      user.allow_hd_resolutions = 1;
      user.can_use_seedance = 1;
      user.can_use_magica = 1;
      user.can_use_scenario = 1;
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user profile.', error: error.message });
  }
}

async function changePassword(req, res) {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ message: 'Old and new passwords are required.' });
  }

  try {
    const db = getDb();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Incorrect old password.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);

    res.json({ message: 'Password updated successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Error changing password.', error: error.message });
  }
}

// User chooses their video/image provider (freebeat|magica|scenario).
async function setPreferredProvider(req, res) {
  const { provider } = req.body;
  if (!['freebeat', 'magica', 'scenario'].includes(provider)) {
    return res.status(400).json({ message: 'Provider tidak valid.' });
  }
  try {
    const db = getDb();
    const user = await db.get('SELECT id, can_use_magica, can_use_scenario FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (provider === 'magica' && !user.can_use_magica) {
      return res.status(403).json({ message: 'Anda belum diberi izin memakai Magica oleh admin.' });
    }
    if (provider === 'scenario' && user.can_use_scenario === 0) {
      return res.status(403).json({ message: 'Anda belum diberi izin memakai Scenario oleh admin.' });
    }
    await db.run('UPDATE users SET preferred_provider = ? WHERE id = ?', [provider, req.user.id]);
    res.json({ message: 'Provider diperbarui.', preferred_provider: provider });
  } catch (error) {
    res.status(500).json({ message: 'Error update provider.', error: error.message });
  }
}

module.exports = {
  register,
  login,
  getMe,
  changePassword,
  setPreferredProvider
};
