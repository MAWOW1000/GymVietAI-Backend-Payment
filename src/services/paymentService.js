const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const vnpayService = require('./vnpayService');

class PaymentService {
    // Get subscription plans
    async getSubscriptionPlans() {
        const [plans] = await pool.execute(
            'SELECT * FROM subscription_plans WHERE is_active = true ORDER BY price ASC'
        );
        return plans;
    }

    // Create new order
    async createOrder(userId, planId, ipAddr) {
        // Check if plan exists
        const [plans] = await pool.execute(
            'SELECT * FROM subscription_plans WHERE id = ? AND is_active = true',
            [planId]
        );

        if (plans.length === 0) {
            throw new Error('Subscription plan not found or inactive');
        }

        const plan = plans[0];
        const orderId = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create order in database
        await pool.execute(
            'INSERT INTO orders (id, user_id, plan_id, amount, status) VALUES (?, ?, ?, ?, ?)',
            [orderId, userId, planId, plan.price, 'pending']
        );

        // Create VNPay payment URL
        const paymentUrl = await vnpayService.createPaymentUrl(
            orderId,
            plan.price,
            `Payment for ${plan.name}`,
            ipAddr
        );

        return {
            orderId,
            paymentUrl,
            plan
        };
    }

    // Get payment history
    async getPaymentHistory(userId) {
        const [orders] = await pool.execute(
            `SELECT o.*, p.name as plan_name, p.duration 
            FROM orders o 
            JOIN subscription_plans p ON o.plan_id = p.id 
            WHERE o.user_id = ? 
            ORDER BY o.created_at DESC`,
            [userId]
        );
        return orders;
    }

    // Get order details
    async getOrderDetails(orderId) {
        const [orders] = await pool.execute(
            `SELECT o.*, p.name as plan_name, p.duration 
            FROM orders o 
            JOIN subscription_plans p ON o.plan_id = p.id 
            WHERE o.id = ?`,
            [orderId]
        );

        if (orders.length === 0) {
            throw new Error('Order not found');
        }

        return orders[0];
    }

    // Cancel order
    async cancelOrder(orderId) {
        const [orders] = await pool.execute(
            'SELECT * FROM orders WHERE id = ? AND status = "pending"',
            [orderId]
        );

        if (orders.length === 0) {
            throw new Error('Order not found or cannot be cancelled');
        }

        await pool.execute(
            'UPDATE orders SET status = "cancelled" WHERE id = ?',
            [orderId]
        );

        return { message: 'Order cancelled successfully' };
    }

    // Retry payment
    async retryPayment(orderId) {
        const [orders] = await pool.execute(
            `SELECT o.*, p.name as plan_name 
            FROM orders o 
            JOIN subscription_plans p ON o.plan_id = p.id 
            WHERE o.id = ? AND o.status IN ('failed', 'expired')`,
            [orderId]
        );

        if (orders.length === 0) {
            throw new Error('Order not found or cannot be retried');
        }

        const order = orders[0];
        await pool.execute(
            'UPDATE orders SET status = "pending" WHERE id = ?',
            [orderId]
        );

        const paymentUrl = await vnpayService.createPaymentUrl(
            orderId,
            order.amount,
            `Retry payment for ${order.plan_name}`,
            '127.0.0.1'
        );

        return { paymentUrl };
    }

    // Get all orders (admin)
    async getAllOrders() {
        const [orders] = await pool.execute(
            `SELECT o.*, p.name as plan_name, p.duration 
            FROM orders o 
            JOIN subscription_plans p ON o.plan_id = p.id 
            ORDER BY o.created_at DESC`
        );
        return orders;
    }
}

module.exports = new PaymentService();
