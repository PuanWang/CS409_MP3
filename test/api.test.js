const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
require('dotenv').config({ quiet: true });
const app = require('../app');
const User = require('../models/user');
const Task = require('../models/task');
const store = require('../lib/store');
let server, base;
const databaseName = `mp3_test_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
const deadline = '2026-11-03T23:59:00.000Z';
const missing = '000000000000000000000001';
async function request(method, path, body, status = method === 'DELETE' ? 204 : 200) {
    const res = await fetch(`${base}/api${path}`, {
        method, headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (status === 204) {
        assert.equal(res.status, 204);
        assert.equal(await res.text(), '');
        return null;
    }
    const json = await res.json();
    assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(json)}`);
    assert.equal(typeof json.message, 'string');
    assert.ok(Object.hasOwn(json, 'data'));
    return json.data;
}
const user = (name = 'Alice', more = {}) => request('POST', '/users', { name, email: `${name}@example.com`, ...more }, 201);
const task = (more = {}) => request('POST', '/tasks', { name: 'Task', deadline, ...more }, 201);
const getUser = id => request('GET', `/users/${id}`);
const getTask = id => request('GET', `/tasks/${id}`);
const query = fields => '?' + new URLSearchParams(Object.entries(fields).map(([key, value]) => [key, JSON.stringify(value)]));
async function snapshot() {
    return JSON.stringify({ users: await User.find().sort('_id').lean(), tasks: await Task.find().sort('_id').lean() });
}
async function invariant() {
    const users = await User.find().lean();
    const tasks = await Task.find().lean();
    for (const u of users) {
        assert.deepEqual([...u.pendingTasks].sort(), tasks.filter(t => t.assignedUser === String(u._id) && !t.completed).map(t => String(t._id)).sort());
    }
    for (const t of tasks) {
        if (!t.assignedUser) assert.equal(t.assignedUserName, 'unassigned');
        else {
            const owner = users.find(u => String(u._id) === t.assignedUser);
            assert.ok(owner, 'Assigned user exists');
            assert.equal(t.assignedUserName, owner.name);
        }
    }
}
before(async () => {
    assert.ok(process.env.TEST_MONGODB_URI || process.env.MONGODB_URI, 'Set MONGODB_URI or TEST_MONGODB_URI to a replica set connection string.');
    await mongoose.connect(process.env.TEST_MONGODB_URI || process.env.MONGODB_URI, { dbName: databaseName, serverSelectionTimeoutMS: 15000 });
    await store.initialize();
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => { await User.deleteMany({}); await Task.deleteMany({}); });
after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    // Only ever remove this run's newly generated database.
    try {
        if (mongoose.connection.readyState === 1 && mongoose.connection.name === databaseName) await mongoose.connection.dropDatabase();
    } finally { await mongoose.disconnect(); }
});
test('creation defaults, timestamps, envelopes, and duplicate emails', async () => {
    const u = await user('Alice', { dateCreated: '2000-01-01' });
    assert.deepEqual(u.pendingTasks, []);
    assert.ok(Date.parse(u.dateCreated) > Date.now() - 60000);
    const t = await task({ dateCreated: '2000-01-01' });
    assert.equal(t.description, ''); assert.equal(t.completed, false);
    assert.equal(t.assignedUser, ''); assert.equal(t.assignedUserName, 'unassigned');
    assert.ok(Date.parse(t.dateCreated) > Date.now() - 60000);
    await request('POST', '/users', { name: 'Other', email: u.email }, 400);
});
test('required fields, types, malformed body ids, and nonexistent references', async () => {
    for (const body of [{}, { name: 1, email: 'a@b.com' }, { name: 'a', email: null }, { name: 'a', email: 'bad' }, { name: 'a', email: 'a@b.com', pendingTasks: ['bad'] }]) {
        await request('POST', '/users', body, 400);
    }
    for (const more of [{ name: '' }, { deadline: null }, { deadline: 'invalid' }, { completed: 'false' }, { description: 3 }, { assignedUser: 'bad' }, { assignedUser: null }, { assignedUserName: 3 }]) {
        await request('POST', '/tasks', { name: 'Task', deadline, ...more }, 400);
    }
    await request('POST', '/tasks', { name: 'Task', deadline, assignedUser: missing }, 404);
    await request('POST', '/users', { name: 'a', email: 'a@b.com', pendingTasks: [missing] }, 404);
    assert.equal(await User.countDocuments(), 0); assert.equal(await Task.countDocuments(), 0);
});
test('URL existence is checked before body values; missing GET/PUT/DELETE is 404', async () => {
    for (const collection of ['users', 'tasks']) {
        for (const id of ['bad', missing]) {
            await request('GET', `/${collection}/${id}`, undefined, 404);
            await request('PUT', `/${collection}/${id}`, {}, 404);
            await request('DELETE', `/${collection}/${id}`, undefined, 404);
        }
    }
});
test('task assignment, transfer, completion, completed transfer and reopening', async () => {
    const a = await user(), b = await user('Bob');
    const t = await task({ assignedUser: a._id });
    assert.deepEqual((await getUser(a._id)).pendingTasks, [t._id]);
    for (const more of [
        { assignedUser: b._id }, { assignedUser: b._id, completed: true },
        { assignedUser: a._id, completed: true }, { assignedUser: a._id, completed: false }
    ]) {
        await request('PUT', `/tasks/${t._id}`, { name: 'New', deadline, ...more });
        await invariant();
    }
    const replaced = await request('PUT', `/tasks/${t._id}`, { name: 'Reset', deadline, dateCreated: '2000-01-01' });
    assert.equal(replaced.assignedUser, ''); assert.equal(replaced.description, '');
    assert.equal(replaced.dateCreated, t.dateCreated);
    await invariant();
});
test('user replacement moves tasks, removes omitted tasks, and renames completed assignments', async () => {
    const a = await user(), b = await user('Bob');
    const t1 = await task({ assignedUser: a._id });
    const t2 = await task({ assignedUser: b._id });
    const done = await task({ assignedUser: a._id, completed: true });
    const updated = await request('PUT', `/users/${a._id}`, { name: 'Renamed', email: a.email, pendingTasks: [t2._id], dateCreated: '2000-01-01' });
    assert.equal(updated.dateCreated, a.dateCreated);
    assert.equal((await getTask(t1._id)).assignedUser, '');
    assert.equal((await getTask(t2._id)).assignedUser, a._id);
    assert.equal((await getTask(done._id)).assignedUserName, 'Renamed');
    await invariant();
    await request('PUT', `/users/${a._id}`, { name: 'Again', email: a.email });
    assert.equal((await getTask(t2._id)).assignedUser, '');
    assert.equal((await getTask(done._id)).assignedUserName, 'Again');
    await invariant();
});
test('POST user claims pending tasks, deduplicates ids, and removes previous owner reference', async () => {
    const a = await user();
    const t = await task({ assignedUser: a._id });
    const b = await user('Bob', { pendingTasks: [t._id, t._id.toUpperCase()] });
    assert.deepEqual(b.pendingTasks, [t._id]);
    assert.equal((await getTask(t._id)).assignedUser, b._id);
    await invariant();
});
test('rejected updates leave all user/task documents unchanged', async () => {
    const a = await user(), b = await user('Bob');
    const t = await task({ assignedUser: a._id });
    const done = await task({ assignedUser: b._id, completed: true });
    const beforeState = await snapshot();
    await request('PUT', `/users/${a._id}`, { name: 'New', email: b.email, pendingTasks: [missing] }, 400);
    await request('PUT', `/users/${a._id}`, { name: 'New', email: a.email, pendingTasks: [done._id] }, 400);
    await request('PUT', `/users/${a._id}`, { name: 'New', email: a.email, pendingTasks: [missing] }, 404);
    await request('PUT', `/tasks/${t._id}`, { name: 'New', deadline, assignedUser: b._id, assignedUserName: a.name }, 400);
    assert.equal(await snapshot(), beforeState);
});
test('transaction rolls back earlier reference writes on unexpected save failure', async () => {
    const a = await user(), b = await user('Bob');
    const t = await task({ assignedUser: a._id });
    const beforeState = await snapshot();
    const original = Task.prototype.save;
    Task.prototype.save = async function () { throw new Error('Private database internals'); };
    try { await request('PUT', `/tasks/${t._id}`, { name: 'New', deadline, assignedUser: b._id }, 500); }
    finally { Task.prototype.save = original; }
    assert.equal(await snapshot(), beforeState);
});
test('deleting tasks cleans pendingTasks; deleting users unassigns completed and pending tasks', async () => {
    const a = await user();
    const t = await task({ assignedUser: a._id });
    await request('DELETE', `/tasks/${t._id}`);
    assert.deepEqual((await getUser(a._id)).pendingTasks, []);
    await request('GET', `/tasks/${t._id}`, undefined, 404);
    const pending = await task({ assignedUser: a._id });
    const done = await task({ assignedUser: a._id, completed: true });
    await request('DELETE', `/users/${a._id}`);
    for (const id of [pending._id, done._id]) assert.equal((await getTask(id)).assignedUser, '');
    await invariant();
});
test('collection filters, sort, projection, pagination, counts and empty results', async () => {
    await Task.insertMany(Array.from({ length: 105 }, (_, i) => ({ name: `Task${String(i).padStart(3, '0')}`, deadline, completed: i % 2 === 0 })));
    await User.insertMany(Array.from({ length: 105 }, (_, i) => ({ name: `User${i}`, email: `u${i}@example.com` })));
    assert.equal((await request('GET', '/tasks')).length, 100);
    assert.equal((await request('GET', '/users')).length, 105);
    assert.equal((await request('GET', '/tasks?limit=0')).length, 105);
    const result = await request('GET', '/tasks' + query({ where: { completed: true }, sort: { name: -1 }, select: { name: 1, _id: 0 }, skip: 1, limit: 2 }));
    assert.deepEqual(result, [{ name: 'Task102' }, { name: 'Task100' }]);
    assert.equal(await request('GET', '/tasks' + query({ where: { completed: true }, count: true, skip: 5, limit: 1 })), 53);
    assert.deepEqual(await request('GET', '/tasks' + query({ where: { _id: missing } })), []);
    assert.equal(await request('GET', '/tasks' + query({ where: { _id: missing }, count: true })), 0);
    const one = await Task.findOne();
    assert.equal((await request('GET', '/tasks' + query({ where: { _id: { $in: [String(one._id)] } } }))).length, 1);
});
test('single-resource select works and ignores other query parameters', async () => {
    const a = await user(), t = await task();
    for (const [path, doc] of [['users', a], ['tasks', t]]) {
        assert.deepEqual(await request('GET', `/${path}/${doc._id}` + query({ select: { name: 1, _id: 0 } }) + '&where=broken&count=broken&skip=broken'), { name: doc.name });
        await request('GET', `/${path}/${doc._id}?select=broken`, undefined, 400);
    }
});
test('malformed query values return 400, including malformed JSON and wrong types', async () => {
    for (const key of ['where', 'sort', 'select', 'skip', 'limit', 'count']) await request('GET', `/tasks?${key}=broken`, undefined, 400);
    for (const fields of [{ where: [] }, { sort: { name: 2 } }, { select: { name: 1, description: 0 } }, { skip: -1 }, { limit: 1.5 }, { count: 1 }, { where: { $where: 'true' } }, { where: { _id: 'bad' } }]) {
        await request('GET', '/tasks' + query(fields), undefined, 400);
    }
});
test('concurrent assignments and deletion preserve references', async () => {
    const a = await user(), b = await user('Bob');
    const t = await task();
    await Promise.all(Array.from({ length: 4 }, (_, i) => request('PUT', `/tasks/${t._id}`, { name: 'Task', deadline, assignedUser: i % 2 ? a._id : b._id })));
    await invariant();
    const results = await Promise.all([
        fetch(`${base}/api/tasks/${t._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Task', deadline, completed: true, assignedUser: a._id }) }),
        fetch(`${base}/api/users/${a._id}`, { method: 'DELETE' })
    ]);
    assert.ok([200, 404].includes(results[0].status)); assert.equal(results[1].status, 204);
    await invariant();
});
test('JSON parser, form encoding, unknown routes and CORS', async () => {
    const malformed = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400); assert.equal((await malformed.json()).data, null);
    const form = await fetch(`${base}/api/tasks`, { method: 'POST', body: new URLSearchParams({ name: 'Form task', deadline, completed: 'false' }) });
    assert.equal(form.status, 201); assert.equal((await form.json()).data.completed, false);
    await request('GET', '/unknown', undefined, 404);
    const options = await fetch(`${base}/api/users`, { method: 'OPTIONS' });
    assert.equal(options.status, 204); assert.equal(options.headers.get('access-control-allow-origin'), '*');
    assert.equal(await options.text(), '');
});
