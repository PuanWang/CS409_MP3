class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    let status = error instanceof ApiError ? error.status : 500;
    let message = error instanceof ApiError ? error.message : 'Unable to complete the request. Please try again.';
    if (error.type === 'entity.parse.failed') {
        status = 400; message = 'Request body must contain valid JSON.';
    } else if (error.type === 'entity.too.large') {
        status = 400; message = 'Request body is too large.';
    } else if (error.code === 11000) {
        status = 400; message = 'Email is already in use.';
    } else if (['ValidationError', 'CastError', 'StrictModeError'].includes(error.name)) {
        status = 400; message = 'A field or query value is invalid.';
    }
    res.status(status).json({ message, data: null });
}
module.exports = { ApiError, errorHandler };
