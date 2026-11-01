const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { ApiError } = require('./errors');
const { isId, bad, userFields, taskFields } = require('./validation');
// Serialize writes across server instances to prevent cross-document write skew,
// including concurrent completed-task assignment and user deletion.
const MutationLock = mongoose.model('MutationLock', new mongoose.Schema({
    _id: String, revision: Number
}, { versionKey: false }));
async function initialize() {
    await User.init();
    await Task.init();
    await MutationLock.init();
    await MutationLock.updateOne({ _id: 'references' }, { $setOnInsert: { revision: 0 } }, { upsert: true });
}
async function mutate(operation) {
    return mongoose.connection.transaction(async session => {
        await MutationLock.updateOne({ _id: 'references' }, { $inc: { revision: 1 } }, { session });
        return operation(session);
    });
}
async function existing(Model, id, session) {
    if (!isId(id)) throw new ApiError(404, `${Model.modelName} not found.`);
    const doc = await Model.findById(id).session(session || null);
    if (!doc) throw new ApiError(404, `${Model.modelName} not found.`);
    return doc;
}
async function saveUser(id, body) {
    return mutate(async session => {
        const user = id ? await existing(User, id, session) : new User();
        const fields = userFields(body);
        const duplicate = await User.findOne({ email: fields.email, _id: { $ne: user._id } }).session(session);
        if (duplicate) bad('Email is already in use.');
        const tasks = await Task.find({ _id: { $in: fields.pendingTasks } }).session(session);
        if (tasks.length !== fields.pendingTasks.length) throw new ApiError(404, 'A referenced task was not found.');
        if (tasks.some(task => task.completed)) bad('pendingTasks cannot contain completed tasks.');
        const userId = String(user._id);
        await Task.updateMany({ assignedUser: userId, completed: false, _id: { $nin: fields.pendingTasks } },
            { $set: { assignedUser: '', assignedUserName: 'unassigned' } }, { session });
        await User.updateMany({ _id: { $ne: user._id }, pendingTasks: { $in: fields.pendingTasks } },
            { $pull: { pendingTasks: { $in: fields.pendingTasks } } }, { session });
        await Task.updateMany({ _id: { $in: fields.pendingTasks } },
            { $set: { assignedUser: userId, assignedUserName: fields.name } }, { session });
        await Task.updateMany({ assignedUser: userId }, { $set: { assignedUserName: fields.name } }, { session });
        user.set(fields);
        await user.save({ session });
        return user.toObject();
    });
}
async function saveTask(id, body) {
    return mutate(async session => {
        const task = id ? await existing(Task, id, session) : new Task();
        const fields = taskFields(body);
        if (fields.assignedUser) {
            const user = await existing(User, fields.assignedUser, session);
            if (fields.assignedUserName !== undefined && fields.assignedUserName !== user.name) bad('assignedUserName must match the assigned user.');
            fields.assignedUserName = user.name;
        } else fields.assignedUserName = 'unassigned';
        const taskId = String(task._id);
        await User.updateMany({ pendingTasks: taskId }, { $pull: { pendingTasks: taskId } }, { session });
        if (fields.assignedUser && !fields.completed) {
            await User.updateOne({ _id: fields.assignedUser }, { $addToSet: { pendingTasks: taskId } }, { session });
        }
        task.set(fields);
        await task.save({ session });
        return task.toObject();
    });
}
async function remove(Model, id) {
    return mutate(async session => {
        const doc = await existing(Model, id, session);
        if (Model === User) {
            await Task.updateMany({ assignedUser: String(doc._id) },
                { $set: { assignedUser: '', assignedUserName: 'unassigned' } }, { session });
        } else {
            await User.updateMany({ pendingTasks: String(doc._id) }, { $pull: { pendingTasks: String(doc._id) } }, { session });
        }
        await doc.deleteOne({ session });
    });
}
module.exports = { initialize, existing, saveUser, saveTask, remove };
