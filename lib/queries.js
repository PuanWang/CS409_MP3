const { bad, object } = require('./validation');
function parse(query, key, fallback) {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string') bad(`${key} must be one JSON value.`);
    try { return JSON.parse(query[key]); }
    catch { bad(`${key} must contain valid JSON.`); }
}
function projection(query) {
    const select = parse(query, 'select', {});
    if (!object(select) || Object.values(select).some(v => v !== 0 && v !== 1)) bad('select must be an object containing 0 or 1.');
    const values = Object.entries(select).filter(([key]) => key !== '_id').map(([, value]) => value);
    if (values.includes(0) && values.includes(1)) bad('select cannot mix included and excluded fields, except _id.');
    return select;
}
function rejectUnsafeOperators(value) {
    if (value && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
            if (['$where', '$function', '$accumulator', '__proto__', 'constructor', 'prototype'].includes(key)) bad('Query contains an unsupported operator.');
            rejectUnsafeOperators(nested);
        }
    }
}
async function list(Model, query, defaultLimit) {
    const where = parse(query, 'where', {});
    const sort = parse(query, 'sort', {});
    const select = projection(query);
    const skip = parse(query, 'skip', 0);
    const limit = parse(query, 'limit', defaultLimit);
    const count = parse(query, 'count', false);
    if (!object(where)) bad('where must be a JSON object.');
    rejectUnsafeOperators(where);
    if (!object(sort) || Object.values(sort).some(v => v !== 1 && v !== -1)) bad('sort must contain 1 or -1.');
    for (const [key, value] of Object.entries({ skip, limit })) {
        if (!Number.isSafeInteger(value) || value < 0) bad(`${key} must be a nonnegative integer.`);
    }
    if (typeof count !== 'boolean') bad('count must be a boolean.');
    // Count all matches, independently of projection and pagination.
    const request = count ? Model.countDocuments(where) : Model.find(where).sort(sort).select(select).skip(skip).limit(limit);
    try { return await request.maxTimeMS(10000).exec(); }
    catch (error) {
        if (error.name === 'CastError' || error.name === 'StrictModeError' || [2, 9, 14, 72, 168, 31254].includes(error.code) || /Can't use/.test(error.message)) {
            bad('Query contains an invalid field value or operator.');
        }
        throw error;
    }
}
module.exports = { list, projection };
