const db = require('./db/database');
const { createApp } = require('./app');
const { startScheduler } = require('./services/scheduler');
const { startSnmpSync } = require('./services/snmp');
const { startMaintenance } = require('./services/maintenance');

const app = createApp();
const PORT = process.env.PORT || 4000;

db.init();
startScheduler();
startSnmpSync();
startMaintenance();
app.listen(PORT, () => console.log(`SOC Portal running on port ${PORT}`));
