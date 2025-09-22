const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/authenticateToken');


// Update/save device token for the authenticated user
router.post('/saveDeviceToken', authenticateToken, async (req, res) => {
    const { deviceToken } = req.body;
    const user_email = req.user.email;
    console.log(`[SAVE DEVICE TOKEN] Request received: user_email=${user_email}, deviceToken=${deviceToken}`);
    if (!deviceToken) {
        console.warn('[SAVE DEVICE TOKEN] deviceToken missing in request body');
        return res.status(400).json({ error: 'deviceToken is required' });
    }
    try {
        // Update device_token for the user identified by email
        const result = await pool.query(
            'UPDATE users SET device_token = $1 WHERE email = $2 RETURNING *',
            [deviceToken, user_email]
        );
        if (result.rowCount === 0) {
            console.warn('[SAVE DEVICE TOKEN] User not found for email:', user_email);
            return res.status(404).json({ error: 'User not found' });
        }
        console.log('[SAVE DEVICE TOKEN] Device token updated for user_email=%s', user_email);
        res.json({ success: true, message: 'Device token updated', user: result.rows[0] });
    } catch (err) {
        console.error('[SAVE DEVICE TOKEN] Error:', err.message);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

// User withdraws their pending enrollment request
router.post('/withdraw-enrollment', authenticateToken, async (req, res) => {
    const { pg_id } = req.body;
    let user_id = req.user.id || req.user.user_id;
    const user_email = req.user.email;
    console.log(`[WITHDRAW ENROLLMENT] Request received: user_id=${user_id}, user_email=${user_email}, pg_id=${pg_id}`);
    if ((!user_id && !user_email) || !pg_id) {
        console.warn('[WITHDRAW ENROLLMENT] Missing user_id/user_email or pg_id');
        return res.status(400).json({ error: 'pg_id is required in body and user must be authenticated' });
    }
    try {
        // If user_id is not present, fetch it using email
        if (!user_id && user_email) {
            console.log('[WITHDRAW ENROLLMENT] Fetching user_id from DB using email:', user_email);
            const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [user_email]);
            if (userResult.rows.length === 0) {
                console.warn('[WITHDRAW ENROLLMENT] No user found for email:', user_email);
                return res.status(404).json({ error: 'User not found' });
            }
            user_id = userResult.rows[0].id;
            console.log('[WITHDRAW ENROLLMENT] Found user_id:', user_id);
        }
        // Check if a pending enrollment exists
        console.log('[WITHDRAW ENROLLMENT] Checking for pending enrollment...');
        const checkResult = await pool.query(
            `SELECT * FROM enrollments WHERE user_id = $1 AND pg_id = $2 AND status = 1`,
            [user_id, pg_id]
        );
        if (checkResult.rowCount === 0) {
            console.warn('[WITHDRAW ENROLLMENT] No pending enrollment found for user_id=%s, pg_id=%s', user_id, pg_id);
            return res.status(404).json({ error: 'No pending enrollment found for this user and PG' });
        }
        // Delete the pending enrollment
        console.log('[WITHDRAW ENROLLMENT] Deleting pending enrollment for user_id=%s, pg_id=%s', user_id, pg_id);
        await pool.query(
            `DELETE FROM enrollments WHERE user_id = $1 AND pg_id = $2 AND status = 1`,
            [user_id, pg_id]
        );
        console.log('[WITHDRAW ENROLLMENT] Enrollment request withdrawn for user_id=%s, pg_id=%s', user_id, pg_id);
        res.json({ success: true, message: 'Enrollment request withdrawn' });
    } catch (err) {
        console.error('[WITHDRAW ENROLLMENT] Error:', err.message);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});




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
router.post('/create-user', async (req, res) => {
    const { username, email, phone, pg_id, deviceToken } = req.body;
    // Generate a 6-digit UUID (numeric string)
    const id = Math.floor(100000 + Math.random() * 900000).toString();
    try {
        let query, params;
        if (pg_id) {
            query = 'INSERT INTO users (id, username, email, phone, pg_id, device_token) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *';
            params = [id, username, email, phone, pg_id, deviceToken];
        } else {
            query = 'INSERT INTO users (id, username, email, phone, device_token) VALUES ($1, $2, $3, $4, $5) RETURNING *';
            params = [id, username, email, phone, deviceToken];
        }
        const result = await pool.query(query, params);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

// Generate QR code for a user using email as unique identifier
router.get('/:email/qrcode', async (req, res) => {
    const { email } = req.params;
    console.log(`[QR CODE] Request received for email: ${email}`);
    try {
        const QRCode = require("qrcode");
        const qrData = JSON.stringify({ email });
        const qrImage = await QRCode.toDataURL(qrData);
        console.log(`[QR CODE] Successfully generated QR for email: ${email}`);
        res.json({ qr: qrImage });
    } catch (err) {
        console.error(`[QR CODE] Failed to generate QR for email: ${email}. Error: ${err.message}`);
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
const { sendPushNotification } = require('../utils/notifications');
router.post('/enroll', authenticateToken, async (req, res) => {
    console.log('[ENROLL] Request body:', req.body);
    console.log('[ENROLL] User:', req.user);
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

        // Notify the admin of this PG
        try {
            // Find admin for this PG
            const adminResult = await pool.query('SELECT * FROM admins WHERE pg_id = $1 LIMIT 1', [pg_id]);
            if (adminResult.rows.length > 0) {
                const admin = adminResult.rows[0];
                // Get admin device token (if stored in admins table)
                let adminDeviceToken = admin.device_token;
                if (!adminDeviceToken) {
                    // Try to get from users table if admin uses same email
                    const adminUserResult = await pool.query('SELECT device_token FROM users WHERE email = $1', [admin.email]);
                    if (adminUserResult.rows.length > 0) {
                        adminDeviceToken = adminUserResult.rows[0].device_token;
                    }
                }
                if (adminDeviceToken) {
                    const title = 'New Enrollment Request';
                    const body = `${userResult.rows[0].username || userResult.rows[0].name || email} requested to join your PG.`;
                    try {
                        await sendPushNotification(adminDeviceToken, title, body);
                        console.log(`[ENROLL] Notification sent to admin (${admin.email}) for PG ${pg_id}`);
                    } catch (pushErr) {
                        console.error(`[ENROLL] Failed to send notification to admin (${admin.email}):`, pushErr.message);
                    }
                } else {
                    console.warn(`[ENROLL] Admin for PG ${pg_id} has no device token, notification not sent.`);
                }
            } else {
                console.warn(`[ENROLL] No admin found for PG ${pg_id}, notification not sent.`);
            }
        } catch (notifyErr) {
            console.error(`[ENROLL] Error notifying admin for PG ${pg_id}:`, notifyErr.message);
        }

        res.json({ message: 'Enrollment request submitted. Pending approval.' });
    } catch (err) {
        console.error('[ENROLL] Error:', err.message);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

module.exports = router;
