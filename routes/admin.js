// Scan QR and mark attendance
router.post('/scan', async (req, res) => {
	const { email } = req.body;
	// Use server-side current date
	const meal_date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
	try {
		// Check if user exists
		const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
		if (userResult.rows.length === 0) {
			return res.status(404).json({ error: 'User not found', flag: true });
		}
		const userId = userResult.rows[0].id;

		// Check if user is enrolled for meal (assuming meal_responses table)
		const mealResult = await pool.query(
			'SELECT * FROM meal_responses WHERE user_id = $1 AND date = $2 AND enrolled = true',
			[userId, meal_date]
		);
		if (mealResult.rows.length === 0) {
			// Not enrolled, flag
			return res.status(403).json({ error: 'User not enrolled for meal', flag: true });
		}

		// Mark attendance (assuming attendance table)
		await pool.query(
			'INSERT INTO attendance (user_id, date, attended) VALUES ($1, $2, true) ON CONFLICT (user_id, date) DO UPDATE SET attended = true',
			[userId, meal_date]
		);
		res.json({ message: 'Attendance marked', attended: true });
	} catch (err) {
		res.status(500).json({ error: 'Server error', details: err.message });
	}
});
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// Admin login route
router.post('/login', async (req, res) => {
	const { username, password } = req.body;
	try {
		const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
		const admin = result.rows[0];
		if (!admin || admin.password !== password) {
			return res.status(401).json({ error: 'Invalid credentials' });
		}
		// Issue JWT token
		const token = jwt.sign({ adminId: admin.id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });
		res.json({ token });
	} catch (err) {
		res.status(500).json({ error: 'Server error', details: err.message });
	}
});

// Example protected admin route
router.get('/verify', (req, res) => {
	// This route should be protected by JWT middleware in production
	res.json({ message: 'Admin verified!' });
});

module.exports = router;
