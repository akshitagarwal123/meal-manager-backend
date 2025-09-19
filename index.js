
const express = require('express');
const app = express();
app.use(express.json()); // <-- Parse JSON bodies before routes
const PORT = process.env.PORT || 3000;

// User routes
const userRoutes = require('./routes/user');
app.use('/user', userRoutes);

// Email OTP Auth routes
const emailAuthRoutes = require('./routes/emailAuth');
app.use('/email-auth', emailAuthRoutes);

// Admin routes
const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);



app.get('/', (req, res) => {
  res.send('Meal Manager Backend is running!');
});

// Simple ping endpoint for health check
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// Sample route for meals
app.get('/meals', (req, res) => {
  res.json({ meals: [] }); // Placeholder for meal data
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
