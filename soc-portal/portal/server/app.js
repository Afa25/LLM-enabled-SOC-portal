const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const routes = require('./routes');
const monitor = require('./services/containerMonitor');

// Start background container polling
monitor.start();

function createApp() {
  const app = express();

  app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : true,
    credentials: true
  }));
  app.use(express.json({ limit: '10mb' }));

  app.use('/api/', rateLimit({
    windowMs: 60_000,
    max: 600,
    skip: (req) => req.originalUrl.startsWith('/api/auth/validate'),
  }));
  app.use('/api', routes);

  // Return 404 for any unmatched /api/* route instead of falling through to the SPA
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  app.disable('x-powered-by');

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('*', (_, res) =>
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
  );

  return app;
}

module.exports = { createApp };
