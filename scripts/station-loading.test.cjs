const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replaceAll('\r\n', '\n');
const gantt = read('js/gantt.js');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function timeline(getDocs) {
  const source = read('js/timeline.js');
  const cacheCode = source.slice(source.indexOf('let cachedRunsAll'), source.indexOf('/* NEW:'));
  const context = vm.createContext({ getDocs, collectionGroup: () => 'runs', db: {} });
  vm.runInContext(cacheCode.replaceAll('export ', ''), context);
  return context;
}

const snapshot = rows => ({ forEach: visit => rows.forEach(row => visit({ id: row.id, data: () => row })) });

test('concurrent reads and refreshes share one request; empty results are cached', async () => {
  const pending = deferred();
  let requests = 0;
  const ctx = timeline(() => { requests++; return pending.promise; });
  const reads = [ctx.loadRuns(), ctx.loadRuns(), ctx.loadRuns(true)];
  assert.equal(requests, 1);
  pending.resolve(snapshot([]));
  await Promise.all(reads);
  await ctx.loadRuns();
  assert.equal(requests, 1);
  await ctx.loadRuns(true);
  assert.equal(requests, 2);
});

test('a failed request can be retried', async () => {
  let requests = 0;
  const ctx = timeline(async () => {
    if (++requests === 1) throw new Error('offline');
    return snapshot([{ id: 'retry' }]);
  });
  await assert.rejects(ctx.loadRuns(), /offline/);
  assert.equal((await ctx.loadRuns())[0].id, 'retry');
});

test('clearing the cache prevents an older request from overwriting fresh data', async () => {
  const old = deferred();
  const fresh = deferred();
  let requests = 0;
  const ctx = timeline(() => (++requests === 1 ? old.promise : fresh.promise));
  const oldRead = ctx.loadRuns();
  ctx.clearCache();
  const freshRead = ctx.loadRuns(true);
  fresh.resolve(snapshot([{ id: 'fresh' }]));
  await freshRead;
  old.resolve(snapshot([{ id: 'old' }]));
  await oldRead;
  assert.equal((await ctx.loadRuns())[0].id, 'fresh');
});

test('historical standards reuse refreshed runs and cache an empty baseline', async () => {
  const calls = [];
  let builds = 0;
  const ctx = vm.createContext({
    loadRuns: async force => { calls.push(force); return []; },
    buildSegmentsFromRuns: () => ({ segments: [] }),
    buildHistoricalStandardsByModelProcess: () => { builds++; return {}; }
  });
  const fn = gantt.slice(gantt.indexOf('async function refreshGanttHistoricalStandards'), gantt.indexOf('function getGanttStandardMinutes'));
  vm.runInContext('let ganttHistoricalStandardsByModelProcess = {}; let ganttHistoricalStandardsReady = false;\n' + fn, ctx);
  await ctx.refreshGanttHistoricalStandards({ forceRefresh: true, reuseLoadedRuns: true });
  await ctx.refreshGanttHistoricalStandards();
  assert.deepEqual(calls, [false]);
  assert.equal(builds, 1);
});

test('station legends render before the network request finishes', async () => {
  const pending = deferred();
  const legends = [];
  const ctx = vm.createContext({
    renderLegend: id => legends.push(id), LEGEND_STATIONS: [], LEGEND_STATUS: [],
    bodyEl: { hasChildNodes: () => false }, showGanttMessage: () => {},
    el: () => null, getMYTodayKey: () => '2026-11-16',
    loadRunsForDayWithCarryForward: () => pending.promise,
    monthHeadEl: {}, dayHeadEl: {}, startGanttLiveRefresh: () => {}, console,
    showGanttError: error => { throw error; }
  });
  const fn = gantt.slice(gantt.indexOf('let stationRenderRequest'), gantt.indexOf('function renderStationLegend'));
  vm.runInContext(fn.replace('export ', ''), ctx);
  const render = ctx.renderStationOnlyView();
  assert.deepEqual(legends, ['legendStations', 'legendStatus']);
  pending.resolve([]);
  await render;
});

test('mobile address-bar height changes are ignored and width changes are debounced', async () => {
  let listener, scheduled, renders = 0;
  const window = {
    innerWidth: 800, innerHeight: 400,
    matchMedia: () => ({ matches: false }),
    addEventListener: (name, fn) => { listener = fn; }
  };
  const ctx = vm.createContext({ window, setTimeout: fn => { scheduled = fn; return 1; },
    clearTimeout: () => {}, el: () => null,
    document: { body: { classList: { contains: name => name === 'station-page' } } },
    fitDailyToScreen: () => {}, renderStationOnlyView: async () => { renders++; }
  });
  vm.runInContext(gantt.slice(gantt.indexOf('let ganttResizeTimer'), gantt.indexOf('const btnExportStationExcel')), ctx);
  window.innerHeight = 450;
  listener();
  assert.equal(scheduled, undefined);
  window.innerWidth = 820;
  listener();
  window.innerWidth = 840;
  listener();
  assert.equal(renders, 0);
  await scheduled();
  assert.equal(renders, 1);
});

test('Excel is loaded on demand, shares requests, and retries after failure', async () => {
  const scripts = [];
  const ctx = vm.createContext({ document: {
    createElement: () => ({ remove() {} }),
    head: { appendChild: script => scripts.push(script) }
  } });
  const source = read('js/excel-export.js');
  const loader = source.slice(source.indexOf('let excelLibraryPending'), source.indexOf('import {\n  buildSegmentsFromRuns'));
  vm.runInContext(loader.replace('export ', ''), ctx);
  assert.equal(scripts.length, 0);
  const first = ctx.ensureExcelLibrary();
  assert.equal(ctx.ensureExcelLibrary(), first);
  scripts[0].onerror();
  await assert.rejects(first, /Unable to load Excel/);
  const retry = ctx.ensureExcelLibrary();
  assert.equal(scripts.length, 2);
  ctx.XLSX = {};
  scripts[1].onload();
  await retry;
  await ctx.ensureExcelLibrary();
  assert.equal(scripts.length, 2);
});
