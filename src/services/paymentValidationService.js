class PaymentValidationService {
    validateAmount(amount, planPrice) {
        // Kiểm tra số tiền có hợp lệ không
        if (!amount || amount <= 0) {
            throw new Error('Số tiền không hợp lệ');
        }

        // Kiểm tra số tiền có khớp với giá gói không
        if (amount !== planPrice) {
            throw new Error('Số tiền không khớp với giá gói đăng ký');
        }

        // Kiểm tra giới hạn số tiền (VNPay thường có giới hạn)
        const MAX_AMOUNT = 100000000; // 100 triệu VNĐ
        if (amount > MAX_AMOUNT) {
            throw new Error('Số tiền vượt quá giới hạn cho phép');
        }
    }

    validateOrderTimeout(order) {
        // Kiểm tra timeout của đơn hàng (VD: 15 phút)
        const PAYMENT_TIMEOUT_MINUTES = 15;
        const orderDate = new Date(order.created_at);
        const now = new Date();
        const diffMinutes = (now - orderDate) / (1000 * 60);

        if (diffMinutes > PAYMENT_TIMEOUT_MINUTES) {
            throw new Error('Đơn hàng đã hết hạn thanh toán');
        }
    }

    validateIPNRetry(retryCount) {
        // Giới hạn số lần retry IPN
        const MAX_RETRY = 3;
        if (retryCount >= MAX_RETRY) {
            throw new Error('Đã vượt quá số lần thử lại IPN');
        }
    }
}

module.exports = new PaymentValidationService();
