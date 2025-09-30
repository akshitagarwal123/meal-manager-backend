



const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { sendPushNotification } = require('../utils/notifications');
const { getISTDateString } = require('../utils/date');
const mealEndTimes = require('../config/mealEndTimes');
const { isMealOver } = require('../utils/mealTime');
const authenticateToken = require('../middleware/authenticateToken');
const { broadcastToPG } = require('../services/notificationService');

module.exports = router;


// GET /admin/notifications - fetch notifications for the authenticated admin
router.get('/notifications', authenticateToken, async (req, res) => {
    const adminId = req.user && (req.user.adminId || req.user.id);
    if (!adminId) {
        return res.status(401).json({ error: 'Unauthorized: adminId missing' });
    }
    try {
        const result = await pool.query(
            `SELECT id, title, message, sent_at, type, read
             FROM notifications
             WHERE admin_id = $1
             ORDER BY sent_at DESC
             LIMIT 100`,
            [adminId]
        );
        res.json({ notifications: result.rows });
    } catch (err) {
        console.error('[ADMIN NOTIFICATIONS] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch notifications', details: err.message });
    }
});


// Add logs for meal-enrollment-details endpoint
router.get('/meal-enrollment-details', authenticateToken, async (req, res) => {
    const adminPgId = req.user && req.user.pg_id;
    const pg_id = req.query.pg_id || adminPgId;
    const { date, meal_type } = req.query;
    console.log(`[MEAL ENROLLMENT DETAILS] Request received: pg_id=${pg_id}, date=${date}, meal_type=${meal_type}`);
    if (!pg_id || !date || !meal_type) {
        console.warn('[MEAL ENROLLMENT DETAILS] Missing required query params');
        return res.status(400).json({ error: 'pg_id, date, and meal_type are required as query params' });
    }
    try {
        // Enrolled users (enrolled = true)
    const enrolledSQL = `SELECT u.id AS user_id, u.name, u.email, u.phone
         FROM user_meal_enrollments ume
         JOIN users u ON ume.user_id = u.id
         WHERE ume.pg_id = $1 AND ume.date = $2 AND ume.meal_type = $3 AND ume.enrolled = true`;
        console.log('[MEAL ENROLLMENT DETAILS] Enrolled SQL:', enrolledSQL);
        const enrolledResult = await pool.query(enrolledSQL, [pg_id, date, meal_type]);
        console.log(`[MEAL ENROLLMENT DETAILS] Enrolled users count: ${enrolledResult.rows.length}`);

        // Opted out users (enrolled = false)
    const optedOutSQL = `SELECT u.id AS user_id, u.name, u.email, u.phone
         FROM user_meal_enrollments ume
         JOIN users u ON ume.user_id = u.id
         WHERE ume.pg_id = $1 AND ume.date = $2 AND ume.meal_type = $3 AND ume.enrolled = false`;
        console.log('[MEAL ENROLLMENT DETAILS] Opted out SQL:', optedOutSQL);
        const optedOutResult = await pool.query(optedOutSQL, [pg_id, date, meal_type]);
        console.log(`[MEAL ENROLLMENT DETAILS] Opted out users count: ${optedOutResult.rows.length}`);

        // No-shows: enrolled but no attendance
                const noShowSQL = `SELECT u.id AS user_id, u.name, u.email, u.phone
                         FROM user_meal_enrollments ume
                         JOIN users u ON ume.user_id = u.id
                         WHERE ume.pg_id = $1 AND ume.date = $2 AND ume.meal_type = $3 AND ume.enrolled = true
                         AND NOT EXISTS (
                                 SELECT 1 FROM attendance a
                                 WHERE a.email = ume.email
                                     AND a.pg_id = ume.pg_id
                                     AND a.meal_type = ume.meal_type
                                     AND a.date = ume.date
                         )`;
        console.log('[MEAL ENROLLMENT DETAILS] No-show SQL:', noShowSQL);
        const noShowResult = await pool.query(noShowSQL, [pg_id, date, meal_type]);
        console.log(`[MEAL ENROLLMENT DETAILS] No-show users count: ${noShowResult.rows.length}`);

        const response = {
            enrolled: enrolledResult.rows,
            opted_out: optedOutResult.rows,
            no_show: noShowResult.rows
        };
        console.log('[MEAL ENROLLMENT DETAILS] Final response:', JSON.stringify(response, null, 2));
        res.json(response);
    } catch (err) {
        console.error('[ADMIN MEAL ENROLLMENT DETAILS] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch meal enrollment details', details: err.message });
    }
});


// GET /admin/meal-enrollment-details
// Returns detailed lists of users: enrolled, opted out, and no-shows for a given meal type, date, and PG
router.get('/meal-enrollment-details', authenticateToken, async (req, res) => {
    const adminPgId = req.user && req.user.pg_id;
    const pg_id = req.query.pg_id || adminPgId;
    const { date, meal_type } = req.query;
    if (!pg_id || !date || !meal_type) {
        return res.status(400).json({ error: 'pg_id, date, and meal_type are required as query params' });
    }
    try {
        // Enrolled users (enrolled = true)
        const enrolledResult = await pool.query(
            `SELECT u.id, u.name, u.email, u.phone
             FROM user_meal_enrollments ume
             JOIN users u ON ume.user_id = u.id
             WHERE ume.pg_id = $1 AND ume.date = $2 AND ume.meal_type = $3 AND ume.enrolled = true`,
            [pg_id, date, meal_type]
        );

        // Opted out users (enrolled = false)
        const optedOutResult = await pool.query(
            `SELECT u.id, u.name, u.email, u.phone
             FROM user_meal_enrollments ume
             JOIN users u ON ume.user_id = u.id
             WHERE ume.pg_id = $1 AND ume.date = $2 AND ume.meal_type = $3 AND ume.enrolled = false`,
            [pg_id, date, meal_type]
        );

        // No-shows: enrolled but no attendance
        const noShowResult = await pool.query(
            `SELECT u.id, u.name, u.email, u.phone
             FROM user_meal_enrollments ume
             JOIN users u ON ume.user_id = u.id
             WHERE ume.pg_id = $1 AND ume.date = $2 AND ume.meal_type = $3 AND ume.enrolled = true
             AND NOT EXISTS (
                 SELECT 1 FROM attendance a
                 WHERE a.email = ume.email
                   AND a.pg_id = ume.pg_id
                   AND a.meal_type = ume.meal_type
                   AND a.date = ume.date
             )`,
            [pg_id, date, meal_type]
        );

        res.json({
            enrolled: enrolledResult.rows,
            opted_out: optedOutResult.rows,
            no_show: noShowResult.rows
        });
    } catch (err) {
        console.error('[ADMIN MEAL ENROLLMENT DETAILS] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch meal enrollment details', details: err.message });
    }
});


// GET /admin/meal-enrollment-counts
// Get count of users enrolled for each meal type and date for a given PG (admin)
// Optional: pass ?date=YYYY-MM-DD to get for a specific date, otherwise defaults to today (IST)
router.get('/meal-enrollment-counts', authenticateToken, async (req, res) => {
    // Declare all variables at the top
    const adminPgId = req.user && req.user.pg_id;
    const pg_id = req.query.pg_id || adminPgId;
    let { date } = req.query;
    if (!pg_id) {
        return res.status(400).json({ error: 'PG ID is required (query param or JWT)' });
    }
    console.log(`[MEAL ENROLLMENT COUNTS] Request received: pg_id=${pg_id}, date=${date || 'today (IST)'}`);
    console.log(`[MEAL ENROLLMENT COUNTS] Query params:`, req.query);

    // Helper function to get counts for a given date
    async function getCounts(targetDate) {
        const sql = `SELECT ume.meal_type,
                    COUNT(*) FILTER (WHERE ume.enrolled = true) AS enrolled_count,
                    COUNT(*) FILTER (WHERE ume.enrolled = false) AS opted_out_count,
                    COUNT(*) FILTER (
                        WHERE ume.enrolled = true
                        AND NOT EXISTS (
                            SELECT 1 FROM attendance a
                            WHERE a.email = ume.email
                              AND a.pg_id = ume.pg_id
                              AND a.meal_type = ume.meal_type
                              AND a.date = ume.date
                        )
                    ) AS no_show_count
             FROM user_meal_enrollments ume
             WHERE ume.pg_id = $1 AND ume.date = $2
             GROUP BY ume.meal_type
             ORDER BY ume.meal_type ASC`;
        console.log(`[MEAL ENROLLMENT COUNTS] Executing SQL:`, sql);
        console.log(`[MEAL ENROLLMENT COUNTS] SQL params:`, [pg_id, targetDate]);
        const countsResult = await pool.query(sql, [pg_id, targetDate]);
        console.log(`[MEAL ENROLLMENT COUNTS] Raw DB result:`, countsResult.rows);
        // For each meal type, only show no_show_count if meal is over
        return countsResult.rows.map(row => {
            const endTime = mealEndTimes[row.meal_type];
            const mealOver = endTime && isMealOver(row.meal_type, targetDate, endTime);
            console.log(`[MEAL ENROLLMENT COUNTS] meal_type=${row.meal_type}, date=${targetDate}, endTime=${endTime}, mealOver=${mealOver}, enrolled_count=${row.enrolled_count}, opted_out_count=${row.opted_out_count}, no_show_count=${row.no_show_count}`);
            if (!endTime || !mealOver) {
                console.log(`[MEAL ENROLLMENT COUNTS] Hiding no_show_count for meal_type=${row.meal_type} (meal not over)`);
                return { ...row, no_show_count: null };
            }
            console.log(`[MEAL ENROLLMENT COUNTS] Showing no_show_count for meal_type=${row.meal_type}`);
            return row;
        });
    }

    if (date) {
        try {
            const counts = await getCounts(date);
            console.log(`[MEAL ENROLLMENT COUNTS] Final response for date=${date}:`, JSON.stringify(counts, null, 2));
            res.json({ date, counts });
        } catch (err) {
            console.error('[ADMIN MEAL ENROLLMENT COUNTS] Error:', err.message);
            res.status(500).json({ error: 'Failed to fetch meal enrollment counts', details: err.message });
        }
    } else {
        const todayIST = getISTDateString();
        try {
            const counts = await getCounts(todayIST);
            console.log(`[MEAL ENROLLMENT COUNTS] Final response for date=${todayIST}:`, JSON.stringify(counts, null, 2));
            res.json({ date: todayIST, counts });
        } catch (err) {
            console.error('[ADMIN MEAL ENROLLMENT COUNTS] Error:', err.message);
            res.status(500).json({ error: 'Failed to fetch meal enrollment counts', details: err.message });
        }
    }
});


// Admin: Get total QR scans for today (optionally for a PG)
router.get('/qr-scans/today', authenticateToken, async (req, res) => {
    try {
        const adminPgId = req.user && req.user.pg_id;
        const pg_id = req.query.pg_id || adminPgId;
        // Build base query using IST date
        const todayIST = getISTDateString();

        let params = [todayIST];
        let whereClause = 'WHERE date = $1';
        if (pg_id) {
            params.push(pg_id);
            whereClause += ' AND pg_id = $2';
        }

        console.log(`[QR SCANS] Fetching QR scan counts for IST date=${todayIST}, pg_id=${pg_id || 'ALL'}`);

        // Total scans
        const totalResult = await pool.query(
            `SELECT COUNT(*)::int AS total FROM attendance ${whereClause}`,
            params
        );

        // Breakdown by meal_type
        const breakdownResult = await pool.query(
            `SELECT meal_type, COUNT(*)::int AS count FROM attendance ${whereClause} GROUP BY meal_type`,
            params
        );

        console.log(`[QR SCANS] Results for IST date=${todayIST}, pg_id=${pg_id || 'ALL'}: total=${totalResult.rows[0].total}, breakdown=${JSON.stringify(breakdownResult.rows)}`);

        res.json({ date: todayIST, pg_id: pg_id || null, total: totalResult.rows[0].total, breakdown: breakdownResult.rows });
    } catch (err) {
        console.error('[ADMIN QR SCANS TODAY] Error:', err.message);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});


// Admin: Send meal notification to users enrolled for a specific meal type and date
router.post('/send-meal-notification', authenticateToken, async (req, res) => {
    /*
        Request body: {
            pg_id: number,
            meal_type: string,
            date: string (YYYY-MM-DD),
            title: string,
            body: string
        }
    */
    try {
        const { pg_id, meal_type, date, title, body } = req.body;
        if (!pg_id || !meal_type || !date || !title || !body) {
            return res.status(400).json({ error: 'pg_id, meal_type, date, title, and body are required.' });
        }

        // Fetch users enrolled for this meal type and date in the PG
        const usersResult = await pool.query(
            `SELECT u.email, u.name, u.device_token FROM users u
             INNER JOIN user_meal_enrollments ume ON ume.user_id = u.id
             WHERE ume.pg_id = $1 AND ume.meal_type = $2 AND ume.date = $3 AND ume.enrolled = true AND u.device_token IS NOT NULL`,
            [pg_id, meal_type, date]
        );

        if (usersResult.rows.length === 0) {
            return res.status(404).json({ error: 'No enrolled users with device tokens found for this meal.' });
        }

        const adminId = req.user && (req.user.adminId || req.user.id);
        let successCount = 0;
        let failCount = 0;
        for (const user of usersResult.rows) {
            try {
                await sendPushNotification(user.device_token, title, body);
                // Add detailed logging for DB insert
                console.log('[MEAL NOTIFICATION][DB INSERT ATTEMPT]', {
                    user_id: user.user_id || user.id,
                    admin_id: adminId,
                    title,
                    body,
                    type: 'meal'
                });
                try {
                    await pool.query(
                        `INSERT INTO notifications (user_id, admin_id, title, message, type, sent_at, read)
                         VALUES ($1, $2, $3, $4, $5, NOW(), false)`,
                        [user.user_id || user.id, adminId, title, body, 'meal']
                    );
                    console.log('[MEAL NOTIFICATION][DB INSERT SUCCESS]', user.user_id || user.id);
                } catch (dbErr) {
                    console.error('[MEAL NOTIFICATION][DB INSERT ERROR]', dbErr.message, {
                        user_id: user.user_id || user.id,
                        admin_id: adminId,
                        title,
                        body,
                        type: 'meal'
                    });
                }
                console.log(`[MEAL NOTIFICATION] Sent to ${user.email} (${user.name || ''}) for ${meal_type} on ${date}`);
                successCount++;
            } catch (err) {
                console.warn(`[MEAL NOTIFICATION] Failed for ${user.email}:`, err.message);
                failCount++;
            }
        }

        return res.json({ message: `Meal notification sent to ${successCount} users. Failed for ${failCount} users.` });
    } catch (err) {
        console.error('[MEAL NOTIFICATION] Error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
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

// Admin triggers push notifications to all users enrolled in a PG (refactored to use notificationService)
router.post('/sendNotifications', authenticateToken, async (req, res) => {
    const { title, body, pg_id } = req.body;
    if (!title || !body || !pg_id) {
        return res.status(400).json({ error: 'title, body, and pg_id are required' });
    }
    try {
        await broadcastToPG({ pgId: pg_id, title, message: body, type: 'admin-broadcast' });
        res.json({ success: true, message: 'Notifications sent to all enrolled users.' });
    } catch (err) {
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
            // Send push notification to the user
            try {
                // Get user email and device token
                const userEmailResult = await pool.query('SELECT email, name, device_token FROM users WHERE id = $1', [user_id]);
                // Fetch PG name
                const pgResult = await pool.query('SELECT name FROM pgs WHERE id = $1', [pg_id]);
                const pgName = pgResult.rows.length > 0 ? pgResult.rows[0].name : `PG ${pg_id}`;
                if (userEmailResult.rows.length > 0) {
                    const user = userEmailResult.rows[0];
                    if (user.device_token) {
                        const title = 'Enrollment Approved';
                        const body = `Hi ${user.name || user.email}, your enrollment for ${pgName} has been approved!`;
                        await sendPushNotification(user.device_token, title, body);
                        // Save notification in DB after successful send
                        const adminId = req.user && (req.user.adminId || req.user.id);
                        await pool.query(
                            `INSERT INTO notifications (user_id, admin_id, title, message, type, sent_at, read)
                             VALUES ($1, $2, $3, $4, $5, NOW(), false)`,
                            [user_id, adminId, title, body, 'enrollment-approved']
                        );
                        console.log(`[APPROVE ENROLLMENT] Notification sent to user (${user.email}) for PG ${pgName}`);
                    } else {
                        console.warn(`[APPROVE ENROLLMENT] User (${user.email}) has no device token, notification not sent.`);
                    }
                } else {
                    console.warn(`[APPROVE ENROLLMENT] No user found for id: ${user_id}, notification not sent.`);
                }
            } catch (notifyErr) {
                console.error(`[APPROVE ENROLLMENT] Error sending notification to user (${user_id}):`, notifyErr.message);
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
    console.log('[MARK ATTENDANCE] Full request body:', req.body);
    let { email, meal_type } = req.body;
    // Support email as stringified object, object, or string
    if (typeof email === 'string' && email.startsWith('{')) {
        try {
            email = JSON.parse(email).email;
        } catch (e) {
            console.warn('[MARK ATTENDANCE] Could not parse stringified email object:', email);
            return res.status(400).json({ error: 'Invalid email format' });
        }
    } else if (typeof email === 'object' && email.email) {
        email = email.email;
    }
    if (!email || typeof email !== 'string') {
        console.warn('[MARK ATTENDANCE] Email missing or invalid in request body');
        return res.status(400).json({ error: 'Email is required as a string' });
    }
    if (!meal_type) {
        console.warn('[MARK ATTENDANCE] Meal type missing in request body');
        return res.status(400).json({ error: 'Meal type is required' });
    }
    console.log('[MARK ATTENDANCE] Request received for email:', email, 'meal_type:', meal_type);

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



    // Get today's date in IST
    const meal_date = getISTDateString();
    console.log(`[MARK ATTENDANCE] Meal date (IST): ${meal_date}`);

        // Check if user is enrolled for this meal type and date
        const mealEnrollResult = await pool.query(
            'SELECT * FROM user_meal_enrollments WHERE email = $1 AND pg_id = $2 AND meal_type = $3 AND date = $4',
            [email, adminPgId, meal_type, meal_date]
        );
        if (mealEnrollResult.rows.length === 0) {
            console.warn('[MARK ATTENDANCE] User not enrolled for this meal');
            return res.status(403).json({ error: 'User not enrolled for this meal' });
        }

        // Persist attendance and prevent duplicates
        const attendanceCheck = await pool.query(
            'SELECT * FROM attendance WHERE email = $1 AND pg_id = $2 AND meal_type = $3 AND date = $4',
            [email, adminPgId, meal_type, meal_date]
        );
        if (attendanceCheck.rows.length > 0) {
                console.warn('[MARK ATTENDANCE] Attendance already marked for user:', email, 'meal_type:', meal_type, 'date:', meal_date);
                return res.status(409).json({ message: 'Attendance already marked' });
        }
            await pool.query(
                'INSERT INTO attendance (email, pg_id, meal_type, date) VALUES ($1, $2, $3, $4)',
                [email, adminPgId, meal_type, meal_date]
            );
        console.log('[MARK ATTENDANCE] Attendance marked for user:', email, 'meal_type:', meal_type, 'date:', meal_date);
            res.json({ message: 'Attendance marked' });
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
    const token = jwt.sign({ adminId: admin.id, role: 'admin', username: admin.username }, process.env.JWT_SECRET, { expiresIn: '1d' });
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
