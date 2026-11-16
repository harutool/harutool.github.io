(function () {
  "use strict";
  var S = self.JBStore, SY = self.JBSync, C = self.JB_CONFIG;
  var $ = function (s) { return document.querySelector(s); };
  var view = $("#view");
  var state = { tab: "home", ym: ym(new Date()), jobsMode: "list", sheet: null };
  var EXP_CATS = ["유류(경유)", "수리·정비", "오일·필터·그리스", "투스·트랙·소모품", "할부·캐피탈", "보험", "정기검사", "운반비(추레라)", "기사 인건비", "주기장", "세금·공과", "식대·통신·기타"];
  var EXTRA_PRESETS = { "브레이커": 0, "집게·채바가지": 0, "크라샤·빔커터": 0, "운반비(추레라)": 0, "유류대": 0, "기타": 0 };
  var PAY_METHODS = ["계좌이체", "현금", "카드", "어음"];

  // ===== 유틸 =====
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function won(v) { return (Math.round(v) || 0).toLocaleString("ko-KR") + "원"; }
  function man(v) { v = Math.round(v) || 0; if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, "") + "억"; if (Math.abs(v) >= 1e4) return Math.round(v / 1e4).toLocaleString("ko-KR") + "만"; return v.toLocaleString("ko-KR"); }
  function ym(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function addMonth(s, k) { var p = s.split("-").map(Number); return ym(new Date(p[0], p[1] - 1 + k, 1)); }
  function ymLabel(s) { var p = s.split("-"); return p[0] + "년 " + Number(p[1]) + "월"; }
  function dLabel(s) { var d = new Date(s + "T00:00:00"); return (d.getMonth() + 1) + "월 " + d.getDate() + "일 (" + "일월화수목금토"[d.getDay()] + ")"; }
  function daysSince(s) { return Math.floor((Date.now() - new Date(s + "T00:00:00").getTime()) / 864e5); }
  function clientName(id) { var c = S.get(id); return c ? c.name : "(거래처 없음)"; }
  function equipName(id) { var e = S.get(id); return e ? e.name : ""; }
  function toast(m) { var t = $("#toast"); t.textContent = m; t.classList.remove("hidden"); clearTimeout(t._t); t._t = setTimeout(function () { t.classList.add("hidden"); }, 2200); }
  function num(v) { return S.n(v); }
  function fmtInput(v) { v = num(v); return v ? v.toLocaleString("ko-KR") : ""; }

  // ===== Pro / 체험 =====
  function lic() { try { return JSON.parse(localStorage.getItem("jb_license") || "null"); } catch (e) { return null; } }
  function trialLeft() { var f = (S.db().meta && S.db().meta.firstUse) || Date.now(); return Math.max(0, C.TRIAL_DAYS - Math.floor((Date.now() - f) / 864e5)); }
  function isPro() { var l = lic(); return !!(l && l.valid) || trialLeft() > 0; }
  function needPro(what) {
    if (isPro()) return false;
    openSheet(proSheet(what)); return true;
  }

  // ===== 렌더 =====
  function render() {
    document.querySelectorAll("#tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === state.tab); });
    var fn = { home: vHome, jobs: vJobs, recv: vRecv, cost: vCost, more: vMore, clients: vClients, equips: vEquips, client: vClient }[state.tab] || vHome;
    view.innerHTML = fn();
    $("#fab").textContent = state.tab === "cost" ? "＋ 지출 기록" : state.tab === "recv" || state.tab === "client" ? "＋ 입금 기록" : "＋ 작업 기록";
    $("#fab").dataset.act = state.tab === "cost" ? "newExpense" : state.tab === "recv" || state.tab === "client" ? "newPayment" : "newJob";
  }
  function monthNav() { return '<div class="month"><button data-act="prevM">◀</button><b>' + ymLabel(state.ym) + '</b><button data-act="nextM">▶</button></div>'; }

  function vHome() {
    var m = S.monthSummary(state.ym);
    var rec = S.receivables(), recTotal = 0, list = [];
    Object.keys(rec).forEach(function (cid) { if (rec[cid].balance > 0) { recTotal += rec[cid].balance; list.push({ cid: cid, r: rec[cid] }); } });
    list.sort(function (a, b) { return b.r.balance - a.r.balance; });
    var bars = "", max = 1, months = [];
    for (var i = 11; i >= 0; i--) { var k = addMonth(state.ym, -i), s = S.monthSummary(k); months.push({ k: k, s: s }); max = Math.max(max, s.sales, s.cost); }
    months.forEach(function (x) {
      bars += '<div class="b" title="' + ymLabel(x.k) + ' 매출 ' + won(x.s.sales) + ' / 지출 ' + won(x.s.cost) + '"><div style="display:flex;gap:2px;align-items:flex-end;width:100%;height:100%"><i style="height:' + Math.round(100 * x.s.sales / max) + '%"></i><i class="c" style="height:' + Math.round(100 * x.s.cost / max) + '%"></i></div><span>' + Number(x.k.slice(5)) + '</span></div>';
    });
    var recent = S.jobsSorted().slice(-5).reverse();
    var noData = !S.all("job").length;
    return monthNav() +
      (noData ? '<div class="card note">처음 오셨나요? 아래 <b>＋ 작업 기록</b>을 눌러 오늘 작업을 적어보세요. 거래처와 단가를 한 번 넣어두면 다음부터는 날짜만 고르면 돼요.</div>' : "") +
      '<div class="grid2"><div class="stat hl"><div class="k">이번 달 매출</div><div class="v">' + won(m.sales) + '</div><div class="s">작업 ' + m.workDays + '일 · ' + m.jobs + '건</div></div>' +
      '<div class="stat"><div class="k">이번 달 순수익</div><div class="v" style="color:' + (m.profit < 0 ? "var(--red)" : "var(--green)") + '">' + won(m.profit) + '</div><div class="s">공급가 ' + man(m.supply) + ' − 지출 ' + man(m.cost) + '</div></div>' +
      '<div class="stat"><div class="k">이번 달 입금</div><div class="v">' + won(m.received) + '</div><div class="s">부가세 적립 필요 ' + won(m.sales - m.supply) + '</div></div>' +
      '<div class="stat red" data-act="tab" data-tab="recv" style="cursor:pointer"><div class="k">받을 돈 (전체 미수금)</div><div class="v">' + won(recTotal) + '</div><div class="s">거래처 ' + list.length + '곳</div></div></div>' +
      (list.length ? '<div class="card"><h3>미수금 많은 거래처</h3>' + list.slice(0, 5).map(function (x) { var d = x.r.oldestUnpaid ? daysSince(x.r.oldestUnpaid) : 0; return '<div class="row" data-act="openClient" data-id="' + esc(x.cid) + '"><div class="l"><div class="t">' + esc(clientName(x.cid)) + '</div><div class="d">' + (x.r.oldestUnpaid ? "가장 오래된 미수 " + x.r.oldestUnpaid + " (" + d + "일 지남)" : "") + '</div></div><div class="r"><div class="amt" style="color:var(--red)">' + won(x.r.balance) + '</div></div></div>'; }).join("") + '</div>' : "") +
      '<div class="card"><h3>최근 12개월 <span class="legend"><i style="background:var(--y)"></i>매출<i style="background:#cfd4dd"></i>지출</span></h3><div class="bars">' + bars + '</div></div>' +
      (Object.keys(m.byCat).length ? '<div class="card"><h3>' + ymLabel(state.ym) + ' 지출 내역</h3>' + Object.keys(m.byCat).sort(function (a, b) { return m.byCat[b] - m.byCat[a]; }).map(function (k) { return '<div class="row" style="cursor:default"><div class="l"><div class="t">' + esc(k) + '</div></div><div class="r amt">' + won(m.byCat[k]) + '</div></div>'; }).join("") + '</div>' : "") +
      (recent.length ? '<div class="card"><h3>최근 작업</h3>' + recent.map(jobRow).join("") + '</div>' : "");
  }

  function jobRow(j) {
    var a = S.jobAmounts(j), st = S.jobStatus(j.id);
    var unit = S.UNIT[j.unit] || "";
    return '<div class="row" data-act="editJob" data-id="' + esc(j.id) + '"><div class="l"><div class="t">' + esc(clientName(j.clientId)) + (j.site ? ' · ' + esc(j.site) : "") + '</div><div class="d">' + esc(j.date) + ' · ' + (num(j.qty) || "") + unit + (equipName(j.equipId) ? ' · ' + esc(equipName(j.equipId)) : "") + (j.work ? ' · ' + esc(j.work) : "") + '</div></div><div class="r"><div class="amt">' + won(a.total) + '</div><span class="badge b-' + st + '">' + st + '</span></div></div>';
  }

  function vJobs() {
    var jobs = S.all("job").filter(function (j) { return (j.date || "").slice(0, 7) === state.ym; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var byDay = {}; jobs.forEach(function (j) { (byDay[j.date] = byDay[j.date] || []).push(j); });
    var p = state.ym.split("-").map(Number), first = new Date(p[0], p[1] - 1, 1), last = new Date(p[0], p[1], 0).getDate();
    var cal = "일월화수목금토".split("").map(function (d) { return '<div class="h">' + d + '</div>'; }).join("");
    for (var i = 0; i < first.getDay(); i++) cal += '<div class="c off"></div>';
    for (var d = 1; d <= last; d++) {
      var ds = state.ym + "-" + ("0" + d).slice(-2), js = byDay[ds] || [];
      var tot = js.reduce(function (s, j) { return s + S.jobAmounts(j).total; }, 0);
      cal += '<div class="c' + (js.length ? " has" : "") + (ds === today() ? " today" : "") + '" data-act="dayNew" data-date="' + ds + '"><div class="n">' + d + '</div>' + (js.length ? '<div class="m">' + man(tot) + '</div>' : "") + '</div>';
    }
    var m = S.monthSummary(state.ym);
    return monthNav() + '<div class="cal">' + cal + '</div>' +
      '<div class="grid2"><div class="stat"><div class="k">작업일수</div><div class="v">' + m.workDays + '일</div></div><div class="stat"><div class="k">매출 합계</div><div class="v">' + won(m.sales) + '</div></div></div>' +
      '<div class="card">' + (jobs.length ? Object.keys(byDay).sort().reverse().map(function (ds) { return '<div class="dayhead">' + dLabel(ds) + '</div>' + byDay[ds].map(jobRow).join(""); }).join("") : '<div class="empty">이 달 작업 기록이 없어요.<br>달력의 날짜를 누르면 바로 기록할 수 있어요.</div>') + '</div>';
  }

  function vRecv() {
    var rec = S.receivables(), list = [], total = 0;
    Object.keys(rec).forEach(function (cid) { if (rec[cid].balance > 0) { list.push({ cid: cid, r: rec[cid] }); total += rec[cid].balance; } });
    list.sort(function (a, b) { return b.r.balance - a.r.balance; });
    var over60 = list.reduce(function (s, x) { return s + x.r.unpaidJobs.filter(function (u) { return daysSince(u.job.date) > 30; }).reduce(function (a, u) { return a + u.total - u.paid; }, 0); }, 0);
    return '<h2>받을 돈</h2><div class="grid2"><div class="stat red"><div class="k">미수금 합계</div><div class="v">' + won(total) + '</div><div class="s">거래처 ' + list.length + '곳</div></div><div class="stat"><div class="k">지급기일(30일) 지난 돈</div><div class="v">' + won(over60) + '</div><div class="s">표준계약서상 작업 후 30일 내 지급</div></div></div>' +
      '<div class="card">' + (list.length ? list.map(function (x) { var d = x.r.oldestUnpaid ? daysSince(x.r.oldestUnpaid) : 0; return '<div class="row" data-act="openClient" data-id="' + esc(x.cid) + '"><div class="l"><div class="t">' + esc(clientName(x.cid)) + '</div><div class="d">미수 작업 ' + x.r.unpaidJobs.length + '건 · 가장 오래된 ' + esc(x.r.oldestUnpaid) + ' (' + d + '일' + (d > 30 ? ', <b style="color:var(--red)">기일 지남</b>' : "") + ')</div></div><div class="r"><div class="amt" style="color:var(--red)">' + won(x.r.balance) + '</div></div></div>'; }).join("") : '<div class="empty">미수금이 없어요. 👍</div>') + '</div>' +
      '<div class="card"><h3>최근 입금</h3>' + (S.all("payment").sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 10).map(function (p) { return '<div class="row" data-act="editPayment" data-id="' + esc(p.id) + '"><div class="l"><div class="t">' + esc(clientName(p.clientId)) + '</div><div class="d">' + esc(p.date) + ' · ' + esc(p.method || "") + (p.memo ? " · " + esc(p.memo) : "") + '</div></div><div class="r amt" style="color:var(--green)">+' + won(p.amount) + '</div></div>'; }).join("") || '<div class="empty">입금 기록이 없어요.</div>') + '</div>';
  }

  function vClient() {
    var c = S.get(state.clientId); if (!c) { state.tab = "recv"; return vRecv(); }
    var r = S.receivables()[c.id] || { billed: 0, paid: 0, balance: 0, jobs: [] };
    var pays = S.all("payment").filter(function (p) { return p.clientId === c.id; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return '<div class="btns" style="margin:0 0 10px"><button class="btn" data-act="tab" data-tab="recv">← 미수금</button></div><h2>' + esc(c.name) + '</h2>' +
      '<div class="grid2"><div class="stat red"><div class="k">미수금</div><div class="v">' + won(r.balance) + '</div></div><div class="stat"><div class="k">총 청구 / 입금</div><div class="v" style="font-size:17px">' + won(r.billed) + '</div><div class="s">입금 ' + won(r.paid) + '</div></div></div>' +
      '<div class="btns" style="margin-bottom:12px"><button class="btn y" data-act="newPayment" data-client="' + esc(c.id) + '">입금 기록</button><button class="btn" data-act="statement" data-client="' + esc(c.id) + '">거래명세표<span class="pro">PRO</span></button>' + (c.phone ? '<a class="btn" href="tel:' + esc(c.phone) + '">📞 전화</a><a class="btn" href="sms:' + esc(c.phone) + '?body=' + encodeURIComponent("안녕하세요, " + (S.settings().bizName || "장비") + "입니다. 미수금 " + won(r.balance) + " 입금 부탁드립니다." + (S.settings().account ? " (" + S.settings().bank + " " + S.settings().account + " " + S.settings().holder + ")" : "")) + '">💬 입금 요청 문자</a>' : "") + '<button class="btn" data-act="editClient" data-id="' + esc(c.id) + '">거래처 수정</button></div>' +
      '<div class="card"><h3>작업 내역</h3>' + (r.jobs.slice().reverse().map(function (x) { return jobRow(x.job); }).join("") || '<div class="empty">작업 기록이 없어요.</div>') + '</div>' +
      '<div class="card"><h3>입금 내역</h3>' + (pays.map(function (p) { return '<div class="row" data-act="editPayment" data-id="' + esc(p.id) + '"><div class="l"><div class="t">' + esc(p.date) + '</div><div class="d">' + esc(p.method || "") + (p.memo ? " · " + esc(p.memo) : "") + '</div></div><div class="r amt" style="color:var(--green)">+' + won(p.amount) + '</div></div>'; }).join("") || '<div class="empty">입금 기록이 없어요.</div>') + '</div>';
  }

  function vCost() {
    var exp = S.all("expense").filter(function (e) { return (e.date || "").slice(0, 7) === state.ym; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var m = S.monthSummary(state.ym);
    return monthNav() + '<div class="grid2"><div class="stat"><div class="k">지출 합계</div><div class="v">' + won(m.cost) + '</div></div><div class="stat"><div class="k">순수익</div><div class="v" style="color:' + (m.profit < 0 ? "var(--red)" : "var(--green)") + '">' + won(m.profit) + '</div><div class="s">공급가 기준</div></div></div>' +
      '<div class="card">' + (exp.map(function (e) { return '<div class="row" data-act="editExpense" data-id="' + esc(e.id) + '"><div class="l"><div class="t">' + esc(e.category || "기타") + '</div><div class="d">' + esc(e.date) + (equipName(e.equipId) ? " · " + esc(equipName(e.equipId)) : "") + (e.memo ? " · " + esc(e.memo) : "") + '</div></div><div class="r amt">' + won(e.amount) + '</div></div>'; }).join("") || '<div class="empty">이 달 지출 기록이 없어요.<br>기름값, 수리비, 할부금도 적어두면 진짜 남는 돈이 보여요.</div>') + '</div>';
  }

  function vMore() {
    var s = SY.session(), l = lic();
    var proLine = l && l.valid ? "Pro 사용 중" : trialLeft() > 0 ? "무료 체험 " + trialLeft() + "일 남음" : "무료 버전";
    var item = function (act, t, d) { return '<div class="row" data-act="' + act + '"><div class="l"><div class="t">' + t + '</div><div class="d">' + d + '</div></div><div class="r">›</div></div>'; };
    return '<h2>더보기</h2><div class="card list-menu">' +
      item("openSync", "☁️ 휴대폰·PC 동기화", s ? s.email + " 로그인됨" : "로그인하면 휴대폰, PC, 크롬 확장에서 같은 장부를 써요") +
      item("tab\" data-tab=\"clients", "🏢 거래처 관리", S.all("client").length + "곳") +
      item("tab\" data-tab=\"equips", "🚜 내 장비 · 기본 단가", S.all("equip").length + "대") +
      item("statement", "🧾 거래명세표 만들기<span class=\"pro\">PRO</span>", "거래처·기간을 골라 인쇄하거나 PDF로 저장") +
      item("exportXlsx", "📊 엑셀로 내보내기<span class=\"pro\">PRO</span>", "작업일보·입금·지출·거래처별 미수 4개 시트") +
      item("editSettings", "🪪 내 사업자 정보 · 계좌", S.settings().bizName || "명세표와 입금 요청 문자에 들어가요") +
      item("backup", "💾 백업 파일 저장", "기기 안 데이터를 파일로 저장") +
      item("restore", "📂 백업 파일 불러오기", "다른 기기에서 저장한 파일 불러오기") +
      item("openPro", "⭐ " + proLine, l && l.valid ? (l.email || "") : "거래명세표·엑셀은 Pro 기능이에요") +
      '</div><p class="muted" style="text-align:center">장비장부 v' + C.VERSION + ' · 데이터는 이 기기에 먼저 저장되고, 로그인하면 클라우드에 암호화 전송돼요.</p><input type="file" id="restoreFile" accept=".json" class="hidden">';
  }

  function vClients() {
    var rec = S.receivables();
    var list = S.all("client").sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); });
    return '<div class="btns" style="margin:0 0 10px"><button class="btn" data-act="tab" data-tab="more">← 더보기</button><button class="btn y" data-act="newClient">＋ 거래처 추가</button></div><h2>거래처</h2><div class="card">' +
      (list.map(function (c) { var b = (rec[c.id] || {}).balance || 0; return '<div class="row" data-act="openClient" data-id="' + esc(c.id) + '"><div class="l"><div class="t">' + esc(c.name) + '</div><div class="d">' + esc([c.contact, c.phone].filter(Boolean).join(" · ")) + '</div></div><div class="r">' + (b > 0 ? '<div class="amt" style="color:var(--red)">' + won(b) + '</div>' : '<span class="muted">미수 없음</span>') + '</div></div>'; }).join("") || '<div class="empty">거래처가 없어요.</div>') + '</div>';
  }
  function vEquips() {
    return '<div class="btns" style="margin:0 0 10px"><button class="btn" data-act="tab" data-tab="more">← 더보기</button><button class="btn y" data-act="newEquip">＋ 장비 추가</button></div><h2>내 장비 · 기본 단가</h2><div class="card">' +
      (S.all("equip").map(function (e) { return '<div class="row" data-act="editEquip" data-id="' + esc(e.id) + '"><div class="l"><div class="t">' + esc(e.name) + '</div><div class="d">일대 ' + won(e.rateDay) + ' · 반대 ' + won(e.rateHalf) + ' · 시간 ' + won(e.rateHour) + (e.regNo ? " · " + esc(e.regNo) : "") + '</div></div><div class="r">›</div></div>'; }).join("") || '<div class="empty">장비를 등록하면 작업 기록할 때 단가가 자동으로 들어가요.</div>') + '</div>';
  }

  // ===== 시트(입력 폼) =====
  function openSheet(html) { $("#sheet").innerHTML = html; $("#sheetBg").classList.remove("hidden"); }
  function closeSheet() { $("#sheetBg").classList.add("hidden"); $("#sheet").innerHTML = ""; state.sheet = null; }
  function head(t) { return '<h3>' + t + '<button class="x" data-act="close">×</button></h3>'; }
  function clientOptions(sel, withNew) {
    return S.all("client").sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); }).map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === sel ? " selected" : "") + '>' + esc(c.name) + '</option>'; }).join("") + (withNew ? '<option value="__new">＋ 새 거래처 입력</option>' : "");
  }
  function equipOptions(sel) { return '<option value="">(선택 안 함)</option>' + S.all("equip").map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === sel ? " selected" : "") + '>' + esc(e.name) + '</option>'; }).join(""); }

  function jobSheet(j) {
    var s = S.settings();
    var last = S.jobsSorted().slice(-1)[0];
    j = j || { date: state.presetDate || today(), clientId: last ? last.clientId : "", equipId: last ? last.equipId : (S.all("equip")[0] || {}).id, unit: "day", qty: 1, rate: "", vat: s.defaultVat, extras: [] };
    state.sheet = { kind: "job", data: JSON.parse(JSON.stringify(j)) };
    var hasClients = S.all("client").length > 0;
    var sites = {}; S.all("job").forEach(function (x) { if (x.site) sites[x.site] = 1; });
    return head(j.id ? "작업 수정" : "작업 기록") +
      '<div class="two"><label class="f">날짜<input type="date" id="fDate" value="' + esc(j.date) + '"></label><label class="f">장비<select id="fEquip">' + equipOptions(j.equipId) + '</select></label></div>' +
      '<label class="f">거래처 (발주처)<select id="fClient">' + (hasClients ? "" : '<option value="__new" selected>＋ 새 거래처 입력</option>') + clientOptions(j.clientId, hasClients) + '</select></label>' +
      '<label class="f' + (hasClients ? " hidden" : "") + '" id="newClientWrap">새 거래처 이름<input id="fClientNew" placeholder="예: ○○건설, 김사장님"></label>' +
      '<label class="f">현장<input id="fSite" list="siteList" value="' + esc(j.site || "") + '" placeholder="예: 여주 산북 전원주택 터파기"><datalist id="siteList">' + Object.keys(sites).map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + '</datalist></label>' +
      '<label class="f">근무 형태</label><div class="seg" id="fUnit">' + Object.keys(S.UNIT).map(function (k) { return '<button data-unit="' + k + '" class="' + (j.unit === k ? "on" : "") + '">' + S.UNIT[k] + '</button>'; }).join("") + '</div>' +
      '<div class="two"><label class="f"><span id="qtyLabel">수량</span><input id="fQty" inputmode="decimal" value="' + esc(j.qty) + '"></label><label class="f">단가 (원)<input id="fRate" inputmode="numeric" value="' + esc(fmtInput(j.rate)) + '" placeholder="직접 입력"></label></div>' +
      '<div class="two"><label class="f">연장 시간<input id="fOt" inputmode="decimal" value="' + esc(j.otHours || "") + '" placeholder="0"></label><label class="f">연장 시간당 단가<input id="fOtRate" inputmode="numeric" value="' + esc(fmtInput(j.otRate)) + '" placeholder="직접 입력"></label></div>' +
      '<label class="f">추가 청구 (브레이커·운반비·유류대 등)</label><div class="chips" id="exPresets">' + Object.keys(EXTRA_PRESETS).map(function (x) { return '<button data-ex="' + x + '">＋ ' + x + '</button>'; }).join("") + '</div><div id="exList">' + (j.extras || []).map(exRow).join("") + '</div>' +
      '<label class="f">부가세</label><div class="seg" id="fVat"><button data-vat="separate" class="' + (j.vat === "separate" ? "on" : "") + '">별도 (+10%)</button><button data-vat="included" class="' + (j.vat === "included" ? "on" : "") + '">포함</button><button data-vat="none" class="' + (j.vat === "none" ? "on" : "") + '">없음</button></div>' +
      '<label class="f"><input type="checkbox" id="fTax" style="width:auto"' + (j.taxInvoice ? " checked" : "") + '> 세금계산서 발행함</label>' +
      '<label class="f">작업 내용<input id="fWork" value="' + esc(j.work || "") + '" placeholder="예: 터파기, 상차, 정지작업"></label>' +
      '<label class="f">메모<textarea id="fMemo" rows="2">' + esc(j.memo || "") + '</textarea></label>' +
      '<div class="sum" id="jobSum"></div>' +
      '<div class="btns"><button class="btn y block" data-act="saveJob">저장</button>' + (j.id ? '<button class="btn red" data-act="delJob">삭제</button><button class="btn" data-act="copyJob">복사해서 새로</button>' : "") + '</div>';
  }
  function exRow(e) { return '<div class="extra"><input class="in exName" value="' + esc(e.name || "") + '" placeholder="항목"><input class="in exAmt" inputmode="numeric" value="' + esc(fmtInput(e.amount)) + '" placeholder="금액"><button class="x" data-act="exDel">×</button></div>'; }
  function readJob() {
    var d = state.sheet.data;
    d.date = $("#fDate").value; d.equipId = $("#fEquip").value; d.clientId = $("#fClient").value; d.site = $("#fSite").value.trim();
    d.qty = num($("#fQty").value); d.rate = num($("#fRate").value); d.otHours = num($("#fOt").value); d.otRate = num($("#fOtRate").value);
    d.work = $("#fWork").value.trim(); d.memo = $("#fMemo").value.trim(); d.taxInvoice = $("#fTax").checked;
    d.extras = Array.prototype.map.call(document.querySelectorAll("#exList .extra"), function (r) { return { name: r.querySelector(".exName").value.trim(), amount: num(r.querySelector(".exAmt").value) }; }).filter(function (e) { return e.name || e.amount; });
    return d;
  }
  function updJobSum() {
    if (!$("#jobSum")) return;
    var d = readJob(), a = S.jobAmounts(d);
    $("#qtyLabel").textContent = { day: "일수", half: "반대 횟수", hour: "시간", month: "개월", lump: "건수" }[d.unit] || "수량";
    $("#jobSum").innerHTML = '청구 합계<b>' + won(a.total) + '</b>공급가 ' + won(a.supply) + ' · 부가세 ' + won(a.vat) + (a.ot ? ' · 연장 ' + won(a.ot) : "") + (a.extras ? ' · 추가 ' + won(a.extras) : "");
  }
  function autoRate() {
    var d = state.sheet.data, e = S.get($("#fEquip").value), cid = $("#fClient").value;
    var prev = S.jobsSorted().filter(function (x) { return x.clientId === cid && x.unit === d.unit && x.id !== d.id; }).slice(-1)[0];
    // 단가는 기사님이 직접 정한 값만 불러옵니다: 같은 거래처의 지난 단가 → 내 장비에 등록한 단가
    var r = prev ? prev.rate : e ? { day: num(e.rateDay), half: num(e.rateHalf), hour: num(e.rateHour) }[d.unit] : 0;
    $("#fRate").value = r ? fmtInput(r) : "";
    var ot = prev && prev.otRate ? prev.otRate : e ? num(e.rateOt) : 0;
    if (!num($("#fOtRate").value) && ot) $("#fOtRate").value = fmtInput(ot);
    updJobSum();
  }

  function paySheet(p) {
    var cid = p && p.clientId || state.presetClient || state.clientId || "";
    var bal = cid ? ((S.receivables()[cid] || {}).balance || 0) : 0;
    p = p || { date: today(), clientId: cid, amount: bal > 0 ? bal : "", method: "계좌이체" };
    state.sheet = { kind: "payment", data: p };
    return head(p.id ? "입금 수정" : "입금 기록") +
      '<label class="f">거래처<select id="pClient">' + clientOptions(p.clientId) + '</select></label>' +
      '<div class="two"><label class="f">입금일<input type="date" id="pDate" value="' + esc(p.date) + '"></label><label class="f">금액 (원)<input id="pAmt" inputmode="numeric" value="' + esc(fmtInput(p.amount)) + '"></label></div>' +
      '<p class="muted" id="pBal"></p>' +
      '<label class="f">입금 방법</label><div class="chips" id="pMethod">' + PAY_METHODS.map(function (m) { return '<button data-m="' + m + '" class="' + (p.method === m ? "on" : "") + '">' + m + '</button>'; }).join("") + '</div>' +
      '<label class="f">메모<input id="pMemo" value="' + esc(p.memo || "") + '" placeholder="예: 10월분 일부"></label>' +
      '<div class="btns"><button class="btn y block" data-act="savePayment">저장</button>' + (p.id ? '<button class="btn red" data-act="delPayment">삭제</button>' : "") + '</div>';
  }
  function expSheet(e) {
    e = e || { date: today(), category: EXP_CATS[0], amount: "", equipId: (S.all("equip")[0] || {}).id || "" };
    state.sheet = { kind: "expense", data: e };
    return head(e.id ? "지출 수정" : "지출 기록") +
      '<label class="f">분류</label><div class="chips" id="eCat">' + EXP_CATS.map(function (c) { return '<button data-c="' + c + '" class="' + (e.category === c ? "on" : "") + '">' + c + '</button>'; }).join("") + '</div>' +
      '<div class="two"><label class="f">날짜<input type="date" id="eDate" value="' + esc(e.date) + '"></label><label class="f">금액 (원)<input id="eAmt" inputmode="numeric" value="' + esc(fmtInput(e.amount)) + '"></label></div>' +
      '<label class="f">장비<select id="eEquip">' + equipOptions(e.equipId) + '</select></label>' +
      '<label class="f">메모<input id="eMemo" value="' + esc(e.memo || "") + '" placeholder="예: 경유 200L, 버켓 핀 교체"></label>' +
      '<div class="btns"><button class="btn y block" data-act="saveExpense">저장</button>' + (e.id ? '<button class="btn red" data-act="delExpense">삭제</button>' : "") + '</div>';
  }
  function clientSheet(c) {
    c = c || {}; state.sheet = { kind: "client", data: c };
    return head(c.id ? "거래처 수정" : "거래처 추가") +
      '<label class="f">상호 / 이름<input id="cName" value="' + esc(c.name || "") + '"></label>' +
      '<div class="two"><label class="f">담당자<input id="cContact" value="' + esc(c.contact || "") + '"></label><label class="f">연락처<input id="cPhone" inputmode="tel" value="' + esc(c.phone || "") + '"></label></div>' +
      '<label class="f">사업자등록번호<input id="cBiz" value="' + esc(c.bizNo || "") + '" placeholder="000-00-00000"></label>' +
      '<label class="f">주소<input id="cAddr" value="' + esc(c.address || "") + '"></label>' +
      '<label class="f">메모<input id="cMemo" value="' + esc(c.memo || "") + '" placeholder="예: 매달 말일 결제, 지급보증 있음"></label>' +
      '<div class="btns"><button class="btn y block" data-act="saveClient">저장</button>' + (c.id ? '<button class="btn red" data-act="delClient">삭제</button>' : "") + '</div>';
  }
  function equipSheet(e) {
    e = e || {}; state.sheet = { kind: "equip", data: e };
    return head(e.id ? "장비 수정" : "장비 추가") +
      '<label class="f">장비 이름 (규격)<input id="qName" value="' + esc(e.name || "") + '" placeholder="예: 06W 굴삭기, 03 미니"></label>' +
      '<label class="f">등록번호<input id="qReg" value="' + esc(e.regNo || "") + '" placeholder="예: 경기 01가 1234"></label>' +
      '<div class="two"><label class="f">일대 단가<input id="qDay" inputmode="numeric" value="' + esc(fmtInput(e.rateDay)) + '"></label><label class="f">반대 단가<input id="qHalf" inputmode="numeric" value="' + esc(fmtInput(e.rateHalf)) + '"></label></div>' +
      '<p class="muted">평소 받는 단가를 적어두면 작업 기록할 때 자동으로 들어가요. 거래처마다 다르면 작업 기록에서 바꾸면 되고, 다음부터는 그 거래처 단가를 기억해요.</p><div class="two"><label class="f">시간당 단가<input id="qHour" inputmode="numeric" value="' + esc(fmtInput(e.rateHour)) + '"></label><label class="f">연장 시간당<input id="qOt" inputmode="numeric" value="' + esc(fmtInput(e.rateOt)) + '"></label></div>' +
      '<div class="btns"><button class="btn y block" data-act="saveEquip">저장</button>' + (e.id ? '<button class="btn red" data-act="delEquip">삭제</button>' : "") + '</div>';
  }
  function settingsSheet() {
    var s = S.settings(); state.sheet = { kind: "settings", data: s };
    var f = function (id, label, v, ph) { return '<label class="f">' + label + '<input id="' + id + '" value="' + esc(v || "") + '" placeholder="' + (ph || "") + '"></label>'; };
    return head("내 사업자 정보") + '<p class="muted">거래명세표의 공급자 칸과 입금 요청 문자에 들어가요.</p>' +
      f("sBiz", "상호", s.bizName, "예: 이혁중기") + '<div class="two">' + f("sOwner", "대표자", s.owner) + f("sBizNo", "사업자등록번호", s.bizNo) + '</div>' +
      f("sPhone", "연락처", s.phone) + f("sAddr", "주소", s.address) +
      '<div class="two">' + f("sBank", "은행", s.bank) + f("sHolder", "예금주", s.holder) + '</div>' + f("sAcc", "계좌번호", s.account) +
      '<label class="f">기본 부가세</label><div class="seg" id="sVat"><button data-vat="separate" class="' + (s.defaultVat === "separate" ? "on" : "") + '">별도</button><button data-vat="included" class="' + (s.defaultVat === "included" ? "on" : "") + '">포함</button><button data-vat="none" class="' + (s.defaultVat === "none" ? "on" : "") + '">없음</button></div>' +
      '<div class="btns"><button class="btn y block" data-act="saveSettings">저장</button></div>';
  }
  function syncSheet() {
    var s = SY.session(), st = SY.state();
    if (!SY.configured()) return head("동기화") + '<p>동기화 서버 설정 전이에요.</p>';
    if (s) return head("☁️ 동기화") + '<p><b>' + esc(s.email) + '</b> 계정으로 로그인됨</p><p class="muted">같은 계정으로 휴대폰, PC, 크롬 확장에 로그인하면 장부가 자동으로 맞춰져요. 인터넷이 없을 때 기록한 것도 연결되면 올라가요.</p><p class="muted">상태: ' + ({ ok: "최근 동기화 " + (st.lastSync ? new Date(st.lastSync).toLocaleTimeString("ko-KR") : ""), syncing: "동기화 중…", error: "오류: " + esc(st.error), off: "대기" }[st.status] || "") + '</p><div class="btns"><button class="btn y" data-act="syncNow">지금 동기화</button><button class="btn" data-act="signOut">로그아웃</button></div>';
    return head("☁️ 휴대폰·PC 동기화 (무료)") +
      '<p class="muted">이메일로 가입하면 휴대폰 앱, PC, 크롬 확장에서 같은 장부를 함께 써요. 지금 이 기기에 있는 기록도 그대로 올라가요.</p>' +
      '<label class="f">이메일<input id="aEmail" type="email" autocomplete="email"></label><label class="f">비밀번호 (6자 이상)<input id="aPw" type="password" autocomplete="current-password"></label>' +
      '<p id="aMsg" class="muted"></p><div class="btns"><button class="btn y" data-act="signIn">로그인</button><button class="btn" data-act="signUp">처음이에요 (가입)</button></div>';
  }
  function proSheet(what) {
    var l = lic();
    return head("⭐ 장비장부 Pro") + (what ? '<div class="note">' + esc(what) + '은(는) Pro 기능이에요.</div>' : "") +
      '<ul><li><b>거래명세표</b> 인쇄·PDF 저장 (현장별·미수만)</li><li><b>엑셀 내보내기</b> (세무사 전달용 4개 시트)</li><li>앞으로 추가: 지급기일 알림, 현장소장 서명</li></ul><p class="muted">작업일보·미수금·동기화 백업은 계속 무료예요.</p>' +
      '<p><b>' + esc(C.PRO_PRICE) + '</b>' + (trialLeft() > 0 ? ' · 지금 7일 무료 체험 중 (' + trialLeft() + '일 남음)' : "") + '</p>' +
      (C.GUMROAD_URL.indexOf("http") === 0 ? '<a class="btn y block" href="' + esc(C.GUMROAD_URL) + '" target="_blank" rel="noopener">구매하고 라이선스 키 받기</a>' : "") +
      '<label class="f">라이선스 키<input id="lKey" value="' + esc(l && l.key || "") + '" placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"></label><p id="lMsg" class="muted"></p><div class="btns"><button class="btn dark" data-act="activate">활성화</button></div>';
  }

  // ===== 거래명세표 =====
  function statementSheet(cid) {
    var p = state.ym.split("-");
    return head("🧾 거래명세표") + '<label class="f">거래처<select id="tClient">' + clientOptions(cid) + '</select></label>' +
      '<div class="two"><label class="f">시작일<input type="date" id="tFrom" value="' + state.ym + '-01"></label><label class="f">종료일<input type="date" id="tTo" value="' + state.ym + "-" + new Date(Number(p[0]), Number(p[1]), 0).getDate() + '"></label></div>' +
      '<label class="f">현장 (비우면 전체)<input id="tSite" placeholder="예: 여주 산북 현장"></label><label class="f"><input type="checkbox" id="tUnpaid" style="width:auto"> 미수 작업만</label>' +
      '<div class="btns"><button class="btn y block" data-act="printStmt">미리보기 · 인쇄 / PDF 저장</button></div><p class="muted">인쇄 창에서 "PDF로 저장"을 고르면 파일로 받아 카톡으로 보낼 수 있어요.</p>';
  }
  function buildStatement(cid, from, to, unpaidOnly, site) {
    var s = S.settings(), c = S.get(cid) || {};
    var rec = S.receivables()[cid] || { jobs: [] };
    var rows = rec.jobs.filter(function (x) { return x.job.date >= from && x.job.date <= to && (!unpaidOnly || x.paid < x.total) && (!site || (x.job.site || "").indexOf(site) >= 0); });
    var sup = 0, vat = 0, tot = 0;
    var tr = rows.map(function (x, i) {
      var j = x.job, a = S.jobAmounts(j); sup += a.supply; vat += a.vat; tot += a.total;
      var desc = [j.site, j.work, equipName(j.equipId)].filter(Boolean).join(" / ");
      var extra = (j.extras || []).map(function (e) { return e.name + " " + num(e.amount).toLocaleString(); }).join(", ") + (a.ot ? (j.extras && j.extras.length ? ", " : "") + "연장 " + num(j.otHours) + "h" : "");
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(j.date.slice(5).replace("-", "/")) + '</td><td>' + esc(desc) + (extra ? '<br><small>' + esc(extra) + '</small>' : "") + '</td><td class="num">' + esc((num(j.qty) || "") + (S.UNIT[j.unit] || "")) + '</td><td class="num">' + num(j.rate).toLocaleString() + '</td><td class="num">' + a.supply.toLocaleString() + '</td><td class="num">' + a.vat.toLocaleString() + '</td></tr>';
    }).join("");
    var paid = rows.reduce(function (s2, x) { return s2 + x.paid; }, 0);
    return '<div class="stmt"><h1>거 래 명 세 표</h1><table class="hd"><tr><td style="width:50%"><b>공급받는자</b><br>상호: ' + esc(c.name || "") + '<br>사업자번호: ' + esc(c.bizNo || "") + '<br>주소: ' + esc(c.address || "") + '<br>담당: ' + esc([c.contact, c.phone].filter(Boolean).join(" ")) + '</td><td><b>공급자</b><br>상호: ' + esc(s.bizName) + '　대표: ' + esc(s.owner) + '<br>사업자번호: ' + esc(s.bizNo) + '<br>주소: ' + esc(s.address) + '<br>연락처: ' + esc(s.phone) + '</td></tr></table>' +
      '<p>기간: ' + esc(from) + ' ~ ' + esc(to) + (site ? '　　현장: ' + esc(site) : "") + '　　작성일: ' + today() + '</p>' +
      '<table><tr><th>No</th><th>일자</th><th>현장 / 작업내용</th><th>수량</th><th>단가</th><th>공급가액</th><th>세액</th></tr>' + (tr || '<tr><td colspan="7" style="text-align:center">해당 기간 작업이 없습니다</td></tr>') +
      '<tr class="tot"><td colspan="5">합계 (공급가액 + 세액)</td><td class="num">' + sup.toLocaleString() + '</td><td class="num">' + vat.toLocaleString() + '</td></tr>' +
      '<tr class="tot"><td colspan="5">청구 합계</td><td class="num" colspan="2">' + tot.toLocaleString() + ' 원</td></tr>' +
      (paid ? '<tr><td colspan="5">기 입금액</td><td class="num" colspan="2">' + paid.toLocaleString() + ' 원</td></tr><tr class="tot"><td colspan="5">잔액</td><td class="num" colspan="2">' + (tot - paid).toLocaleString() + ' 원</td></tr>' : "") + '</table>' +
      (s.account ? '<p><b>입금 계좌:</b> ' + esc(s.bank) + ' ' + esc(s.account) + ' (예금주 ' + esc(s.holder) + ')</p>' : "") + '<p style="text-align:right">위 금액을 청구합니다.　　공급자 ' + esc(s.bizName || "") + ' (인)</p></div>';
  }

  // ===== 엑셀 =====
  function exportXlsx() {
    var jobs = S.jobsSorted(), rec = S.receivables();
    var sheets = [
      { name: "작업일보", columns: [{ title: "날짜", width: 12 }, { title: "거래처", width: 18 }, { title: "현장", width: 24 }, { title: "장비", width: 12 }, { title: "형태", width: 7 }, { title: "수량", type: "int", width: 7 }, { title: "단가", type: "money", width: 12 }, { title: "연장", type: "money", width: 11 }, { title: "추가", type: "money", width: 11 }, { title: "공급가", type: "money", width: 13 }, { title: "부가세", type: "money", width: 11 }, { title: "합계", type: "money", width: 13 }, { title: "입금", type: "money", width: 13 }, { title: "상태", width: 7 }, { title: "세금계산서", width: 9 }, { title: "작업내용", width: 20 }, { title: "메모", width: 20 }],
        rows: jobs.map(function (j) { var a = S.jobAmounts(j), x = (rec[j.clientId] || { jobs: [] }).jobs.find(function (y) { return y.job.id === j.id; }) || { paid: 0 }; return [j.date, clientName(j.clientId), j.site || "", equipName(j.equipId), S.UNIT[j.unit] || "", num(j.qty), num(j.rate), a.ot, a.extras, a.supply, a.vat, a.total, x.paid, x.paid >= a.total ? "완납" : x.paid > 0 ? "부분" : "미수", j.taxInvoice ? "발행" : "", j.work || "", j.memo || ""]; }) },
      { name: "입금", columns: [{ title: "날짜", width: 12 }, { title: "거래처", width: 18 }, { title: "금액", type: "money", width: 14 }, { title: "방법", width: 10 }, { title: "메모", width: 24 }], rows: S.all("payment").sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (p) { return [p.date, clientName(p.clientId), num(p.amount), p.method || "", p.memo || ""]; }) },
      { name: "지출", columns: [{ title: "날짜", width: 12 }, { title: "분류", width: 16 }, { title: "금액", type: "money", width: 14 }, { title: "장비", width: 12 }, { title: "메모", width: 26 }], rows: S.all("expense").sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (e) { return [e.date, e.category || "", num(e.amount), equipName(e.equipId), e.memo || ""]; }) },
      { name: "거래처별미수", columns: [{ title: "거래처", width: 20 }, { title: "총청구", type: "money", width: 14 }, { title: "입금", type: "money", width: 14 }, { title: "미수금", type: "money", width: 14 }, { title: "가장 오래된 미수", width: 16 }], rows: Object.keys(rec).map(function (cid) { var r = rec[cid]; return [clientName(cid), r.billed, r.paid, r.balance, r.oldestUnpaid || ""]; }).sort(function (a, b) { return b[3] - a[3]; }) }
    ];
    download(self.JGXlsx.build(sheets), "장비장부_" + today() + ".xlsx");
  }
  function download(blob, name) { var u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 1500); }

  // ===== 이벤트 =====
  function act(name, el) {
    var id = el.dataset.id;
    switch (name) {
      case "tab": state.tab = el.dataset.tab; render(); window.scrollTo(0, 0); break;
      case "prevM": state.ym = addMonth(state.ym, -1); render(); break;
      case "nextM": state.ym = addMonth(state.ym, 1); render(); break;
      case "close": closeSheet(); break;
      case "newJob": state.presetDate = null; openSheet(jobSheet()); updJobSum(); if (!$("#fRate").value) autoRate(); break;
      case "dayNew": state.presetDate = el.dataset.date; openSheet(jobSheet()); updJobSum(); if (!$("#fRate").value) autoRate(); break;
      case "editJob": openSheet(jobSheet(S.get(id))); updJobSum(); break;
      case "copyJob": var cp = Object.assign({}, readJob()); delete cp.id; cp.date = today(); openSheet(jobSheet(cp)); updJobSum(); break;
      case "saveJob":
        var d = readJob();
        if (d.clientId === "__new" || !d.clientId) {
          var nm = ($("#fClientNew") || {}).value; nm = nm && nm.trim();
          if (!nm) { toast("거래처를 선택하거나 입력해 주세요"); return; }
          d.clientId = S.save("client", { name: nm }).id;
        }
        if (!d.date) { toast("날짜를 입력해 주세요"); return; }
        S.save("job", d); closeSheet(); toast("저장했어요"); render(); SY.schedule(); break;
      case "delJob": if (confirm("이 작업 기록을 삭제할까요?")) { S.remove(state.sheet.data.id); closeSheet(); render(); SY.schedule(); } break;
      case "exDel": el.parentNode.remove(); updJobSum(); break;
      case "newPayment": state.presetClient = el.dataset.client || (state.tab === "client" ? state.clientId : ""); if (!S.all("client").length) { toast("먼저 작업을 기록해 주세요"); return; } openSheet(paySheet()); updPayBal(); break;
      case "editPayment": openSheet(paySheet(S.get(id))); updPayBal(); break;
      case "savePayment":
        var p = state.sheet.data; p.clientId = $("#pClient").value; p.date = $("#pDate").value; p.amount = num($("#pAmt").value); p.memo = $("#pMemo").value.trim();
        if (!p.amount) { toast("금액을 입력해 주세요"); return; }
        S.save("payment", p); closeSheet(); toast("입금을 기록했어요"); render(); SY.schedule(); break;
      case "delPayment": if (confirm("이 입금 기록을 삭제할까요?")) { S.remove(state.sheet.data.id); closeSheet(); render(); SY.schedule(); } break;
      case "newExpense": openSheet(expSheet()); break;
      case "editExpense": openSheet(expSheet(S.get(id))); break;
      case "saveExpense":
        var e = state.sheet.data; e.date = $("#eDate").value; e.amount = num($("#eAmt").value); e.equipId = $("#eEquip").value; e.memo = $("#eMemo").value.trim();
        if (!e.amount) { toast("금액을 입력해 주세요"); return; }
        S.save("expense", e); closeSheet(); toast("지출을 기록했어요"); render(); SY.schedule(); break;
      case "delExpense": if (confirm("이 지출 기록을 삭제할까요?")) { S.remove(state.sheet.data.id); closeSheet(); render(); SY.schedule(); } break;
      case "openClient": state.clientId = id; state.tab = "client"; render(); window.scrollTo(0, 0); break;
      case "newClient": openSheet(clientSheet()); break;
      case "editClient": openSheet(clientSheet(S.get(id))); break;
      case "saveClient":
        var c = state.sheet.data; c.name = $("#cName").value.trim(); c.contact = $("#cContact").value.trim(); c.phone = $("#cPhone").value.trim(); c.bizNo = $("#cBiz").value.trim(); c.address = $("#cAddr").value.trim(); c.memo = $("#cMemo").value.trim();
        if (!c.name) { toast("이름을 입력해 주세요"); return; }
        S.save("client", c); closeSheet(); render(); SY.schedule(); break;
      case "delClient":
        if (S.all("job").some(function (j) { return j.clientId === state.sheet.data.id; })) { toast("작업 기록이 있는 거래처는 삭제할 수 없어요"); return; }
        if (confirm("거래처를 삭제할까요?")) { S.remove(state.sheet.data.id); closeSheet(); state.tab = "clients"; render(); SY.schedule(); } break;
      case "newEquip": openSheet(equipSheet()); break;
      case "editEquip": openSheet(equipSheet(S.get(id))); break;
      case "saveEquip":
        var q = state.sheet.data; q.name = $("#qName").value.trim(); q.regNo = $("#qReg").value.trim(); q.rateDay = num($("#qDay").value); q.rateHalf = num($("#qHalf").value); q.rateHour = num($("#qHour").value); q.rateOt = num($("#qOt").value);
        if (!q.name) { toast("장비 이름을 입력해 주세요"); return; }
        S.save("equip", q); closeSheet(); render(); SY.schedule(); break;
      case "delEquip": if (confirm("장비를 삭제할까요?")) { S.remove(state.sheet.data.id); closeSheet(); render(); SY.schedule(); } break;
      case "editSettings": openSheet(settingsSheet()); break;
      case "saveSettings":
        var s = state.sheet.data; s.bizName = $("#sBiz").value.trim(); s.owner = $("#sOwner").value.trim(); s.bizNo = $("#sBizNo").value.trim(); s.phone = $("#sPhone").value.trim(); s.address = $("#sAddr").value.trim(); s.bank = $("#sBank").value.trim(); s.holder = $("#sHolder").value.trim(); s.account = $("#sAcc").value.trim();
        S.saveSettings(s); closeSheet(); toast("저장했어요"); render(); SY.schedule(); break;
      case "statement": if (needPro("거래명세표")) return; if (!S.all("client").length) { toast("거래처가 없어요"); return; } openSheet(statementSheet(el.dataset.client || state.clientId)); break;
      case "printStmt":
        $("#print").innerHTML = buildStatement($("#tClient").value, $("#tFrom").value, $("#tTo").value, $("#tUnpaid").checked, $("#tSite").value.trim());
        closeSheet(); setTimeout(function () { window.print(); }, 200); break;
      case "exportXlsx": if (needPro("엑셀 내보내기")) return; exportXlsx(); break;
      case "backup": download(new Blob([JSON.stringify(S.db())], { type: "application/json" }), "장비장부_백업_" + today() + ".json"); break;
      case "restore": $("#restoreFile").click(); break;
      case "openSync": openSheet(syncSheet()); break;
      case "signIn": case "signUp": doAuth(name); break;
      case "signOut": if (confirm("로그아웃할까요? 이 기기의 기록은 남아 있어요.")) { SY.signOut(); closeSheet(); } break;
      case "syncNow": SY.syncNow().then(function () { openSheet(syncSheet()); }); break;
      case "openPro": openSheet(proSheet()); break;
      case "activate": activate(); break;
    }
  }
  function updPayBal() {
    var cid = $("#pClient").value, b = (S.receivables()[cid] || {}).balance || 0;
    $("#pBal").textContent = "현재 미수금 " + won(b);
  }
  async function doAuth(kind) {
    var em = $("#aEmail").value.trim(), pw = $("#aPw").value, msg = $("#aMsg");
    if (!em || pw.length < 6) { msg.textContent = "이메일과 6자 이상 비밀번호를 넣어주세요."; return; }
    msg.textContent = "확인 중…";
    try {
      if (kind === "signUp") { var r = await SY.signUp(em, pw); if (r.confirm) { msg.textContent = "메일함에서 인증 링크를 누른 뒤 로그인해 주세요."; return; } }
      else await SY.signIn(em, pw);
      // 첫 로그인: 이 기기의 모든 기록을 올림
      var db = S.db(); Object.keys(db.items).forEach(function (k) { db.meta.dirty[k] = 1; }); db.meta.pulledAt = null; S.persist();
      await SY.syncNow(); closeSheet(); toast("동기화를 시작했어요"); render();
    } catch (e) { msg.textContent = e.message; }
  }
  async function activate() {
    var key = $("#lKey").value.trim(), msg = $("#lMsg");
    if (!key) return;
    msg.textContent = "확인 중…";
    try {
      var r = await fetch("https://api.gumroad.com/v2/licenses/verify", { method: "POST", body: new URLSearchParams({ product_id: C.GUMROAD_PRODUCT_ID, license_key: key }) });
      var j = await r.json();
      if (j.success && !(j.purchase && (j.purchase.refunded || j.purchase.chargebacked))) { localStorage.setItem("jb_license", JSON.stringify({ valid: true, key: key, email: j.purchase && j.purchase.email, at: Date.now() })); msg.textContent = "Pro가 활성화됐어요. 감사합니다!"; setTimeout(function () { closeSheet(); render(); }, 900); }
      else msg.textContent = "키가 맞지 않아요. 구매 메일의 키를 그대로 붙여 넣어 주세요.";
    } catch (e) { msg.textContent = "인터넷 연결을 확인해 주세요."; }
  }

  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("[data-act],[data-tab],[data-unit],[data-vat],[data-ex],[data-m],[data-c]");
    if (!t) { if (ev.target.id === "sheetBg") closeSheet(); return; }
    if (t.dataset.act) { ev.preventDefault(); act(t.dataset.act, t); return; }
    if (t.dataset.tab && t.closest("#tabs")) { state.tab = t.dataset.tab; render(); window.scrollTo(0, 0); return; }
    if (t.dataset.unit) { state.sheet.data.unit = t.dataset.unit; t.parentNode.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === t); }); autoRate(); return; }
    if (t.dataset.vat) { if (state.sheet) state.sheet.data.vat = t.dataset.vat; if (state.sheet && state.sheet.kind === "settings") state.sheet.data.defaultVat = t.dataset.vat; t.parentNode.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === t); }); updJobSum(); return; }
    if (t.dataset.ex) { var w = document.createElement("div"); w.innerHTML = exRow({ name: t.dataset.ex, amount: EXTRA_PRESETS[t.dataset.ex] || "" }); $("#exList").appendChild(w.firstChild); return; }
    if (t.dataset.m) { state.sheet.data.method = t.dataset.m; t.parentNode.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === t); }); return; }
    if (t.dataset.c) { state.sheet.data.category = t.dataset.c; t.parentNode.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === t); }); return; }
  });
  document.addEventListener("input", function (ev) {
    var t = ev.target;
    if (/^(fRate|fOtRate|pAmt|eAmt|qDay|qHalf|qHour|qOt)$/.test(t.id) || t.classList.contains("exAmt")) {
      var pos = t.value.length - t.selectionStart; t.value = fmtInput(t.value); try { t.setSelectionRange(t.value.length - pos, t.value.length - pos); } catch (e) {}
    }
    if ($("#jobSum") && t.closest("#sheet")) updJobSum();
  });
  document.addEventListener("change", function (ev) {
    var t = ev.target;
    if (t.id === "fClient") { $("#newClientWrap").classList.toggle("hidden", t.value !== "__new"); autoRate(); }
    if (t.id === "fEquip") autoRate();
    if (t.id === "pClient") { var b = (S.receivables()[t.value] || {}).balance || 0; $("#pAmt").value = b > 0 ? fmtInput(b) : ""; updPayBal(); }
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
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(function () {});
  self.JBApp = { render: render, state: state };
})();
