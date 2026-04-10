const cron   = require('node-cron');
const db     = require('../db/database');
const wazuh  = require('./wazuh');
const ollama = require('./ollama');

const activeTasks = new Map();

async function runScheduledReport(schedule) {
  console.log(`[Scheduler] Running report: "${schedule.name}"`);
  const d   = db.get();

  try {
    // Determine date range
    const now = new Date();
    let startDate;
    switch (schedule.timeframe) {
      case 'daily':   startDate = new Date(now - 86400_000);   break;
      case 'weekly':  startDate = new Date(now - 7*86400_000); break;
      case 'monthly': startDate = new Date(now - 30*86400_000);break;
      default:        startDate = new Date(now - 86400_000);
    }

    const startISO = startDate.toISOString();
    const endISO   = now.toISOString();

    // Fetch data from Wazuh
    const [alertData, agents] = await Promise.all([
      wazuh.getAlertCountByRange(startISO, endISO),
      wazuh.getAgents()
    ]);

    const context = { ...alertData, agents, startDate: startISO, endDate: endISO };

    // Generate with Ollama
    const content = await ollama.generateReport(context, schedule.timeframe, schedule.model);

    // Save report
    const title = `${schedule.timeframe.charAt(0).toUpperCase() + schedule.timeframe.slice(1)} SOC Report — ${now.toLocaleDateString()}`;
    d.prepare(`
      INSERT INTO reports (title, timeframe, start_date, end_date, content, model, alert_count, schedule_id)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(title, schedule.timeframe, startISO, endISO, content, schedule.model, alertData.total, schedule.id);

    // Update last/next run
    d.prepare('UPDATE schedules SET last_run = ? WHERE id = ?').run(endISO, schedule.id);
    console.log(`[Scheduler] Report "${title}" saved. Alerts: ${alertData.total}`);
  } catch (err) {
    console.error(`[Scheduler] Error generating report for "${schedule.name}":`, err.message);
  }
}

function registerTask(schedule) {
  if (activeTasks.has(schedule.id)) {
    activeTasks.get(schedule.id).stop();
  }
  if (!schedule.enabled) return;

  const task = cron.schedule(schedule.cron_expr, () => runScheduledReport(schedule));
  activeTasks.set(schedule.id, task);
  console.log(`[Scheduler] Registered: "${schedule.name}" (${schedule.cron_expr})`);
}

function startScheduler() {
  const schedules = db.get().prepare('SELECT * FROM schedules WHERE enabled = 1').all();
  schedules.forEach(registerTask);
  console.log(`[Scheduler] Started with ${schedules.length} active schedules.`);
}

function refreshSchedule(id) {
  const s = db.get().prepare('SELECT * FROM schedules WHERE id = ?').get(id);
  if (s) registerTask(s);
}

module.exports = { startScheduler, runScheduledReport, refreshSchedule };
