const express = require('express');
const { errorHandler } = require('./lib/errors');
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use((req, res, next) => {
    // Form encoding has no boolean type; JSON requests retain strict type checks.
    if (req.is('application/x-www-form-urlencoded') && req.body) {
        if (req.body.completed === 'true') req.body.completed = true;
        if (req.body.completed === 'false') req.body.completed = false;
    }
    next();
});
require('./routes')(app);
app.use((req, res) => res.status(404).json({ message: 'Endpoint not found.', data: null }));
app.use(errorHandler);
module.exports = app;
