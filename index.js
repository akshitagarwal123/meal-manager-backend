require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json()); // <-- Parse JSON bodies before routes
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Basic CORS support for mobile/dev usage.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// User routes
const userRoutes = require('./routes/user');
app.use('/user', userRoutes);


// Auth routes (OTP, login, etc.)
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes);
// Backward-compatible alias for older clients still calling /email-auth/*
app.use('/email-auth', authRoutes);


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

app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});
