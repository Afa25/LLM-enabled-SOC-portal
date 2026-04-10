const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const routes = require('./routes');

function createApp() {
  const app = express();

  app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : true,
    credentials: true
  }));
  app.use(express.json({ limit: '10mb' }));

  app.use('/api/', rateLimit({ windowMs: 60_000, max: 200 }));
  app.use('/api', routes);

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('*', (_, res) =>
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
  );

  return app;
}

module.exports = { createApp };
