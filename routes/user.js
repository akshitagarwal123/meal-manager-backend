const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/authenticateToken');



// GET /user/notifications - fetch notifications for the authenticated user
router.get('/notifications', authenticateToken, async (req, res) => {
    const userEmail = req.user && req.user.email;
    if (!userEmail) {
        return res.status(401).json({ error: 'Unauthorized: user email missing' });
    }
    try {
        // Get user_id from users table
        const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [userEmail]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const userId = userResult.rows[0].id;
        const result = await pool.query(
            `SELECT id, title, message, sent_at, type, read
             FROM notifications
             WHERE user_id = $1
             ORDER BY sent_at DESC
             LIMIT 100`,
            [userId]
        );
        res.json({ notifications: result.rows });
    } catch (err) {
        console.error('[USER NOTIFICATIONS] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch notifications', details: err.message });
    }
});

// Get meals assigned by the admin of the user's PG
router.get('/assigned-meals', authenticateToken, async (req, res) => {
    const { email } = req.user;
    console.log(`[ASSIGNED MEALS] Request received for user: ${email}`);
    try {
        // Get user's enrollment and PG
        console.log('[ASSIGNED MEALS] Checking enrollment for user:', email);
        const enrollmentResult = await pool.query('SELECT pg_id FROM enrollments WHERE user_email = $1 AND status = 2', [email]);
        console.log('[ASSIGNED MEALS] Enrollment query result:', enrollmentResult.rows);
        if (enrollmentResult.rows.length === 0) {
            console.warn('[ASSIGNED MEALS] User not enrolled in any PG:', email);
            return res.status(403).json({ error: 'User not enrolled in any PG' });
        }
        const pg_id = enrollmentResult.rows[0].pg_id;
        console.log(`[ASSIGNED MEALS] Fetching meals for PG: ${pg_id}`);
        // Fetch meals assigned to this PG
        const mealsResult = await pool.query('SELECT * FROM meal_menus WHERE pg_id = $1', [pg_id]);
        console.log(`[ASSIGNED MEALS] Meals query result for PG ${pg_id}:`, mealsResult.rows);
        // For each meal, fetch the user's enrollment status
        const mealsWithStatus = await Promise.all(mealsResult.rows.map(async meal => {
            const enrollResult = await pool.query(
                'SELECT enrolled FROM user_meal_enrollments WHERE email = $1 AND pg_id = $2 AND meal_type = $3 AND date = $4',
                [email, pg_id, meal.meal_type, meal.date]
            );
            return {
                ...meal,
                enrolled: enrollResult.rows.length > 0 ? enrollResult.rows[0].enrolled : undefined
            };
        }));
    const response = { meals: mealsWithStatus };
    console.log('[ASSIGNED MEALS] Response:', JSON.stringify(response));
    res.json(response);
    console.log(`[ASSIGNED MEALS] Response sent for user: ${email}`);
    } catch (err) {
        console.error('[ASSIGNED MEALS] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch assigned meals', details: err.message });
    }
});

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

// Update user profile details by email
router.put('/update-details', async (req, res) => {
  const { email, phone, username } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required to identify the user.' });
  }
  try {
    // Check for duplicate phone (excluding current user)
    if (phone) {
      const duplicate = await pool.query(
        'SELECT * FROM users WHERE phone = $1 AND email != $2',
        [phone, email]
      );
      if (duplicate.rows.length > 0) {
        return res.status(409).json({ error: 'Phone already exists' });
      }
    }
    // Update user details
    const fields = [];
    const values = [];
    let idx = 1;
    if (username) { fields.push(`name = $${idx++}`); values.push(username); }
    if (phone) { fields.push(`phone = $${idx++}`); values.push(phone); }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update.' });
    }
    values.push(email);
    const query = `UPDATE users SET ${fields.join(', ')} WHERE email = $${idx} RETURNING *`;
    const result = await pool.query(query, values);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('[UPDATE DETAILS] Error:', err.message);
    res.status(500).json({ error: 'Failed to update user details', details: err.message });
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
    const { username, email, phone, pg_id } = req.body;
    const deviceToken = req.body.device_token ?? req.body.deviceToken;
    if (!username || !email || !phone) {
        return res.status(400).json({ error: 'username, email, and phone are required' });
    }
    try {
        const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Email already exists' });
        }

        const existingPhone = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
        if (existingPhone.rows.length > 0) {
            return res.status(409).json({ error: 'Phone already exists' });
        }

        const fields = ['name', 'email', 'phone'];
        const placeholders = ['$1', '$2', '$3'];
        const values = [username, email, phone];

        if (pg_id !== undefined) {
            fields.push('pg_id');
            placeholders.push(`$${fields.length}`);
            values.push(pg_id);
        }

        if (deviceToken !== undefined) {
            fields.push('device_token');
            placeholders.push(`$${fields.length}`);
            values.push(deviceToken);
        }

        const insertQuery = `INSERT INTO users (${fields.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id, name, email, phone, pg_id, device_token`;
        const result = await pool.query(insertQuery, values);
        const user = result.rows[0];

        return res.status(201).json({
            id: user.id,
            username: user.name,
            email: user.email,
            phone: user.phone,
            pg_id: user.pg_id ?? null,
            device_token: user.device_token ?? null
        });
    } catch (err) {
        console.error('[CREATE USER] Error:', err.message);
        return res.status(500).json({ error: 'Server error', details: err.message });
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
const { notifyAdmin } = require('../services/notificationService');
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

        // Notify the admin of this PG using notificationService
        try {
            const adminResult = await pool.query('SELECT * FROM admins WHERE pg_id = $1 LIMIT 1', [pg_id]);
            if (adminResult.rows.length > 0) {
                const admin = adminResult.rows[0];
                const title = 'New Enrollment Request';
                const message = `${userResult.rows[0].username || userResult.rows[0].name || email} requested to join your PG.`;
                await notifyAdmin({ adminId: admin.id, title, message, type: 'enrollment' });
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
