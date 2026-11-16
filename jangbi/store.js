// 로컬 저장소 + 계산 로직 (기기 안에 먼저 저장하고, 로그인하면 클라우드와 동기화)
(function () {
  "use strict";
  var KEY = "jb_data_v1";
  var listeners = [];
  var db = load();

  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || "null");
      if (d && d.items) return d;
    } catch (e) {}
    return { items: {}, meta: { firstUse: Date.now(), dirty: {} } };
  }
  function persist() {
    localStorage.setItem(KEY, JSON.stringify(db));
    listeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  function uid() {
    var a = new Uint8Array(10);
    (self.crypto || window.crypto).getRandomValues(a);
    return Date.now().toString(36) + Array.prototype.map.call(a, function (b) { return (b % 36).toString(36); }).join("");
  }
  function all(kind) {
    var out = [];
    Object.keys(db.items).forEach(function (k) {
      var it = db.items[k];
      if (it.kind === kind && !it.deleted) out.push(it);
    });
    return out;
  }
  function get(id) { var it = db.items[id]; return it && !it.deleted ? it : null; }
  function save(kind, data) {
    var id = data.id || uid();
    var prev = db.items[id] || {};
    var it = Object.assign({}, prev, data, { id: id, kind: kind, updatedAt: Date.now(), deleted: false });
    db.items[id] = it;
    db.meta.dirty[id] = 1;
    persist();
    return it;
  }
  function remove(id) {
    if (!db.items[id]) return;
    db.items[id] = { id: id, kind: db.items[id].kind, updatedAt: Date.now(), deleted: true };
    db.meta.dirty[id] = 1;
    persist();
  }
  function settings() {
    var s = db.items.settings;
    return Object.assign({ bizName: "", owner: "", bizNo: "", phone: "", address: "", bank: "", account: "", holder: "", defaultVat: "separate", otAfter: 8 }, s && !s.deleted ? s : {});
  }
  function saveSettings(s) { return save("settings", Object.assign({}, s, { id: "settings" })); }

  // ===== 계산 =====
  var UNIT = { day: "일대", half: "반대", hour: "시간", month: "월대", lump: "건당" };
  function n(v) { v = Number(String(v == null ? "" : v).replace(/[^\d.-]/g, "")); return isFinite(v) ? v : 0; }
  function jobAmounts(j) {
    var base = Math.round(n(j.qty) * n(j.rate));
    var ot = Math.round(n(j.otHours) * n(j.otRate));
    var ex = (j.extras || []).reduce(function (s, e) { return s + Math.round(n(e.amount)); }, 0);
    var gross = base + ot + ex;
    var supply, vat, total;
    if (j.vat === "included") { total = gross; supply = Math.round(total / 1.1); vat = total - supply; }
    else if (j.vat === "none") { supply = gross; vat = 0; total = gross; }
    else { supply = gross; vat = Math.round(gross * 0.1); total = supply + vat; }
    return { base: base, ot: ot, extras: ex, supply: supply, vat: vat, total: total };
  }
  function jobsSorted() { return all("job").sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.updatedAt - b.updatedAt); }); }

  // 거래처별 미수금 (입금을 오래된 작업부터 차감)
  function receivables() {
    var byClient = {};
    jobsSorted().forEach(function (j) {
      var c = byClient[j.clientId] || (byClient[j.clientId] = { billed: 0, paid: 0, jobs: [] });
      var t = jobAmounts(j).total;
      c.billed += t; c.jobs.push({ job: j, total: t, paid: 0 });
    });
    all("payment").forEach(function (p) {
      var c = byClient[p.clientId] || (byClient[p.clientId] = { billed: 0, paid: 0, jobs: [] });
      c.paid += n(p.amount);
    });
    Object.keys(byClient).forEach(function (cid) {
      var c = byClient[cid], left = c.paid;
      c.jobs.forEach(function (x) { var use = Math.min(left, x.total); x.paid = use; left -= use; });
      c.balance = c.billed - c.paid;
      c.unpaidJobs = c.jobs.filter(function (x) { return x.paid < x.total; });
      c.oldestUnpaid = c.unpaidJobs.length ? c.unpaidJobs[0].job.date : "";
    });
    return byClient;
  }
  function jobStatus(jobId) {
    var r = receivables();
    for (var cid in r) {
      var x = r[cid].jobs.find(function (y) { return y.job.id === jobId; });
      if (x) return x.paid >= x.total ? "완납" : x.paid > 0 ? "부분" : "미수";
    }
    return "미수";
  }
  function monthSummary(ym) {
    var jobs = all("job").filter(function (j) { return (j.date || "").slice(0, 7) === ym; });
    var sales = 0, supply = 0, days = {};
    jobs.forEach(function (j) { var a = jobAmounts(j); sales += a.total; supply += a.supply; days[j.date] = 1; });
    var exp = all("expense").filter(function (e) { return (e.date || "").slice(0, 7) === ym; });
    var cost = exp.reduce(function (s, e) { return s + n(e.amount); }, 0);
    var paid = all("payment").filter(function (p) { return (p.date || "").slice(0, 7) === ym; }).reduce(function (s, p) { return s + n(p.amount); }, 0);
    var byCat = {};
    exp.forEach(function (e) { byCat[e.category || "기타"] = (byCat[e.category || "기타"] || 0) + n(e.amount); });
    return { jobs: jobs.length, workDays: Object.keys(days).length, sales: sales, supply: supply, cost: cost, profit: supply - cost, received: paid, byCat: byCat };
  }

  self.JBStore = {
    db: function () { return db; }, all: all, get: get, save: save, remove: remove,
    settings: settings, saveSettings: saveSettings,
    jobAmounts: jobAmounts, receivables: receivables, jobStatus: jobStatus, monthSummary: monthSummary, jobsSorted: jobsSorted,
    UNIT: UNIT, n: n, uid: uid,
    onChange: function (fn) { listeners.push(fn); },
    persist: persist,
    replaceAll: function (data) { db = data; if (!db.meta) db.meta = { firstUse: Date.now(), dirty: {} }; persist(); }
  };
})();
