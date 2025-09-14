const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const QRCode = require('qrcode');

// User enrolls or opts out for a meal
router.post('/meal-response', async (req, res) => {
	const { email, meal_id, enrolled } = req.body;
	try {
		// Find user by email
		const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
		if (userResult.rows.length === 0) {
			return res.status(404).json({ error: 'User not found' });
		}
		const userId = userResult.rows[0].id;

		// Insert or update meal response
		await pool.query(
			'INSERT INTO meal_responses (user_id, meal_id, enrolled) VALUES ($1, $2, $3) ON CONFLICT (user_id, meal_id) DO UPDATE SET enrolled = $3',
			[userId, meal_id, enrolled]
		);
		res.json({ message: 'Meal response recorded', enrolled });
	} catch (err) {
		res.status(500).json({ error: 'Server error', details: err.message });
	}
});



// Get user profile
router.get('/:id', async (req, res) => {
	const { id } = req.params;
	try {
		const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
		if (result.rows.length === 0) {
			return res.status(404).json({ error: 'User not found' });
		}
		res.json(result.rows[0]);
	} catch (err) {
		res.status(500).json({ error: 'Server error', details: err.message });
	}
});

// Create user (admin only)
router.post('/', async (req, res) => {
	const { username, email, phone, pg_id } = req.body;
	try {
		const result = await pool.query(
			'INSERT INTO users (username, email, phone, pg_id) VALUES ($1, $2, $3, $4) RETURNING *',
			[username, email, phone, pg_id]
		);
		res.status(201).json(result.rows[0]);
	} catch (err) {
		res.status(500).json({ error: 'Server error', details: err.message });
	}
});

// Generate QR code for a user using email as unique identifier
router.get('/:email/qrcode', async (req, res) => {
	const { email } = req.params;
	try {
		const qrData = JSON.stringify({ email });
		const qrImage = await QRCode.toDataURL(qrData);
		res.json({ qr: qrImage });
	} catch (err) {
		res.status(500).json({ error: 'Failed to generate QR', details: err.message });
	}
});

// Delete user (admin only)
router.delete('/:id', async (req, res) => {
	const { id } = req.params;
	try {
		await pool.query('DELETE FROM users WHERE id = $1', [id]);
		res.json({ message: 'User deleted' });
	} catch (err) {
		res.status(500).json({ error: 'Server error', details: err.message });
	}
});

module.exports = router;
