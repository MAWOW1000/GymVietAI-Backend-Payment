const sendResponse = (res, data, status = 200) => {
    res.status(status).json({
        success: true,
        data
    });
};

const sendError = (res, error, status = 500) => {
    console.error(`Error: ${error.message}`);
    res.status(status).json({
        success: false,
        message: error.message
    });
};

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
        sendError(res, error, error.status || 500);
    });
};

module.exports = {
    sendResponse,
    sendError,
    asyncHandler
};
