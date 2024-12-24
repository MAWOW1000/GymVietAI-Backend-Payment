const nodemailer = require('nodemailer');

let transporter = null;

// Log environment variables
console.log('Email Config:', {
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: '***' // Don't log the actual password
});

// Chỉ khởi tạo transporter nếu có đủ thông tin SMTP
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        },
        logger: true,
        debug: true // Thêm debug để xem chi tiết lỗi
    });

    // Verify connection configuration
    transporter.verify(function(error, success) {
        if (error) {
            console.error('SMTP connection error:', error);
        } else {
            console.log('SMTP server is ready to take our messages');
        }
    });
}

class EmailService {
    async sendPaymentSuccessEmail(toEmail, { planName, amount, orderId }) {
        if (!transporter) {
            console.log('Email service not configured. Skipping email notification.');
            return;
        }

        if (!toEmail) {
            console.error('No recipient email provided');
            return;
        }

        const mailOptions = {
            from: {
                name: 'GymVietAI',
                address: process.env.SMTP_USER
            },
            to: toEmail,
            subject: 'Thanh toán thành công',
            html: `
                <h2>Cảm ơn bạn đã thanh toán!</h2>
                <p>Đơn hàng của bạn đã được xử lý thành công:</p>
                <ul>
                    <li>Mã đơn hàng: ${orderId || 'N/A'}</li>
                    <li>Gói dịch vụ: ${planName || 'N/A'}</li>
                    <li>Số tiền: ${(amount || 0).toLocaleString('vi-VN')} VNĐ</li>
                </ul>
                <p>Bạn có thể bắt đầu sử dụng dịch vụ ngay bây giờ.</p>
                <p>Nếu có bất kỳ thắc mắc nào, vui lòng liên hệ với chúng tôi.</p>
            `
        };

        try {
            const info = await transporter.sendMail(mailOptions);
            console.log('Success email sent:', info.messageId);
        } catch (error) {
            console.error('Failed to send success email:', error);
            throw error;
        }
    }

    async sendPaymentFailureEmail(toEmail, { planName, amount, orderId, reason }) {
        if (!transporter) {
            console.log('Email service not configured. Skipping email notification.');
            return;
        }

        if (!toEmail) {
            console.error('No recipient email provided');
            return;
        }

        const mailOptions = {
            from: {
                name: 'GymVietAI',
                address: process.env.SMTP_USER
            },
            to: toEmail,
            subject: 'Thanh toán thất bại',
            html: `
                <h2>Thông báo thanh toán thất bại</h2>
                <p>Đơn hàng của bạn không thể hoàn tất:</p>
                <ul>
                    <li>Mã đơn hàng: ${orderId || 'N/A'}</li>
                    <li>Gói dịch vụ: ${planName || 'N/A'}</li>
                    <li>Số tiền: ${(amount || 0).toLocaleString('vi-VN')} VNĐ</li>
                    <li>Lý do: ${reason || 'Không xác định'}</li>
                </ul>
                <p>Vui lòng thử lại hoặc liên hệ với chúng tôi nếu cần hỗ trợ.</p>
            `
        };

        try {
            const info = await transporter.sendMail(mailOptions);
            console.log('Failure email sent:', info.messageId);
        } catch (error) {
            console.error('Failed to send failure email:', error);
            throw error;
        }
    }

    getErrorMessage(code) {
        const messages = {
            '24': 'Giao dịch không thành công do: Khách hàng hủy giao dịch',
            '09': 'Giao dịch không thành công do: Thẻ/Tài khoản của khách hàng chưa đăng ký dịch vụ InternetBanking tại ngân hàng',
            '10': 'Giao dịch không thành công do: Khách hàng xác thực thông tin thẻ/tài khoản không đúng quá 3 lần',
            '11': 'Giao dịch không thành công do: Đã hết hạn chờ thanh toán',
            '12': 'Giao dịch không thành công do: Thẻ/Tài khoản của khách hàng bị khóa',
            '13': 'Giao dịch không thành công do Quý khách nhập sai mật khẩu xác thực giao dịch (OTP)',
            '51': 'Giao dịch không thành công do: Tài khoản của quý khách không đủ số dư để thực hiện giao dịch',
            '65': 'Giao dịch không thành công do: Tài khoản của Quý khách đã vượt quá hạn mức giao dịch trong ngày',
            '75': 'Ngân hàng thanh toán đang bảo trì',
            '79': 'Giao dịch không thành công do: KH nhập sai mật khẩu thanh toán quá số lần quy định',
            '99': 'Các lỗi khác'
        };
        return messages[code] || 'Lỗi không xác định';
    }
}

module.exports = new EmailService();
