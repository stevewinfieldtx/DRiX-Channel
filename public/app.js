(function () {
  "use strict";

  var state = { url: "", city: "", profile: null, known: false, detailCache: {} };

  var $ = function (id) { return document.getElementById(id); };

  var urlInput = $("urlInput"), cityInput = $("cityInput");
  var identifyBtn = $("identifyBtn"), identifyHint = $("identifyHint");
  var loading = $("loading"), loadText = $("loadText");
  var confirm = $("confirm"), errorBox = $("errorBox"), errorMsg = $("errorMsg");

  function setLoading(on, lines) {
    loading.classList.toggle("show", on);
    if (!on) { if (loadTimer) { clearInterval(loadTimer); loadTimer = null; } return; }
    var arr = lines || ["Working…"]; var i = 0; loadText.textContent = arr[0];
    loadTimer = setInterval(function () { i = (i + 1) % arr.length; loadText.textContent = arr[i]; }, 1400);
  }
  var loadTimer = null;

  function showError(msg) { errorMsg.textContent = msg; errorBox.classList.add("show"); }
  function clearError() { errorBox.classList.remove("show"); }

  urlInput.addEventListener("input", function () {
    state.url = urlInput.value.trim();
    identifyBtn.disabled = !state.url;
    identifyHint.textContent = state.url ? "Ready to read the site." : "Paste a URL to start.";
  });
  cityInput.addEventListener("input", function () { state.city = cityInput.value.trim(); });
  urlInput.addEventListener("keydown", function (e) { if (e.key === "Enter" && !identifyBtn.disabled) identify(); });

  identifyBtn.addEventListener("click", identify);

  function identify() {
    clearError(); confirm.classList.remove("show");
    identifyBtn.disabled = true;
    setLoading(true, ["Reading the site…", "Working out what they do…", "Checking what we already know…"]);

    fetch("/api/identify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: state.url, city: state.city })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        setLoading(false); identifyBtn.disabled = false;
        if (!res.ok) { showError(res.j.error || "Could not read that site."); return; }
        state.profile = res.j.profile || {};
        state.known = !!res.j.known;
        renderConfirm(res.j);
      })
      .catch(function () { setLoading(false); identifyBtn.disabled = false; showError("Network error reaching the engine."); });
  }

  function renderConfirm(data) {
    var p = data.profile || {};
    $("cName").textContent = p.name || state.url;
    $("cVert").textContent = (p.vertical || "vertical unknown") + (p.location ? "  ·  " + p.location : "");
    $("cSummary").textContent = p.summary || "We could not read much from the site. Add a line below so the engine has something to work with.";
    $("editVertical").value = p.vertical || "";
    $("editNote").value = "";

    var k = $("confirmK"), note = $("confirmNote");
    if (data.known) {
      k.textContent = "We've seen this one before";
      k.classList.add("known");
      note.textContent = data.lastRunAt ? "Last run " + new Date(data.lastRunAt).toLocaleString() + ". Running again makes a fresh read." : "Already in the system.";
    } else {
      k.textContent = "Here's what we think they do";
      k.classList.remove("known");
      note.textContent = data.siteRead === false ? ("Site note: " + (data.siteNote || "limited text retrieved") + " — add context below if needed.") : "";
    }
    confirm.classList.add("show");
    confirm.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  $("cancelBtn").addEventListener("click", function () {
    confirm.classList.remove("show"); clearError();
    urlInput.value = ""; cityInput.value = ""; state = { url: "", city: "", profile: null, known: false, detailCache: {} };
    identifyBtn.disabled = true; identifyHint.textContent = "Paste a URL to start.";
    urlInput.focus();
  });

  $("analyzeBtn").addEventListener("click", analyze);

  function analyze() {
    clearError();
    var profile = Object.assign({}, state.profile, {
      vertical: $("editVertical").value.trim() || state.profile.vertical,
      note: $("editNote").value.trim()
    });
    $("analyzeBtn").disabled = true;
    setLoading(true, ["Qualifying the basics…", "Reading where they bleed…", "Building the ten…", "Ranking by impact…"]);

    fetch("/api/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: state.url, profile: profile })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        setLoading(false); $("analyzeBtn").disabled = false;
        if (!res.ok) { showError(res.j.error || "Analysis failed."); return; }
        renderResults(profile, res.j);
      })
      .catch(function () { setLoading(false); $("analyzeBtn").disabled = false; showError("Network error during analysis."); });
  }

  function quadrant(impact, effort) {
    var hi = String(impact || "").toLowerCase() === "high";
    var heavy = String(effort || "").toLowerCase() === "heavy";
    // "low effort" = Quick or Moderate; "high effort" = Heavy
    if (hi && !heavy) return { cls: "q-green", label: "Do it now" };
    if (hi && heavy) return { cls: "q-yellow", label: "Worth the lift" };
    if (!hi && !heavy) return { cls: "q-orange", label: "Cheap, marginal" };
    return { cls: "q-red", label: "Avoid" };
  }

  function esc(s) { var d = document.createElement("div"); d.textContent = (s == null ? "" : String(s)); return d.innerHTML; }

  // ---- SOLUTION DEEP DIVE DRAWER ----
  var drawer = $("drawer"), drawerInner = $("drawerInner"), drawerBackdrop = $("drawerBackdrop");

  function openDrawer() {
    drawer.classList.add("show");
    drawerBackdrop.classList.add("show");
    drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    drawer.classList.remove("show");
    drawerBackdrop.classList.remove("show");
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  if (drawerBackdrop) drawerBackdrop.addEventListener("click", closeDrawer);
  if ($("drawerClose")) $("drawerClose").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });

  function nineGrid() {
    return '<div class="big-grid"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>';
  }

  function detailHead(idea) {
    var tags = '';
    if (idea.pain) tags += '<span class="tag pain">' + esc(idea.pain) + '</span>';
    tags += '<span class="tag">Impact · ' + esc(idea.impact || "—") + '</span>';
    tags += '<span class="tag">Effort · ' + esc(idea.effort || "—") + '</span>';
    return '<div class="drawer-head"><div class="d-rank">Solution deep dive</div>'
      + '<h3 class="d-title">' + esc(idea.title) + '</h3>'
      + '<div class="tags">' + tags + '</div></div>';
  }

  function dsec(label, inner) {
    return '<div class="dsec"><div class="dsec-label">' + label + '</div>' + inner + '</div>';
  }

  function renderDetailLoading(idea) {
    drawerInner.innerHTML = detailHead(idea)
      + '<div class="d-loading">' + nineGrid() + '<div class="load-text">Building the deep dive…</div></div>';
  }

  function renderDetailError(idx, idea, msg) {
    drawerInner.innerHTML = detailHead(idea)
      + '<div class="error show" style="margin-top:22px;"><div class="k">Engine note</div><p>' + esc(msg) + '</p></div>'
      + '<button class="btn ghost" id="detailRetry" style="margin-top:16px;">Try again</button>';
    var rb = $("detailRetry");
    if (rb) rb.addEventListener("click", function () { delete state.detailCache[idx]; openDetail(idx, idea); });
  }

  function renderDetail(idea, d) {
    var html = detailHead(idea);
    if (d.pitch_line) {
      html += '<div class="d-pitch"><span class="d-pitch-k">Open with</span><span class="d-pitch-t">' + esc(d.pitch_line) + '</span></div>';
    }
    if (d.how_it_works) html += dsec("How it works", '<p class="dtext">' + esc(d.how_it_works) + '</p>');
    if (d.why_this_customer) html += dsec("Why this customer", '<p class="dtext">' + esc(d.why_this_customer) + '</p>');
    if (d.integrations && d.integrations.length) {
      var chips = d.integrations.map(function (x) { return '<span class="dchip">' + esc(x) + '</span>'; }).join("");
      html += dsec("Wires into", '<div class="dchips">' + chips + '</div>');
    }
    if (d.discovery_questions && d.discovery_questions.length) {
      var qs = d.discovery_questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join("");
      html += dsec("Discovery questions", '<ol class="dlist">' + qs + '</ol>');
    }
    if (d.objections && d.objections.length) {
      var obj = d.objections.map(function (o) {
        return '<div class="dobj"><div class="dobj-q">' + esc(o.objection) + '</div><div class="dobj-a">' + esc(o.response) + '</div></div>';
      }).join("");
      html += dsec("Objections, handled", obj);
    }
    if (d.success_metric) html += dsec("What success looks like", '<p class="dtext dmetric">' + esc(d.success_metric) + '</p>');
    drawerInner.innerHTML = html;
  }

  function openDetail(idx, idea) {
    openDrawer();
    if (state.detailCache[idx]) { renderDetail(idea, state.detailCache[idx]); return; }
    renderDetailLoading(idea);
    fetch("/api/solution-detail", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: state.resultProfile || state.profile || {}, solution: idea })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { renderDetailError(idx, idea, res.j.error || "Could not load the deep dive."); return; }
        state.detailCache[idx] = res.j;
        renderDetail(idea, res.j);
      })
      .catch(function () { renderDetailError(idx, idea, "Network error loading the deep dive."); });
  }

  function renderResults(profile, out) {
    $("resName").textContent = profile.name || state.url;
    $("resVert").textContent = (profile.vertical || "") + (profile.location ? "  ·  " + profile.location : "");
    $("lockTitle").textContent = "AI gets built around " + (profile.name || "them") + ".";

    var B = $("basics"); B.innerHTML = "";
    (out.basics || []).forEach(function (b) {
      var a = (b.applies || "").toLowerCase();
      var cls = a === "yes" ? "v-yes" : (a === "maybe" ? "v-maybe" : "v-no");
      var row = document.createElement("div"); row.className = "basic";
      row.innerHTML = '<span class="verdict ' + cls + '">' + esc(b.applies || "—") + '</span>'
        + '<span class="bname">' + esc(b.name) + '</span>'
        + '<span class="breason">' + esc(b.reason || "") + '</span>';
      B.appendChild(row);
    });

    var A = $("advanced"); A.innerHTML = "";
    (out.advanced || []).slice(0, 10).forEach(function (idea, idx) {
      var impact = (idea.impact || "").toLowerCase() === "high" ? "impact-high" : "";
      var ef = (idea.effort || "").toLowerCase(); var ec = ef === "quick" ? "effort-quick" : (ef === "heavy" ? "effort-heavy" : "");
      var q = quadrant(idea.impact, idea.effort);
      var card = document.createElement("article"); card.className = "card " + q.cls;
      card.innerHTML = '<div class="rank">' + ("0" + (idx + 1)).slice(-2) + ' / 10</div>'
        + '<h4>' + esc(idea.title) + '</h4>'
        + '<p class="problem">' + esc(idea.problem) + '</p>'
        + '<p class="solution">' + esc(idea.solution) + '</p>'
        + '<div class="tags">'
        + (idea.pain ? '<span class="tag pain">' + esc(idea.pain) + '</span>' : '')
        + '<span class="tag ' + impact + '">Impact · ' + esc(idea.impact || "—") + '</span>'
        + '<span class="tag ' + ec + '">Effort · ' + esc(idea.effort || "—") + '</span>'
        + '</div>'
        + '<div class="quad">' + q.label + '</div>'
        + '<div class="card-open">Open deep dive <span class="arrow">▸</span></div>';
      card.addEventListener("click", function () { openDetail(idx, idea); });
      A.appendChild(card);
    });

    state.resultProfile = profile;

    $("inputView").style.display = "none";
    $("resultsView").classList.add("show");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("restartBtn").addEventListener("click", function () {
    $("resultsView").classList.remove("show");
    $("inputView").style.display = "block";
    confirm.classList.remove("show"); clearError(); closeDrawer();
    urlInput.value = ""; cityInput.value = ""; state = { url: "", city: "", profile: null, known: false, detailCache: {} };
    identifyBtn.disabled = true; identifyHint.textContent = "Paste a URL to start.";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
