const cron = require('node-cron');
const pool = require('../config/db');
const nodemailer = require('nodemailer');

// Email transporter setup (reuse your config/email.js if available)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Function to send notification email
async function sendNotification(email, subject, message) {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject,
    text: message,
  });
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

module.exports = {};
