(function () {
  "use strict";

  var DATA = window.GRE_DATA;
  var KEY = "gre-vocab-v1";
  var BACKUP_KEY = KEY + "-prev";
  var DAY = 24 * 60 * 60 * 1000;
  var INTERVAL_DAYS = [0, 1, 2, 4, 7, 15, 30]; // Leitner box -> days until next review
  var MASTERED_BOX = 3;
  var LIST_PAGE = 100;
  var MODES = [
    ["mix", "混合"], ["en2zh", "英→中"], ["zh2en", "中→英"], ["eq", "等价词"], ["cloze", "例句填空"]
  ];
  var ROUNDS = [10, 20, 30, 50];

  var $ = function (id) { return document.getElementById(id); };
  var touched = false; // true once this page has changed any progress
  var state = loadState();
  var activeModule = DATA.modules[0].id;
  var session = null;
  var lastScope = null;
  var listCtx = null;
  var entryCache = {};

  // ====================================================================
  // storage
  // Progress lives only in this browser. Every answer is written straight
  // away, the previous good copy is kept under a second key, and a record
  // that fails to parse is set aside instead of being overwritten.
  // ====================================================================
  function blank() {
    return { version: 1, words: {}, q: {}, keys: {}, sessions: [], daily: {}, settings: { mode: "mix", round: 20 }, savedAt: null };
  }

  function clampInt(v, lo, hi) {
    v = Math.round(Number(v) || 0);
    return Math.min(hi, Math.max(lo, v));
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object" || !raw.words || typeof raw.words !== "object") return null;
    var s = blank();
    Object.keys(raw.words).forEach(function (id) {
      var w = raw.words[id];
      if (!w || typeof w !== "object") return;
      s.words[id] = {
        box: clampInt(w.box, 0, INTERVAL_DAYS.length - 1),
        due: Number(w.due) || 0,
        seen: Math.max(0, Number(w.seen) || 0),
        right: Math.max(0, Number(w.right) || 0),
        wrong: Math.max(0, Number(w.wrong) || 0),
        lastWrong: !!w.lastWrong,
        last: Number(w.last) || 0,
        m: !!w.m // marked mastered by hand
      };
    });
    if (raw.q && typeof raw.q === "object") {
      Object.keys(raw.q).forEach(function (id) {
        var r = raw.q[id];
        if (!r || typeof r !== "object") return;
        s.q[id] = {
          n: Math.max(0, Number(r.n) || 0), right: Math.max(0, Number(r.right) || 0),
          lastWrong: !!r.lastWrong, last: Number(r.last) || 0,
          pick: typeof r.pick === "string" ? r.pick.slice(0, 12) : "", ok: !!r.ok
        };
      });
    }
    if (raw.keys && typeof raw.keys === "object") {
      Object.keys(raw.keys).forEach(function (id) {
        if (typeof raw.keys[id] === "string" && /^[A-I]{1,3}$/.test(raw.keys[id])) s.keys[id] = raw.keys[id];
      });
    }
    s.sessions = Array.isArray(raw.sessions) ? raw.sessions.slice(-200) : [];
    if (raw.daily && typeof raw.daily === "object") {
      Object.keys(raw.daily).slice(-400).forEach(function (d) {
        var v = raw.daily[d];
        if (v && typeof v === "object") s.daily[d] = { n: Math.max(0, Number(v.n) || 0), ok: Math.max(0, Number(v.ok) || 0) };
      });
    }
    if (raw.settings && typeof raw.settings === "object") {
      if (MODES.some(function (m) { return m[0] === raw.settings.mode; })) s.settings.mode = raw.settings.mode;
      if (ROUNDS.indexOf(Number(raw.settings.round)) >= 0) s.settings.round = Number(raw.settings.round);
    }
    s.savedAt = raw.savedAt || null;
    return s;
  }

  function isValidRecord(text) {
    try { return !!normalize(JSON.parse(text)); } catch (e) { return false; }
  }

  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return blank(); }
    if (raw) {
      try {
        var parsed = normalize(JSON.parse(raw));
        if (parsed) return parsed;
      } catch (e) { /* fall through */ }
      try { localStorage.setItem(KEY + "-corrupt-" + Date.now(), raw); } catch (e) { /* ignore */ }
    }
    try {
      var prev = localStorage.getItem(BACKUP_KEY);
      if (prev) {
        var recovered = normalize(JSON.parse(prev));
        if (recovered) return recovered;
      }
    } catch (e) { /* ignore */ }
    return blank();
  }

  function save() {
    state.savedAt = new Date().toISOString();
    var ok = true;
    try {
      var current = localStorage.getItem(KEY);
      if (current && isValidRecord(current)) localStorage.setItem(BACKUP_KEY, current);
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) { ok = false; }
    renderSaveStatus(ok);
  }

  function saveNow() { touched = true; save(); }

  function renderSaveStatus(ok) {
    var el = $("saveStatus");
    el.className = "save" + (ok ? "" : " err");
    el.textContent = ok
      ? "已自动保存 · 学过 " + Object.keys(state.words).length + " 词"
      : "⚠ 无法写入浏览器存储，请先导出备份";
  }

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function () {});
  }

  // ====================================================================
  // helpers
  // ====================================================================
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function pickOne(a) { return a[Math.floor(Math.random() * a.length)]; }

  function moduleById(id) {
    return DATA.modules.filter(function (m) { return m.id === id; })[0];
  }

  function entriesOf(module) {
    if (!entryCache[module.id]) {
      var out = [];
      module.sections.forEach(function (sec, si) {
        sec.entries.forEach(function (e) {
          out.push({ key: module.id + ":" + e.id, e: e, si: si, mod: module });
        });
      });
      entryCache[module.id] = out;
    }
    return entryCache[module.id];
  }

  function isMastered(rec) {
    return !!rec && (!!rec.m || (rec.seen > 0 && rec.box >= MASTERED_BOX && !rec.lastWrong));
  }

  function statusOf(rec, now) {
    if (isMastered(rec)) return "mastered";
    if (!rec || !rec.seen) return "new";
    if (rec.lastWrong) return "wrong";
    if (rec.due <= now) return "due";
    return "learning";
  }

  var STATUS_TEXT = { "new": "未学", learning: "学习中", due: "待复习", wrong: "错题", mastered: "已掌握" };

  function dayKey(t) {
    var d = new Date(t);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function tally(module) {
    var now = Date.now();
    var total = { total: 0, seen: 0, mastered: 0, due: 0, wrong: 0 };
    var per = module.sections.map(function () { return { total: 0, seen: 0, mastered: 0, due: 0, wrong: 0 }; });
    entriesOf(module).forEach(function (it) {
      var rec = state.words[it.key];
      [total, per[it.si]].forEach(function (c) {
        c.total += 1;
        if (isMastered(rec)) c.mastered += 1;
        if (!rec || !rec.seen) return;
        c.seen += 1;
        if (rec.due <= now && !rec.lastWrong) c.due += 1;
        if (rec.lastWrong) c.wrong += 1;
      });
    });
    return { total: total, per: per };
  }

  function show(view) {
    Array.prototype.forEach.call(document.querySelectorAll("main > section"), function (sec) { sec.hidden = sec.id !== view; });
    document.querySelectorAll("#topNav button").forEach(function (b) {
      var vocabViews = ["homeView", "listView", "quizView", "summaryView"];
      b.classList.toggle("on", b.dataset.area === (vocabViews.indexOf(view) >= 0 ? "vocab" : "exam"));
    });
    window.scrollTo(0, 0);
  }

  // ====================================================================
  // home
  // ====================================================================
  function renderSeg(container, options, current, onPick) {
    container.textContent = "";
    options.forEach(function (o) {
      var b = el("button", null, o[1]);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(o[0] === current));
      b.onclick = function () { onPick(o[0]); };
      container.appendChild(b);
    });
  }

  function renderHome() {
    show("homeView");
    var module = moduleById(activeModule);
    var t = tally(module);
    var c = t.total;

    var tabs = $("moduleTabs");
    tabs.textContent = "";
    DATA.modules.forEach(function (m) {
      var mt = m.id === module.id ? c : tally(m).total;
      var b = el("button", m.id === module.id ? "active" : "");
      b.appendChild(el("b", null, m.name));
      b.appendChild(el("span", null, "已学 " + mt.seen + " / " + mt.total + " · 已掌握 " + mt.mastered));
      b.onclick = function () { activeModule = m.id; renderHome(); };
      tabs.appendChild(b);
    });

    renderOverview(c);

    $("btnSmart").textContent = c.seen === 0 ? "开始学习" : "继续学习";
    $("btnDue").textContent = "复习到期（" + c.due + "）";
    $("btnDue").disabled = c.due === 0;
    $("btnWrong").textContent = "错题本（" + c.wrong + "）";
    $("btnWrong").disabled = c.wrong === 0;

    var modeOptions = MODES.filter(function (m) {
      return m[0] === "mix" || m[0] === "en2zh" || m[0] === "zh2en" ||
        (m[0] === "eq" && moduleHas(module, "eq")) || (m[0] === "cloze" && moduleHas(module, "ex"));
    });
    if (!modeOptions.some(function (m) { return m[0] === state.settings.mode; })) {
      state.settings.mode = "mix";
    }
    renderSeg($("modeSeg"), modeOptions, state.settings.mode, function (v) { state.settings.mode = v; saveNow(); renderHome(); });
    renderSeg($("roundSeg"), ROUNDS.map(function (n) { return [n, n + " 词"]; }), state.settings.round,
      function (v) { state.settings.round = v; saveNow(); renderHome(); });

    var list = $("groupList");
    list.textContent = "";
    module.sections.forEach(function (sec, si) {
      var sc = t.per[si];
      var card = el("div", "card group");
      card.appendChild(el("div", "name", sec.name));
      var meta = el("div", "meta", "已学 " + sc.seen + "/" + sc.total + " · 已掌握 " + sc.mastered);
      if (sc.due) { meta.appendChild(document.createTextNode(" · ")); meta.appendChild(el("span", "due", "待复习 " + sc.due)); }
      if (sc.wrong) meta.appendChild(document.createTextNode(" · 错题 " + sc.wrong));
      card.appendChild(meta);
      var bar = el("div", "progress");
      var fill = el("i");
      fill.style.width = (sc.total ? Math.round(sc.seen / sc.total * 100) : 0) + "%";
      bar.appendChild(fill);
      card.appendChild(bar);
      var btns = el("div", "btns");
      var go = el("button", "btn primary", "练习");
      go.onclick = function () { startSession({ kind: "section", section: si }); };
      var look = el("button", "btn", "词表");
      look.onclick = function () { openList({ moduleId: module.id, section: si }); };
      btns.appendChild(go); btns.appendChild(look);
      card.appendChild(btns);
      list.appendChild(card);
    });
    renderSaveStatus(true);
  }

  function moduleHas(module, field) {
    return entriesOf(module).some(function (it) { return it.e[field] && it.e[field].length; });
  }

  function renderOverview(c) {
    var box = $("overview");
    box.textContent = "";
    var pct = c.total ? c.mastered / c.total : 0;
    var ring = el("div", "ring");
    var R = 46, L = 2 * Math.PI * R;
    ring.innerHTML = '<svg viewBox="0 0 112 112"><circle class="bg" cx="56" cy="56" r="' + R + '" fill="none" stroke-width="10"/>' +
      '<circle class="fg" cx="56" cy="56" r="' + R + '" fill="none" stroke-width="10"' + (pct > 0 ? "" : ' stroke-opacity="0"') + ' stroke-dasharray="' + (pct * L).toFixed(1) + " " + L.toFixed(1) + '"/></svg>';
    var mid = el("div", "mid");
    var inner = el("div");
    inner.appendChild(el("b", null, Math.round(pct * 100) + "%"));
    inner.appendChild(el("span", null, "已掌握"));
    mid.appendChild(inner);
    ring.appendChild(mid);
    box.appendChild(ring);

    var side = el("div", "side");
    var nums = el("div", "nums");
    [["已掌握", c.mastered + "/" + c.total, ""], ["学过", c.seen, ""], ["待复习", c.due, "due"], ["错题", c.wrong, "wrong"]]
      .forEach(function (n) {
        var d = el("div", n[2]);
        d.appendChild(el("b", null, String(n[1])));
        d.appendChild(el("span", null, n[0]));
        nums.appendChild(d);
      });
    side.appendChild(nums);

    var week = el("div", "week");
    var days = [], max = 1;
    for (var i = 6; i >= 0; i -= 1) {
      var key = dayKey(Date.now() - i * DAY);
      var n = (state.daily[key] && state.daily[key].n) || 0;
      days.push({ key: key, n: n, today: i === 0 });
      max = Math.max(max, n);
    }
    days.forEach(function (d) {
      var col = el("div", d.today ? "today" : "");
      var bar = el("i");
      bar.style.height = Math.max(2, Math.round(d.n / max * 30)) + "px";
      bar.title = d.key + "：" + d.n + " 题";
      col.appendChild(bar);
      col.appendChild(el("span", null, d.key.slice(8)));
      week.appendChild(col);
    });
    side.appendChild(week);
    var today = state.daily[dayKey(Date.now())] || { n: 0, ok: 0 };
    side.appendChild(el("div", "weekcap", "今天已答 " + today.n + " 题" + (today.n ? "，答对 " + today.ok + " 题" : "") + "（近 7 天）"));
    box.appendChild(side);
  }

  // ====================================================================
  // word list
  // ====================================================================
  var FILTERS = [["all", "全部"], ["unmastered", "未掌握"], ["new", "未学"], ["learning", "学习中"], ["due", "待复习"], ["wrong", "错题"], ["mastered", "已掌握"]];

  function openList(ctx) {
    listCtx = { moduleId: ctx.moduleId, section: ctx.section == null ? null : ctx.section, filter: ctx.filter || "all", q: "", limit: LIST_PAGE };
    $("listSearch").value = "";
    renderList();
    show("listView");
  }

  // Hand-marked mastery. Unmarking a word that was never practised removes its record.
  function setMastered(key, on) {
    var w = state.words[key] || { box: 0, due: 0, seen: 0, right: 0, wrong: 0, lastWrong: false, last: 0, m: false };
    w.m = on;
    if (on || w.seen) state.words[key] = w; else delete state.words[key];
    saveNow();
  }

  function listItems() {
    var module = moduleById(listCtx.moduleId);
    var now = Date.now();
    var q = listCtx.q.trim().toLowerCase();
    return entriesOf(module).filter(function (it) {
      if (listCtx.section != null && it.si !== listCtx.section) return false;
      var st = statusOf(state.words[it.key], now);
      if (listCtx.filter === "unmastered" ? st === "mastered" : listCtx.filter !== "all" && st !== listCtx.filter) return false;
      if (q && it.e.en.toLowerCase().indexOf(q) < 0 && it.e.zh.indexOf(q) < 0) return false;
      return true;
    });
  }

  function renderList() {
    var module = moduleById(listCtx.moduleId);
    $("listTitle").textContent = module.name + (listCtx.section != null ? " · " + module.sections[listCtx.section].name : " · 全部词表");

    var fb = $("listFilters");
    fb.textContent = "";
    FILTERS.forEach(function (f) {
      var b = el("button", listCtx.filter === f[0] ? "on" : "", f[1]);
      b.onclick = function () { listCtx.filter = f[0]; listCtx.limit = LIST_PAGE; renderList(); };
      fb.appendChild(b);
    });

    var items = listItems();
    var acts = $("listActions");
    acts.textContent = "";
    acts.appendChild(el("span", "muted", "共 " + items.length + " 词"));
    if (items.length) {
      var scope = listCtx.filter === "wrong" ? { kind: "wrong", section: listCtx.section } : { kind: "section", section: listCtx.section };
      if (listCtx.section != null || listCtx.filter === "wrong") {
        var go = el("button", "btn primary", listCtx.filter === "wrong" ? "练习这些错题" : "练习这一组");
        go.onclick = function () { activeModule = listCtx.moduleId; startSession(scope); };
        acts.appendChild(go);
      }
    }

    var rows = $("listRows");
    rows.textContent = "";
    var now = Date.now();
    items.slice(0, listCtx.limit).forEach(function (it) {
      var st = statusOf(state.words[it.key], now);
      var card = el("div", "card wrow");
      var line = el("div", "line");
      var name = el("div");
      var en = el("span", "en", it.e.en);
      name.appendChild(en);
      if (it.e.ipa) name.appendChild(el("span", "ipa", it.e.ipa));
      line.appendChild(name);
      line.appendChild(el("span", "chip " + st, STATUS_TEXT[st]));
      card.appendChild(line);
      card.appendChild(el("div", "zh", it.e.zh));
      var mark = el("button", "btn small mark", st === "mastered" ? "撤销已掌握" : "标为已掌握");
      mark.onclick = function (e) { e.stopPropagation(); setMastered(it.key, st !== "mastered"); renderList(); };
      card.appendChild(mark);
      var more = el("div", "detail");
      more.hidden = true;
      fillDetail(more, it.e, false);
      card.appendChild(more);
      card.onclick = function () { more.hidden = !more.hidden; };
      rows.appendChild(card);
    });
    if (!items.length) rows.appendChild(el("p", "muted", "没有符合条件的词。"));
    $("listMore").hidden = items.length <= listCtx.limit;
  }

  // ====================================================================
  // questions
  // ====================================================================
  function stemRegex(word) {
    var w = word.trim();
    if (!/^[A-Za-z][A-Za-z\-' ]*$/.test(w)) return null;
    var stem = w.length > 5 ? w.slice(0, w.length - 2) : w;
    var esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("\\b" + esc + "[a-z]*", "i");
  }

  function applicableTypes(it) {
    var t = ["en2zh", "zh2en"];
    if (it.e.eq && it.e.eq.length) t.push("eq");
    if (it.e.ex) {
      var re = stemRegex(it.e.en);
      if (re && re.test(it.e.ex)) t.push("cloze");
    }
    return t;
  }

  // Candidate distractors, most plausible first: same group & part of speech, then same
  // part of speech, then anything else.
  function choosePool(module, it, field) {
    var pos = it.e.pos, near = [], mid = [], rest = [];
    entriesOf(module).forEach(function (o) {
      if (o.key === it.key || o.e[field] === it.e[field]) return;
      var samePos = !pos || o.e.pos === pos;
      if (samePos && o.si === it.si) near.push(o);
      else if (samePos) mid.push(o);
      else rest.push(o);
    });
    return shuffle(near).concat(shuffle(mid).slice(0, 80), shuffle(rest).slice(0, 80));
  }

  function distractors(module, it, field, count) {
    var seen = {};
    seen[it.e[field]] = true;
    var out = [];
    choosePool(module, it, field).some(function (o) {
      var v = o.e[field];
      if (!seen[v]) { seen[v] = true; out.push(v); }
      return out.length >= count;
    });
    return out;
  }

  function buildQuestion(module, it, mode) {
    var types = applicableTypes(it);
    var type = mode === "mix" ? pickOne(types) : (types.indexOf(mode) >= 0 ? mode : "en2zh");
    var q = { type: type, item: it };
    if (type === "en2zh") {
      q.label = "选出正确的中文释义";
      q.prompt = it.e.en;
      q.sub = it.e.ipa || "";
      q.correct = it.e.zh;
      q.options = shuffle(distractors(module, it, "zh", 3).concat([it.e.zh]));
    } else if (type === "zh2en") {
      q.label = "选出对应的英文单词";
      q.prompt = it.e.zh;
      q.sub = it.e.pos ? "词性：" + it.e.pos + "." : "";
      q.correct = it.e.en;
      q.options = shuffle(distractors(module, it, "en", 3).concat([it.e.en]));
    } else if (type === "eq") {
      var own = {};
      it.e.eq.forEach(function (w) { own[w.toLowerCase()] = true; });
      own[it.e.en.toLowerCase()] = true;
      var correct = pickOne(it.e.eq);
      var pool = [];
      shuffle(entriesOf(module)).some(function (o) {
        if (o.key === it.key || !o.e.eq) return false;
        o.e.eq.forEach(function (w) { if (!own[w.toLowerCase()] && pool.indexOf(w) < 0) pool.push(w); });
        return pool.length >= 30;
      });
      q.label = "选出它的等价词（六选二同义词）";
      q.prompt = it.e.en;
      q.sub = it.e.zh;
      q.correct = correct;
      q.options = shuffle(shuffle(pool).slice(0, 3).concat([correct]));
    } else {
      var re = stemRegex(it.e.en);
      q.label = "选出最适合填入空白处的单词";
      q.sentence = it.e.ex.replace(new RegExp(re.source, "gi"), "\u0000");
      q.sub = it.e.zh;
      q.correct = it.e.en;
      q.options = shuffle(distractors(module, it, "en", 3).concat([it.e.en]));
    }
    return q;
  }

  // ====================================================================
  // sessions
  // ====================================================================
  function pickWords(module, scope) {
    var now = Date.now(), round = state.settings.round;
    var items = entriesOf(module);
    if (scope.kind === "section" && scope.section != null) items = items.filter(function (it) { return it.si === scope.section; });
    if (scope.kind === "wrong" && scope.section != null) items = items.filter(function (it) { return it.si === scope.section; });
    var rec = function (it) { return state.words[it.key]; };
    var learned = function (it) { return rec(it) && rec(it).seen; };

    if (scope.kind === "wrong") {
      return shuffle(items.filter(function (it) { return learned(it) && rec(it).lastWrong; })).slice(0, round);
    }
    var due = items.filter(function (it) { return learned(it) && rec(it).due <= now; })
      .sort(function (a, b) { return rec(a).due - rec(b).due; });
    if (scope.kind === "due") {
      return shuffle(due.filter(function (it) { return !rec(it).lastWrong; }).slice(0, round));
    }

    var fresh = items.filter(function (it) { return !learned(it); });
    var picked = due.slice(0, Math.ceil(round / 2));
    picked = picked.concat(fresh.slice(0, round - picked.length));
    if (picked.length < round) {
      picked = picked.concat(due.slice(picked.length > 0 ? Math.ceil(round / 2) : 0, round));
    }
    picked = picked.slice(0, round);
    if (picked.length === 0) {
      picked = items.slice().sort(function (a, b) { return rec(a).box - rec(b).box; }).slice(0, round);
    }
    return shuffle(picked);
  }

  function startSession(scope) {
    var module = moduleById(activeModule);
    var words = pickWords(module, scope);
    if (!words.length) return;
    lastScope = scope;
    session = {
      moduleId: module.id, scope: scope, mode: state.settings.mode,
      queue: words.slice(), total: words.length,
      first: {}, attempted: {}, correct: 0, current: null, answered: false,
      history: [], pos: -1, timer: null
    };
    show("quizView");
    nextQuestion();
  }

  // Questions already shown in this round stay in history, so 上一题 can go back to them.
  function nextQuestion() {
    cancelAutoNext();
    if (session.pos < session.history.length - 1) return showAt(session.pos + 1);
    if (!session.queue.length) return finishSession();
    var module = moduleById(session.moduleId);
    var it = session.queue.shift();
    session.history.push({ item: it, q: buildQuestion(module, it, session.mode), index: null });
    showAt(session.history.length - 1);
  }

  function prevQuestion() {
    cancelAutoNext();
    if (session.pos > 0) showAt(session.pos - 1);
  }

  function cancelAutoNext() {
    if (session && session.timer) { clearTimeout(session.timer); session.timer = null; }
  }

  function showAt(p) {
    session.pos = p;
    var entry = session.history[p];
    session.current = entry.q;
    session.answered = entry.index != null;
    window.scrollTo(0, 0);
    var q = session.current;

    var done = Object.keys(session.attempted).length;
    $("qCount").textContent = Math.min(p + 1, session.total) + " / " + session.total;
    $("qBar").style.width = Math.round(done / session.total * 100) + "%";
    $("qType").textContent = q.label;

    var prompt = $("prompt");
    prompt.textContent = "";
    if (q.sentence != null) {
      prompt.className = "prompt sentence";
      var parts = q.sentence.split("\u0000");
      prompt.appendChild(document.createTextNode(parts[0]));
      prompt.appendChild(el("span", "blank", " "));
      prompt.appendChild(document.createTextNode(parts.slice(1).join(" ___ ")));
    } else {
      prompt.className = "prompt";
      prompt.textContent = q.prompt;
    }
    $("promptSub").textContent = q.sub || "";

    var box = $("options");
    box.textContent = "";
    q.options.forEach(function (text, i) {
      var b = el("button", "opt");
      b.type = "button";
      b.appendChild(el("span", "k", String(i + 1)));
      b.appendChild(el("span", null, text));
      b.onclick = function () { answer(i); };
      box.appendChild(b);
    });
    $("feedback").textContent = "";
    $("feedback").className = "feedback";
    $("detail").hidden = true;
    $("btnNext").hidden = true;
    $("btnPrev").disabled = p === 0;
    if (entry.index != null) showResult(entry.index); // already answered: show it again, record nothing
  }

  function fillDetail(box, e, highlight) {
    box.textContent = "";
    var head = el("div", "dw", e.en);
    if (e.ipa) head.appendChild(el("span", null, e.ipa));
    box.appendChild(head);
    box.appendChild(el("p", null, e.zh));
    if (e.def) box.appendChild(el("p", "ex", e.def));
    if (e.eq && e.eq.length) box.appendChild(el("p", null, "等价词：" + e.eq.join(", ")));
    if (e.ex) {
      var p = el("p", "ex");
      var re = highlight ? stemRegex(e.en) : null;
      var m = re && re.exec(e.ex);
      if (m) {
        p.appendChild(document.createTextNode(e.ex.slice(0, m.index)));
        p.appendChild(el("mark", null, m[0]));
        p.appendChild(document.createTextNode(e.ex.slice(m.index + m[0].length)));
      } else {
        p.textContent = e.ex;
      }
      box.appendChild(p);
      if (e.exzh) box.appendChild(el("p", "ex", e.exzh));
    }
  }

  function showResult(index) {
    var q = session.current, it = q.item;
    var ok = q.options[index] === q.correct;
    var buttons = $("options").children;
    for (var i = 0; i < buttons.length; i += 1) {
      if (q.options[i] === q.correct) buttons[i].classList.add("right");
      else if (i === index) buttons[i].classList.add("wrong");
      buttons[i].disabled = true;
    }
    var fb = $("feedback");
    fb.className = "feedback " + (ok ? "good" : "bad");
    fb.textContent = ok ? "✓ 正确" : "✗ 答错了";
    var detail = $("detail");
    fillDetail(detail, it.e, true);
    detail.hidden = false;
    $("btnNext").hidden = false;
  }

  function answer(index) {
    if (!session || session.answered) return;
    session.answered = true;
    var entry = session.history[session.pos], q = session.current, it = q.item;
    var ok = q.options[index] === q.correct;
    entry.index = index;
    showResult(index);

    if (!session.attempted[it.key]) {
      session.attempted[it.key] = true;
      session.first[it.key] = ok;
      if (ok) session.correct += 1;
      record(it.key, ok);
    }
    if (!ok) session.queue.push(it); // see it again later in this round
    if (ok) {
      // Right answers move on by themselves after a short pause to read the explanation.
      var at = session.pos;
      session.timer = setTimeout(function () {
        session.timer = null;
        if (session && session.pos === at) nextQuestion();
      }, 1200);
    } else {
      $("btnNext").focus();
    }
  }

  function record(key, ok) {
    var now = Date.now();
    var w = state.words[key] || { box: 0, due: 0, seen: 0, right: 0, wrong: 0, lastWrong: false, last: 0 };
    w.seen += 1;
    w.last = now;
    if (ok) {
      w.right += 1;
      w.box = Math.min(w.box + 1, INTERVAL_DAYS.length - 1);
      w.lastWrong = false;
    } else {
      w.wrong += 1;
      w.box = 0;
      w.lastWrong = true;
    }
    w.due = now + INTERVAL_DAYS[w.box] * DAY;
    state.words[key] = w;
    var d = dayKey(now);
    var day = state.daily[d] || (state.daily[d] = { n: 0, ok: 0 });
    day.n += 1;
    if (ok) day.ok += 1;
    saveNow();
  }

  function finishSession() {
    var module = moduleById(session.moduleId);
    state.sessions.push({ date: Date.now(), moduleId: module.id, total: session.total, correct: session.correct });
    saveNow();

    var box = $("summary");
    box.textContent = "";
    box.appendChild(el("h2", null, "本轮完成"));
    [["本轮词数", session.total], ["一次答对", session.correct],
     ["正确率", Math.round(session.correct / session.total * 100) + "%"]].forEach(function (r) {
      var line = el("div", "sumline");
      line.appendChild(el("span", null, r[0]));
      line.appendChild(el("b", null, String(r[1])));
      box.appendChild(line);
    });
    var wrongKeys = Object.keys(session.first).filter(function (k) { return !session.first[k]; });
    if (wrongKeys.length) {
      var byKey = {};
      entriesOf(module).forEach(function (it) { byKey[it.key] = it; });
      box.appendChild(el("p", "muted", "这几个词答错了，已加入错题本："));
      var ul = el("ul", "wronglist");
      wrongKeys.forEach(function (k) { ul.appendChild(el("li", null, byKey[k].e.en + " — " + byKey[k].e.zh)); });
      box.appendChild(ul);
    }
    session = null;
    show("summaryView");
  }

  // ====================================================================
  // backup
  // ====================================================================
  function exportBackup() {
    saveNow();
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gre-vocab-backup-" + dayKey(Date.now()).replace(/-/g, "") + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    $("backupMsg").textContent = "已导出备份文件。";
  }

  // Importing merges instead of replacing: for each word the record with more attempts wins.
  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var incoming = normalize(JSON.parse(reader.result));
        if (!incoming) throw new Error("bad format");
        var updated = 0;
        Object.keys(incoming.words).forEach(function (id) {
          var mine = state.words[id], theirs = incoming.words[id];
          if (!mine || theirs.seen > mine.seen || (theirs.seen === mine.seen && theirs.last > mine.last)) {
            state.words[id] = theirs;
            updated += 1;
          }
        });
        Object.keys(incoming.q).forEach(function (id) {
          var mine = state.q[id], theirs = incoming.q[id];
          if (!mine || theirs.n > mine.n || (theirs.n === mine.n && theirs.last > mine.last)) { state.q[id] = theirs; updated += 1; }
        });
        Object.keys(incoming.keys).forEach(function (id) { if (!state.keys[id]) state.keys[id] = incoming.keys[id]; });
        Object.keys(incoming.daily).forEach(function (d) {
          var mine = state.daily[d];
          if (!mine || incoming.daily[d].n > mine.n) state.daily[d] = incoming.daily[d];
        });
        state.sessions = state.sessions.concat(incoming.sessions).slice(-200);
        saveNow();
        renderHome();
        $("backupMsg").textContent = "已导入，合并更新了 " + updated + " 个词的进度。";
      } catch (e) {
        $("backupMsg").textContent = "导入失败：这不是有效的备份文件。";
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!window.confirm("确定清空全部进度吗？建议先导出备份。此操作无法撤销。")) return;
    try { localStorage.setItem(KEY + "-before-reset-" + Date.now(), JSON.stringify(state)); } catch (e) { /* ignore */ }
    var settings = state.settings;
    state = blank();
    state.settings = settings;
    saveNow();
    renderHome();
  }

  // ====================================================================
  // wiring
  // ====================================================================
  $("btnSmart").onclick = function () { startSession({ kind: "section", section: null }); };
  $("btnDue").onclick = function () { startSession({ kind: "due" }); };
  $("btnWrong").onclick = function () { startSession({ kind: "wrong", section: null }); };
  $("btnBrowseAll").onclick = function () { openList({ moduleId: activeModule }); };
  $("btnNext").onclick = nextQuestion;
  $("btnPrev").onclick = prevQuestion;
  $("btnExit").onclick = function () { session = null; renderHome(); };
  $("btnHome").onclick = renderHome;
  $("btnAgain").onclick = function () { startSession(lastScope || { kind: "due" }); };
  $("listBack").onclick = renderHome;
  $("listMore").onclick = function () { listCtx.limit += LIST_PAGE; renderList(); };
  $("listSearch").oninput = function (e) { listCtx.q = e.target.value; listCtx.limit = LIST_PAGE; renderList(); };
  $("btnExport").onclick = exportBackup;
  $("btnImport").onclick = function () { $("fileImport").click(); };
  $("fileImport").onchange = function (e) {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = "";
  };
  $("btnReset").onclick = resetAll;

  document.addEventListener("keydown", function (e) {
    if ($("quizView").hidden || !session) return;
    if (e.key >= "1" && e.key <= "4" && !session.answered) {
      answer(Number(e.key) - 1);
    } else if (e.key === "Enter" && session.answered) {
      e.preventDefault();
      nextQuestion();
    }
  });
  function saveIfTouched() { if (touched) save(); }
  document.addEventListener("visibilitychange", function () { if (document.hidden) saveIfTouched(); });
  window.addEventListener("pagehide", saveIfTouched);

  window.GREApp = {
    get state() { return state; }, save: save, saveNow: saveNow, el: el, shuffle: shuffle, show: show,
    $: $, dayKey: dayKey, renderVocabHome: function () { renderHome(); }, renderSaveStatus: renderSaveStatus
  };
  document.querySelectorAll("#topNav button").forEach(function (b) {
    b.onclick = function () {
      if (b.dataset.area === "vocab") renderHome();
      else if (window.GREExam) window.GREExam.home();
    };
  });

  renderHome();
})();
