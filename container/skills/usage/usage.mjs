#!/usr/bin/env node
/**
 * usage — show NanoClaw Claude token usage and estimated costs
 *
 * Commands:
 *   usage today       # Today's usage (default)
 *   usage yesterday
 *   usage week        # Last 7 days
 *   usage month       # Current calendar month
 *   usage all         # All recorded history
 *
 * Note: Costs are estimated API-equivalent amounts.
 * If you use a subscription plan (Claude Pro/Max), these
 * reflect what the usage would cost at API rates, not actual billing.
 *
 * Usage data is stored in /workspace/project/data/usage/usage.jsonl
 */

import fs from 'fs';

const USAGE_FILE = process.env.USAGE_FILE || '/workspace/project/data/usage/usage.jsonl';

function die(msg) { console.error(msg); process.exit(1); }

function loadRecords() {
  if (!fs.existsSync(USAGE_FILE)) return [];
  return fs.readFileSync(USAGE_FILE, 'utf-8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function startOf(period) {
  const now = new Date();
  if (period === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (period === 'yesterday') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - 1);
    return d;
  }
  if (period === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (period === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return null; // 'all'
}

function endOf(period) {
  if (period === 'yesterday') {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  return null; // no end filter
}

function filterRecords(records, period) {
  const from = startOf(period);
  const to = endOf(period);
  return records.filter(r => {
    const ts = new Date(r.ts);
    if (from && ts < from) return false;
    if (to && ts >= to) return false;
    return true;
  });
}

function fmt(n) { return n.toLocaleString(); }
function fmtCost(n) { return `$${n.toFixed(4)}`; }

function periodLabel(period) {
  if (period === 'today') return 'Today';
  if (period === 'yesterday') return 'Yesterday';
  if (period === 'week') return 'Last 7 days';
  if (period === 'month') return 'This month';
  return 'All time';
}

function summarize(records) {
  return records.reduce((acc, r) => ({
    inputTokens: acc.inputTokens + (r.inputTokens || 0),
    outputTokens: acc.outputTokens + (r.outputTokens || 0),
    cacheReadTokens: acc.cacheReadTokens + (r.cacheReadTokens || 0),
    cacheWriteTokens: acc.cacheWriteTokens + (r.cacheWriteTokens || 0),
    costUsd: acc.costUsd + (r.costUsd || 0),
    turns: acc.turns + (r.turns || 0),
    requests: acc.requests + 1,
  }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, turns: 0, requests: 0 });
}

function printSummary(label, records) {
  if (!records.length) {
    console.log(`${label}: no usage recorded.`);
    return;
  }
  const s = summarize(records);
  console.log(`${label} — ${s.requests} request${s.requests !== 1 ? 's' : ''}, ${s.turns} turns`);
  console.log(`  Estimated cost: ${fmtCost(s.costUsd)}`);
  console.log(`  Tokens:`);
  console.log(`    Input:       ${fmt(s.inputTokens)}`);
  console.log(`    Output:      ${fmt(s.outputTokens)}`);
  console.log(`    Cache read:  ${fmt(s.cacheReadTokens)}`);
  console.log(`    Cache write: ${fmt(s.cacheWriteTokens)}`);

  // Break down by model if more than one
  const byModel = {};
  for (const r of records) {
    const m = r.model || 'unknown';
    if (!byModel[m]) byModel[m] = { costUsd: 0, requests: 0 };
    byModel[m].costUsd += r.costUsd || 0;
    byModel[m].requests++;
  }
  const models = Object.entries(byModel);
  if (models.length > 1) {
    console.log(`  By model:`);
    for (const [model, stats] of models.sort((a, b) => b[1].costUsd - a[1].costUsd)) {
      console.log(`    ${model}: ${fmtCost(stats.costUsd)} (${stats.requests} req)`);
    }
  }

  // By day if period spans multiple days
  if (records.length > 1) {
    const byDay = {};
    for (const r of records) {
      const day = r.ts.slice(0, 10);
      if (!byDay[day]) byDay[day] = { costUsd: 0, requests: 0 };
      byDay[day].costUsd += r.costUsd || 0;
      byDay[day].requests++;
    }
    const days = Object.entries(byDay).sort();
    if (days.length > 1) {
      console.log(`  By day:`);
      for (const [day, stats] of days) {
        console.log(`    ${day}: ${fmtCost(stats.costUsd)} (${stats.requests} req)`);
      }
    }
  }
}

const period = process.argv[2] || 'today';
const validPeriods = ['today', 'yesterday', 'week', 'month', 'all'];
if (!validPeriods.includes(period)) {
  die(`Usage: usage [today|yesterday|week|month|all]\nUnknown period: ${period}`);
}

const all = loadRecords();
const filtered = filterRecords(all, period);
printSummary(periodLabel(period), filtered);
