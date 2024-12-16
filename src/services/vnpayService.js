const crypto = require('crypto');
const moment = require('moment');
const querystring = require('qs');

class VNPayService {
    createPaymentUrl(orderId, amount, orderInfo) {
        console.log('=== START VNPAY PAYMENT DEBUG ===');
        
        process.env.TZ = 'Asia/Ho_Chi_Minh';
        const createDate = moment().format('YYYYMMDDHHmmss');
        const txnRef = orderId || moment().format('HHmmss');
    
        let vnpParams = {
            vnp_Version: '2.1.0',
            vnp_Command: 'pay',
            vnp_TmnCode: process.env.VNPAY_TMN_CODE,
            vnp_Locale: 'vn',
            vnp_CurrCode: 'VND',
            vnp_TxnRef: txnRef,
            vnp_OrderInfo: orderInfo,
            vnp_OrderType: 'other',
            vnp_Amount: amount * 100,
            vnp_ReturnUrl: process.env.VNPAY_RETURN_URL,
            vnp_IpAddr: '127.0.0.1',
            vnp_CreateDate: createDate
        };
    
        vnpParams = this.sortObject(vnpParams);
        
        const signData = querystring.stringify(vnpParams, { encode: false });
        const hmac = crypto.createHmac("sha512", process.env.VNPAY_HASH_SECRET);
        const signed = hmac.update(new Buffer.from(signData, 'utf-8')).digest("hex");
        
        vnpParams['vnp_SecureHash'] = signed;
        const paymentUrl = process.env.VNPAY_URL + '?' + querystring.stringify(vnpParams, { encode: false });
        
        console.log("paymentUrl:", paymentUrl);
        console.log('=== END VNPAY PAYMENT DEBUG ===');
    
        return {
            orderId: txnRef,
            paymentUrl: paymentUrl
        };
    }

    verifyReturnUrl(vnpParams) {
        console.log('=== START VERIFY RETURN URL ===');
        const secureHash = vnpParams['vnp_SecureHash'];
        
        delete vnpParams['vnp_SecureHash'];
        delete vnpParams['vnp_SecureHashType'];
        
        vnpParams = this.sortObject(vnpParams);
        
        const signData = querystring.stringify(vnpParams, { encode: false });
        const hmac = crypto.createHmac("sha512", process.env.VNPAY_HASH_SECRET);
        const signed = hmac.update(new Buffer.from(signData, 'utf-8')).digest("hex");
        
        console.log("Verify Payment Return...");
        console.log("signData:", signData);
        console.log("signed:", signed);
        console.log("secureHash:", secureHash);
        
        const result = secureHash === signed;
        console.log("Verify Result:", result);
        console.log('=== END VERIFY RETURN URL ===');
        
        return result;
    }

    sortObject(obj) {
        let sorted = {};
        let str = [];
        let key;
        for (key in obj) {
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
