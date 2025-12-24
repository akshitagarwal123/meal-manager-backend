const jwt = require('jsonwebtoken');
const express = require('express');
const pool = require('../config/db');
const transporter = require('../config/email');
const router = express.Router();

// Save user details after OTP verification
router.post('/save-details', async (req, res) => {
  const { username, email, phone } = req.body;
  console.log(`[SAVE DETAILS] Request received: username=${username}, email=${email}, phone=${phone}`);
  if (!username || !email || !phone) {
    return res.status(400).json({ error: 'All fields required: username, email, phone' });
  }
  try {
    // Check if user with same email exists
    const existingUserResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUserResult.rows.length > 0) {
      const response = { error: 'Email already exists' };
      console.log('[SAVE DETAILS] Response:', response);
      return res.status(409).json(response);
    }
    // Insert new user
    await pool.query('INSERT INTO users (name, email, phone) VALUES ($1, $2, $3)', [username, email, phone]);
    console.log(`[SAVE DETAILS] New user created: ${email}`);
    // Fetch user to get id
    const newUserResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    let token = null;
    if (newUserResult.rows.length > 0) {
      token = jwt.sign({ email: newUserResult.rows[0].email, username: newUserResult.rows[0].name }, process.env.JWT_SECRET, { expiresIn: '1h' });
    }
    const response = { success: true, message: 'User details saved', token };
    console.log('[SAVE DETAILS] Response:', response);
    return res.json(response);
  } catch (err) {
    console.error(`[SAVE DETAILS] Error for ${email}:`, err);
    res.status(500).json({ error: 'Failed to save user details', details: err.message });
  }
});


function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP to email
router.post('/send-otp', async (req, res) => {
  const { email } = req.body;
  console.log(`[SEND OTP] Request received: email=${email}`);
  if (!email) {
    console.warn('[SEND OTP] Missing email');
    return res.status(400).json({ error: 'Email required' });
  }
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min expiry
  try {
    await pool.query('INSERT INTO email_otps (email, otp, expires_at) VALUES ($1, $2, $3)', [email, otp, expiresAt]);
    console.log(`[SEND OTP] OTP inserted for ${email}, OTP: ${otp}`);
    const mailPromise = transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your OTP for Meal Manager',
      text: `Your OTP is ${otp}. It is valid for 5 minutes.`,
    });

    // Avoid hanging the request forever when SMTP/DNS is flaky (common on hotspots).
    const timeoutMs = Number(process.env.OTP_EMAIL_TIMEOUT_MS || 15000);
    await Promise.race([
      mailPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('OTP email timeout')), timeoutMs)),
    ]);

    console.log(`[SEND OTP] Email sent to ${email}`);
    const response = { success: true, message: 'OTP sent to email' };
    console.log('[SEND OTP] Response:', response);
    res.json(response);
  } catch (err) {
    const details = err?.message || String(err);
    console.error(`[SEND OTP] Error for ${email}:`, err);

    // Dev fallback: return OTP in response if email couldn't be sent.
    const allowFallback =
      process.env.ALLOW_DEV_OTP === 'true' ||
      (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'prod');

    if (allowFallback) {
      const response = {
        success: true,
        message: 'OTP generated (email delivery unavailable on this network)',
        otp,
        emailDelivery: 'failed',
        details,
      };
      console.log('[SEND OTP] Response (fallback):', response);
      return res.json(response);
    }

    res.status(500).json({ error: 'Failed to send OTP', details });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  console.log(`[VERIFY OTP] Request received: email=${email}, otp=${otp}`);
  if (!email || !otp) {
    console.warn('[VERIFY OTP] Missing email or otp');
    return res.status(400).json({ error: 'Email and OTP required' });
  }
  try {
    const result = await pool.query('SELECT * FROM email_otps WHERE email = $1 AND otp = $2 AND expires_at > NOW()', [email, otp]);
    if (result.rows.length > 0) {
      console.log(`[VERIFY OTP] OTP valid for ${email}`);
      await pool.query('DELETE FROM email_otps WHERE email = $1', [email]); // Clean up
      const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      let profileStatus = 'NOT_EXISTS';
      let token = null;
      if (userResult.rows.length > 0) {
        profileStatus = 'EXISTS';
  token = jwt.sign({ email: userResult.rows[0].email, username: userResult.rows[0].name }, process.env.JWT_SECRET, { expiresIn: '1h' });
        console.log(`[VERIFY OTP] JWT issued for ${email}`);
      }
  const response = { success: true, message: 'OTP verified', token, profileStatus };
  console.log('[VERIFY OTP] Response:', response);
  res.json(response);
    } else {
      console.warn(`[VERIFY OTP] Invalid or expired OTP for ${email}`);
      res.status(401).json({ error: 'Invalid or expired OTP' });
    }
  } catch (err) {
    console.error(`[VERIFY OTP] Error for ${email}:`, err);
    res.status(500).json({ error: 'Failed to verify OTP', details: err.message });
  }
});


module.exports = router;
