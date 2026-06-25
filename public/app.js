(function () {
  "use strict";

  var state = { url: "", city: "", profile: null, known: false };

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
    urlInput.value = ""; cityInput.value = ""; state = { url: "", city: "", profile: null, known: false };
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

  function money(n) {
    n = Number(n) || 0;
    if (n >= 1000) { var k = n / 1000; return "$" + (k % 1 === 0 ? k : k.toFixed(1)) + "K"; }
    return "$" + n;
  }
  function priceBlock(pr) {
    if (!pr) return "";
    var total = money(pr.low) + " – " + money(pr.high);
    var mo = "$" + (Number(pr.monthlyLow) || 0).toLocaleString() + " – $" + (Number(pr.monthlyHigh) || 0).toLocaleString() + " /mo";
    var isMarket = pr.basis === "market";
    var refs = (pr.refs && pr.refs.length) ? '<span class="refs">[' + pr.refs.join(",") + ']</span>' : "";
    var label = isMarket ? "Market-based" : "Scope-based";
    var note = pr.note ? '<div class="pnote">' + esc(pr.note) + '</div>' : "";
    return '<div class="price">'
      + '<div class="amt">' + total + '</div>'
      + '<div class="mo">' + mo + ' · setup = one month</div>'
      + '<span class="basis ' + (isMarket ? "market" : "effort") + '">' + label + ' indicative' + refs + '</span>'
      + note
      + '</div>';
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
        + priceBlock(idea.price);
      A.appendChild(card);
    });

    var apx = $("priceAppendix");
    var srcs = out.priceSources || [];
    var anyMarket = (out.advanced || []).some(function (x) { return x.price && x.price.basis === "market"; });
    var html = "";
    if (srcs.length) {
      html += "<h4>Pricing references</h4><ol>";
      srcs.forEach(function (sref) {
        html += '<li value="' + Number(sref.n) + '"><a href="' + esc(sref.url) + '" target="_blank" rel="noopener">' + esc(sref.title) + '</a></li>';
      });
      html += "</ol>";
    } else {
      html += "<h4>Pricing references</h4>";
    }
    html += '<div class="disclaimer">All figures are indicative budgeting ranges, not quotes. Market-based ranges cite live comparables above. Scope-based ranges fall back to internal effort bands and carry no market citation. A firm price is set only after scoping the customer\'s actual environment.</div>';
    apx.innerHTML = html;
    apx.style.display = "block";

    $("inputView").style.display = "none";
    $("resultsView").classList.add("show");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("restartBtn").addEventListener("click", function () {
    $("resultsView").classList.remove("show");
    $("inputView").style.display = "block";
    confirm.classList.remove("show"); clearError();
    urlInput.value = ""; cityInput.value = ""; state = { url: "", city: "", profile: null, known: false };
    identifyBtn.disabled = true; identifyHint.textContent = "Paste a URL to start.";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
