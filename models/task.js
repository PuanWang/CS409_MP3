const mongoose = require('mongoose');
module.exports = mongoose.model('Task', new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, default: '' },
    deadline: { type: Date, required: true },
    completed: { type: Boolean, default: false },
    assignedUser: { type: String, default: '', index: true },
    assignedUserName: { type: String, default: 'unassigned' },
    dateCreated: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false }));
