const express = require('express');
const axios = require('axios');
require('dotenv').config();
const router = express.Router();

// Send OTP using MSG91
router.post('/user/login', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });
  try {
    const response = await axios.get(`https://control.msg91.com/api/v5/otp?template_id=${process.env.MSG91_TEMPLATE_ID}&mobile=${phone}&authkey=${process.env.MSG91_AUTH_KEY}`);
    res.json({ success: true, message: 'OTP sent', data: response.data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send OTP', details: err.message });
  }
});

// Verify OTP using MSG91
router.post('/user/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });
  try {
    const response = await axios.get(`https://control.msg91.com/api/v5/otp/verify?mobile=${phone}&otp=${otp}&authkey=${process.env.MSG91_AUTH_KEY}`);
    if (response.data && response.data.type === 'success') {
      res.json({ success: true, message: 'OTP verified' });
    } else {
      res.status(401).json({ error: 'Invalid OTP', data: response.data });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify OTP', details: err.message });
  }
});

module.exports = router;