(function () {
  "use strict";
  var S = self.JBStore, SY = self.JBSync, C = self.JB_CONFIG;
  var $ = function (s) { return document.querySelector(s); };
  var view = $("#view");
  var state = { tab: "home", ym: S.ymOf(new Date()), sheet: null, year: new Date().getFullYear() };
  var EXP_CATS = ["수리·보수", "관리비·공용전기", "재산세·종부세", "대출이자", "화재·건물보험", "중개수수료", "청소·소독", "세무·기장", "기타"];
  var EXTRA_PRESETS = ["전기", "수도", "가스", "인터넷·TV", "주차", "기타"];
  var PAY_METHODS = ["계좌이체", "현금", "카드", "보증금 차감"];
  var DEFAULT_SMS = "안녕하세요 {세입자}님, {건물} {호수} {월} 월세 {금액} 입금 부탁드립니다.{계좌}";

  // ===== 유틸 =====
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function won(v) { return (Math.round(v) || 0).toLocaleString("ko-KR") + "원"; }
  function man(v) { v = Math.round(v) || 0; if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, "") + "억"; if (Math.abs(v) >= 1e4) return Math.round(v / 1e4).toLocaleString("ko-KR") + "만"; return v.toLocaleString("ko-KR"); }
  function today() { return S.todayStr(); }
  function addMonth(s, k) { return S.addMonth(s, k); }
  function ymLabel(s) { var p = s.split("-"); return p[0] + "년 " + Number(p[1]) + "월"; }
  function mLabel(s) { return Number(s.split("-")[1]) + "월"; }
  function daysUntil(s) { return Math.ceil((new Date(s + "T00:00:00").getTime() - new Date(today() + "T00:00:00").getTime()) / 864e5); }
  function toast(m) { var t = $("#toast"); t.textContent = m; t.classList.remove("hidden"); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.add("hidden"); }, 2200); }
  function num(v) { return S.n(v); }
  function fmtInput(v) { v = num(v); return v ? v.toLocaleString("ko-KR") : ""; }
  function propName(id) { var p = S.get(id); return p ? p.name : ""; }
  function unitLabel(u) { if (!u) return "(삭제된 호실)"; return [propName(u.propId), u.room].filter(Boolean).join(" ") + (u.tenant ? " · " + u.tenant : ""); }
  function unitShort(u) { return [propName(u.propId), u.room].filter(Boolean).join(" ") || u.tenant || "호실"; }
  function units(includeOut) { return S.all("unit").filter(function (u) { return includeOut || !u.moveOut; }).sort(function (a, b) { var pa = propName(a.propId), pb = propName(b.propId); return pa === pb ? String(a.room || "").localeCompare(String(b.room || ""), "ko", { numeric: true }) : pa.localeCompare(pb, "ko"); }); }

  // ===== Pro / 체험 =====
  try { if (document.referrer.indexOf("android-app://") === 0) localStorage.setItem("jz_play", "1"); } catch (e) {}
  var IN_PLAY = (function () { try { return localStorage.getItem("jz_play") === "1"; } catch (e) { return false; } })();
  var REVIEW_HASH = C.REVIEW_HASH || "";
  async function sha256(s) { var b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, "0"); }).join(""); }
  function lic() { try { return JSON.parse(localStorage.getItem("jz_license") || "null"); } catch (e) { return null; } }
  function trialLeft() { var f = (S.db().meta && S.db().meta.firstUse) || Date.now(); return Math.max(0, C.TRIAL_DAYS - Math.floor((Date.now() - f) / 864e5)); }
  function isPro() { var l = lic(); return !!(l && l.valid) || trialLeft() > 0; }
  function needPro(what) { if (isPro()) return false; openSheet(proSheet(what)); return true; }

  // ===== 렌더 =====
  function render() {
    S.ensureBills();
    document.querySelectorAll("#tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === state.tab || (state.tab === "unit" && b.dataset.tab === "units") || (/^(props|report)$/.test(state.tab) && b.dataset.tab === "more")); });
    var fn = { home: vHome, units: vUnits, unit: vUnit, collect: vCollect, cost: vCost, more: vMore, props: vProps, report: vReport }[state.tab] || vHome;
    view.innerHTML = fn();
    var fab = $("#fab");
    if (state.tab === "cost") { fab.textContent = "＋ 지출 기록"; fab.dataset.act = "newExpense"; }
    else if (state.tab === "units" || !S.all("unit").length) { fab.textContent = "＋ 세입자 등록"; fab.dataset.act = "newUnit"; }
    else { fab.textContent = "＋ 입금 기록"; fab.dataset.act = "newPayment"; }
    fab.classList.toggle("hidden", /^(more|props|report)$/.test(state.tab));
  }
  function monthNav() { return '<div class="month"><button data-act="prevM">◀</button><b>' + ymLabel(state.ym) + '</b><button data-act="nextM">▶</button></div>'; }
  function statusBadge(x) {
    if (!x) return "";
    var cls = { "완납": "b-ok", "연체": "b-late", "부분": "b-part", "납부 전": "b-wait" }[x.status] || "b-wait";
    return '<span class="badge ' + cls + '">' + (x.status === "연체" ? "연체 " + x.late + "일" : x.status) + '</span>';
  }

  function vHome() {
    var cur = S.ymOf(new Date());
    var m = S.monthSummary(cur), L = S.ledger();
    var us = units(false);
    if (!us.length) {
      return '<div class="hero"><h2>집주인장부</h2><p>원룸·다가구·상가 월세를 휴대폰과 PC에서 함께 관리해요.</p><ul><li>매달 청구가 자동으로 만들어지고 연체 일수가 보여요</li><li>입금 요청 문자를 한 번에 보내요</li><li>연간 임대수입 리포트로 종합소득세 준비 끝</li></ul><button class="btn y block" data-act="newUnit">첫 세입자 등록하기</button><p class="muted" style="margin-top:12px">기록은 이 기기에 먼저 저장돼요. 로그인하면 휴대폰·PC가 자동으로 맞춰져요.</p></div>';
    }
    var late = [], upcoming = [], lateTotal = 0, deposit = 0;
    us.forEach(function (u) {
      deposit += num(u.deposit);
      var l = L[u.id]; if (!l) return;
      if (l.overdueAmt > 0) { late.push({ u: u, l: l }); lateTotal += l.overdueAmt; }
      l.bills.forEach(function (x) { if (x.status !== "완납" && x.status !== "연체") { var d = daysUntil(x.bill.due); if (d >= 0 && d <= 7) upcoming.push({ u: u, x: x, d: d }); } });
    });
    late.sort(function (a, b) { return b.l.maxLate - a.l.maxLate; });
    upcoming.sort(function (a, b) { return a.d - b.d; });
    var expiring = us.filter(function (u) { return u.end && daysUntil(u.end) <= 90; }).sort(function (a, b) { return a.end < b.end ? -1 : 1; });
    var vacant = S.all("unit").filter(function (u) { return u.vacant && !u.moveOut; }).length;
    var bars = "", max = 1, months = [];
    for (var i = 11; i >= 0; i--) { var k = addMonth(cur, -i), s = S.monthSummary(k); months.push({ k: k, s: s }); max = Math.max(max, s.received, s.cost); }
    months.forEach(function (x) { bars += '<div class="b" title="' + ymLabel(x.k) + ' 입금 ' + won(x.s.received) + ' / 지출 ' + won(x.s.cost) + '"><div style="display:flex;gap:2px;align-items:flex-end;width:100%;height:100%"><i style="height:' + Math.round(100 * x.s.received / max) + '%"></i><i class="c" style="height:' + Math.round(100 * x.s.cost / max) + '%"></i></div><span>' + Number(x.k.slice(5)) + '</span></div>'; });
    var rate = m.count ? Math.round(100 * m.paidCount / m.count) : 0;
    return '<h2>' + ymLabel(cur) + ' 수납 현황</h2>' +
      '<div class="grid2"><div class="stat hl"><div class="k">이번 달 받을 돈</div><div class="v">' + won(m.billed) + '</div><div class="s">' + m.count + '건 중 ' + m.paidCount + '건 완납 (' + rate + '%)</div></div>' +
      '<div class="stat"><div class="k">이번 달 입금</div><div class="v" style="color:var(--green)">' + won(m.received) + '</div><div class="s">지출 ' + man(m.cost) + ' · 순수익 ' + man(m.net) + '</div></div>' +
      '<div class="stat red" data-act="tab" data-tab="collect" style="cursor:pointer"><div class="k">연체 (납부일 지남)</div><div class="v">' + won(lateTotal) + '</div><div class="s">' + late.length + '세대</div></div>' +
      '<div class="stat"><div class="k">세입자 · 보증금</div><div class="v">' + us.filter(function (u) { return !u.vacant; }).length + '세대</div><div class="s">보증금 ' + man(deposit) + (vacant ? ' · 공실 ' + vacant : "") + '</div></div></div>' +
      (late.length ? '<div class="card"><h3>🚨 연체 세대</h3>' + late.map(function (x) { return '<div class="row" data-act="openUnit" data-id="' + esc(x.u.id) + '"><div class="l"><div class="t">' + esc(unitShort(x.u)) + ' · ' + esc(x.u.tenant || "") + '</div><div class="d">' + x.l.overdue.length + '개월 미납 · 최장 ' + x.l.maxLate + '일 지남</div></div><div class="r"><div class="amt" style="color:var(--red)">' + won(x.l.overdueAmt) + '</div></div></div>'; }).join("") + '</div>' : '<div class="card note">연체 세대가 없어요. 👍</div>') +
      (upcoming.length ? '<div class="card"><h3>📅 7일 안에 납부일</h3>' + upcoming.map(function (x) { return '<div class="row" data-act="openUnit" data-id="' + esc(x.u.id) + '"><div class="l"><div class="t">' + esc(unitShort(x.u)) + ' · ' + esc(x.u.tenant || "") + '</div><div class="d">' + esc(x.x.bill.due) + (x.d === 0 ? " (오늘)" : " (" + x.d + "일 후)") + '</div></div><div class="r amt">' + won(x.x.total - x.x.paid) + '</div></div>'; }).join("") + '</div>' : "") +
      (expiring.length ? '<div class="card"><h3>📝 계약 만기 90일 이내</h3>' + expiring.map(function (u) { var d = daysUntil(u.end); return '<div class="row" data-act="openUnit" data-id="' + esc(u.id) + '"><div class="l"><div class="t">' + esc(unitShort(u)) + ' · ' + esc(u.tenant || "") + '</div><div class="d">만기 ' + esc(u.end) + ' · 보증금 ' + won(u.deposit) + '</div></div><div class="r"><span class="badge ' + (d < 0 ? "b-late" : "b-part") + '">' + (d < 0 ? "만기 " + (-d) + "일 지남" : "D-" + d) + '</span></div></div>'; }).join("") + '</div>' : "") +
      '<div class="card"><h3>최근 12개월 <span class="legend"><i style="background:var(--y)"></i>입금<i style="background:#cfd4dd"></i>지출</span></h3><div class="bars">' + bars + '</div></div>';
  }

  function unitRow(u, L) {
    var l = L[u.id] || { bills: [], balance: 0, overdueAmt: 0 };
    var curX = l.bills.filter(function (x) { return x.bill.ym === S.ymOf(new Date()); })[0];
    var badge = u.moveOut ? '<span class="badge b-wait">퇴실</span>' : u.vacant ? '<span class="badge b-wait">공실</span>' : l.overdueAmt > 0 ? '<span class="badge b-late">연체 ' + l.maxLate + '일</span>' : statusBadge(curX);
    return '<div class="row" data-act="openUnit" data-id="' + esc(u.id) + '"><div class="l"><div class="t">' + esc(u.room || "호실") + (u.tenant ? ' · ' + esc(u.tenant) : "") + '</div><div class="d">월 ' + man(u.rent) + (num(u.mgmt) ? ' + 관리비 ' + man(u.mgmt) : "") + ' · 매월 ' + (num(u.dueDay) || 1) + '일' + (u.end ? ' · 만기 ' + esc(u.end) : "") + '</div></div><div class="r">' + (l.balance > 0 ? '<div class="amt" style="color:var(--red)">' + won(l.balance) + '</div>' : "") + badge + '</div></div>';
  }
  function vUnits() {
    var L = S.ledger(), list = units(false), groups = {};
    list.forEach(function (u) { (groups[u.propId || ""] = groups[u.propId || ""] || []).push(u); });
    var out = S.all("unit").filter(function (u) { return u.moveOut; });
    return '<h2>세입자</h2>' + (list.length ? Object.keys(groups).sort(function (a, b) { return propName(a).localeCompare(propName(b), "ko"); }).map(function (pid) {
      var g = groups[pid], sum = g.reduce(function (s, u) { return s + num(u.rent) + num(u.mgmt); }, 0);
      return '<div class="card"><h3>' + esc(propName(pid) || "건물 미지정") + ' <span class="muted">' + g.length + '호 · 월 ' + man(sum) + '</span></h3>' + g.map(function (u) { return unitRow(u, L); }).join("") + '</div>';
    }).join("") : '<div class="card empty">아직 등록한 세입자가 없어요.<br>아래 <b>＋ 세입자 등록</b>을 눌러 시작하세요.</div>') +
      (out.length ? '<div class="card"><h3>퇴실한 세입자</h3>' + out.map(function (u) { return unitRow(u, L); }).join("") + '</div>' : "");
  }

  function smsText(u, l) {
    var s = S.settings(), tpl = s.smsTpl || DEFAULT_SMS;
    var due = (l.bills || []).filter(function (x) { return x.status !== "완납"; });
    var monthsTxt = due.length ? due.map(function (x) { return mLabel(x.bill.ym); }).join("·") : mLabel(S.ymOf(new Date()));
    var amt = l.balance > 0 ? l.balance : num(u.rent) + num(u.mgmt);
    var acc = s.account ? " (" + [s.bank, s.account, s.holder].filter(Boolean).join(" ") + ")" : "";
    return tpl.replace(/\{세입자\}/g, u.tenant || "").replace(/\{건물\}/g, propName(u.propId)).replace(/\{호수\}/g, u.room || "").replace(/\{월\}/g, monthsTxt).replace(/\{금액\}/g, won(amt)).replace(/\{계좌\}/g, acc);
  }
  function vUnit() {
    var u = S.get(state.unitId); if (!u) { state.tab = "units"; return vUnits(); }
    var l = S.ledger()[u.id] || { bills: [], billed: 0, paid: 0, balance: 0, overdueAmt: 0, credit: 0 };
    var pays = S.all("payment").filter(function (p) { return p.unitId === u.id; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var dEnd = u.end ? daysUntil(u.end) : null;
    var sms = u.phone ? 'sms:' + esc(u.phone) + '?body=' + encodeURIComponent(smsText(u, l)) : "";
    return '<div class="btns" style="margin:0 0 10px"><button class="btn" data-act="tab" data-tab="units">← 세입자</button></div><h2>' + esc(unitShort(u)) + (u.tenant ? ' · ' + esc(u.tenant) : "") + (u.moveOut ? ' <span class="badge b-wait">퇴실</span>' : "") + '</h2>' +
      '<div class="grid2"><div class="stat red"><div class="k">미납 합계</div><div class="v">' + won(Math.max(0, l.balance)) + '</div><div class="s">' + (l.overdueAmt ? "연체 " + won(l.overdueAmt) : "연체 없음") + (l.credit ? " · 선납 " + won(l.credit) : "") + '</div></div>' +
      '<div class="stat"><div class="k">월세 · 보증금</div><div class="v" style="font-size:18px">' + won(num(u.rent) + num(u.mgmt)) + '</div><div class="s">보증금 ' + won(u.deposit) + (u.vat === "separate" ? " · 부가세 별도" : "") + '</div></div></div>' +
      '<div class="card"><div class="kv"><span>연락처</span><b>' + esc(u.phone || "-") + '</b></div><div class="kv"><span>납부일</span><b>매월 ' + (num(u.dueDay) || 1) + '일</b></div><div class="kv"><span>계약</span><b>' + esc(u.start || "?") + ' ~ ' + esc(u.end || "?") + (dEnd != null ? (dEnd < 0 ? ' (만기 지남)' : ' (D-' + dEnd + ')') : "") + '</b></div>' + (u.memo ? '<div class="kv"><span>메모</span><b>' + esc(u.memo) + '</b></div>' : "") + '</div>' +
      '<div class="btns" style="margin-bottom:12px"><button class="btn y" data-act="newPayment" data-unit="' + esc(u.id) + '">입금 기록</button>' + (sms ? '<a class="btn" href="' + sms + '">💬 입금 요청 문자</a><a class="btn" href="tel:' + esc(u.phone) + '">📞 전화</a>' : "") + '<button class="btn" data-act="receipt" data-unit="' + esc(u.id) + '">🧾 납부확인서<span class="pro">PRO</span></button><button class="btn" data-act="editUnit" data-id="' + esc(u.id) + '">계약 수정</button>' + (!u.moveOut ? '<button class="btn" data-act="moveOut" data-id="' + esc(u.id) + '">퇴실 처리</button>' : '<button class="btn" data-act="newTenantSame" data-id="' + esc(u.id) + '">같은 호실 새 세입자</button>') + '</div>' +
      '<div class="card"><h3>월별 청구</h3>' + (l.bills.slice().reverse().map(function (x) { return '<div class="row" data-act="editBill" data-id="' + esc(x.bill.id) + '"><div class="l"><div class="t">' + ymLabel(x.bill.ym) + '</div><div class="d">납부일 ' + esc(x.bill.due) + (x.paid && x.paid < x.total ? ' · ' + won(x.paid) + ' 입금' : "") + ((x.bill.extras || []).length ? ' · ' + esc(x.bill.extras.map(function (e) { return e.name; }).join(", ")) : "") + '</div></div><div class="r"><div class="amt">' + won(x.total) + '</div>' + statusBadge(x) + '</div></div>'; }).join("") || '<div class="empty">청구 내역이 없어요. 계약 수정에서 월세와 청구 시작 월을 확인해 주세요.</div>') + '</div>' +
      '<div class="card"><h3>입금 내역</h3>' + (pays.map(function (p) { return '<div class="row" data-act="editPayment" data-id="' + esc(p.id) + '"><div class="l"><div class="t">' + esc(p.date) + '</div><div class="d">' + esc(p.method || "") + (p.memo ? " · " + esc(p.memo) : "") + '</div></div><div class="r amt" style="color:var(--green)">+' + won(p.amount) + '</div></div>'; }).join("") || '<div class="empty">입금 기록이 없어요.</div>') + '</div>';
  }

  function vCollect() {
    var L = S.ledger(), rows = [];
    Object.keys(L).forEach(function (uid) { var u = S.get(uid); if (!u) return; L[uid].bills.forEach(function (x) { if (x.bill.ym === state.ym) rows.push({ u: u, x: x }); }); });
    rows.sort(function (a, b) { var o = { "연체": 0, "부분": 1, "납부 전": 2, "완납": 3 }; return (o[a.x.status] - o[b.x.status]) || (a.x.bill.due < b.x.bill.due ? -1 : 1); });
    var m = S.monthSummary(state.ym);
    var pays = S.all("payment").filter(function (p) { return (p.date || "").slice(0, 7) === state.ym; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return monthNav() + '<div class="grid2"><div class="stat"><div class="k">청구</div><div class="v">' + won(m.billed) + '</div><div class="s">' + m.count + '건</div></div><div class="stat"><div class="k">수납</div><div class="v" style="color:var(--green)">' + won(m.collected) + '</div><div class="s">미수납 ' + won(m.unpaid) + '</div></div></div>' +
      '<div class="card"><h3>' + ymLabel(state.ym) + ' 청구서</h3>' + (rows.map(function (r) { return '<div class="row" data-act="openUnit" data-id="' + esc(r.u.id) + '"><div class="l"><div class="t">' + esc(unitShort(r.u)) + ' · ' + esc(r.u.tenant || "") + '</div><div class="d">납부일 ' + esc(r.x.bill.due) + (r.x.paid && r.x.paid < r.x.total ? ' · ' + won(r.x.paid) + ' 입금' : "") + '</div></div><div class="r"><div class="amt">' + won(r.x.total) + '</div>' + statusBadge(r.x) + '</div></div>'; }).join("") || '<div class="empty">이 달 청구서가 없어요.</div>') + '</div>' +
      '<div class="card"><h3>' + ymLabel(state.ym) + ' 입금</h3>' + (pays.map(function (p) { return '<div class="row" data-act="editPayment" data-id="' + esc(p.id) + '"><div class="l"><div class="t">' + esc(unitLabel(S.get(p.unitId))) + '</div><div class="d">' + esc(p.date) + ' · ' + esc(p.method || "") + (p.memo ? " · " + esc(p.memo) : "") + '</div></div><div class="r amt" style="color:var(--green)">+' + won(p.amount) + '</div></div>'; }).join("") || '<div class="empty">입금 기록이 없어요.</div>') + '</div>';
  }

  function vCost() {
    var exp = S.all("expense").filter(function (e) { return (e.date || "").slice(0, 7) === state.ym; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var m = S.monthSummary(state.ym);
    return monthNav() + '<div class="grid2"><div class="stat"><div class="k">지출 합계</div><div class="v">' + won(m.cost) + '</div></div><div class="stat"><div class="k">순수익 (입금 − 지출)</div><div class="v" style="color:' + (m.net < 0 ? "var(--red)" : "var(--green)") + '">' + won(m.net) + '</div></div></div>' +
      '<div class="card">' + (exp.map(function (e) { return '<div class="row" data-act="editExpense" data-id="' + esc(e.id) + '"><div class="l"><div class="t">' + esc(e.category || "기타") + '</div><div class="d">' + esc(e.date) + (propName(e.propId) ? " · " + esc(propName(e.propId)) : "") + (e.memo ? " · " + esc(e.memo) : "") + '</div></div><div class="r amt">' + won(e.amount) + '</div></div>'; }).join("") || '<div class="empty">이 달 지출 기록이 없어요.<br>수리비, 재산세, 대출이자를 적어두면 종소세 때 필요경비로 바로 정리돼요.</div>') + '</div>';
  }

  function vMore() {
    var s = SY.session(), l = lic();
    var proLine = l && l.valid ? "Pro 사용 중" : trialLeft() > 0 ? "무료 체험 " + trialLeft() + "일 남음" : "무료 버전";
    var item = function (act, t, d) { return '<div class="row" data-act="' + act + '"><div class="l"><div class="t">' + t + '</div><div class="d">' + d + '</div></div><div class="r">›</div></div>'; };
    return '<h2>더보기</h2><div class="card list-menu">' +
      item("openSync", "☁️ 휴대폰·PC 동기화", s ? s.email + " 로그인됨" : "로그인하면 휴대폰, PC에서 같은 장부를 써요") +
      item("tab\" data-tab=\"props", "🏢 건물 관리", S.all("prop").length + "곳") +
      item("openReport", "📈 연간 임대수입 리포트<span class=\"pro\">PRO</span>", "종합소득세 신고용 월별 수입·필요경비 정리") +
      item("exportXlsx", "📊 엑셀로 내보내기<span class=\"pro\">PRO</span>", "세입자·청구·입금·지출·미납 5개 시트") +
      item("editSettings", "🪪 내 정보 · 입금 계좌 · 문자 문구", S.settings().account ? S.settings().bank + " " + S.settings().account : "입금 요청 문자와 납부확인서에 들어가요") +
      item("backup", "💾 백업 파일 저장", "기기 안 데이터를 파일로 저장") +
      item("restore", "📂 백업 파일 불러오기", "다른 기기에서 저장한 파일 불러오기") +
      item("openPro", "⭐ " + proLine, l && l.valid ? (l.email || "") : "리포트·엑셀·납부확인서는 Pro 기능이에요") +
      '</div><p class="muted" style="text-align:center">집주인장부 v' + C.VERSION + ' · 데이터는 이 기기에 먼저 저장되고, 로그인하면 클라우드에 암호화 전송돼요.<br><a href="privacy.html" target="_blank">개인정보 처리방침</a> · <a href="terms.html" target="_blank">이용약관</a></p><input type="file" id="restoreFile" accept=".json" class="hidden">';
  }
  function vProps() {
    var us = S.all("unit").filter(function (u) { return !u.moveOut; });
    return '<div class="btns" style="margin:0 0 10px"><button class="btn" data-act="tab" data-tab="more">← 더보기</button><button class="btn y" data-act="newProp">＋ 건물 추가</button></div><h2>건물</h2><div class="card">' +
      (S.all("prop").sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); }).map(function (p) { var g = us.filter(function (u) { return u.propId === p.id; }); return '<div class="row" data-act="editProp" data-id="' + esc(p.id) + '"><div class="l"><div class="t">' + esc(p.name) + '</div><div class="d">' + esc(p.address || "") + ' · ' + g.length + '호 · 월 ' + man(g.reduce(function (s, u) { return s + num(u.rent) + num(u.mgmt); }, 0)) + '</div></div><div class="r">›</div></div>'; }).join("") || '<div class="empty">건물이 없어요. 세입자를 등록할 때 함께 만들 수도 있어요.</div>') + '</div>';
  }

  function vReport() {
    var y = state.year, r = S.yearReport(y);
    var rows = r.months.map(function (m) { return '<tr><td>' + mLabel(m.ym) + '</td><td class="num">' + m.rent.toLocaleString() + '</td><td class="num">' + m.mgmt.toLocaleString() + '</td><td class="num">' + m.vat.toLocaleString() + '</td><td class="num">' + m.received.toLocaleString() + '</td><td class="num">' + m.cost.toLocaleString() + '</td></tr>'; }).join("");
    var cats = Object.keys(r.byCat).sort(function (a, b) { return r.byCat[b] - r.byCat[a]; });
    var props = Object.keys(r.byProp);
    var body = '<div class="stmt"><h1 style="letter-spacing:2px">' + y + '년 임대수입 리포트</h1><p>임대인: ' + esc(S.settings().owner || "") + '　　작성일: ' + today() + '</p>' +
      '<table><tr><th>월</th><th>월세(청구)</th><th>관리비 등</th><th>부가세</th><th>실제 입금</th><th>지출</th></tr>' + rows +
      '<tr class="tot"><td>합계</td><td class="num">' + r.tot.rent.toLocaleString() + '</td><td class="num">' + r.tot.mgmt.toLocaleString() + '</td><td class="num">' + r.tot.vat.toLocaleString() + '</td><td class="num">' + r.tot.received.toLocaleString() + '</td><td class="num">' + r.tot.cost.toLocaleString() + '</td></tr></table>' +
      (props.length ? '<h3 style="margin-top:16px">건물별 월세 수입</h3><table>' + props.map(function (p) { return '<tr><td>' + esc(propName(p) || "건물 미지정") + '</td><td class="num">' + r.byProp[p].toLocaleString() + ' 원</td></tr>'; }).join("") + '</table>' : "") +
      '<h3 style="margin-top:16px">필요경비 (지출 분류별)</h3><table>' + (cats.map(function (c) { return '<tr><td>' + esc(c) + '</td><td class="num">' + r.byCat[c].toLocaleString() + ' 원</td></tr>'; }).join("") || '<tr><td colspan="2">지출 기록 없음</td></tr>') + '<tr class="tot"><td>합계</td><td class="num">' + r.tot.cost.toLocaleString() + ' 원</td></tr></table>' +
      '<p class="muted" style="color:#555">※ 종합소득세 신고 참고용 자료입니다. 간주임대료(보증금), 주택 수, 분리과세 여부 등은 세무사와 확인하세요.</p></div>';
    state.reportHtml = body;
    return '<div class="btns" style="margin:0 0 10px"><button class="btn" data-act="tab" data-tab="more">← 더보기</button><button class="btn" data-act="prevY">◀ ' + (y - 1) + '</button><button class="btn" data-act="nextY">' + (y + 1) + ' ▶</button><button class="btn y" data-act="printReport">인쇄 / PDF 저장</button></div><div class="card" style="overflow:auto">' + body + '</div>';
  }

  // ===== 시트(입력 폼) =====
  function openSheet(html) { $("#sheet").innerHTML = html; $("#sheetBg").classList.remove("hidden"); }
  function closeSheet() { $("#sheetBg").classList.add("hidden"); $("#sheet").innerHTML = ""; state.sheet = null; }
  function head(t) { return '<h3>' + t + '<button class="x" data-act="close">×</button></h3>'; }
  function propOptions(sel) {
    var ps = S.all("prop").sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); });
    return ps.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === sel ? " selected" : "") + '>' + esc(p.name) + '</option>'; }).join("") + '<option value="__new"' + (!ps.length ? " selected" : "") + '>＋ 새 건물 입력</option>' + '<option value=""' + (sel === "" && ps.length ? " selected" : "") + '>(건물 미지정)</option>';
  }
  function unitOptions(sel) { return units(true).map(function (u) { return '<option value="' + esc(u.id) + '"' + (u.id === sel ? " selected" : "") + '>' + esc(unitLabel(u)) + (u.moveOut ? " (퇴실)" : "") + '</option>'; }).join(""); }

  function unitSheet(u) {
    var cur = S.ymOf(new Date());
    u = u || { propId: (S.all("prop")[0] || {}).id || "", dueDay: 1, vat: "none", billFrom: cur, start: "", end: "" };
    state.sheet = { kind: "unit", data: JSON.parse(JSON.stringify(u)) };
    var hasProps = S.all("prop").length > 0;
    return head(u.id ? "계약 수정" : "세입자 등록") +
      '<div class="two"><label class="f">건물<select id="uProp">' + propOptions(u.propId) + '</select></label><label class="f">호수<input id="uRoom" value="' + esc(u.room || "") + '" placeholder="예: 201호"></label></div>' +
      '<label class="f' + (hasProps ? " hidden" : "") + '" id="newPropWrap">새 건물 이름<input id="uPropNew" placeholder="예: 행복빌라, 역삼동 상가"></label>' +
      '<div class="two"><label class="f">세입자 이름<input id="uTenant" value="' + esc(u.tenant || "") + '"></label><label class="f">연락처<input id="uPhone" inputmode="tel" value="' + esc(u.phone || "") + '" placeholder="010-0000-0000"></label></div>' +
      '<div class="two"><label class="f">월세 (원)<input id="uRent" inputmode="numeric" value="' + esc(fmtInput(u.rent)) + '"></label><label class="f">관리비 (원)<input id="uMgmt" inputmode="numeric" value="' + esc(fmtInput(u.mgmt)) + '" placeholder="없으면 비워두세요"></label></div>' +
      '<div class="two"><label class="f">보증금 (원)<input id="uDeposit" inputmode="numeric" value="' + esc(fmtInput(u.deposit)) + '"></label><label class="f">납부일 (매월)<input id="uDue" inputmode="numeric" value="' + esc(u.dueDay || 1) + '"></label></div>' +
      '<div class="two"><label class="f">계약 시작일<input type="date" id="uStart" value="' + esc(u.start || "") + '"></label><label class="f">계약 만기일<input type="date" id="uEnd" value="' + esc(u.end || "") + '"></label></div>' +
      '<label class="f">부가세 (상가)</label><div class="seg" id="uVat"><button data-vat="none" class="' + (u.vat !== "separate" ? "on" : "") + '">없음 (주택)</button><button data-vat="separate" class="' + (u.vat === "separate" ? "on" : "") + '">월세의 10% 별도</button></div>' +
      '<label class="f">청구 시작 월<input type="month" id="uBillFrom" value="' + esc(u.billFrom || cur) + '"></label><p class="muted">이 달부터 매달 청구가 자동으로 만들어져요. 지난 달 미납이 있다면 그 달로 바꾸세요.</p>' +
      '<label class="f"><input type="checkbox" id="uVacant" style="width:auto"' + (u.vacant ? " checked" : "") + '> 공실 (청구 안 함)</label>' +
      '<label class="f">메모<textarea id="uMemo" rows="2" placeholder="예: 반려동물 있음, 계좌 이름이 다름">' + esc(u.memo || "") + '</textarea></label>' +
      '<div class="btns"><button class="btn y block" data-act="saveUnit">저장</button>' + (u.id ? '<button class="btn red" data-act="delUnit">삭제</button>' : "") + '</div>';
  }
  function readUnit() {
    var d = state.sheet.data;
    d.propId = $("#uProp").value; d.room = $("#uRoom").value.trim(); d.tenant = $("#uTenant").value.trim(); d.phone = $("#uPhone").value.trim();
    d.rent = num($("#uRent").value); d.mgmt = num($("#uMgmt").value); d.deposit = num($("#uDeposit").value); d.dueDay = Math.min(31, Math.max(1, num($("#uDue").value) || 1));
    d.start = $("#uStart").value; d.end = $("#uEnd").value; d.billFrom = $("#uBillFrom").value || S.ymOf(new Date()); d.vacant = $("#uVacant").checked; d.memo = $("#uMemo").value.trim();
    if (!d.start) d.start = d.billFrom + "-01";
    return d;
  }

  function billSheet(b) {
    state.sheet = { kind: "bill", data: JSON.parse(JSON.stringify(b)) };
    var u = S.get(b.unitId);
    return head(ymLabel(b.ym) + " 청구 수정") + '<p class="muted">' + esc(unitLabel(u)) + '</p>' +
      '<div class="two"><label class="f">월세<input id="bRent" inputmode="numeric" value="' + esc(fmtInput(b.rent)) + '"></label><label class="f">관리비<input id="bMgmt" inputmode="numeric" value="' + esc(fmtInput(b.mgmt)) + '"></label></div>' +
      '<label class="f">납부일<input type="date" id="bDue" value="' + esc(b.due) + '"></label>' +
      '<label class="f">추가 청구 (공과금 등)</label><div class="chips" id="exPresets">' + EXTRA_PRESETS.map(function (x) { return '<button data-ex="' + x + '">＋ ' + x + '</button>'; }).join("") + '</div><div id="exList">' + (b.extras || []).map(exRow).join("") + '</div>' +
      '<div class="sum" id="billSum"></div>' +
      '<div class="btns"><button class="btn y block" data-act="saveBill">저장</button><button class="btn red" data-act="delBill">이 달 청구 삭제</button></div><p class="muted">이 달만 바뀌어요. 앞으로의 월세를 바꾸려면 계약 수정에서 바꾸세요.</p>';
  }
  function exRow(e) { return '<div class="extra"><input class="in exName" value="' + esc(e.name || "") + '" placeholder="항목"><input class="in exAmt" inputmode="numeric" value="' + esc(fmtInput(e.amount)) + '" placeholder="금액"><button class="x" data-act="exDel">×</button></div>'; }
  function readBill() {
    var d = state.sheet.data;
    d.rent = num($("#bRent").value); d.mgmt = num($("#bMgmt").value); d.due = $("#bDue").value || d.due;
    d.extras = Array.prototype.map.call(document.querySelectorAll("#exList .extra"), function (r) { return { name: r.querySelector(".exName").value.trim(), amount: num(r.querySelector(".exAmt").value) }; }).filter(function (e) { return e.name || e.amount; });
    return d;
  }
  function updBillSum() { if (!$("#billSum")) return; var d = readBill(); $("#billSum").innerHTML = '청구 합계<b>' + won(S.billTotal(d)) + '</b>' + (S.billVat(d) ? '부가세 ' + won(S.billVat(d)) + ' 포함' : ""); }

  function paySheet(p) {
    var L = S.ledger();
    var uid = p && p.unitId || state.presetUnit || (state.tab === "unit" ? state.unitId : "");
    if (!uid) { var owed = units(false).filter(function (u) { return (L[u.id] || {}).balance > 0; }).sort(function (a, b) { return L[b.id].maxLate - L[a.id].maxLate; }); uid = (owed[0] || units(false)[0] || {}).id || ""; }
    var bal = uid ? Math.max(0, (L[uid] || {}).balance || 0) : 0;
    p = p || { date: today(), unitId: uid, amount: bal || "", method: "계좌이체" };
    state.sheet = { kind: "payment", data: p };
    return head(p.id ? "입금 수정" : "입금 기록") +
      '<label class="f">세입자<select id="pUnit">' + unitOptions(p.unitId) + '</select></label>' +
      '<div class="two"><label class="f">입금일<input type="date" id="pDate" value="' + esc(p.date) + '"></label><label class="f">금액 (원)<input id="pAmt" inputmode="numeric" value="' + esc(fmtInput(p.amount)) + '"></label></div>' +
      '<p class="muted" id="pBal"></p>' +
      '<label class="f">입금 방법</label><div class="chips" id="pMethod">' + PAY_METHODS.map(function (m) { return '<button data-m="' + m + '" class="' + (p.method === m ? "on" : "") + '">' + m + '</button>'; }).join("") + '</div>' +
      '<label class="f">메모<input id="pMemo" value="' + esc(p.memo || "") + '" placeholder="예: 11월분, 입금자명 다름"></label>' +
      '<div class="btns"><button class="btn y block" data-act="savePayment">저장</button>' + (p.id ? '<button class="btn red" data-act="delPayment">삭제</button>' : "") + '</div>';
  }
  function updPayBal() { var uid = $("#pUnit").value, l = S.ledger()[uid] || {}; $("#pBal").textContent = "현재 미납 " + won(Math.max(0, l.balance || 0)) + (l.overdueAmt ? " (연체 " + won(l.overdueAmt) + ")" : ""); }

  function expSheet(e) {
    e = e || { date: today(), category: EXP_CATS[0], amount: "", propId: (S.all("prop")[0] || {}).id || "" };
    state.sheet = { kind: "expense", data: e };
    return head(e.id ? "지출 수정" : "지출 기록") +
      '<label class="f">분류</label><div class="chips" id="eCat">' + EXP_CATS.map(function (c) { return '<button data-c="' + c + '" class="' + (e.category === c ? "on" : "") + '">' + c + '</button>'; }).join("") + '</div>' +
      '<div class="two"><label class="f">날짜<input type="date" id="eDate" value="' + esc(e.date) + '"></label><label class="f">금액 (원)<input id="eAmt" inputmode="numeric" value="' + esc(fmtInput(e.amount)) + '"></label></div>' +
      '<label class="f">건물<select id="eProp"><option value="">(전체/미지정)</option>' + S.all("prop").map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === e.propId ? " selected" : "") + '>' + esc(p.name) + '</option>'; }).join("") + '</select></label>' +
      '<label class="f">메모<input id="eMemo" value="' + esc(e.memo || "") + '" placeholder="예: 302호 보일러 교체"></label>' +
      '<div class="btns"><button class="btn y block" data-act="saveExpense">저장</button>' + (e.id ? '<button class="btn red" data-act="delExpense">삭제</button>' : "") + '</div>';
  }
  function propSheet(p) {
    p = p || {}; state.sheet = { kind: "prop", data: p };
    return head(p.id ? "건물 수정" : "건물 추가") +
      '<label class="f">건물 이름<input id="gName" value="' + esc(p.name || "") + '" placeholder="예: 행복빌라"></label>' +
      '<label class="f">주소<input id="gAddr" value="' + esc(p.address || "") + '" placeholder="납부확인서에 들어가요"></label>' +
      '<label class="f">메모<input id="gMemo" value="' + esc(p.memo || "") + '"></label>' +
      '<div class="btns"><button class="btn y block" data-act="saveProp">저장</button>' + (p.id ? '<button class="btn red" data-act="delProp">삭제</button>' : "") + '</div>';
  }
  function settingsSheet() {
    var s = S.settings(); state.sheet = { kind: "settings", data: s };
    var f = function (id, label, v, ph) { return '<label class="f">' + label + '<input id="' + id + '" value="' + esc(v || "") + '" placeholder="' + (ph || "") + '"></label>'; };
    return head("내 정보 · 입금 계좌") + '<p class="muted">입금 요청 문자와 납부확인서에 들어가요.</p>' +
      '<div class="two">' + f("sOwner", "임대인 이름", s.owner) + f("sPhone", "연락처", s.phone) + '</div>' +
      '<div class="two">' + f("sBank", "은행", s.bank) + f("sHolder", "예금주", s.holder) + '</div>' + f("sAcc", "계좌번호", s.account) +
      '<label class="f">입금 요청 문자 문구<textarea id="sTpl" rows="3">' + esc(s.smsTpl || DEFAULT_SMS) + '</textarea></label><p class="muted">{세입자} {건물} {호수} {월} {금액} {계좌} 는 자동으로 바뀌어요.</p>' +
      '<div class="btns"><button class="btn y block" data-act="saveSettings">저장</button></div>';
  }
  function syncSheet() {
    var s = SY.session(), st = SY.state();
    if (!SY.configured()) return head("동기화") + '<p>동기화 서버 설정 전이에요.</p>';
    if (s) return head("☁️ 동기화") + '<p><b>' + esc(s.email) + '</b> 계정으로 로그인됨</p><p class="muted">같은 계정으로 휴대폰, PC에 로그인하면 장부가 자동으로 맞춰져요. 인터넷이 없을 때 기록한 것도 연결되면 올라가요.</p><p class="muted">상태: ' + ({ ok: "최근 동기화 " + (st.lastSync ? new Date(st.lastSync).toLocaleTimeString("ko-KR") : ""), syncing: "동기화 중…", error: "오류: " + esc(st.error), off: "대기" }[st.status] || "") + '</p><div class="btns"><button class="btn y" data-act="syncNow">지금 동기화</button><button class="btn" data-act="signOut">로그아웃</button></div>';
    return head("☁️ 휴대폰·PC 동기화 (무료)") +
      '<p class="muted">이메일로 가입하면 휴대폰과 PC에서 같은 장부를 함께 써요. 휴대폰을 바꿔도 기록이 그대로 남아요.</p>' +
      '<label class="f">이메일<input id="aEmail" type="email" autocomplete="email"></label><label class="f">비밀번호 (6자 이상)<input id="aPw" type="password" autocomplete="current-password"></label>' +
      '<p id="aMsg" class="muted"></p><div class="btns"><button class="btn y" data-act="signIn">로그인</button><button class="btn" data-act="signUp">처음이에요 (가입)</button></div>';
  }
  function proSheet(what) {
    var l = lic();
    return head("⭐ 집주인장부 Pro") + (what ? '<div class="note">' + esc(what) + '은(는) Pro 기능이에요.</div>' : "") +
      '<ul><li><b>연간 임대수입 리포트</b> (종소세 신고용, PDF)</li><li><b>월세 납부확인서</b> (세입자 연말정산·월세 세액공제용)</li><li><b>엑셀 내보내기</b> (세무사 전달용 5개 시트)</li></ul><p class="muted">세입자 관리·자동 청구·연체 알림·입금 요청 문자·동기화는 계속 무료예요.</p>' +
      (IN_PLAY || !C.GUMROAD_URL ? '<p class="muted">' + (trialLeft() > 0 ? '지금 7일 무료 체험 중 (' + trialLeft() + '일 남음). ' : "") + '라이선스 키가 있으면 아래에 넣어 주세요.</p>' : '<p><b>' + esc(C.PRO_PRICE) + '</b>' + (trialLeft() > 0 ? ' · 지금 7일 무료 체험 중 (' + trialLeft() + '일 남음)' : "") + '</p><a class="btn y block" href="' + esc(C.GUMROAD_URL) + '" target="_blank" rel="noopener">구매하고 라이선스 키 받기</a>') +
      '<label class="f">라이선스 키<input id="lKey" value="' + esc(l && l.key || "") + '" placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"></label><p id="lMsg" class="muted"></p><div class="btns"><button class="btn dark" data-act="activate">활성화</button></div>';
  }

  // ===== 납부확인서 =====
  function receiptSheet(uid) {
    var y = new Date().getFullYear();
    return head("🧾 월세 납부확인서") + '<label class="f">세입자<select id="rUnit">' + unitOptions(uid) + '</select></label>' +
      '<div class="two"><label class="f">시작 월<input type="month" id="rFrom" value="' + y + '-01"></label><label class="f">끝 월<input type="month" id="rTo" value="' + S.ymOf(new Date()) + '"></label></div>' +
      '<div class="btns"><button class="btn y block" data-act="printReceipt">미리보기 · 인쇄 / PDF 저장</button></div><p class="muted">세입자 연말정산(월세 세액공제)이나 확인 요청 때 PDF로 저장해 보내세요.</p>';
  }
  function buildReceipt(uid, from, to) {
    var u = S.get(uid) || {}, s = S.settings(), p = S.get(u.propId) || {};
    var L = S.ledger()[uid] || { bills: [] };
    var pays = S.all("payment").filter(function (x) { return x.unitId === uid && x.date.slice(0, 7) >= from && x.date.slice(0, 7) <= to; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var bills = L.bills.filter(function (x) { return x.bill.ym >= from && x.bill.ym <= to; });
    var tot = pays.reduce(function (a, x) { return a + num(x.amount); }, 0);
    return '<div class="stmt"><h1>월세 납부 확인서</h1><table class="hd"><tr><td style="width:50%"><b>임차인</b><br>성명: ' + esc(u.tenant || "") + '<br>연락처: ' + esc(u.phone || "") + '<br>임차 주소: ' + esc([p.address || p.name, u.room].filter(Boolean).join(" ")) + '</td><td><b>임대인</b><br>성명: ' + esc(s.owner || "") + '<br>연락처: ' + esc(s.phone || "") + '<br>계약 기간: ' + esc((u.start || "") + " ~ " + (u.end || "")) + '<br>보증금: ' + num(u.deposit).toLocaleString() + '원 / 월세: ' + num(u.rent).toLocaleString() + '원</td></tr></table>' +
      '<p>확인 기간: ' + esc(from) + ' ~ ' + esc(to) + '　　작성일: ' + today() + '</p>' +
      '<table><tr><th>No</th><th>입금일</th><th>방법</th><th>메모</th><th>금액</th></tr>' + (pays.map(function (x, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(x.date) + '</td><td>' + esc(x.method || "") + '</td><td>' + esc(x.memo || "") + '</td><td class="num">' + num(x.amount).toLocaleString() + '</td></tr>'; }).join("") || '<tr><td colspan="5" style="text-align:center">해당 기간 입금 기록이 없습니다</td></tr>') +
      '<tr class="tot"><td colspan="4">납부 합계</td><td class="num">' + tot.toLocaleString() + ' 원</td></tr></table>' +
      '<p style="margin-top:10px">청구 ' + bills.length + '개월 중 완납 ' + bills.filter(function (x) { return x.status === "완납"; }).length + '개월</p>' +
      '<p style="text-align:right;margin-top:24px">위와 같이 월세를 납부하였음을 확인합니다.<br><br>임대인 ' + esc(s.owner || "") + ' (인)</p></div>';
  }

  // ===== 엑셀 =====
  function exportXlsx() {
    var L = S.ledger(), us = units(true);
    var sheets = [
      { name: "세입자", columns: [{ title: "건물", width: 14 }, { title: "호수", width: 8 }, { title: "세입자", width: 10 }, { title: "연락처", width: 14 }, { title: "보증금", type: "money", width: 14 }, { title: "월세", type: "money", width: 12 }, { title: "관리비", type: "money", width: 10 }, { title: "납부일", type: "int", width: 7 }, { title: "계약시작", width: 11 }, { title: "계약만기", width: 11 }, { title: "상태", width: 7 }, { title: "미납", type: "money", width: 12 }, { title: "메모", width: 20 }],
        rows: us.map(function (u) { return [propName(u.propId), u.room || "", u.tenant || "", u.phone || "", num(u.deposit), num(u.rent), num(u.mgmt), num(u.dueDay) || 1, u.start || "", u.end || "", u.moveOut ? "퇴실" : u.vacant ? "공실" : "거주", Math.max(0, (L[u.id] || {}).balance || 0), u.memo || ""]; }) },
      { name: "청구", columns: [{ title: "월", width: 9 }, { title: "건물", width: 14 }, { title: "호수", width: 8 }, { title: "세입자", width: 10 }, { title: "납부일", width: 11 }, { title: "월세", type: "money", width: 12 }, { title: "관리비", type: "money", width: 10 }, { title: "추가", type: "money", width: 10 }, { title: "부가세", type: "money", width: 10 }, { title: "합계", type: "money", width: 12 }, { title: "입금", type: "money", width: 12 }, { title: "상태", width: 9 }],
        rows: Object.keys(L).reduce(function (acc, uid) { var u = S.get(uid) || {}; L[uid].bills.forEach(function (x) { var b = x.bill; acc.push([b.ym, propName(u.propId), u.room || "", u.tenant || "", b.due, num(b.rent), num(b.mgmt), (b.extras || []).reduce(function (a, e) { return a + num(e.amount); }, 0), S.billVat(b), x.total, x.paid, x.status === "연체" ? "연체 " + x.late + "일" : x.status]); }); return acc; }, []).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }) },
      { name: "입금", columns: [{ title: "날짜", width: 12 }, { title: "건물", width: 14 }, { title: "호수", width: 8 }, { title: "세입자", width: 10 }, { title: "금액", type: "money", width: 14 }, { title: "방법", width: 10 }, { title: "메모", width: 24 }], rows: S.all("payment").sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (p) { var u = S.get(p.unitId) || {}; return [p.date, propName(u.propId), u.room || "", u.tenant || "", num(p.amount), p.method || "", p.memo || ""]; }) },
      { name: "지출", columns: [{ title: "날짜", width: 12 }, { title: "분류", width: 16 }, { title: "건물", width: 14 }, { title: "금액", type: "money", width: 14 }, { title: "메모", width: 26 }], rows: S.all("expense").sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (e) { return [e.date, e.category || "", propName(e.propId), num(e.amount), e.memo || ""]; }) },
      { name: "미납", columns: [{ title: "건물", width: 14 }, { title: "호수", width: 8 }, { title: "세입자", width: 10 }, { title: "연락처", width: 14 }, { title: "미납 합계", type: "money", width: 14 }, { title: "연체 금액", type: "money", width: 14 }, { title: "최장 연체일", type: "int", width: 10 }], rows: us.filter(function (u) { return (L[u.id] || {}).balance > 0; }).map(function (u) { var l = L[u.id]; return [propName(u.propId), u.room || "", u.tenant || "", u.phone || "", l.balance, l.overdueAmt, l.maxLate]; }) }
    ];
    download(self.JGXlsx.build(sheets), "집주인장부_" + today() + ".xlsx");
  }
  function download(blob, name) { var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 1500); }
  function printHtml(html) { $("#print").innerHTML = html; closeSheet(); setTimeout(function () { window.print(); }, 200); }

  // ===== 이벤트 =====
  function act(name, el) {
    var id = el.dataset.id;
    switch (name) {
      case "tab": state.tab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
      case "prevM": state.ym = addMonth(state.ym, -1); render(); break;
      case "nextM": state.ym = addMonth(state.ym, 1); render(); break;
      case "prevY": state.year--; render(); break;
      case "nextY": state.year++; render(); break;
      case "close": closeSheet(); break;
      case "newUnit": openSheet(unitSheet()); break;
      case "newTenantSame": var src = S.get(id); openSheet(unitSheet({ propId: src.propId, room: src.room, rent: src.rent, mgmt: src.mgmt, dueDay: src.dueDay, vat: src.vat, billFrom: S.ymOf(new Date()) })); break;
      case "editUnit": openSheet(unitSheet(S.get(id))); break;
      case "saveUnit":
        var d = readUnit();
        if (d.propId === "__new") {
          var nm = ($("#uPropNew") || {}).value; nm = nm && nm.trim();
          if (!nm) { toast("건물 이름을 입력하거나 고르세요"); return; }
          d.propId = S.save("prop", { name: nm }).id;
        }
        if (!d.room && !d.tenant) { toast("호수나 세입자 이름을 입력해 주세요"); return; }
        var saved = S.save("unit", d); closeSheet(); S.ensureBills(); toast("저장했어요"); state.unitId = saved.id; state.tab = "unit"; render(); SY.schedule(); break;
      case "delUnit":
        if (!confirm("이 세입자와 청구·입금 기록을 모두 삭제할까요? 이사 나간 경우엔 '퇴실 처리'를 쓰세요.")) return;
        var delId = state.sheet.data.id;
        S.all("bill").filter(function (b) { return b.unitId === delId; }).forEach(function (b) { S.remove(b.id); });
        S.all("payment").filter(function (p) { return p.unitId === delId; }).forEach(function (p) { S.remove(p.id); });
        S.remove(delId); closeSheet(); state.tab = "units"; render(); SY.schedule(); break;
      case "moveOut":
        var mo = S.get(id), dt = prompt("퇴실일을 입력하세요 (예: " + today() + ")", today());
        if (!dt) return;
        S.save("unit", Object.assign({}, mo, { moveOut: true, end: dt })); toast("퇴실 처리했어요. 남은 미납은 그대로 보여요."); render(); SY.schedule(); break;
      case "openUnit": state.unitId = id; state.tab = "unit"; render(); window.scrollTo(0, 0); break;
      case "editBill": openSheet(billSheet(S.get(id))); updBillSum(); break;
      case "saveBill": S.save("bill", readBill()); closeSheet(); toast("청구를 수정했어요"); render(); SY.schedule(); break;
      case "delBill": if (confirm("이 달 청구를 삭제할까요? (이 달은 받을 돈에서 빠져요)")) { var bd = state.sheet.data; S.save("bill", Object.assign({}, bd, { rent: 0, mgmt: 0, extras: [], vat: "none", skipped: true })); closeSheet(); render(); SY.schedule(); } break;
      case "exDel": el.parentNode.remove(); updBillSum(); break;
      case "newPayment": state.presetUnit = el.dataset.unit || (state.tab === "unit" ? state.unitId : ""); if (!S.all("unit").length) { toast("먼저 세입자를 등록해 주세요"); return; } openSheet(paySheet()); updPayBal(); break;
      case "editPayment": openSheet(paySheet(S.get(id))); updPayBal(); break;
      case "savePayment":
        var p = state.sheet.data; p.unitId = $("#pUnit").value; p.date = $("#pDate").value; p.amount = num($("#pAmt").value); p.memo = $("#pMemo").value.trim();
        if (!p.amount) { toast("금액을 입력해 주세요"); return; }
        S.save("payment", p); closeSheet(); toast("입금을 기록했어요"); render(); SY.schedule(); break;
      case "delPayment": if (confirm("이 입금 기록을 삭제할까요?")) { S.remove(state.sheet.data.id); closeSheet(); render(); SY.schedule(); } break;
      case "newExpense": openSheet(expSheet()); break;
      case "editExpense": openSheet(expSheet(S.get(id))); break;
      case "saveExpense":
        var e = state.sheet.data; e.date = $("#eDate").value; e.amount = num($("#eAmt").value); e.propId = $("#eProp").value; e.memo = $("#eMemo").value.trim();
        if (!e.amount) { toast("금액을 입력해 주세요"); return; }
        S.save("expense", e); closeSheet(); toast("지출을 기록했어요"); render(); SY.schedule(); break;
      case "delExpense": if (confirm("이 지출 기록을 삭제할까요?")) { S.remove(state.sheet.data.id); closeSheet(); render(); SY.schedule(); } break;
      case "newProp": openSheet(propSheet()); break;
      case "editProp": openSheet(propSheet(S.get(id))); break;
      case "saveProp":
        var g = state.sheet.data; g.name = $("#gName").value.trim(); g.address = $("#gAddr").value.trim(); g.memo = $("#gMemo").value.trim();
        if (!g.name) { toast("이름을 입력해 주세요"); return; }
        S.save("prop", g); closeSheet(); render(); SY.schedule(); break;
      case "delProp":
        if (S.all("unit").some(function (u) { return u.propId === state.sheet.data.id; })) { toast("세입자가 있는 건물은 삭제할 수 없어요"); return; }
        if (confirm("건물을 삭제할까요?")) { S.remove(state.sheet.data.id); closeSheet(); render(); SY.schedule(); } break;
      case "editSettings": openSheet(settingsSheet()); break;
      case "saveSettings":
        var s = state.sheet.data; s.owner = $("#sOwner").value.trim(); s.phone = $("#sPhone").value.trim(); s.bank = $("#sBank").value.trim(); s.holder = $("#sHolder").value.trim(); s.account = $("#sAcc").value.trim(); s.smsTpl = $("#sTpl").value.trim();
        S.saveSettings(s); closeSheet(); toast("저장했어요"); render(); SY.schedule(); break;
      case "openReport": if (needPro("연간 임대수입 리포트")) return; state.tab = "report"; render(); window.scrollTo(0, 0); break;
      case "printReport": printHtml(state.reportHtml || ""); break;
      case "receipt": if (needPro("월세 납부확인서")) return; openSheet(receiptSheet(el.dataset.unit || state.unitId)); break;
      case "printReceipt": printHtml(buildReceipt($("#rUnit").value, $("#rFrom").value, $("#rTo").value)); break;
      case "exportXlsx": if (needPro("엑셀 내보내기")) return; exportXlsx(); break;
      case "backup": download(new Blob([JSON.stringify(S.db())], { type: "application/json" }), "집주인장부_백업_" + today() + ".json"); break;
      case "restore": $("#restoreFile").click(); break;
      case "openSync": openSheet(syncSheet()); break;
      case "signIn": case "signUp": doAuth(name); break;
      case "signOut": if (confirm("로그아웃할까요? 이 기기의 기록은 남아 있어요.")) { SY.signOut(); closeSheet(); } break;
      case "syncNow": SY.syncNow().then(function () { openSheet(syncSheet()); }); break;
      case "openPro": openSheet(proSheet()); break;
      case "activate": activate(); break;
    }
  }
  async function doAuth(kind) {
    var em = $("#aEmail").value.trim(), pw = $("#aPw").value, msg = $("#aMsg");
    if (!em || pw.length < 6) { msg.textContent = "이메일과 6자 이상 비밀번호를 넣어주세요."; return; }
    msg.textContent = "확인 중…";
    try {
      if (kind === "signUp") { var r = await SY.signUp(em, pw); if (r.confirm) { msg.textContent = "메일함에서 인증 링크를 누른 뒤 로그인해 주세요."; return; } }
      else await SY.signIn(em, pw);
      var db = S.db(); Object.keys(db.items).forEach(function (k) { db.meta.dirty[k] = 1; }); db.meta.pulledAt = null; S.persist();
      await SY.syncNow(); closeSheet(); toast("동기화를 시작했어요"); render();
    } catch (e) { msg.textContent = e.message; }
  }
  function licOk(j) {
    var p = j && j.purchase || {};
    return !!(j && j.success) && !p.refunded && !p.chargebacked && !p.subscription_ended_at && !p.subscription_failed_at && !(p.subscription_cancelled_at && new Date(p.subscription_cancelled_at) < new Date());
  }
  async function recheckLicense() {
    var l = lic(); if (!l || !l.valid || l.review || !C.GUMROAD_PRODUCT_ID || Date.now() - (l.at || 0) < 3 * 864e5) return;
    try {
      var r = await fetch("https://api.gumroad.com/v2/licenses/verify", { method: "POST", body: new URLSearchParams({ product_id: C.GUMROAD_PRODUCT_ID, license_key: l.key }) });
      var j = await r.json(); l.valid = licOk(j); l.at = Date.now(); localStorage.setItem("jz_license", JSON.stringify(l)); render();
    } catch (e) {}
  }
  async function activate() {
    var key = $("#lKey").value.trim(), msg = $("#lMsg");
    if (!key) return;
    msg.textContent = "확인 중…";
    try {
      if (REVIEW_HASH && (await sha256(key.toUpperCase())) === REVIEW_HASH) { localStorage.setItem("jz_license", JSON.stringify({ valid: true, key: key, review: true, at: Date.now() })); msg.textContent = "Pro가 활성화됐어요."; setTimeout(function () { closeSheet(); render(); }, 900); return; }
      if (!C.GUMROAD_PRODUCT_ID) { msg.textContent = "키가 맞지 않아요."; return; }
      var r = await fetch("https://api.gumroad.com/v2/licenses/verify", { method: "POST", body: new URLSearchParams({ product_id: C.GUMROAD_PRODUCT_ID, license_key: key }) });
      var j = await r.json();
      if (licOk(j)) { localStorage.setItem("jz_license", JSON.stringify({ valid: true, key: key, email: j.purchase && j.purchase.email, at: Date.now() })); msg.textContent = "Pro가 활성화됐어요. 감사합니다!"; setTimeout(function () { closeSheet(); render(); }, 900); }
      else msg.textContent = "키가 맞지 않아요. 구매 메일의 키를 그대로 붙여 넣어 주세요.";
    } catch (e) { msg.textContent = "인터넷 연결을 확인해 주세요."; }
  }

  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("[data-act],[data-tab],[data-vat],[data-ex],[data-m],[data-c]");
    if (!t) { if (ev.target.id === "sheetBg") closeSheet(); return; }
    if (t.dataset.act) { ev.preventDefault(); act(t.dataset.act, t); return; }
    if (t.dataset.tab && t.closest("#tabs")) { state.tab = t.dataset.tab; if (t.dataset.tab === "collect" || t.dataset.tab === "cost") state.ym = state.ym || S.ymOf(new Date()); render(); window.scrollTo(0, 0); return; }
    if (t.dataset.vat) { if (state.sheet) state.sheet.data.vat = t.dataset.vat; t.parentNode.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === t); }); return; }
    if (t.dataset.ex) { var w = document.createElement("div"); w.innerHTML = exRow({ name: t.dataset.ex, amount: "" }); $("#exList").appendChild(w.firstChild); updBillSum(); return; }
    if (t.dataset.m) { state.sheet.data.method = t.dataset.m; t.parentNode.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === t); }); return; }
    if (t.dataset.c) { state.sheet.data.category = t.dataset.c; t.parentNode.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === t); }); return; }
  });
  document.addEventListener("input", function (ev) {
    var t = ev.target;
    if (/^(uRent|uMgmt|uDeposit|bRent|bMgmt|pAmt|eAmt)$/.test(t.id) || t.classList.contains("exAmt")) {
      var pos = t.value.length - t.selectionStart; t.value = fmtInput(t.value); try { t.setSelectionRange(t.value.length - pos, t.value.length - pos); } catch (e) {}
    }
    if ($("#billSum") && t.closest("#sheet")) updBillSum();
  });
  document.addEventListener("change", function (ev) {
    var t = ev.target;
    if (t.id === "uProp") $("#newPropWrap").classList.toggle("hidden", t.value !== "__new");
    if (t.id === "pUnit") { var l = S.ledger()[t.value] || {}; $("#pAmt").value = l.balance > 0 ? fmtInput(l.balance) : ""; updPayBal(); }
    if (t.id === "restoreFile" && t.files[0]) {
      var rd = new FileReader();
      rd.onload = function () { try { var d = JSON.parse(rd.result); if (!d.items) throw 0; if (confirm("백업 파일로 덮어쓸까요? 지금 기록은 사라져요.")) { Object.keys(d.items).forEach(function (k) { d.meta = d.meta || {}; d.meta.dirty = d.meta.dirty || {}; d.meta.dirty[k] = 1; }); S.replaceAll(d); render(); SY.schedule(); toast("불러왔어요"); } } catch (e) { toast("올바른 백업 파일이 아니에요"); } };
      rd.readAsText(t.files[0]);
    }
  });

  function syncBadge(st) {
    var b = $("#syncBadge"), s = SY.session();
    b.className = "sync";
    if (!s) { b.textContent = "이 기기에만 저장"; return; }
    if (st.status === "syncing") { b.classList.add("busy"); b.textContent = "동기화 중…"; }
    else if (st.status === "error") { b.classList.add("err"); b.textContent = "동기화 오류"; }
    else { b.classList.add("ok"); b.textContent = "☁️ 동기화됨"; }
  }
  SY.onStatus(function (st) { syncBadge(st); if (st.status === "ok" && !state.sheet) render(); });
  syncBadge(SY.state());
  render();
  if (SY.session()) SY.syncNow();
  recheckLicense();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(function () {});
  self.JBApp = { render: render, state: state };
})();
