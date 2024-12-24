const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.AUTH_DB_HOST || 'localhost',
    user: process.env.AUTH_DB_USER || 'root',
    password: process.env.AUTH_DB_PASSWORD || '',
    database: process.env.AUTH_DB_NAME || 'auth_service',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;
