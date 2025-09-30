
const cron = require('node-cron');
const pool = require('../config/db');
const nodemailer = require('nodemailer');
const { sendPushNotification } = require('../utils/notifications');

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Send a generic email notification
async function sendEmailNotification({ to, subject, message }) {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    text: message,
  });
}

// Send OTP email
async function sendOtpEmail({ to, otp }) {
  const subject = 'Your OTP Code';
  const message = `Your OTP code is: ${otp}`;
  await sendEmailNotification({ to, subject, message });
}

// Schedule notifications for meals
cron.schedule('0 8 * * *', async () => { // 8:00 AM for breakfast
  await triggerMealNotification('Breakfast');
});
cron.schedule('0 13 * * *', async () => { // 1:00 PM for lunch
  await triggerMealNotification('Lunch');
});
cron.schedule('0 19 * * *', async () => { // 7:00 PM for dinner
  await triggerMealNotification('Dinner');
});

// Trigger notifications for a meal type
async function triggerMealNotification(mealType) {
  const today = new Date().toISOString().slice(0, 10);
  // Find enrolled users for this meal
  const result = await pool.query(
    `SELECT u.email FROM users u
     JOIN meal_responses mr ON u.id = mr.user_id
     JOIN meals m ON mr.meal_id = m.id
     WHERE m.type = $1 AND m.date = $2 AND mr.enrolled = true`,
    [mealType, today]
  );
  for (const row of result.rows) {
    await sendNotification(row.email, `${mealType} Notification`, `Your ${mealType} is scheduled for today.`);
  }
}

// const { sendPushNotification } = require('../utils/notifications');

// Send notification to a user (push + DB + optional email)
async function notifyUser({ userId, title, message, type, email = false }) {
  // Fetch user info
  const userRes = await pool.query('SELECT device_token, email FROM users WHERE id = $1', [userId]);
  if (userRes.rows.length) {
    const { device_token, email: userEmail } = userRes.rows[0];
    // If this is a successful enrollment notification, add redirectUrl to dashboard
    let redirectUrl;
    if (type === 'enrollment-success') {
      redirectUrl = '/user/dashboard'; // Adjust as needed for your frontend route
    }
    if (device_token) {
      await sendPushNotification(device_token, title, message, redirectUrl);
    }
    if (email && userEmail) {
      await sendEmailNotification({ to: userEmail, subject: title, message });
    }
  }
  // Save in DB
  await pool.query(
    `INSERT INTO notifications (user_id, admin_id, title, message, type, sent_at, read)
     VALUES ($1, NULL, $2, $3, $4, NOW(), false)`,
    [userId, title, message, type]
  );
}

// Send notification to an admin (push + DB + optional email)
async function notifyAdmin({ adminId, title, message, type, email = false }) {
  const adminRes = await pool.query('SELECT device_token, email FROM admins WHERE id = $1', [adminId]);
  if (adminRes.rows.length) {
    const { device_token, email: adminEmail } = adminRes.rows[0];
    // If this is an enrollment notification, add redirectUrl to enrollment page
    let redirectUrl;
    if (type === 'enrollment') {
      redirectUrl = '/admin/enrollments'; // Adjust as needed for your frontend route
    }
    if (device_token) {
      await sendPushNotification(device_token, title, message, redirectUrl);
    }
    if (email && adminEmail) {
      await sendEmailNotification({ to: adminEmail, subject: title, message });
    }
  }
  await pool.query(
    `INSERT INTO notifications (user_id, admin_id, title, message, type, sent_at, read)
     VALUES (NULL, $1, $2, $3, $4, NOW(), false)`,
    [adminId, title, message, type]
  );
}

// Broadcast to all users in a PG (push + DB + optional email)
async function broadcastToPG({ pgId, title, message, type, email = false }) {
  const users = await pool.query(
    `SELECT id, device_token, email FROM users
     WHERE id IN (SELECT user_id FROM enrollments WHERE pg_id = $1 AND status = 2)`,
    [pgId]
  );
  for (const user of users.rows) {
    if (user.device_token) {
      await sendPushNotification(user.device_token, title, message);
    }
    if (email && user.email) {
      await sendEmailNotification({ to: user.email, subject: title, message });
    }
    await pool.query(
      `INSERT INTO notifications (user_id, admin_id, title, message, type, sent_at, read)
       VALUES ($1, NULL, $2, $3, $4, NOW(), false)`,
      [user.id, title, message, type]
    );
  }
}

module.exports = {
  notifyUser,
  notifyAdmin,
  broadcastToPG,
  sendEmailNotification,
  sendOtpEmail
};
