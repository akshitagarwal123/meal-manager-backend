-- PGs Table
CREATE TABLE pgs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users Table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100),
    email VARCHAR(100),
    company VARCHAR(100),
    room_no VARCHAR(20),
    pg_id INTEGER REFERENCES pgs(id),
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Meals Table
CREATE TABLE meals (
    id SERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL, -- breakfast/lunch/dinner
    date DATE NOT NULL,
    menu TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications Table
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    meal_id INTEGER REFERENCES meals(id),
    message TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Meal Responses Table
CREATE TABLE meal_responses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    meal_id INTEGER REFERENCES meals(id),
    opted_in BOOLEAN,
    responded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE email_otps (
    email VARCHAR(100) NOT NULL,
    otp VARCHAR(10) NOT NULL,
    username VARCHAR(100),
    expires_at TIMESTAMP NOT NULL
);
