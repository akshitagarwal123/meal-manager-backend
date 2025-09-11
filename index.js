const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Meal Manager Backend is running!');
});

// Sample route for meals
app.get('/meals', (req, res) => {
  res.json({ meals: [] }); // Placeholder for meal data
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
