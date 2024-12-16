const pool = require('../config/database');
const authPool = require('../config/authDatabase');
const { v4: uuidv4 } = require('uuid');
const vnpayService = require('./vnpayService');

class PaymentService {
    // Lấy danh sách gói subscription
    async getSubscriptionPlans() {
        const [plans] = await pool.execute(
            'SELECT * FROM subscription_plans WHERE is_active = true ORDER BY price ASC'
        );
        return plans;
    }

    // Tạo đơn hàng mới
    async createOrder(userId, planId, ipAddr) {
        // Kiểm tra plan có tồn tại
        const [plans] = await pool.execute(
            'SELECT * FROM subscription_plans WHERE id = ? AND is_active = true',
            [planId]
        );

        if (plans.length === 0) {
            throw new Error('Subscription plan not found or inactive');
        }

        // Kiểm tra user có tồn tại
        const [users] = await authPool.execute(
            'SELECT id FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            throw new Error('User not found');
        }

        const plan = plans[0];
        const orderId = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Tạo đơn hàng trong database
        await pool.execute(
            'INSERT INTO orders (id, user_id, plan_id, amount, status) VALUES (?, ?, ?, ?, ?)',
            [orderId, userId, planId, plan.price, 'pending']
        );

        // Tạo URL thanh toán VNPay
        const { paymentUrl } = vnpayService.createPaymentUrl(
            orderId,
            plan.price,
            `Thanh toan goi ${plan.name}`,
            ipAddr
        );

        return {
            orderId,
            paymentUrl,
            amount: plan.price
        };
    }

    // Lấy thông tin đơn hàng
    async getOrder(orderId) {
        const [orders] = await pool.execute(
            'SELECT o.*, p.name as plan_name, p.duration FROM orders o ' +
            'JOIN subscription_plans p ON o.plan_id = p.id ' +
            'WHERE o.id = ?',
            [orderId]
        );

        if (orders.length === 0) {
            throw new Error('Order not found');
        }

        return orders[0];
    }

    // Lấy lịch sử thanh toán của user
    async getPaymentHistory(userId) {
        const [orders] = await pool.execute(
            'SELECT o.*, p.name as plan_name, p.duration FROM orders o ' +
            'JOIN subscription_plans p ON o.plan_id = p.id ' +
            'WHERE o.user_id = ? ' +
            'ORDER BY o.created_at DESC',
            [userId]
        );

        return orders;
    }

    // Cập nhật trạng thái đơn hàng
    async updateOrderStatus(orderId, status, transactionData = null) {
        const completedAt = status === 'completed' ? new Date() : null;
        
        await pool.execute(
            'UPDATE orders SET status = ?, transaction_id = ?, vnp_response = ?, completed_at = ?, updated_at = NOW() WHERE id = ?',
            [status, transactionData?.transactionNo || null, JSON.stringify(transactionData), completedAt, orderId]
        );

        // Log payment event
        await pool.execute(
            'INSERT INTO payment_logs (order_id, event_type, data) VALUES (?, ?, ?)',
            [orderId, `payment_${status}`, JSON.stringify(transactionData)]
        );

        return await this.getOrder(orderId);
    }

    // Hủy đơn hàng
    async cancelOrder(orderId, userId) {
        const order = await this.getOrder(orderId);
        
        if (order.user_id !== userId) {
            throw new Error('Unauthorized to cancel this order');
        }

        if (order.status !== 'pending') {
            throw new Error('Can only cancel pending orders');
        }

        return await this.updateOrderStatus(orderId, 'cancelled');
    }

    // Tạo lại URL thanh toán cho đơn hàng
    async retryPayment(orderId, userId, ipAddr) {
        const order = await this.getOrder(orderId);
        
        if (order.user_id !== userId) {
            throw new Error('Unauthorized to retry this order');
        }

        if (order.status !== 'failed' && order.status !== 'expired') {
            throw new Error('Can only retry failed or expired orders');
        }

        // Tạo URL thanh toán mới
        const { paymentUrl } = vnpayService.createPaymentUrl(
            orderId,
            order.amount,
            `Thanh toan lai goi ${order.plan_name}`,
            ipAddr
        );

        // Cập nhật trạng thái đơn hàng về pending
        await this.updateOrderStatus(orderId, 'pending');

        return {
            orderId,
            paymentUrl,
            amount: order.amount
        };
    }
}

module.exports = new PaymentService();
