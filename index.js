
const express = require('express');
const app = express();
app.use(express.json()); // <-- Parse JSON bodies before routes
const PORT = process.env.PORT || 3000;

// User routes
const userRoutes = require('./routes/user');
app.use('/user', userRoutes);


// Auth routes (OTP, login, etc.)
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);


// Admin routes
const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);

// Meals routes
const mealsRoutes = require('./routes/meals');
app.use('/meals', mealsRoutes);



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
