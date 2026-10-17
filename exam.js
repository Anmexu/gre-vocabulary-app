(function () {
  "use strict";

  var App = window.GREApp;
  var BANKS = window.GRE_Q || {};
  var $ = App.$, el = App.el, state = function () { return App.state; };
  var LETTERS = "ABCDEFGHI";
  var RANDOM_N = 10;
  var DIFF_TEXT = { easy: "简单", medium: "中等", hard: "困难" };
  var KIND_TEXT = {
    pick1: "单空 · 五选一", pick2: "单空 · 六选二", multi: "多空 · 每空选一个",
    single: "单选", any: "多选（选出所有正确项）", qc: "数量比较", num: "数值填空"
  };
  var QC_OPTS = ["A 比 B 大（Quantity A is greater）", "B 比 A 大（Quantity B is greater）", "两者相等（The two quantities are equal）", "无法判断（Cannot be determined）"];
  var DISCLAIMER = "答案为 AI 参考答案，不是官方答案，个别题可能有误。你可以在做完题后点“设定我的答案”改成自己认为对的。";

  var ctx = { bank: null, mode: "set", tab: 0 };
  var session = null;
  var index = null;

  // ---------- indexing ----------
  function buildIndex() {
    index = {};
    Object.keys(BANKS).forEach(function (bid) {
      BANKS[bid].sets.forEach(function (set, si) {
        set.questions.forEach(function (q) { index[q.id] = { q: q, set: set, bank: BANKS[bid], si: si }; });
      });
    });
  }

  function bankList() { return Object.keys(BANKS).map(function (k) { return BANKS[k]; }); }

  function effectiveKey(q) { return state().keys[q.id] || q.key; }

  function recOf(id) { return state().q[id]; }

  function kindOf(q) {
    if (q.kind === "multi") return q.groups.length >= 3 ? "multi3" : "multi2";
    return q.kind;
  }

  function bankStats(bank) {
    var s = { total: 0, done: 0, right: 0, wrong: 0 };
    bank.sets.forEach(function (set) {
      set.questions.forEach(function (q) {
        s.total += 1;
        var r = recOf(q.id);
        if (!r || !r.n) return;
        s.done += 1;
        if (r.ok) s.right += 1;
        if (r.lastWrong) s.wrong += 1;
      });
    });
    return s;
  }

  function setStats(set) {
    var s = { total: set.questions.length, done: 0, right: 0, wrong: 0 };
    set.questions.forEach(function (q) {
      var r = recOf(q.id);
      if (!r || !r.n) return;
      s.done += 1;
      if (r.ok) s.right += 1;
      if (r.lastWrong) s.wrong += 1;
    });
    return s;
  }

  // ---------- grading ----------
  function normalizePick(q, pick) {
    var k = q.kind;
    if (k === "pick2" || k === "any") return pick.split("").sort().join("");
    return pick;
  }

  function isCorrect(q, pick) {
    if (q.kind === "num") return numEqual(pick, effectiveKey(q));
    return normalizePick(q, pick) === normalizePick(q, effectiveKey(q));
  }

  function parseNum(t) {
    t = String(t).trim().replace(/,/g, "").replace(/\s+/g, "");
    var m = /^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(t);
    if (m) return Number(m[1]) / Number(m[2]);
    t = t.replace(/%$/, "");
    return /^-?\d*\.?\d+$/.test(t) ? Number(t) : NaN;
  }

  function numEqual(a, key) {
    var x = parseNum(a);
    return String(key).split("|").some(function (k) {
      var y = parseNum(k);
      return !isNaN(x) && !isNaN(y) && Math.abs(x - y) < 1e-6 * Math.max(1, Math.abs(y));
    });
  }

  // ---------- home ----------
  function home() {
    if (!bankList().length) return;
    if (!ctx.bank || !BANKS[ctx.bank]) ctx.bank = bankList()[0].id;
    renderHome();
  }

  function renderHome() {
    App.show("examHome");
    var bank = BANKS[ctx.bank];

    var tabs = $("bankTabs");
    tabs.textContent = "";
    bankList().forEach(function (b) {
      var st = bankStats(b);
      var btn = el("button", b.id === ctx.bank ? "active" : "");
      btn.appendChild(el("b", null, b.name));
      btn.appendChild(el("span", null, st.done + " / " + st.total + " 已做"));
      btn.onclick = function () { ctx.bank = b.id; ctx.tab = 0; renderHome(); };
      tabs.appendChild(btn);
    });

    var st = bankStats(bank);
    var box = $("examOverview");
    box.textContent = "";
    var nums = el("div", "nums wide");
    [["已做", st.done + "/" + st.total, ""], ["最近一次答对", st.right, ""], ["正确率", st.done ? Math.round(st.right / st.done * 100) + "%" : "--", ""], ["错题", st.wrong, "wrong"]]
      .forEach(function (n) {
        var d = el("div", n[2]);
        d.appendChild(el("b", null, String(n[1])));
        d.appendChild(el("span", null, n[0]));
        nums.appendChild(d);
      });
    box.appendChild(nums);
    var bar = el("div", "progress thick");
    var fill = el("i");
    fill.style.width = (st.total ? Math.round(st.done / st.total * 100) : 0) + "%";
    bar.appendChild(fill);
    box.appendChild(bar);
    if (bank.official === false) box.appendChild(el("p", "notice", DISCLAIMER));

    var next = nextUnfinishedSet(bank);
    var cont = $("btnExamContinue");
    cont.textContent = next ? "继续：" + next.title : "全部做完了 🎉";
    cont.disabled = !next;
    cont.onclick = function () { if (next) startSet(bank, next); };
    var wb = $("btnExamWrong");
    wb.textContent = "错题本（" + st.wrong + "）";
    wb.disabled = st.wrong === 0;
    wb.onclick = renderWrong;

    var modes = [["set", "按套卷"], ["type", "按题型"], ["diff", "按难度"]];
    var seg = $("examModes");
    seg.textContent = "";
    modes.forEach(function (m) {
      var b = el("button", null, m[1]);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(m[0] === ctx.mode));
      b.onclick = function () { ctx.mode = m[0]; renderHome(); };
      seg.appendChild(b);
    });

    var body = $("examBody");
    body.textContent = "";
    if (ctx.mode === "set") renderSets(body, bank);
    else if (ctx.mode === "type") renderTypes(body, bank);
    else renderDiffs(body, bank);
  }

  function nextUnfinishedSet(bank) {
    for (var i = 0; i < bank.sets.length; i += 1) {
      if (setStats(bank.sets[i]).done < bank.sets[i].questions.length) return bank.sets[i];
    }
    return null;
  }

  function renderSets(body, bank) {
    var groups = [], byName = {};
    bank.sets.forEach(function (set) {
      var g = set.group || "全部";
      if (!byName[g]) { byName[g] = { name: g, sets: [] }; groups.push(byName[g]); }
      byName[g].sets.push(set);
    });
    var picker = el("div", "chips");
    var diffs = [["all", "全部难度"], ["easy", "简单"], ["medium", "中等"], ["hard", "困难"], ["todo", "未做完"], ["wrong", "有错题"]];
    var cur = ctx.setFilter || "all";
    diffs.forEach(function (d) {
      var b = el("button", cur === d[0] ? "on" : "", d[1]);
      b.onclick = function () { ctx.setFilter = d[0]; renderHome(); };
      picker.appendChild(b);
    });
    body.appendChild(picker);

    groups.forEach(function (g) {
      var sets = g.sets.filter(function (set) {
        var s = setStats(set);
        if (cur === "easy" || cur === "medium" || cur === "hard") return set.difficulty === cur;
        if (cur === "todo") return s.done < s.total;
        if (cur === "wrong") return s.wrong > 0;
        return true;
      });
      if (!sets.length) return;
      var gs = g.sets.reduce(function (a, set) { var s = setStats(set); return a + s.done; }, 0);
      var gt = g.sets.reduce(function (a, set) { return a + set.questions.length; }, 0);
      var det = el("details", "setgroup");
      if (ctx.openGroup === g.name || (ctx.openGroup == null && g === groups[0])) det.open = true;
      var sum = el("summary", null, g.name + "  ·  " + gs + "/" + gt);
      det.appendChild(sum);
      det.addEventListener("toggle", function () { if (det.open) ctx.openGroup = g.name; });
      var grid = el("div", "setgrid");
      sets.forEach(function (set) {
        var s = setStats(set);
        var card = el("button", "setcard" + (s.done === s.total ? " done" : ""));
        card.appendChild(el("div", "t", set.title));
        var meta = el("div", "m");
        if (set.difficulty) meta.appendChild(el("span", "chip d-" + set.difficulty, DIFF_TEXT[set.difficulty] || set.difficulty));
        meta.appendChild(el("span", null, s.done ? s.right + "/" + s.total + " 对" : s.total + " 题"));
        if (s.wrong) meta.appendChild(el("span", "bad", "错 " + s.wrong));
        card.appendChild(meta);
        card.onclick = function () { startSet(bank, set); };
        grid.appendChild(card);
      });
      det.appendChild(grid);
      body.appendChild(det);
    });
  }

  function allQuestions(bank) {
    var out = [];
    bank.sets.forEach(function (set) { set.questions.forEach(function (q) { out.push({ q: q, set: set }); }); });
    return out;
  }

  function poolCard(body, title, desc, items, bank) {
    var card = el("div", "card poolcard");
    var info = el("div", "info");
    info.appendChild(el("div", "name", title));
    var done = items.filter(function (it) { var r = recOf(it.q.id); return r && r.n; }).length;
    var wrong = items.filter(function (it) { var r = recOf(it.q.id); return r && r.lastWrong; }).length;
    info.appendChild(el("div", "meta", desc + " · 共 " + items.length + " 题，已做 " + done + (wrong ? "，错 " + wrong : "")));
    var bar = el("div", "progress");
    var fill = el("i");
    fill.style.width = (items.length ? Math.round(done / items.length * 100) : 0) + "%";
    bar.appendChild(fill);
    info.appendChild(bar);
    card.appendChild(info);
    var go = el("button", "btn primary", "随机 " + RANDOM_N + " 题");
    go.onclick = function () { startRandom(bank, items, title); };
    card.appendChild(go);
    body.appendChild(card);
  }

  function renderTypes(body, bank) {
    var all = allQuestions(bank), groups = {}, order = [];
    all.forEach(function (it) {
      var k = kindOf(it.q);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(it);
    });
    var names = { pick1: "单空 · 五选一", pick2: "单空 · 六选二", multi2: "两空题", multi3: "三空题", single: "单选", any: "多选", qc: "数量比较", num: "数值填空" };
    order.forEach(function (k) { poolCard(body, names[k] || k, "", groups[k], bank); });
  }

  function renderDiffs(body, bank) {
    var all = allQuestions(bank), groups = { easy: [], medium: [], hard: [] };
    all.forEach(function (it) { if (groups[it.set.difficulty]) groups[it.set.difficulty].push(it); });
    ["easy", "medium", "hard"].forEach(function (d) { if (groups[d].length) poolCard(body, DIFF_TEXT[d], "", groups[d], bank); });
  }

  // ---------- sessions ----------
  function startSet(bank, set) {
    begin({ title: set.title, bank: bank, set: set, ids: set.questions.map(function (q) { return q.id; }), kind: "set" });
  }

  function startRandom(bank, items, title) {
    // unseen first, then last-wrong, then the rest; each tier shuffled
    var tiers = [[], [], []];
    items.forEach(function (it) {
      var r = recOf(it.q.id);
      tiers[!r || !r.n ? 0 : r.lastWrong ? 1 : 2].push(it.q.id);
    });
    var ids = App.shuffle(tiers[0]).concat(App.shuffle(tiers[1]), App.shuffle(tiers[2])).slice(0, RANDOM_N);
    begin({ title: title + " · 随机", bank: bank, ids: App.shuffle(ids), kind: "random", pool: items });
  }

  function startWrong(bank) {
    var ids = [];
    allQuestions(bank).forEach(function (it) { var r = recOf(it.q.id); if (r && r.lastWrong) ids.push(it.q.id); });
    if (!ids.length) return;
    begin({ title: "错题重做", bank: bank, ids: App.shuffle(ids).slice(0, 30), kind: "wrong" });
  }

  function begin(spec) {
    session = { title: spec.title, bank: spec.bank, set: spec.set || null, ids: spec.ids, pos: 0, kind: spec.kind, pool: spec.pool || null,
      results: {}, answered: false, editingKey: false };
    App.show("examQuiz");
    showQuestion();
  }

  function currentQ() { return index[session.ids[session.pos]]; }

  // ---------- question view ----------
  function formatStem(text) {
    var frag = document.createDocumentFragment();
    String(text).split(/(\(\s*i{1,3}\s*\)\s*_+|_{3,})/i).forEach(function (part) {
      if (!part) return;
      if (/_{3,}/.test(part)) {
        var m = /^(\(\s*i{1,3}\s*\))\s*_+$/i.exec(part);
        var span = el("span", "blank", "   ");
        if (m) frag.appendChild(el("span", "bnum", m[1].replace(/\s/g, "")));
        frag.appendChild(span);
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    });
    return frag;
  }

  function showQuestion() {
    var item = currentQ(), q = item.q;
    session.answered = false;
    session.editingKey = false;
    session.sel = [];
    var total = session.ids.length;
    $("exCount").textContent = (session.pos + 1) + " / " + total;
    $("exBar").style.width = Math.round(session.pos / total * 100) + "%";
    $("exTitle").textContent = session.title;

    var meta = [];
    meta.push(item.set.title + (q.n ? " · 第 " + q.n + " 题" : ""));
    if (item.set.difficulty) meta.push(DIFF_TEXT[item.set.difficulty]);
    $("exMeta").textContent = meta.join(" · ");
    $("exKind").textContent = KIND_TEXT[q.kind] || q.kind;

    var pbox = $("exPassage");
    if (item.set.passage) {
      pbox.hidden = false;
      pbox.textContent = "";
      var det = el("details", "passage");
      det.open = true;
      det.appendChild(el("summary", null, "阅读文章"));
      String(item.set.passage).split(/\n+/).forEach(function (para) {
        if (!para.trim()) return;
        var p = el("p", null);
        para.trim().split(/(\u27e6[^\u27e7]*\u27e7)/).forEach(function (part) {
          if (part.charAt(0) === "\u27e6") p.appendChild(el("mark", null, part.slice(1, -1)));
          else if (part) p.appendChild(document.createTextNode(part));
        });
        det.appendChild(p);
      });
      pbox.appendChild(det);
    } else {
      pbox.hidden = true;
    }

    var stem = $("exStem");
    stem.textContent = "";
    stem.appendChild(formatStem(q.stem || ""));
    var img = $("exImg");
    if (q.img) { img.hidden = false; img.src = q.img; img.alt = "题目图片"; } else { img.hidden = true; img.removeAttribute("src"); }

    renderAnswerArea(q, false);
    $("exFeedback").textContent = "";
    $("exFeedback").className = "feedback";
    $("exNote").hidden = true;
    $("exSubmit").hidden = false;
    $("exSubmit").disabled = true;
    $("exSubmit").textContent = "提交答案";
    $("exNext").hidden = true;
    $("exKeyEdit").hidden = true;
    $("exSkip").hidden = false;
    var r = recOf(q.id);
    $("exPrev").hidden = true;
    if (r && r.n) {
      $("exHistory").hidden = false;
      $("exHistory").textContent = "你之前做过 " + r.n + " 次，最近一次" + (r.ok ? "答对了" : "答错了") + "（选 " + (r.pick || "—") + "）";
    } else {
      $("exHistory").hidden = true;
    }
  }

  function optionTexts(q) {
    if (q.kind === "qc") return QC_OPTS;
    if (q.opts) return q.opts;
    if (q.letters) return Array.apply(null, Array(q.letters)).map(function () { return ""; });
    return [];
  }

  function renderAnswerArea(q, locked) {
    var box = $("exOptions");
    box.textContent = "";
    box.className = "options";
    if (q.kind === "num") {
      box.className = "numentry";
      var inp = el("input", "numinput");
      inp.type = "text";
      inp.inputMode = "decimal";
      inp.placeholder = "输入答案（可写分数 3/4 或小数）";
      inp.autocomplete = "off";
      inp.id = "numField";
      inp.oninput = function () { session.sel = [inp.value]; $("exSubmit").disabled = !inp.value.trim(); };
      inp.onkeydown = function (e) { if (e.key === "Enter" && !$("exSubmit").disabled && !session.answered) submit(); };
      box.appendChild(inp);
      inp.focus();
      return;
    }
    if (q.kind === "multi") {
      var start = 0;
      box.className = "groups cols" + q.groups.length;
      q.groups.forEach(function (g, gi) {
        var col = el("div", "gcol");
        col.appendChild(el("div", "ghead", "(" + "i".repeat(gi + 1) + ")"));
        g.forEach(function (text, oi) {
          var letter = LETTERS[start + oi];
          col.appendChild(optButton(letter, text, function () { selectInGroup(gi, letter); }));
        });
        start += g.length;
        box.appendChild(col);
      });
      return;
    }
    var texts = optionTexts(q);
    texts.forEach(function (text, i) {
      var letter = LETTERS[i];
      box.appendChild(optButton(letter, text, function () { toggleOption(q, letter); }));
    });
  }

  function optButton(letter, text, onclick) {
    var b = el("button", "opt");
    b.type = "button";
    b.dataset.letter = letter;
    b.appendChild(el("span", "k", letter));
    b.appendChild(el("span", "tx", text));
    b.onclick = onclick;
    return b;
  }

  var AUTO_SUBMIT = ["pick1", "pick2", "single", "qc", "multi"];

  function refreshSelection() {
    document.querySelectorAll("#exOptions .opt").forEach(function (b) {
      b.classList.toggle("sel", session.sel.indexOf(b.dataset.letter) >= 0);
    });
  }

  function groupOf(q, letter) {
    var start = 0;
    for (var gi = 0; gi < q.groups.length; gi += 1) {
      var n = q.groups[gi].length;
      if (LETTERS.indexOf(letter) < start + n) return gi;
      start += n;
    }
    return -1;
  }

  function selectInGroup(gi, letter) {
    if (session.answered && !session.editingKey) return;
    var q = currentQ().q;
    session.sel = session.sel.filter(function (l) { return groupOf(q, l) !== gi; }).concat([letter]);
    session.sel.sort(function (a, b) { return groupOf(q, a) - groupOf(q, b); });
    refreshSelection();
    updateSubmitState(q);
  }

  function toggleOption(q, letter) {
    if (session.answered && !session.editingKey) return;
    var i = session.sel.indexOf(letter);
    if (q.kind === "pick1" || q.kind === "single" || q.kind === "qc") session.sel = [letter];
    else if (i >= 0) session.sel.splice(i, 1);
    else if (q.kind === "pick2") { if (session.sel.length >= 2) session.sel.shift(); session.sel.push(letter); }
    else session.sel.push(letter);
    refreshSelection();
    updateSubmitState(q);
  }

  function updateSubmitState(q) {
    var ok;
    if (q.kind === "multi") ok = session.sel.length === q.groups.length;
    else if (q.kind === "pick2") ok = session.sel.length === 2;
    else if (q.kind === "any") ok = session.sel.length >= 1;
    else ok = session.sel.length === 1;
    var btn = session.editingKey ? $("exKeySave") : $("exSubmit");
    btn.disabled = !ok;
    // Choice questions are graded as soon as the answer is complete; "any" and numeric
    // answers still wait for the 提交 button, since more choices may follow.
    if (ok && !session.editingKey && !session.answered && AUTO_SUBMIT.indexOf(q.kind) >= 0) submit();
  }

  function pickString(q) { return q.kind === "num" ? String(session.sel[0] || "").trim() : session.sel.join(""); }

  function submit() {
    var item = currentQ(), q = item.q;
    if (session.answered) return;
    var pick = pickString(q);
    if (!pick) return;
    session.answered = true;
    var ok = isCorrect(q, pick);
    record(q, pick, ok);
    session.results[q.id] = ok;
    revealAnswer(q, pick, ok);
    $("exHistory").hidden = true;
    $("exSubmit").hidden = true;
    $("exSkip").hidden = true;
    var last = session.pos === session.ids.length - 1;
    $("exNext").hidden = false;
    $("exNext").textContent = last ? "完成，查看结果" : "下一题";
    $("exNext").focus();
    $("exKeyEdit").hidden = false;
  }

  function record(q, pick, ok) {
    var now = Date.now();
    var r = state().q[q.id] || { n: 0, right: 0, lastWrong: false, last: 0, pick: "", ok: false };
    r.n += 1; r.last = now; r.pick = pick.slice(0, 12); r.ok = ok;
    if (ok) { r.right += 1; r.lastWrong = false; } else { r.lastWrong = true; }
    state().q[q.id] = r;
    var d = App.dayKey(now), day = state().daily[d] || (state().daily[d] = { n: 0, ok: 0 });
    day.n += 1; if (ok) day.ok += 1;
    App.saveNow();
  }

  function revealAnswer(q, pick, ok) {
    var key = effectiveKey(q);
    var fb = $("exFeedback");
    fb.className = "feedback " + (ok ? "good" : "bad");
    fb.textContent = ok ? "✓ 正确" : "✗ 答错了";

    var buttons = document.querySelectorAll("#exOptions .opt");
    var keyLetters = q.kind === "num" ? [] : key.split("");
    var pickLetters = q.kind === "num" ? [] : pick.split("");
    buttons.forEach(function (b) {
      b.classList.remove("sel");
      var L = b.dataset.letter;
      if (keyLetters.indexOf(L) >= 0) b.classList.add("right");
      else if (pickLetters.indexOf(L) >= 0) b.classList.add("wrong");
      b.disabled = true;
    });
    var field = document.getElementById("numField");
    if (field) field.disabled = true;

    var note = $("exNote");
    note.hidden = false;
    note.textContent = "";
    var mine = !!state().keys[q.id];
    var keyShown = q.kind === "num" ? String(key).split("|")[0] : keyText(q, key);
    note.appendChild(el("div", null, "你的答案：" + (q.kind === "num" ? pick : pickText(q, pick)) + "　参考答案：" + keyShown + (mine ? "（你设定的）" :  "")));
    if (q.expl) note.appendChild(el("div", "expl", q.expl));
    if (q.kind === "qc" || q.kind === "single" || q.kind === "any") { /* letters only */ }
  }

  function pickText(q, pick) { return pick.split("").join(" "); }

  function keyText(q, key) { return key.split("").join(" "); }

  function openKeyEdit() {
    var item = currentQ(), q = item.q;
    if (!session.answered || q.kind === "num") {
      if (q.kind === "num") editNumKey(q);
      return;
    }
    session.editingKey = true;
    session.sel = [];
    document.querySelectorAll("#exOptions .opt").forEach(function (b) { b.disabled = false; b.className = "opt"; });
    $("exKeyEdit").hidden = true;
    var bar = $("exKeyBar");
    bar.hidden = false;
    $("exKeySave").disabled = true;
    $("exNext").hidden = true;
  }

  function editNumKey(q) {
    var v = window.prompt("请输入你认为正确的答案（可写分数或小数；多个等价写法用 | 分隔）：", effectiveKey(q));
    if (v && v.trim()) { state().keys[q.id] = v.trim(); regrade(q); }
  }

  function saveKey() {
    var q = currentQ().q;
    var k = session.sel.join("");
    if (!k) return;
    state().keys[q.id] = k;
    session.editingKey = false;
    $("exKeyBar").hidden = true;
    regrade(q);
  }

  function resetKey() {
    var q = currentQ().q;
    delete state().keys[q.id];
    session.editingKey = false;
    $("exKeyBar").hidden = true;
    regrade(q);
  }

  function cancelKey() {
    session.editingKey = false;
    $("exKeyBar").hidden = true;
    var q = currentQ().q, r = recOf(q.id);
    regradeView(q, r.pick);
  }

  // re-evaluate the latest attempt against the (possibly changed) answer key
  function regrade(q) {
    var r = recOf(q.id);
    var ok = isCorrect(q, r.pick);
    if (ok !== r.ok) {
      r.ok = ok;
      if (ok) { r.right += 1; r.lastWrong = false; } else { r.right = Math.max(0, r.right - 1); r.lastWrong = true; }
    }
    session.results[q.id] = ok;
    App.saveNow();
    regradeView(q, r.pick);
  }

  function regradeView(q, pick) {
    var r = recOf(q.id);
    revealAnswer(q, pick, r.ok);
    var last = session.pos === session.ids.length - 1;
    $("exNext").hidden = false;
    $("exNext").textContent = last ? "完成，查看结果" : "下一题";
    $("exKeyEdit").hidden = false;
  }

  function next() {
    if (!session.answered) return;
    if (session.pos >= session.ids.length - 1) return finish();
    session.pos += 1;
    showQuestion();
    window.scrollTo(0, 0);
  }

  function skip() {
    if (session.answered) return;
    if (session.pos >= session.ids.length - 1) return finish();
    session.pos += 1;
    showQuestion();
    window.scrollTo(0, 0);
  }

  function finish() {
    var ids = Object.keys(session.results);
    var right = ids.filter(function (id) { return session.results[id]; }).length;
    var box = $("exSummary");
    box.textContent = "";
    box.appendChild(el("h2", null, "本轮完成"));
    [["做了", ids.length + " 题"], ["答对", right + " 题"], ["正确率", ids.length ? Math.round(right / ids.length * 100) + "%" : "--"]].forEach(function (row) {
      var line = el("div", "sumline");
      line.appendChild(el("span", null, row[0]));
      line.appendChild(el("b", null, row[1]));
      box.appendChild(line);
    });
    var wrong = ids.filter(function (id) { return !session.results[id]; });
    if (wrong.length) {
      box.appendChild(el("p", "muted", "答错的题已加入错题本："));
      var ul = el("ul", "wronglist");
      wrong.forEach(function (id) {
        var it = index[id];
        ul.appendChild(el("li", null, it.set.title + (it.q.n ? " 第 " + it.q.n + " 题" : "") + " — " + brief(it.q)));
      });
      box.appendChild(ul);
    }
    $("exAgain").hidden = !(session.kind === "random");
    App.show("examSummary");
    App.renderSaveStatus(true);
  }

  function brief(q) { return String(q.stem || "（图片题）").replace(/\s+/g, " ").slice(0, 70) + (String(q.stem || "").length > 70 ? "…" : ""); }

  // ---------- wrong book ----------
  function renderWrong() {
    App.show("examWrongView");
    var bank = BANKS[ctx.bank];
    var box = $("exWrongList");
    box.textContent = "";
    var items = [];
    allQuestions(bank).forEach(function (it) { var r = recOf(it.q.id); if (r && r.lastWrong) items.push({ it: it, r: r }); });
    items.sort(function (a, b) { return b.r.last - a.r.last; });
    $("exWrongTitle").textContent = bank.name + " · 错题本（" + items.length + "）";
    $("exWrongGo").disabled = !items.length;
    items.forEach(function (x) {
      var q = x.it.q, card = el("div", "card wrow");
      var line = el("div", "line");
      line.appendChild(el("span", "en", x.it.set.title + (q.n ? " · 第 " + q.n + " 题" : "")));
      line.appendChild(el("span", "chip wrong", "做错 " + (x.r.n - x.r.right) + " 次"));
      card.appendChild(line);
      card.appendChild(el("div", "zh", brief(q)));
      var more = el("div", "detail");
      more.hidden = true;
      more.appendChild(el("div", null, "你的答案：" + (x.r.pick || "—") + "　参考答案：" + (q.kind === "num" ? String(effectiveKey(q)).split("|")[0] : effectiveKey(q))));
      var redo = el("button", "btn", "重做这一题");
      redo.onclick = function (e) { e.stopPropagation(); begin({ title: "错题重做", bank: bank, ids: [q.id], kind: "wrong" }); };
      var rm = el("button", "btn", "移出错题本");
      rm.onclick = function (e) { e.stopPropagation(); x.r.lastWrong = false; App.saveNow(); renderWrong(); };
      var row = el("div", "row wrap");
      row.appendChild(redo); row.appendChild(rm);
      more.appendChild(row);
      card.appendChild(more);
      card.onclick = function () { more.hidden = !more.hidden; };
      box.appendChild(card);
    });
    if (!items.length) box.appendChild(el("p", "muted", "错题本是空的。"));
  }

  // ---------- wiring ----------
  $("exSubmit").onclick = submit;
  $("exNext").onclick = next;
  $("exSkip").onclick = skip;
  $("exKeyEdit").onclick = openKeyEdit;
  $("exKeySave").onclick = saveKey;
  $("exKeyReset").onclick = resetKey;
  $("exKeyCancel").onclick = cancelKey;
  $("exExit").onclick = function () { session = null; home(); };
  $("exHome").onclick = home;
  $("exAgain").onclick = function () { if (session && session.kind === "random") startRandom(session.bank, session.pool, session.title.replace(" · 随机", "")); };
  $("exWrongBack").onclick = home;
  $("exWrongGo").onclick = function () { startWrong(BANKS[ctx.bank]); };

  document.addEventListener("keydown", function (e) {
    if ($("examQuiz").hidden || !session || e.target.tagName === "INPUT") return;
    var q = currentQ().q;
    if (e.key === "Enter") {
      e.preventDefault();
      if (!session.answered && !$("exSubmit").disabled) submit();
      else if (session.answered && !session.editingKey) next();
      return;
    }
    var idx = LETTERS.indexOf(e.key.toUpperCase());
    if (idx >= 0 && e.key.length === 1 && (!session.answered || session.editingKey)) {
      var b = document.querySelector('#exOptions .opt[data-letter="' + LETTERS[idx] + '"]');
      if (b) b.click();
    }
  });

  buildIndex();
  window.GREExam = { home: home, count: function () { return Object.keys(index).length; } };
})();
