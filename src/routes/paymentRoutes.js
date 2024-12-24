const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Basic routes
router.get('/plans', paymentController.getPlans);
router.post('/create', paymentController.createPayment);
router.get('/history', paymentController.getPaymentHistory);

// VNPay specific routes
router.get('/vnpay_return', paymentController.handleVNPayReturn);
router.post('/vnpay_ipn', paymentController.handleVNPayIPN);

// Order management routes
router.get('/orders/:orderId', paymentController.getOrder);
router.post('/orders/:orderId/cancel', paymentController.cancelOrder);
router.post('/orders/:orderId/retry', paymentController.retryPayment);

// Admin routes
router.get('/admin/orders', paymentController.getAllOrders);

module.exports = router;
