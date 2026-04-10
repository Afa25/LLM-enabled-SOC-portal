const express = require('express');
const authRoutes = require('./auth');
const alertRoutes = require('./alerts');
const reportRoutes = require('./reports');
const scheduleRoutes = require('./schedule');
const statsRoutes = require('./stats');
const agentRoutes = require('./agents');
const healthRoutes = require('./health');
const deviceRoutes = require('./devices');
const pairingRoutes = require('./pairing');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/alerts', alertRoutes);
router.use('/reports', reportRoutes);
router.use('/schedule', scheduleRoutes);
router.use('/stats', statsRoutes);
router.use('/agents', agentRoutes);
router.use('/health', healthRoutes);
router.use('/devices', deviceRoutes);
router.use('/pairing', pairingRoutes);

module.exports = router;
