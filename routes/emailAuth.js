const jwt = require('jsonwebtoken');
const express = require('express');
const pool = require('../config/db');
const transporter = require('../config/email');
const router = express.Router();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP to email
router.post('/send-otp', async (req, res) => {
  const { email, username } = req.body;
  if (!email || !username) return res.status(400).json({ error: 'Email and username required' });
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry
  try {
  await pool.query('INSERT INTO email_otps (email, otp, username, expires_at) VALUES ($1, $2, $3, $4)', [email, otp, username, expiresAt]);
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your OTP for Meal Manager',
      text: `Hello ${username},\nYour OTP is ${otp}. It is valid for 5 minutes.`
    });
    res.json({ success: true, message: 'OTP sent to email' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send OTP', details: err.message });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });
  try {
    const result = await pool.query('SELECT * FROM email_otps WHERE email = $1 AND otp = $2 AND expires_at > NOW()', [email, otp]);
    if (result.rows.length > 0) {
      const username = result.rows[0].username || '';
      await pool.query('DELETE FROM email_otps WHERE email = $1', [email]); // Clean up
      // Check if user exists
      let user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (user.rows.length === 0) {
        await pool.query('INSERT INTO users (email, name) VALUES ($1, $2)', [email, username]);
        user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      }
      // Issue JWT token
      const token = jwt.sign({ email: user.rows[0].email, id: user.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '1h' });
      res.json({ success: true, message: 'OTP verified, user created if not present', token });
    } else {
      res.status(401).json({ error: 'Invalid or expired OTP' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify OTP', details: err.message });
  }
});

module.exports = router;
