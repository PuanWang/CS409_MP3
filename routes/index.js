const express = require('express');
const User = require('../models/user');
const Task = require('../models/task');
const store = require('../lib/store');
const { list, projection } = require('../lib/queries');
module.exports = function (app) {
    const router = express.Router();
    require('./home')(router);
    for (const [path, Model, save, defaultLimit] of [
        ['users', User, store.saveUser, 0], ['tasks', Task, store.saveTask, 100]
    ]) {
        router.get(`/${path}`, async (req, res) => {
            res.json({ message: 'OK', data: await list(Model, req.query, defaultLimit) });
        });
        router.post(`/${path}`, async (req, res) => {
            res.status(201).json({ message: `${Model.modelName} created.`, data: await save(null, req.body) });
        });
        router.get(`/${path}/:id`, async (req, res) => {
            await store.existing(Model, req.params.id);
            const data = await Model.findById(req.params.id).select(projection(req.query));
            res.json({ message: 'OK', data });
        });
        router.put(`/${path}/:id`, async (req, res) => {
            res.json({ message: `${Model.modelName} updated.`, data: await save(req.params.id, req.body) });
        });
        router.delete(`/${path}/:id`, async (req, res) => {
            await store.remove(Model, req.params.id);
            res.status(204).end();
        });
    }
    app.use('/api', router);
};
