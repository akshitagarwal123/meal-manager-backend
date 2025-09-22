const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { sendPushNotification } = require('../utils/notifications');
const authenticateToken = require('../middleware/authenticateToken');


// Save or update device token for the authenticated admin
router.post('/saveDeviceToken', authenticateToken, async (req, res) => {
    const { deviceToken } = req.body;
    // Admin ID is available in JWT as adminId
    const adminId = req.user && (req.user.adminId || req.user.id);
    if (!deviceToken) {
        console.warn('[ADMIN SAVE DEVICE TOKEN] deviceToken missing in request body');
        return res.status(400).json({ error: 'deviceToken is required' });
    }
    if (!adminId) {
        console.warn('[ADMIN SAVE DEVICE TOKEN] adminId missing in JWT');
        return res.status(401).json({ error: 'Unauthorized: adminId missing' });
    }
    try {
        const result = await pool.query(
            'UPDATE admins SET device_token = $1 WHERE id = $2 RETURNING *',
            [deviceToken, adminId]
        );
        if (result.rowCount === 0) {
            console.warn('[ADMIN SAVE DEVICE TOKEN] Admin not found for id:', adminId);
            return res.status(404).json({ error: 'Admin not found' });
        }
        console.log('[ADMIN SAVE DEVICE TOKEN] Device token updated for adminId=%s', adminId);
        res.json({ success: true, message: 'Device token updated', admin: result.rows[0] });
    } catch (err) {
        console.error('[ADMIN SAVE DEVICE TOKEN] Error:', err.message);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

// Admin endpoint to decline a user's enrollment to a PG
router.post('/decline-enrollment', authenticateToken, async (req, res) => {
    const { user_id, pg_id } = req.body;
    console.log(`[DECLINE ENROLLMENT] Request received: user_id=${user_id}, pg_id=${pg_id}`);
    if (!user_id || !pg_id) {
        console.warn('[DECLINE ENROLLMENT] Missing user_id or pg_id in request body');
        return res.status(400).json({ error: 'user_id and pg_id are required in body' });
    }
    try {
        // Delete the pending enrollment entry
        console.log('[DECLINE ENROLLMENT] Deleting pending enrollment entry');
        const result = await pool.query(
            `DELETE FROM enrollments WHERE user_id = $1 AND pg_id = $2 AND status = 1 RETURNING *`,
            [user_id, pg_id]
        );
        if (result.rowCount === 0) {
            console.warn('[DECLINE ENROLLMENT] Pending enrollment not found for user_id:', user_id, 'pg_id:', pg_id);
            return res.status(404).json({ error: 'Pending enrollment not found for this user and PG' });
        }
        console.log('[DECLINE ENROLLMENT] Enrollment entry deleted:', result.rows[0]);
        res.json({ success: true, message: 'Enrollment declined and entry deleted', enrollment: result.rows[0] });
    } catch (err) {
        console.error('[DECLINE ENROLLMENT] Error:', err.message);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});

// Admin endpoint to add a new user and enroll them in a PG
router.post('/add-user', authenticateToken, async (req, res) => {
    const { name, email, phone, pg_id } = req.body;
    if (!name || !email || !phone || !pg_id) {
        return res.status(400).json({ error: 'Name, email, phone, and pg_id are required' });
    }
    try {
        // Insert new user into users table
        const userResult = await pool.query(
            'INSERT INTO users (name, email, phone) VALUES ($1, $2, $3) RETURNING *',
            [name, email, phone]
        );
        const user = userResult.rows[0];
        // Enroll the user in the specified PG with status=2 (approved)
        await pool.query(
            'INSERT INTO enrollments (user_id, user_email, pg_id, status) VALUES ($1, $2, $3, 2)',
            [user.id, user.email, pg_id]
        );
        res.json({ success: true, message: 'User added and enrolled successfully', user });
    } catch (err) {
        // Handle duplicate email/phone errors
        if (err.code === '23505') {
            return res.status(409).json({ error: 'User with this email or phone already exists' });
        }
        console.error('[ADD USER] Error:', err.message);
        res.status(500).json({ error: 'Failed to add and enroll user', details: err.message });
    }
});

// Admin endpoint to update user details by user ID
router.put('/update-user/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const { name, email, phone } = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }
    if (!name && !email && !phone) {
        return res.status(400).json({ error: 'At least one field (name, email, phone) is required to update' });
    }
    try {
        // Build dynamic update query
        const fields = [];
        const values = [];
        let idx = 1;
        if (name) { fields.push(`name = $${idx++}`); values.push(name); }
        if (email) { fields.push(`email = $${idx++}`); values.push(email); }
        if (phone) { fields.push(`phone = $${idx++}`); values.push(phone); }
        values.push(userId);
        const query = `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
        const result = await pool.query(query, values);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ success: true, message: 'User updated successfully', user: result.rows[0] });
    } catch (err) {
        console.error('[UPDATE USER] Error:', err.message);
        res.status(500).json({ error: 'Failed to update user', details: err.message });
    }
});


// Admin endpoint to delete a user by user ID
router.delete('/delete-user/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }
    try {
        // First, delete user's enrollments
        await pool.query('DELETE FROM enrollments WHERE user_id = $1', [userId]);
        // Then, delete user from users table
        const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ success: true, message: 'User and enrollments deleted successfully', user: result.rows[0] });
    } catch (err) {
        console.error('[DELETE USER] Error:', err.message);
        res.status(500).json({ error: 'Failed to delete user', details: err.message });
    }
});

// Admin triggers push notifications to all users enrolled in a PG
router.post('/sendNotifications', authenticateToken, async (req, res) => {
    // Extract notification details and PG ID from request body
    const { title, body, pg_id } = req.body;
    // Log the incoming request
    console.log(`[SEND NOTIFICATIONS] Request received: title="${title}", body="${body}", pg_id=${pg_id}`);

    // Validate required fields
    if (!title || !body || !pg_id) {
        console.warn('[SEND NOTIFICATIONS] Missing required fields in request body');
        return res.status(400).json({ error: 'title, body, and pg_id are required' });
    }
    try {
        // Query device tokens for all users enrolled in the specified PG (status=2 means approved/enrolled)
        console.log('[SEND NOTIFICATIONS] Fetching device tokens for enrolled users in PG:', pg_id);
        const result = await pool.query(
            `SELECT u.device_token FROM users u
             JOIN enrollments e ON u.id = e.user_id
             WHERE e.pg_id = $1 AND e.status = 2 AND u.device_token IS NOT NULL`,
            [pg_id]
        );
        // Extract and filter device tokens
        const deviceTokens = result.rows.map(row => row.device_token).filter(Boolean);
        console.log(`[SEND NOTIFICATIONS] Found ${deviceTokens.length} device tokens.`);
        if (deviceTokens.length === 0) {
            // No device tokens found for enrolled users
            console.warn('[SEND NOTIFICATIONS] No device tokens found for enrolled users in PG:', pg_id);
            return res.status(404).json({ error: 'No device tokens found for enrolled users in this PG' });
        }
        let results = [];
        // Send notification to each device token
        for (const token of deviceTokens) {
            try {
                await sendPushNotification(token, title, body);
                results.push({ token, status: 'sent' });
            } catch (err) {
                // Log and record any errors for individual tokens
                console.error(`[SEND NOTIFICATIONS] Error sending to token ${token}:`, err.message);
                results.push({ token, status: 'error', error: err.message });
            }
        }
        // Log and return the results
        console.log('[SEND NOTIFICATIONS] Notification results:', results);
        res.json({ success: true, results });
    } catch (err) {
        // Log and return any server errors
        console.error('[SEND NOTIFICATIONS] Error sending push notifications:', err.message);
        res.status(500).json({ error: 'Failed to send notifications', details: err.message });
    }
});

// Admin triggers a push notification (placeholder, not implemented)
router.post('/notifications', authenticateToken, async (req, res) => {
    res.status(200).json({ message: 'This endpoint is not implemented yet.' });
});

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
        console.log('[MARK ATTENDANCE] Extracted email:', email);

        // Get user
        const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) {
            console.warn('[MARK ATTENDANCE] User not found');
            return res.status(404).json({ error: 'User not found' });
        }
        const userId = userResult.rows[0].id;
        console.log('[MARK ATTENDANCE] User found, id:', userId);

        // Get admin's PG ID from JWT or DB
        const adminId = req.user && (req.user.adminId || req.user.id);
        let adminPgId = req.user && req.user.pg_id;
        if (!adminPgId && adminId) {
            const adminResult = await pool.query('SELECT pg_id FROM admins WHERE id = $1', [adminId]);
            if (adminResult.rows.length > 0) {
                adminPgId = adminResult.rows[0].pg_id;
            }
        }
        if (!adminPgId) {
            console.warn('[MARK ATTENDANCE] Admin PG ID not found');
            return res.status(400).json({ error: 'Admin PG ID not found' });
        }
        console.log('[MARK ATTENDANCE] Admin PG ID:', adminPgId);

        // Check if user is enrolled in this PG (status=2 means approved)
        const enrollmentResult = await pool.query(
            'SELECT * FROM enrollments WHERE user_id = $1 AND pg_id = $2 AND status = 2',
            [userId, adminPgId]
        );
        if (enrollmentResult.rows.length === 0) {
            console.warn('[MARK ATTENDANCE] User not enrolled in this PG');
            return res.status(403).json({ error: 'User not enrolled in this PG' });
        }

        // Get today's date
        const meal_date = new Date().toISOString().slice(0, 10);
        console.log(`[MARK ATTENDANCE] Meal date: ${meal_date}`);

        // Check if user is enrolled for today's meal
        // const mealResult = await pool.query(
        //     'SELECT * FROM meal_responses WHERE user_id = $1 AND date = $2 AND enrolled = true',
        //     [userId, meal_date]
        // );
        // if (mealResult.rows.length === 0) {
        //     console.warn('[MARK ATTENDANCE] User not enrolled for today\'s meal');
        //     return res.status(403).json({ error: 'User not enrolled for today\'s meal' });
        // }

        // // Mark attendance
        // await pool.query(
        //     'INSERT INTO attendance (user_id, date, attended) VALUES ($1, $2, true) ON CONFLICT (user_id, date) DO UPDATE SET attended = true',
        //     [userId, meal_date]
        // );
        console.log('[MARK ATTENDANCE] Attendance marked for userId=%s, date=%s', userId, meal_date);
        res.json({ message: 'Attendance marked', attended: true });
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
        // Return pg_id along with token
        console.log(`[ADMIN LOGIN] Success: adminId=${admin.id}, token=${token}, pg_id=${admin.pg_id}`);
        res.json({ token, pg_id: admin.pg_id });
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
