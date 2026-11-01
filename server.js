require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const app = require('./app');
const { initialize } = require('./lib/store');
async function start() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    await initialize();
    const server = app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
        console.log(`API listening on port ${server.address().port}`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            server.close(async () => { await mongoose.disconnect(); process.exit(0); });
            setTimeout(() => process.exit(1), 10000).unref();
        });
    }
}
start().catch(async () => {
    console.error('Startup failed. Check MONGODB_URI, database access, and network connectivity.');
    await mongoose.disconnect();
    process.exitCode = 1;
});
