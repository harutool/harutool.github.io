// 클라우드 동기화 (Supabase REST, 라이브러리 없이 fetch만 사용)
(function () {
  "use strict";
  var C = self.JB_CONFIG;
  var SKEY = "jb_session_v1";
  var busy = false, timer = null, statusFns = [];
  var state = { status: "off", lastSync: 0, error: "" };

  function sess() { try { return JSON.parse(localStorage.getItem(SKEY) || "null"); } catch (e) { return null; } }
  function setSess(s) { if (s) localStorage.setItem(SKEY, JSON.stringify(s)); else localStorage.removeItem(SKEY); }
  function emit(st, err) { state.status = st; state.error = err || ""; statusFns.forEach(function (f) { try { f(state); } catch (e) {} }); }
  function configured() { return C.SUPABASE_URL.indexOf("http") === 0; }

  async function authCall(path, body) {
    var r = await fetch(C.SUPABASE_URL + "/auth/v1/" + path, {
      method: "POST",
      headers: { apikey: C.SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) {
      var m = j.msg || j.error_description || j.message || ("오류 " + r.status);
      if (/Invalid login/i.test(m)) m = "이메일 또는 비밀번호가 맞지 않아요.";
      if (/already registered|already exists/i.test(m)) m = "이미 가입된 이메일이에요. 로그인해 주세요.";
      if (/Password should be/i.test(m)) m = "비밀번호는 6자 이상이어야 해요.";
      if (/Email not confirmed/i.test(m)) m = "메일함의 인증 링크를 먼저 눌러주세요.";
      throw new Error(m);
    }
    return j;
  }
  function keep(j) {
    if (!j.access_token) return null;
    var s = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, email: (j.user && j.user.email) || "", uid: (j.user && j.user.id) || "" };
    setSess(s); return s;
  }
  async function signUp(email, pw) {
    var j = await authCall("signup", { email: email, password: pw });
    if (j.access_token) { keep(j); return { ok: true }; }
    return { ok: true, confirm: true };
  }
  async function signIn(email, pw) { keep(await authCall("token?grant_type=password", { email: email, password: pw })); }
  async function token() {
    var s = sess();
    if (!s) return null;
    if (Date.now() < s.exp - 60000) return s.access;
    try { var ns = keep(await authCall("token?grant_type=refresh_token", { refresh_token: s.refresh })); return ns && ns.access; }
    catch (e) { setSess(null); emit("off", "다시 로그인해 주세요."); return null; }
  }
  function signOut() { setSess(null); emit("off"); }

  async function rest(method, q, body, tk) {
    var h = { apikey: C.SUPABASE_KEY, Authorization: "Bearer " + tk, "Content-Type": "application/json" };
    if (method === "POST") h.Prefer = "resolution=merge-duplicates,return=minimal";
    var r = await fetch(C.SUPABASE_URL + "/rest/v1/items" + q, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error("동기화 실패 (" + r.status + ")");
    return method === "GET" ? r.json() : null;
  }

  async function syncNow() {
    if (!configured() || busy) return;
    var tk = await token();
    if (!tk) { emit("off"); return; }
    busy = true; emit("syncing");
    try {
      var S = self.JBStore, db = S.db(), meta = db.meta;
      // 1) 올리기
      var ids = Object.keys(meta.dirty || {});
      for (var i = 0; i < ids.length; i += 200) {
        var chunk = ids.slice(i, i + 200).map(function (id) {
          var it = db.items[id]; if (!it) return null;
          return { id: id, kind: it.kind, data: it.deleted ? {} : it, updated_at: it.updatedAt, deleted: !!it.deleted };
        }).filter(Boolean);
        if (chunk.length) await rest("POST", "?on_conflict=user_id,id", chunk, tk);
        chunk.forEach(function (c) { delete meta.dirty[c.id]; });
      }
      // 2) 내려받기 (서버 기준 변경분)
      var since = meta.pulledAt || "1970-01-01T00:00:00Z", got = 0;
      while (true) {
        var rows = await rest("GET", "?select=id,kind,data,updated_at,deleted,server_ts&server_ts=gt." + encodeURIComponent(since) + "&order=server_ts.asc&limit=500", null, tk);
        rows.forEach(function (r) {
          var cur = db.items[r.id];
          if (meta.dirty[r.id] && cur && cur.updatedAt > r.updated_at) return;
          if (!cur || r.updated_at >= (cur.updatedAt || 0)) {
            db.items[r.id] = r.deleted ? { id: r.id, kind: r.kind, updatedAt: r.updated_at, deleted: true } : Object.assign({}, r.data, { id: r.id, kind: r.kind, updatedAt: r.updated_at, deleted: false });
            got++;
          }
          since = r.server_ts;
        });
        if (rows.length < 500) break;
      }
      meta.pulledAt = since;
      state.lastSync = Date.now();
      S.persist();
      emit("ok");
    } catch (e) {
      emit("error", e.message || String(e));
    } finally { busy = false; }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(syncNow, 2500); }

  self.JBSync = {
    configured: configured, session: sess, signUp: signUp, signIn: signIn, signOut: signOut,
    syncNow: syncNow, schedule: schedule, state: function () { return state; },
    onStatus: function (f) { statusFns.push(f); }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("online", schedule);
    setInterval(function () { if (sess()) syncNow(); }, 60000);
  }
})();
