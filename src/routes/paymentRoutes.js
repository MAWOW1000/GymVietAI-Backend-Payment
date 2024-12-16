const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Public routes
router.get('/plans', paymentController.getPlans);
router.get('/vnpay_return', paymentController.handleVNPayReturn);
router.post('/vnpay_ipn', paymentController.handleVNPayIPN);

// Protected routes (yêu cầu đăng nhập)
router.use(authenticateToken);

// Tạo đơn hàng và lấy URL thanh toán
router.post('/create', paymentController.createPayment);

// Lấy lịch sử thanh toán của user
router.get('/history', paymentController.getPaymentHistory);

// Lấy chi tiết một đơn hàng
router.get('/orders/:orderId', paymentController.getOrder);

// Hủy đơn hàng (nếu chưa thanh toán)
router.post('/orders/:orderId/cancel', paymentController.cancelOrder);

// Tạo lại URL thanh toán cho đơn hàng thất bại
router.post('/orders/:orderId/retry', paymentController.retryPayment);

// Admin routes (yêu cầu quyền admin)
router.use(authenticateToken, (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Không có quyền truy cập' });
    }
    next();
});

// Thống kê thanh toán
router.get('/admin/statistics', paymentController.getPaymentStatistics);

// Quản lý gói dịch vụ
router.post('/admin/plans', paymentController.createPlan);
router.put('/admin/plans/:planId', paymentController.updatePlan);
router.delete('/admin/plans/:planId', paymentController.deletePlan);

// Quản lý đơn hàng
router.get('/admin/orders', paymentController.getAllOrders);
router.put('/admin/orders/:orderId', paymentController.updateOrderStatus);

module.exports = router;
