const otplib = require('otplib');
const { authenticator, totp } = otplib;


// 设置OTP默认参数
authenticator.options = {
    digits: 6,
    step: 30,
    algorithm: 'sha1',
};


function applyOptions(options) {
    const customOptions = { ...authenticator.options };
    if (options.digits) {
        customOptions.digits = options.digits;
    }
    if (options.period) {
        customOptions.step = options.period;
    }
    if (options.algorithm) {
        customOptions.algorithm = options.algorithm.toLowerCase();
    }
    return customOptions
}


// 生成TOTP验证码
function generateTOTP(secret, options = {}) {
    // console.log("generateTOTP", secret, options)
    const customOptions = applyOptions(options)

    try {
        authenticator.options = customOptions
        return authenticator.generate(secret);
    } catch (error) {
        console.error('生成OTP失败:', error);
        return '';
    }
}




// Generate the next TOTP code
function generateNextTOTP(secret, options = {}) {
    const customOptions = applyOptions(options)
    customOptions.epoch = Date.now() + 1000 * 30
    try {
        const tmp = authenticator.create(customOptions)
        // authenticator.options = customOptions
        // console.log("generateNextTOTP", tmp.generate(secret))
        return tmp.generate(secret)
    } catch (error) {
        console.error('生成OTP失败:', error);
        return '';
    }
}

module.exports = {
    generateTOTP,
    generateNextTOTP
}


