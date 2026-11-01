const { ApiError } = require('./errors');
const isId = value => typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const bad = message => { throw new ApiError(400, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function bodyObject(body) {
    if (!object(body)) bad('Request body must be an object.');
}
function requiredString(body, key) {
    if (typeof body[key] !== 'string' || !body[key].trim()) bad(`${key} must be a nonempty string.`);
    return body[key].trim();
}
function userFields(body) {
    bodyObject(body);
    const name = requiredString(body, 'name');
    const email = requiredString(body, 'email');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('email must be a valid email address.');
    const pendingTasks = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (!Array.isArray(pendingTasks) || !pendingTasks.every(isId)) bad('pendingTasks must be a list of valid task ids.');
    return { name, email, pendingTasks: [...new Set(pendingTasks.map(id => id.toLowerCase()))] };
}
function taskFields(body) {
    bodyObject(body);
    const name = requiredString(body, 'name');
    if (!['string', 'number'].includes(typeof body.deadline) || body.deadline === '') bad('deadline must be a valid date.');
    const deadline = new Date(body.deadline);
    if (!Number.isFinite(deadline.getTime())) bad('deadline must be a valid date.');
    const description = body.description === undefined ? '' : body.description;
    const completed = body.completed === undefined ? false : body.completed;
    if (typeof description !== 'string') bad('description must be a string.');
    if (typeof completed !== 'boolean') bad('completed must be a boolean.');
    const assignedUser = body.assignedUser === undefined ? '' : body.assignedUser;
    if (assignedUser !== '' && !isId(assignedUser)) bad('assignedUser must be a valid user id or an empty string.');
    if (body.assignedUserName !== undefined && typeof body.assignedUserName !== 'string') bad('assignedUserName must be a string.');
    if (assignedUser === '' && body.assignedUserName !== undefined && body.assignedUserName !== 'unassigned') bad('An unassigned task must have assignedUserName "unassigned".');
    return { name, deadline, description, completed, assignedUser: assignedUser.toLowerCase(), assignedUserName: body.assignedUserName };
}
module.exports = { isId, bad, object, userFields, taskFields };
