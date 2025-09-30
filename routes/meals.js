const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticateToken = require('../middleware/authenticateToken');
const { getISTDateString } = require('../utils/date');
const { broadcastToPG } = require('../services/notificationService');

// Get meal menu for a PG and date
router.get('/menu', authenticateToken, async (req, res) => {
    const { pg_id, date } = req.query;
    console.log(`[GET MEAL MENU] Request received: pg_id=${pg_id}, date=${date}`);
    if (!pg_id || !date) {
        console.warn('[GET MEAL MENU] Missing pg_id or date in query params');
        return res.status(400).json({ error: 'pg_id and date are required as query params' });
    }
    try {
        const user_email = req.user.email;
        console.log('[GET MEAL MENU] Querying meal_menus table');
        const result = await pool.query(
            'SELECT meal_type, items, date FROM meal_menus WHERE pg_id = $1 AND date = $2',
            [pg_id, date]
        );
        console.log('[GET MEAL MENU] Meals found:', result.rows.length);
        // For each meal, fetch the user's enrollment status
        const mealsWithStatus = await Promise.all(result.rows.map(async meal => {
            const enrollResult = await pool.query(
                'SELECT enrolled FROM user_meal_enrollments WHERE email = $1 AND pg_id = $2 AND meal_type = $3 AND date = $4',
                [user_email, pg_id, meal.meal_type, date]
            );
            return {
                ...meal,
                enrolled: enrollResult.rows.length > 0 ? enrollResult.rows[0].enrolled : undefined
            };
        }));
        const response = { meals: mealsWithStatus };
        console.log('[GET MEAL MENU] Response:', JSON.stringify(response));
        res.json(response);
    } catch (err) {
        console.error('[GET MEAL MENU] Error:', err.message);
        res.status(500).json({ error: 'Failed to fetch meal menu', details: err.message });
    }
});

// Save or update meal menu for a PG, date, and meal_type
router.post('/menu', authenticateToken, async (req, res) => {
    const { pg_id, date, meal_type, items } = req.body;
    console.log(`[SAVE MEAL MENU] Request received: pg_id=${pg_id}, date=${date}, meal_type=${meal_type}, items=${JSON.stringify(items)}`);
    if (!pg_id || !date || !meal_type || !Array.isArray(items)) {
        console.warn('[SAVE MEAL MENU] Missing required fields in request body');
        return res.status(400).json({ error: 'pg_id, date, meal_type, and items[] are required' });
    }
    try {
        console.log('[SAVE MEAL MENU] Upserting meal menu');
        const upsert = await pool.query(
            `INSERT INTO meal_menus (pg_id, date, meal_type, items) VALUES ($1, $2, $3, $4)
             ON CONFLICT (pg_id, date, meal_type)
             DO UPDATE SET items = $4, updated_at = NOW()
             RETURNING *`,
            [pg_id, date, meal_type, JSON.stringify(items)]
        );
        console.log('[SAVE MEAL MENU] Upserted meal:', upsert.rows[0]);

        // Enroll all users in the PG for this meal/date by default (enrolled=true) if not already present
        try {
            const usersResult = await pool.query(
                `SELECT u.id, u.email, u.name, u.device_token FROM users u
                 INNER JOIN enrollments e ON e.user_id = u.id
                 WHERE e.pg_id = $1`,
                [pg_id]
            );
            if (usersResult.rows.length > 0) {
                for (const user of usersResult.rows) {
                    // Insert only if not already present
                    await pool.query(
                        `INSERT INTO user_meal_enrollments (user_id, pg_id, email, date, meal_type, enrolled, created_at)
                         VALUES ($1, $2, $3, $4, $5, true, NOW())
                         ON CONFLICT (user_id, pg_id, date, meal_type) DO NOTHING`,
                        [user.id, pg_id, user.email, date, meal_type]
                    );
                }
                // Send meal menu notification using notificationService
                const title = `Meal Menu Updated: ${meal_type}`;
                const body = `Today's menu: ${items.join(', ')}`;
                await broadcastToPG({ pgId: pg_id, title, message: body, type: 'meal-menu' });
                console.log(`[MEAL MENU NOTIFICATION] Notification sent to all PG members for ${meal_type} on ${date}`);
            } else {
                console.log('[MEAL MENU NOTIFICATION] No PG members found.');
            }
        } catch (notifyErr) {
            console.error('[MEAL MENU NOTIFICATION] Error:', notifyErr.message);
        }

        res.json({ success: true, meal: upsert.rows[0] });
    } catch (err) {
        console.error('[SAVE MEAL MENU] Error:', err.message);
        res.status(500).json({ error: 'Failed to save meal menu', details: err.message });
    }
});

// Remove an item from a meal menu
router.delete('/menu/item', authenticateToken, async (req, res) => {
    const { pg_id, date, meal_type, item } = req.body;
    console.log(`[DELETE MEAL ITEM] Request received: pg_id=${pg_id}, date=${date}, meal_type=${meal_type}, item=${item}`);
    if (!pg_id || !date || !meal_type || !item) {
        console.warn('[DELETE MEAL ITEM] Missing required fields in request body');
        return res.status(400).json({ error: 'pg_id, date, meal_type, and item are required' });
    }
    try {
        // Fetch current items
        console.log('[DELETE MEAL ITEM] Fetching current items');
        const result = await pool.query(
            'SELECT items FROM meal_menus WHERE pg_id = $1 AND date = $2 AND meal_type = $3',
            [pg_id, date, meal_type]
        );
        if (result.rows.length === 0) {
            console.warn('[DELETE MEAL ITEM] Meal menu not found for pg_id:', pg_id, 'date:', date, 'meal_type:', meal_type);
            return res.status(404).json({ error: 'Meal menu not found' });
        }
        let items = result.rows[0].items;
        if (!Array.isArray(items)) items = [];
        const newItems = items.filter(i => i !== item);
        // Update items
        console.log('[DELETE MEAL ITEM] Updating items after removal');
        await pool.query(
            'UPDATE meal_menus SET items = $1, updated_at = NOW() WHERE pg_id = $2 AND date = $3 AND meal_type = $4',
            [JSON.stringify(newItems), pg_id, date, meal_type]
        );
        console.log('[DELETE MEAL ITEM] Updated items:', newItems);
        res.json({ success: true, items: newItems });
    } catch (err) {
        console.error('[DELETE MEAL ITEM] Error:', err.message);
        res.status(500).json({ error: 'Failed to delete meal item', details: err.message });
    }
});

module.exports = router;
