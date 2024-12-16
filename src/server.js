const express = require('express');
const cors = require('cors');
require('dotenv').config();

const paymentRoutes = require('./routes/paymentRoutes');
const paymentController = require('./controllers/paymentController'); // Added this line

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/payment', paymentRoutes);

// VNPay routes
app.get('/api/payment/vnpay_ipn', paymentController.handleVNPayIPN);
app.get('/api/payment/vnpay_return', paymentController.handleVNPayReturn);

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
    console.log(`Payment Service running on port ${PORT}`);
});
