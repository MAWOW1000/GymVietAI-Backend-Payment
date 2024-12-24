const crypto = require('crypto');
const moment = require('moment');
const querystring = require('qs');
const path = require('path');
const pool = require('../config/database');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

class VNPayService {
    constructor() {
        this.validateConfig();
    }

    validateConfig() {
        const requiredEnvVars = [
            'VNP_TMN_CODE',
            'VNP_HASH_SECRET',
            'VNP_URL',
            'VNP_RETURN_URL'
        ];

        const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
        
        if (missingVars.length > 0) {
            throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
        }

        this.config = {
            tmnCode: process.env.VNP_TMN_CODE,
            hashSecret: process.env.VNP_HASH_SECRET,
            url: process.env.VNP_URL,
            returnUrl: process.env.VNP_RETURN_URL
        };
    }

    createPaymentUrl(orderId, amount, orderInfo, ipAddr) {
        console.log('=== START VNPAY PAYMENT DEBUG ===');
        console.log('VNPay Config:', this.config);
        
        process.env.TZ = 'Asia/Ho_Chi_Minh';
        const createDate = moment().format('YYYYMMDDHHmmss');
        const txnRef = orderId || moment().format('HHmmss');
    
        let vnpParams = {
            vnp_Version: '2.1.0',
            vnp_Command: 'pay',
            vnp_TmnCode: this.config.tmnCode,
            vnp_Locale: 'vn',
            vnp_CurrCode: 'VND',
            vnp_TxnRef: txnRef,
            vnp_OrderInfo: orderInfo,
            vnp_OrderType: 'other',
            vnp_Amount: amount * 100,
            vnp_ReturnUrl: this.config.returnUrl,
            vnp_IpAddr: ipAddr || '127.0.0.1',
            vnp_CreateDate: createDate
        };
    
        vnpParams = this.sortObject(vnpParams);
        
        const signData = querystring.stringify(vnpParams, { encode: false });
        const hmac = crypto.createHmac("sha512", this.config.hashSecret);
        const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");
        
        vnpParams['vnp_SecureHash'] = signed;
        const paymentUrl = this.config.url + '?' + querystring.stringify(vnpParams, { encode: false });
        
        console.log("paymentUrl:", paymentUrl);
        console.log('=== END VNPAY PAYMENT DEBUG ===');
    
        return paymentUrl;
    }

    async createPayment(userId, planId, clientIp) {
        try {
            // Validate required environment variables
            this.validateConfig();

            // Get plan details from database
            const [plans] = await pool.execute(
                'SELECT * FROM subscription_plans WHERE id = ?',
                [planId]
            );

            if (plans.length === 0) {
                throw new Error('Plan not found');
            }

            const plan = plans[0];
            const orderId = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Create order in database
            await pool.execute(
                'INSERT INTO orders (id, user_id, plan_id, amount, status) VALUES (?, ?, ?, ?, ?)',
                [orderId, userId, planId, plan.price, 'pending']
            );

            // Create VNPay payment URL
            const vnpUrl = this.createPaymentUrl(orderId, plan.price, clientIp, `Payment for ${plan.name}`);

            return {
                orderId,
                paymentUrl: vnpUrl,
                plan: {
                    id: plan.id,
                    name: plan.name,
                    price: plan.price,
                    duration: plan.duration
                }
            };

        } catch (error) {
            console.error('Error creating payment:', error);
            throw error;
        }
    }

    verifyReturnUrl(vnpParams) {
        const secureHash = vnpParams['vnp_SecureHash'];
        
        delete vnpParams['vnp_SecureHash'];
        delete vnpParams['vnp_SecureHashType'];

        vnpParams = this.sortObject(vnpParams);
        const signData = querystring.stringify(vnpParams, { encode: false });
        const hmac = crypto.createHmac("sha512", this.config.hashSecret);
        const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest("hex");

        if(secureHash === signed){
            return {
                status: true,
                message: 'Valid signature'
            };
        } else {
            return {
                status: false,
                message: 'Invalid signature'
            };
        }
    }

    async processReturnUrl(vnpParams) {
        const verifyResult = this.verifyReturnUrl(vnpParams);
        
        if (!verifyResult.status) {
            throw new Error('Invalid VNPay signature');
        }

        // Extract payment information
        const paymentInfo = {
            orderId: vnpParams['vnp_TxnRef'],
            amount: parseInt(vnpParams['vnp_Amount']) / 100, // Convert from VNPay amount (x100)
            bankCode: vnpParams['vnp_BankCode'],
            bankTranNo: vnpParams['vnp_BankTranNo'],
            cardType: vnpParams['vnp_CardType'],
            payDate: vnpParams['vnp_PayDate'],
            transactionNo: vnpParams['vnp_TransactionNo'],
            responseCode: vnpParams['vnp_ResponseCode'],
            transactionStatus: vnpParams['vnp_TransactionStatus']
        };

        // Check payment status
        if (paymentInfo.responseCode === '00') {
            // Payment successful
            try {
                // Update order status in database
                const [result] = await pool.execute(
                    `UPDATE orders 
                    SET status = ?, 
                        payment_method = 'vnpay',
                        transaction_info = ?,
                        updated_at = NOW()
                    WHERE id = ?`,
                    ['completed', JSON.stringify(paymentInfo), paymentInfo.orderId]
                );

                if (result.affectedRows === 0) {
                    throw new Error('Order not found');
                }

                // Add payment log
                await pool.execute(
                    'INSERT INTO payment_logs (order_id, event_type, data) VALUES (?, ?, ?)',
                    [paymentInfo.orderId, 'payment_success', JSON.stringify(paymentInfo)]
                );

                return {
                    status: 'success',
                    message: 'Payment successful',
                    data: paymentInfo
                };
            } catch (error) {
                console.error('Error updating payment status:', error);
                throw new Error('Failed to update payment status');
            }
        } else {
            // Payment failed
            try {
                // Update order status
                await pool.execute(
                    `UPDATE orders 
                    SET status = ?, 
                        payment_method = 'vnpay',
                        transaction_info = ?,
                        updated_at = NOW()
                    WHERE id = ?`,
                    ['failed', JSON.stringify(paymentInfo), paymentInfo.orderId]
                );

                // Add payment log
                await pool.execute(
                    'INSERT INTO payment_logs (order_id, event_type, data) VALUES (?, ?, ?)',
                    [paymentInfo.orderId, 'payment_failed', JSON.stringify(paymentInfo)]
                );

                return {
                    status: 'failed',
                    message: 'Payment failed',
                    data: paymentInfo
                };
            } catch (error) {
                console.error('Error updating payment status:', error);
                throw new Error('Failed to update payment status');
            }
        }
    }

    async processIPN(vnpParams) {
        const verifyResult = this.verifyReturnUrl(vnpParams);
        
        if (!verifyResult.status) {
            return {
                RspCode: '97',
                Message: 'Invalid signature'
            };
        }

        const orderId = vnpParams['vnp_TxnRef'];
        const rspCode = vnpParams['vnp_ResponseCode'];

        try {
            // Get order information
            const [orders] = await pool.execute(
                'SELECT * FROM orders WHERE id = ?',
                [orderId]
            );

            if (orders.length === 0) {
                return {
                    RspCode: '01',
                    Message: 'Order not found'
                };
            }

            const order = orders[0];

            // Check if payment amount matches
            const vnpAmount = parseInt(vnpParams['vnp_Amount']) / 100;
            if (vnpAmount !== order.amount) {
                return {
                    RspCode: '04',
                    Message: 'Invalid amount'
                };
            }

            // Process payment status
            if (rspCode === '00') {
                if (order.status === 'pending') {
                    // Update order status
                    await pool.execute(
                        `UPDATE orders 
                        SET status = ?, 
                            payment_method = 'vnpay',
                            transaction_info = ?,
                            updated_at = NOW()
                        WHERE id = ?`,
                        ['completed', JSON.stringify(vnpParams), orderId]
                    );

                    // Log the transaction
                    await pool.execute(
                        'INSERT INTO payment_logs (order_id, event_type, data) VALUES (?, ?, ?)',
                        [orderId, 'ipn_success', JSON.stringify(vnpParams)]
                    );
                }
            } else {
                // Update order status as failed
                await pool.execute(
                    `UPDATE orders 
                    SET status = ?, 
                        payment_method = 'vnpay',
                        transaction_info = ?,
                        updated_at = NOW()
                    WHERE id = ?`,
                    ['failed', JSON.stringify(vnpParams), orderId]
                );

                // Log the failed transaction
                await pool.execute(
                    'INSERT INTO payment_logs (order_id, event_type, data) VALUES (?, ?, ?)',
                    [orderId, 'ipn_failed', JSON.stringify(vnpParams)]
                );
            }

            return {
                RspCode: '00',
                Message: 'Confirmed'
            };

        } catch (error) {
            console.error('Error processing IPN:', error);
            return {
                RspCode: '99',
                Message: 'Unknown error'
            };
        }
    }

    sortObject(obj) {
        let sorted = {};
        let str = [];
        let key;
        for (key in obj){
            if (obj.hasOwnProperty(key)) {
                str.push(encodeURIComponent(key));
            }
        }
        str.sort();
        for (key = 0; key < str.length; key++) {
            sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, "+");
        }
        return sorted;
    }
}

module.exports = new VNPayService();
