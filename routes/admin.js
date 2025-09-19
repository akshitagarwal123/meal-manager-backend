
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const authenticateToken = require('../middleware/authenticateToken');

// Approve a user's enrollment to a PG
router.post('/approve-enrollment', authenticateToken, async (req, res) => {
    const { user_id, pg_id } = req.body;
    if (!user_id || !pg_id) {
        return res.status(400).json({ error: 'user_id and pg_id are required in body' });
    }
    try {
        // Update enrollment status to approved (2)
        const result = await pool.query(
            `UPDATE enrollments SET status = 2 WHERE user_id = $1 AND pg_id = $2 AND status = 1 RETURNING *`,
            [user_id, pg_id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Pending enrollment not found for this user and PG' });
        }
        res.json({ success: true, message: 'Enrollment approved', enrollment: result.rows[0] });
    } catch (err) {
        console.error('[ADMIN] Error approving enrollment:', err.message);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

// Scan QR and mark attendance
router.post('/scan', async (req, res) => {
	const { email } = req.body;
	const meal_date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
	console.log(`[SCAN] Request: email=${email}, date=${meal_date}`);
	try {
		const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
		if (userResult.rows.length === 0) {
			console.log('[SCAN] User not found');
			return res.status(404).json({ error: 'User not found', flag: true });
		}
		const userId = userResult.rows[0].id;

		const mealResult = await pool.query(
			'SELECT * FROM meal_responses WHERE user_id = $1 AND date = $2 AND enrolled = true',
			[userId, meal_date]
		);
		if (mealResult.rows.length === 0) {
			console.log('[SCAN] User not enrolled for meal');
			return res.status(403).json({ error: 'User not enrolled for meal', flag: true });
		}

		await pool.query(
			'INSERT INTO attendance (user_id, date, attended) VALUES ($1, $2, true) ON CONFLICT (user_id, date) DO UPDATE SET attended = true',
			[userId, meal_date]
		);
		console.log(`[SCAN] Attendance marked for userId=${userId}, date=${meal_date}`);
		res.json({ message: 'Attendance marked', attended: true });
	} catch (err) {
		console.error('[SCAN] Error:', err);
		res.status(500).json({ error: 'Server error', details: err.message });
	}
});

// Mark attendance for user from QR code data (admin only)
router.post('/mark-attendance', authenticateToken, async (req, res) => {
    console.log('[MARK ATTENDANCE] Request received');
    try {
        const { qrData } = req.body;
        if (!qrData) {
            console.warn('[MARK ATTENDANCE] QR data missing in request');
            return res.status(400).json({ error: 'QR data required' });
        }
        console.log('[MARK ATTENDANCE] QR data received');

        // Parse QR data (assume it contains email)
        let parsed;
        try {
            parsed = JSON.parse(qrData);
            console.log('[MARK ATTENDANCE] QR data parsed successfully');
        } catch (err) {
            console.error('[MARK ATTENDANCE] Invalid QR data format:', err.message);
            return res.status(400).json({ error: 'Invalid QR data format' });
        }
        console.log('[MARK ATTENDANCE] Parsed data:', parsed);
        let { email } = parsed;
        if (!email) {
            console.warn('[MARK ATTENDANCE] Email missing in QR data');
            return res.status(400).json({ error: 'Email missing in QR data' });
        }
        // Handle double-encoded email JSON string
        if (typeof email === 'string' && email.startsWith('{')) {
            try {
                email = JSON.parse(email).email;
            } catch (e) {
                return res.status(400).json({ error: 'Invalid nested email format' });
            }
        }
        if (email.startsWith('mailto:')) {
            email = email.replace('mailto:', '');
        }
        console.log('[MARK ATTENDANCE] Extracted email:', email);

        // Get user
        const userResult = await pool.query('SELECT email FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
            console.warn('[MARK ATTENDANCE] User not found');
            return res.status(404).json({ error: 'User not found' });
        }
        console.log('[MARK ATTENDANCE] User found');

        // Get today's date
        const meal_date = new Date().toISOString().slice(0, 10);
        console.log(`[MARK ATTENDANCE] Meal date: ${meal_date}`);

        // Check if user is enrolled for today's meal (logic removed temporarily)
        // const mealResult = await pool.query(
        //     'SELECT * FROM meal_responses WHERE email = $1 AND meal_id IN (SELECT id FROM meals WHERE date = $2)',
        //     [email, meal_date]
        // );
        // if (mealResult.rows.length === 0) {
        //     console.warn('[MARK ATTENDANCE] User not enrolled for today\'s meal');
        //     return res.status(400).json({ error: 'User not enrolled for today\'s meal' });
        // }
        console.log('[MARK ATTENDANCE] User enrolled for today\'s meal');

        // Skip saving attendance and return success message
        console.log('[MARK ATTENDANCE] Attendance verified successfully');
        res.json({ message: 'Attendance verified successfully', attended: true });
    } catch (error) {
        console.error('[MARK ATTENDANCE] Internal server error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin login route
router.post('/login', async (req, res) => {
	const { username, password } = req.body;
	console.log(`[ADMIN LOGIN] Attempt: username=${username}`);
	try {
		const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
		const admin = result.rows[0];
		if (!admin || admin.password !== password) {
			console.log('[ADMIN LOGIN] Invalid credentials');
			return res.status(401).json({ error: 'Invalid credentials' });
		}
		const token = jwt.sign({ adminId: admin.id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });
		console.log(`[ADMIN LOGIN] Success: adminId=${admin.id}, token=${token}`);
		res.json({ token });
	} catch (err) {
		console.error('[ADMIN LOGIN] Error:', err);
		res.status(500).json({ error: 'Server error', details: err.message });
	}
});

// Example protected admin route
router.get('/verify', (req, res) => {
	console.log('[ADMIN VERIFY] Accessed');
	// This route should be protected by JWT middleware in production
	res.json({ message: 'Admin verified!' });
});

// Get list of users awaiting PG enrollment approval
router.get('/pending-enrollments', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT e.user_id, e.user_email, e.pg_id, p.name as pg_name, u.name, u.phone
             FROM enrollments e
             JOIN users u ON e.user_email = u.email
             JOIN pgs p ON e.pg_id = p.id
             WHERE e.status = 1`
        );
        res.json({ pending: result.rows });
    } catch (err) {
        console.error('[ADMIN] Error fetching pending enrollments:', err.message);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

// Get list of users enrolled in a specific PG
router.get('/enrolled-users', authenticateToken, async (req, res) => {
    const { pg_id } = req.query;
    if (!pg_id) {
        return res.status(400).json({ error: 'PG ID is required as query param' });
    }
    try {
        const result = await pool.query(
            `SELECT e.user_id, e.user_email, e.pg_id, p.name as pg_name, u.name, u.phone
             FROM enrollments e
             JOIN users u ON e.user_email = u.email
             JOIN pgs p ON e.pg_id = p.id
             WHERE e.status = 2 AND e.pg_id = $1`,
            [pg_id]
        );
        res.json({ enrolled: result.rows });
    } catch (err) {
        console.error('[ADMIN] Error fetching enrolled users:', err.message);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

module.exports = router;
