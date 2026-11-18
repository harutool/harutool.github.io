// 로컬 저장소 + 계산 로직 (기기 안에 먼저 저장하고, 로그인하면 클라우드와 동기화)
(function () {
  "use strict";
  var KEY = "jz_data_v1";
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
  function save(kind, data, quiet) {
    var id = data.id || uid();
    var prev = db.items[id] || {};
    var it = Object.assign({}, prev, data, { id: id, kind: kind, updatedAt: Date.now(), deleted: false });
    db.items[id] = it;
    db.meta.dirty[id] = 1;
    if (!quiet) persist();
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
    return Object.assign({ owner: "", phone: "", bank: "", account: "", holder: "", smsTpl: "" }, s && !s.deleted ? s : {});
  }
  function saveSettings(s) { return save("settings", Object.assign({}, s, { id: "settings" })); }

  // ===== 계산 =====
  function n(v) { v = Number(String(v == null ? "" : v).replace(/[^\d.-]/g, "")); return isFinite(v) ? v : 0; }
  function pad(x) { return ("0" + x).slice(-2); }
  function ymOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addMonth(ym, k) { var p = ym.split("-").map(Number); return ymOf(new Date(p[0], p[1] - 1 + k, 1)); }
  function lastDay(ym) { var p = ym.split("-").map(Number); return new Date(p[0], p[1], 0).getDate(); }
  function dueDateOf(ym, day) { day = Math.min(Math.max(1, n(day) || 1), lastDay(ym)); return ym + "-" + pad(day); }

  function billTotal(b) {
    var base = Math.round(n(b.rent)) + Math.round(n(b.mgmt)) + (b.extras || []).reduce(function (s, e) { return s + Math.round(n(e.amount)); }, 0);
    var vat = b.vat === "separate" ? Math.round(n(b.rent) * 0.1) : 0;
    return base + vat;
  }
  function billVat(b) { return b.vat === "separate" ? Math.round(n(b.rent) * 0.1) : 0; }

  // 계약 기간 동안 매달 청구서를 자동으로 만들어요 (id가 정해져 있어 기기마다 중복되지 않음)
  function ensureBills() {
    var cur = ymOf(new Date()), made = 0;
    all("unit").forEach(function (u) {
      if (!u.start || !(n(u.rent) || n(u.mgmt)) || u.vacant) return;
      var first = u.start.slice(0, 7);
      if (u.billFrom && u.billFrom > first) first = u.billFrom;
      var endYm = u.end && u.moveOut ? u.end.slice(0, 7) : cur;
      if (endYm > cur) endYm = cur;
      for (var ym = first, guard = 0; ym <= endYm && guard < 240; ym = addMonth(ym, 1), guard++) {
        var id = "b_" + u.id + "_" + ym;
        if (db.items[id]) continue;
        save("bill", { id: id, unitId: u.id, ym: ym, due: dueDateOf(ym, u.dueDay), rent: n(u.rent), mgmt: n(u.mgmt), vat: u.vat || "none", extras: [] }, true);
        made++;
      }
    });
    if (made) persist();
    return made;
  }

  function billsOf(unitId) { return all("bill").filter(function (b) { return b.unitId === unitId; }).sort(function (a, b) { return a.ym < b.ym ? -1 : 1; }); }

  // 호실별 수납 현황: 입금을 오래된 청구부터 차감
  function ledger() {
    var out = {}, today = todayStr();
    all("unit").forEach(function (u) { out[u.id] = { billed: 0, paid: 0, bills: [] }; });
    all("bill").sort(function (a, b) { return a.ym < b.ym ? -1 : 1; }).forEach(function (b) {
      var L = out[b.unitId] || (out[b.unitId] = { billed: 0, paid: 0, bills: [] });
      var t = billTotal(b);
      L.billed += t; L.bills.push({ bill: b, total: t, paid: 0 });
    });
    all("payment").forEach(function (p) {
      var L = out[p.unitId] || (out[p.unitId] = { billed: 0, paid: 0, bills: [] });
      L.paid += n(p.amount);
    });
    Object.keys(out).forEach(function (k) {
      var L = out[k], left = L.paid;
      L.bills.forEach(function (x) {
        var use = Math.min(left, x.total); x.paid = use; left -= use;
        x.status = x.paid >= x.total ? "완납" : x.bill.due < today ? "연체" : x.paid > 0 ? "부분" : "납부 전";
        x.late = x.status === "연체" ? Math.floor((Date.now() - new Date(x.bill.due + "T00:00:00").getTime()) / 864e5) : 0;
      });
      L.credit = Math.max(0, left);
      L.balance = L.billed - L.paid;
      L.overdue = L.bills.filter(function (x) { return x.status === "연체"; });
      L.overdueAmt = L.overdue.reduce(function (s, x) { return s + x.total - x.paid; }, 0);
      L.maxLate = L.overdue.reduce(function (m, x) { return Math.max(m, x.late); }, 0);
    });
    return out;
  }

  function monthSummary(ym) {
    var L = ledger(), billed = 0, collected = 0, unpaid = 0, count = 0, paidCount = 0;
    Object.keys(L).forEach(function (k) {
      L[k].bills.forEach(function (x) {
        if (x.bill.ym !== ym) return;
        billed += x.total; collected += x.paid; unpaid += x.total - x.paid; count++; if (x.paid >= x.total) paidCount++;
      });
    });
    var received = all("payment").filter(function (p) { return (p.date || "").slice(0, 7) === ym; }).reduce(function (s, p) { return s + n(p.amount); }, 0);
    var exp = all("expense").filter(function (e) { return (e.date || "").slice(0, 7) === ym; });
    var cost = exp.reduce(function (s, e) { return s + n(e.amount); }, 0);
    var byCat = {};
    exp.forEach(function (e) { byCat[e.category || "기타"] = (byCat[e.category || "기타"] || 0) + n(e.amount); });
    return { billed: billed, collected: collected, unpaid: unpaid, count: count, paidCount: paidCount, received: received, cost: cost, net: received - cost, byCat: byCat };
  }

  function yearReport(year) {
    var months = [], tot = { billed: 0, received: 0, cost: 0, rent: 0, mgmt: 0, vat: 0 };
    for (var m = 1; m <= 12; m++) {
      var ym = year + "-" + pad(m), s = monthSummary(ym);
      var bills = all("bill").filter(function (b) { return b.ym === ym; });
      var rent = bills.reduce(function (a, b) { return a + n(b.rent); }, 0), mgmt = bills.reduce(function (a, b) { return a + n(b.mgmt) + (b.extras || []).reduce(function (q, e) { return q + n(e.amount); }, 0); }, 0), vat = bills.reduce(function (a, b) { return a + billVat(b); }, 0);
      months.push({ ym: ym, billed: s.billed, received: s.received, cost: s.cost, rent: rent, mgmt: mgmt, vat: vat });
      tot.billed += s.billed; tot.received += s.received; tot.cost += s.cost; tot.rent += rent; tot.mgmt += mgmt; tot.vat += vat;
    }
    var byProp = {};
    all("bill").filter(function (b) { return b.ym.slice(0, 4) === String(year); }).forEach(function (b) {
      var u = get(b.unitId) || {}, pid = u.propId || "";
      byProp[pid] = (byProp[pid] || 0) + n(b.rent);
    });
    var byCat = {};
    all("expense").filter(function (e) { return (e.date || "").slice(0, 4) === String(year); }).forEach(function (e) { byCat[e.category || "기타"] = (byCat[e.category || "기타"] || 0) + n(e.amount); });
    return { months: months, tot: tot, byProp: byProp, byCat: byCat };
  }

  self.JBStore = {
    db: function () { return db; }, all: all, get: get, save: save, remove: remove,
    settings: settings, saveSettings: saveSettings,
    billTotal: billTotal, billVat: billVat, ensureBills: ensureBills, billsOf: billsOf, ledger: ledger, monthSummary: monthSummary, yearReport: yearReport,
    n: n, uid: uid, addMonth: addMonth, ymOf: ymOf, todayStr: todayStr, dueDateOf: dueDateOf,
    onChange: function (fn) { listeners.push(fn); },
    persist: persist,
    replaceAll: function (data) { db = data; if (!db.meta) db.meta = { firstUse: Date.now(), dirty: {} }; persist(); }
  };
})();
