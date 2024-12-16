const pool = require('../config/database');
const authPool = require('../config/authDatabase');
const messages = require('../config/messages');
const vnpayService = require('../services/vnpayService');
const emailService = require('../services/emailService');
const paymentValidationService = require('../services/paymentValidationService');
const paymentService = require('../services/paymentService');
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
    async getPlans(req, res) {
        try {
            const plans = await paymentService.getSubscriptionPlans();
            res.json({ success: true, data: plans });
        } catch (error) {
            console.error('Error getting plans:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async createPayment(req, res) {
        try {
            const planId = parseInt(req.body.planId);
            
            if (isNaN(planId) || planId <= 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'planId is required and must be a positive number' 
                });
            }

            const userId = req.user.id; // Từ JWT middleware
            const ipAddr = req.ip;

            const result = await paymentService.createOrder(userId, planId, ipAddr);
            res.json({ success: true, data: result });
        } catch (error) {
            console.error('Error creating payment:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    }

    async handleVNPayReturn(req, res) {
        console.log('=== START VERIFY RETURN URL ===');
        try {
            const vnp_Params = req.query;
            const orderId = vnp_Params.vnp_TxnRef;
            
            if (!orderId) {
                throw new Error('Invalid order ID');
            }

            // Lấy thông tin đơn hàng và user từ auth_service
            const [orders] = await pool.execute(
                'SELECT o.*, p.name as plan_name, p.duration FROM orders o ' +
                'JOIN subscription_plans p ON o.plan_id = p.id ' +
                'WHERE o.id = ?',
                [orderId]
            );

            if (orders.length === 0) {
                throw new Error('Order not found');
            }

            const order = orders[0];

            if (!order.user_id) {
                throw new Error('Invalid user ID in order');
            }

            // Lấy thông tin user từ auth service
            const [users] = await authPool.execute(
                'SELECT email FROM users WHERE id = ?',
                [order.user_id]
            );

            if (users.length === 0) {
                throw new Error('User not found');
            }

            const userEmail = users[0].email;

            if (vnp_Params.vnp_ResponseCode === '00') {
                // Thanh toán thành công
                const updatedOrder = await paymentService.updateOrderStatus(orderId, 'completed', vnp_Params);
                
                try {
                    // Xác định role dựa trên gói đăng ký
                    let newRole = 'user_premium';
                    if (order.plan_name.toLowerCase() === 'vip') {
                        newRole = 'user_vip';
                    }

                    // Gửi request để cập nhật role người dùng
                    await axios.put(`${process.env.AUTH_SERVICE_URL}/auth/upgrade-role`, {
                        userId: order.user_id,
                        newRole: newRole
                    });
                    
                    // Gửi email thông báo
                    await emailService.sendPaymentSuccessEmail(userEmail, {
                        planName: order.plan_name || 'Unknown Plan',
                        amount: order.amount || 0,
                        orderId: orderId
                    });
                } catch (error) {
                    console.error('Error updating user role:', error);
                    // Vẫn trả về success vì payment đã thành công
                }

                // Cập nhật subscription trong bảng users của auth_service
                if (order.duration) {
                    await authPool.execute(
                        `UPDATE users 
                        SET subscription_plan = ?,
                            subscription_start = CURRENT_TIMESTAMP,
                            subscription_end = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MONTH)
                        WHERE id = ?`,
                        [order.plan_id, order.duration, order.user_id]
                    );
                }

                res.redirect(`${process.env.FRONTEND_URL}/payment/success?orderId=${orderId}`);
            } else {
                // Thanh toán thất bại
                const updatedOrder = await paymentService.updateOrderStatus(orderId, 'failed', vnp_Params);
                
                try {
                    // Gửi email thông báo
                    await emailService.sendPaymentFailureEmail(userEmail, {
                        planName: order.plan_name || 'Unknown Plan',
                        amount: order.amount || 0,
                        orderId: orderId,
                        reason: vnp_Params.vnp_ResponseCode
                    });
                } catch (emailError) {
                    console.error('Failed to send failure email:', emailError);
                    // Không throw error ở đây để tiếp tục xử lý
                }

                res.redirect(`${process.env.FRONTEND_URL}/payment/failure?orderId=${orderId}`);
            }
        } catch (error) {
            console.error('VNPay return error:', error);
            res.redirect(`${process.env.FRONTEND_URL}/payment/failure`);
        } finally {
            console.log('=== END VERIFY RETURN URL ===');
        }
    }

    async handleVNPayIPN(req, res) {
        try {
            const vnp_Params = req.query;
            const orderId = vnp_Params.vnp_TxnRef;

            if (vnp_Params.vnp_ResponseCode === '00') {
                await paymentService.updateOrderStatus(orderId, 'completed', vnp_Params);
            } else {
                await paymentService.updateOrderStatus(orderId, 'failed', vnp_Params);
            }

            res.status(200).json({ RspCode: '00', Message: 'success' });
        } catch (error) {
            console.error('VNPay IPN error:', error);
            res.status(500).json({ RspCode: '99', Message: 'error' });
        }
    }

    async getPaymentHistory(req, res) {
        try {
            const userId = req.user.id;
            const history = await paymentService.getPaymentHistory(userId);
            res.json({ success: true, data: history });
        } catch (error) {
            console.error('Error getting payment history:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async getOrder(req, res) {
        try {
            const { orderId } = req.params;
            const order = await paymentService.getOrder(orderId);
            
            // Kiểm tra quyền truy cập
            if (order.user_id !== req.user.id && !req.user.isAdmin) {
                return res.status(403).json({ success: false, message: 'Unauthorized' });
            }

            res.json({ success: true, data: order });
        } catch (error) {
            console.error('Error getting order:', error);
            res.status(404).json({ success: false, message: error.message });
        }
    }

    async cancelOrder(req, res) {
        try {
            const { orderId } = req.params;
            const userId = req.user.id;
            
            const order = await paymentService.cancelOrder(orderId, userId);
            res.json({ success: true, data: order });
        } catch (error) {
            console.error('Error cancelling order:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    }

    async retryPayment(req, res) {
        try {
            const { orderId } = req.params;
            const userId = req.user.id;
            const ipAddr = req.ip;
            
            const result = await paymentService.retryPayment(orderId, userId, ipAddr);
            res.json({ success: true, data: result });
        } catch (error) {
            console.error('Error retrying payment:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // Admin endpoints
    async getPaymentStatistics(req, res) {
        try {
            const [result] = await pool.execute(`
                SELECT 
                    COUNT(*) as total_orders,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_orders,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
                    SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_revenue
                FROM orders
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            `);

            // Thống kê theo gói dịch vụ
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

            res.json({ 
                success: true, 
                data: {
                    summary: result[0],
                    planStats
                }
            });
        } catch (error) {
            console.error('Error getting payment statistics:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async createPlan(req, res) {
        try {
            const { name, description, price, duration, features } = req.body;
            const id = `${name.toLowerCase().replace(/\s+/g, '-')}-${duration}`;

            await pool.execute(
                'INSERT INTO subscription_plans (id, name, description, price, duration, features) VALUES (?, ?, ?, ?, ?, ?)',
                [id, name, description, price, duration, JSON.stringify(features)]
            );

            res.json({ success: true, message: 'Plan created successfully' });
        } catch (error) {
            console.error('Error creating plan:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    }

    async updatePlan(req, res) {
        try {
            const { planId } = req.params;
            const { name, description, price, duration, features, is_active } = req.body;

            await pool.execute(
                `UPDATE subscription_plans 
                SET name = ?, description = ?, price = ?, duration = ?, 
                    features = ?, is_active = ?
                WHERE id = ?`,
                [name, description, price, duration, JSON.stringify(features), is_active, planId]
            );

            res.json({ success: true, message: 'Plan updated successfully' });
        } catch (error) {
            console.error('Error updating plan:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    }

    async deletePlan(req, res) {
        try {
            const { planId } = req.params;

            // Kiểm tra xem có đơn hàng nào đang sử dụng plan này không
            const [orders] = await pool.execute(
                'SELECT COUNT(*) as count FROM orders WHERE plan_id = ? AND status IN ("pending", "completed")',
                [planId]
            );

            if (orders[0].count > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Cannot delete plan that has active orders' 
                });
            }

            await pool.execute(
                'DELETE FROM subscription_plans WHERE id = ?',
                [planId]
            );

            res.json({ success: true, message: 'Plan deleted successfully' });
        } catch (error) {
            console.error('Error deleting plan:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    }

    async getAllOrders(req, res) {
        try {
            const { status, startDate, endDate, page = 1, limit = 10 } = req.query;
            const offset = (page - 1) * limit;

            let query = `
                SELECT o.*, p.name as plan_name
                FROM orders o
                JOIN subscription_plans p ON o.plan_id = p.id
                WHERE 1=1
            `;
            const params = [];

            if (status) {
                query += ' AND o.status = ?';
                params.push(status);
            }

            if (startDate) {
                query += ' AND o.created_at >= ?';
                params.push(startDate);
            }

            if (endDate) {
                query += ' AND o.created_at <= ?';
                params.push(endDate);
            }

            query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), offset);

            // Lấy danh sách orders
            const [orders] = await pool.execute(query, params);

            // Lấy thông tin user cho mỗi order
            const ordersWithUserInfo = await Promise.all(orders.map(async (order) => {
                try {
                    const [users] = await authPool.execute(
                        'SELECT email FROM users WHERE id = ?',
                        [order.user_id]
                    );
                    return {
                        ...order,
                        user_email: users.length > 0 ? users[0].email : 'Unknown'
                    };
                } catch (error) {
                    console.error(`Error fetching user info for order ${order.id}:`, error);
                    return { ...order, user_email: 'Unknown' };
                }
            }));

            // Get total count for pagination
            const [totalCount] = await pool.execute(
                'SELECT COUNT(*) as count FROM orders WHERE 1=1' + 
                (status ? ' AND status = ?' : ''),
                status ? [status] : []
            );

            res.json({ 
                success: true, 
                data: {
                    orders: ordersWithUserInfo,
                    pagination: {
                        total: totalCount[0].count,
                        page: parseInt(page),
                        limit: parseInt(limit),
                        totalPages: Math.ceil(totalCount[0].count / limit)
                    }
                }
            });
        } catch (error) {
            console.error('Error getting all orders:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateOrderStatus(req, res) {
        try {
            const { orderId } = req.params;
            const { status, note } = req.body;

            await pool.execute(
                `UPDATE orders 
                SET status = ?, 
                    admin_note = ?,
                    updated_at = NOW()
                WHERE id = ?`,
                [status, note, orderId]
            );

            // Log the status change
            await pool.execute(
                'INSERT INTO payment_logs (order_id, event_type, data) VALUES (?, ?, ?)',
                [orderId, 'admin_status_change', JSON.stringify({ status, note })]
            );

            res.json({ success: true, message: 'Order status updated successfully' });
        } catch (error) {
            console.error('Error updating order status:', error);
            res.status(400).json({ success: false, message: error.message });
        }
    }
}

module.exports = new PaymentController();
