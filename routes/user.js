const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const QRCode = require('qrcode');
const authenticateToken = require('../middleware/authenticateToken');
const crypto = require('crypto');


// Check user enrollment status
router.get('/check-status', authenticateToken, async (req, res) => {
    const { email } = req.user; // Using email as userId
    console.log(`[CHECK STATUS] Request received for email: ${email}`);
    try {
        // Check if user exists
        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
            console.warn(`[CHECK STATUS] User not found for email: ${email}`);
            return res.status(404).json({ error: 'User not found' });
        }
        console.log(`[CHECK STATUS] User found:`, userResult.rows[0]);

        // Check enrollment status
        const enrollmentResult = await pool.query('SELECT * FROM enrollments WHERE user_email = $1', [email]);
        if (enrollmentResult.rows.length === 0) {
            console.log(`[CHECK STATUS] No enrollment found for email: ${email}`);
            // Condition 1: User not enrolled in any PG
            return res.json({ status: 0 });
        }

        const enrollment = enrollmentResult.rows[0];
        console.log(`[CHECK STATUS] Enrollment found:`, enrollment);
        if (enrollment.status === 1) {
            // Condition 2: Waiting for approval
            const pgDetails = await pool.query('SELECT * FROM pgs WHERE id = $1', [enrollment.pg_id]);
            console.log(`[CHECK STATUS] Pending approval for PG:`, pgDetails.rows[0]);
            return res.json({ status: 1, pgDetails: pgDetails.rows[0] });
        }

        if (enrollment.status === 2) {
            // Condition 3: Enrolled in a PG
            const pgDetails = await pool.query('SELECT * FROM pgs WHERE id = $1', [enrollment.pg_id]);
            console.log(`[CHECK STATUS] User enrolled in PG:`, pgDetails.rows[0]);
            return res.json({ status: 2 });
        }

        // Default case (should not occur)
        console.error(`[CHECK STATUS] Invalid enrollment status for email: ${email}`);
        return res.status(400).json({ error: 'Invalid enrollment status' });
    } catch (error) {
        console.error('[CHECK USER STATUS] Error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});




// Get list of PGs for user selection after login
router.get('/pgs', authenticateToken, async (req, res) => {
	try {
		const result = await pool.query('SELECT id, name, address FROM pgs');
		const response = { success: true, pgs: result.rows };
		console.log('[GET PGs] Response:', response);
		res.json(response);
	} catch (err) {
		console.error('[GET PGs] Error:', err);
		res.status(500).json({ error: 'Failed to fetch PGs', details: err.message });
	}
});

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

// Create user
router.post('/', async (req, res) => {
    const { username, email, phone, pg_id } = req.body;
    // Generate a 6-digit UUID (numeric string)
    const id = Math.floor(100000 + Math.random() * 900000).toString();
    try {
        const result = await pool.query(
            'INSERT INTO users (id, username, email, phone, pg_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [id, username, email, phone, pg_id]
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

// User requests to enroll in a PG
router.post('/enroll', authenticateToken, async (req, res) => {
    console.log(req.body)
    console.log('Enroll request received:', {
        user: req.user,
        body: req.body
    });
    const { email } = req.user; // Using email as userId
    const { pg_id } = req.body;
    if (!pg_id) {
        return res.status(400).json({ error: 'PG ID is required' });
    }
    try {
        // Check if user exists
        const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Use numeric userId for user_id
        const userId = userResult.rows[0].id;
        await pool.query(
            'INSERT INTO enrollments (user_id, user_email, pg_id, status) VALUES ($1, $2, $3, 1) ON CONFLICT (user_email, pg_id) DO UPDATE SET status = 1',
            [userId, email, pg_id]
        );
        res.json({ message: 'Enrollment request submitted. Pending approval.' });
    } catch (err) {
        console.error('[ENROLL] Error:', err.message);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

module.exports = router;
