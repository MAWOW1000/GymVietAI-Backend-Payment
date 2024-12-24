const pool = require('../config/database');
const authPool = require('../config/authDatabase');
const messages = require('../config/messages');
const vnpayService = require('../services/vnpayService');
const emailService = require('../services/emailService');
const paymentValidationService = require('../services/paymentValidationService');
const paymentService = require('../services/paymentService');
const { sendResponse, sendError, asyncHandler } = require('../middleware/responseHandler');
const axios = require('axios');
const { createHmac } = require('crypto');
const querystring = require('qs');

const config = {
    vnp_TmnCode: process.env.VNP_TMN_CODE,
    vnp_HashSecret: process.env.VNP_HASH_SECRET,
    vnp_Url: process.env.VNP_URL,
    vnp_ReturnUrl: process.env.VNP_RETURN_URL
};

class PaymentController {
    // Get all subscription plans
    getPlans = asyncHandler(async (req, res) => {
        const plans = await paymentService.getSubscriptionPlans();
        sendResponse(res, plans);
    });

    // Create a new payment
    createPayment = asyncHandler(async (req, res) => {
        try {
            const { userId, planId } = req.body;
            
            if (!userId || !planId) {
                return res.json({
                    EC: 1,
                    EM: "Missing required parameters",
                    DT: null
                });
            }

            const result = await paymentService.createOrder(userId, planId, req.ip || '127.0.0.1');
            return res.json({
                EC: 0,
                EM: "Success",
                DT: result
            });
        } catch (error) {
            console.error('Error creating payment:', error);
            return res.json({
                EC: 99,
                EM: error.message || "Error creating payment",
                DT: null
            });
        }
    });

    // Get payment history for a user
    getPaymentHistory = asyncHandler(async (req, res) => {
        const userId = req.user?.id;  // Should come from auth middleware
        const history = await paymentService.getPaymentHistory(userId);
        sendResponse(res, history);
    });

    // Handle VNPay return URL
    handleVNPayReturn = asyncHandler(async (req, res) => {
        try {
            const result = await vnpayService.processReturnUrl(req.query);
            
            return res.json({
                EC: result.status === 'success' ? 0 : 1,
                EM: result.message,
                DT: result.data
            });
        } catch (error) {
            console.error('Error processing return URL:', error);
            return res.json({
                EC: 99,
                EM: error.message || "Error processing payment return",
                DT: null
            });
        }
    });

    // Handle VNPay IPN
    handleVNPayIPN = asyncHandler(async (req, res) => {
        try {
            const result = await vnpayService.processIPN(req.body);
            
            return res.json({
                EC: result.RspCode === '00' ? 0 : parseInt(result.RspCode),
                EM: result.Message,
                DT: result.RspCode === '00' ? {
                    RspCode: result.RspCode,
                    orderId: req.body.vnp_TxnRef
                } : null
            });
        } catch (error) {
            console.error('Error processing IPN:', error);
            return res.json({
                EC: 99,
                EM: "Error processing IPN",
                DT: null
            });
        }
    });

    // Get specific order details
    getOrder = asyncHandler(async (req, res) => {
        const orderId = req.params.orderId;
        const order = await paymentService.getOrderDetails(orderId);
        sendResponse(res, order);
    });

    // Cancel an order
    cancelOrder = asyncHandler(async (req, res) => {
        const orderId = req.params.orderId;
        const result = await paymentService.cancelOrder(orderId);
        sendResponse(res, result);
    });

    // Retry a failed payment
    retryPayment = asyncHandler(async (req, res) => {
        const orderId = req.params.orderId;
        const result = await paymentService.retryPayment(orderId);
        sendResponse(res, result);
    });

    // Admin: Get all orders
    getAllOrders = asyncHandler(async (req, res) => {
        const orders = await paymentService.getAllOrders();
        sendResponse(res, orders);
    });

    // Get payment statistics
    getPaymentStatistics = asyncHandler(async (req, res) => {
        const [summary] = await pool.execute(`
            SELECT 
                COUNT(*) as total_orders,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_orders,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
                SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_revenue
            FROM orders
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        `);

        const [planStats] = await pool.execute(`
            SELECT 
                p.name as plan_name,
                COUNT(*) as total_orders,
                SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
                SUM(CASE WHEN o.status = 'completed' THEN o.amount ELSE 0 END) as revenue
            FROM orders o
            JOIN subscription_plans p ON o.plan_id = p.id
            WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY p.id, p.name
        `);

        sendResponse(res, {
            summary: summary[0],
            planStats
        });
    });

    // Create subscription plan
    createPlan = asyncHandler(async (req, res) => {
        const { name, description, price, duration, features } = req.body;
        const id = `${name.toLowerCase().replace(/\s+/g, '-')}-${duration}`;

        await pool.execute(
            'INSERT INTO subscription_plans (id, name, description, price, duration, features) VALUES (?, ?, ?, ?, ?, ?)',
            [id, name, description, price, duration, JSON.stringify(features)]
        );

        sendResponse(res, { message: 'Plan created successfully' });
    });

    // Update subscription plan
    updatePlan = asyncHandler(async (req, res) => {
        const { planId } = req.params;
        const { name, description, price, duration, features, is_active } = req.body;

        // Validate required fields
        if (!planId || !name || !description || !price || !duration) {
            return sendError(res, new Error('Missing required fields'), 400);
        }

        // Convert is_active to boolean with default value
        const isActive = is_active === undefined ? true : Boolean(is_active);

        await pool.execute(
            `UPDATE subscription_plans 
            SET name = ?, description = ?, price = ?, duration = ?, 
                features = ?, is_active = ?
            WHERE id = ?`,
            [
                name, 
                description, 
                price, 
                duration, 
                JSON.stringify(features || {}), 
                isActive, 
                planId
            ]
        );

        sendResponse(res, { message: 'Plan updated successfully' });
    });

    // Delete subscription plan
    deletePlan = asyncHandler(async (req, res) => {
        const { planId } = req.params;

        // Kiểm tra xem có đơn hàng nào đang sử dụng plan này không
        const [orders] = await pool.execute(
            'SELECT COUNT(*) as count FROM orders WHERE plan_id = ? AND status IN ("pending", "completed")',
            [planId]
        );

        if (orders[0].count > 0) {
            return sendError(res, new Error('Cannot delete plan that has active orders'), 400);
        }

        await pool.execute(
            'DELETE FROM subscription_plans WHERE id = ?',
            [planId]
        );

        sendResponse(res, { message: 'Plan deleted successfully' });
    });

    // Get all orders
    getAllOrders = asyncHandler(async (req, res) => {
        const { 
            status, 
            startDate, 
            endDate, 
            page = 1, 
            limit = 10 
        } = req.query;

        const offset = (page - 1) * limit;
        let query = `
            SELECT o.*, p.name as plan_name
            FROM orders o
            JOIN subscription_plans p ON o.plan_id = p.id
            WHERE 1=1
        `;
        const params = [];

        if (status && status.trim()) {
            query += ' AND o.status = ?';
            params.push(status.trim());
        }

        if (startDate && startDate.trim()) {
            query += ' AND o.created_at >= ?';
            params.push(startDate.trim());
        }

        if (endDate && endDate.trim()) {
            query += ' AND o.created_at <= ?';
            params.push(endDate.trim());
        }

        // Add pagination
        query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
        params.push(Number(limit), Number(offset));

        // Get orders
        const [orders] = await pool.execute(query, params);

        // Get user info for each order
        const ordersWithUserInfo = await Promise.all(orders.map(async (order) => {
            try {
                const [users] = await authPool.execute(
                    'SELECT email FROM users WHERE id = ?',
                    [order.user_id]
                );
                return {
                    ...order,
                    user_email: users[0]?.email || 'Unknown'
                };
            } catch (error) {
                console.error(`Error fetching user info for order ${order.id}:`, error);
                return { ...order, user_email: 'Unknown' };
            }
        }));

        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) as count FROM orders WHERE 1=1';
        const countParams = [];
        
        if (status && status.trim()) {
            countQuery += ' AND status = ?';
            countParams.push(status.trim());
        }

        const [totalCount] = await pool.execute(countQuery, countParams);

        sendResponse(res, {
            orders: ordersWithUserInfo,
            pagination: {
                total: totalCount[0].count,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(totalCount[0].count / limit)
            }
        });
    });

    // Update order status
    updateOrderStatus = asyncHandler(async (req, res) => {
        const { orderId } = req.params;
        const { status, note = '' } = req.body;

        if (!orderId || !status) {
            return sendError(res, new Error('Order ID and status are required'), 400);
        }

        await pool.execute(
            `UPDATE orders 
            SET status = ?, 
                admin_note = ?,
                updated_at = NOW()
            WHERE id = ?`,
            [status, note || null, orderId]
        );

        // Log the status change
        await pool.execute(
            'INSERT INTO payment_logs (order_id, event_type, data) VALUES (?, ?, ?)',
            [orderId, 'admin_status_change', JSON.stringify({ status, note: note || null })]
        );

        sendResponse(res, { message: 'Order status updated successfully' });
    });
}

module.exports = new PaymentController();
