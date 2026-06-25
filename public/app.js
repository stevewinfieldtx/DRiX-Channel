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

  // 3x3 matrix: impact (High/Medium/Low) x effort (Quick/Moderate/Heavy) = 9 cells, 9 colors.
  var MATRIX = [
    // effort:        Quick                            Moderate                         Heavy
    [ {c:"#22E06B",l:"Do it now"},       {c:"#91E053",l:"Strong bet"},    {c:"#FFE03A",l:"Worth the lift"} ], // High impact
    [ {c:"#91C04D",l:"Easy win"},        {c:"#C8AB47",l:"Consider"},      {c:"#FF9740",l:"Costly for mid"} ], // Medium impact
    [ {c:"#FF9F2E",l:"Cheap, marginal"}, {c:"#FF763A",l:"Low priority"},  {c:"#FF4D45",l:"Avoid"} ]           // Low impact
  ];
  function cell(impact, effort) {
    var imp = String(impact || "").toLowerCase();
    var eff = String(effort || "").toLowerCase();
    var i = imp === "high" ? 0 : (imp === "low" ? 2 : 1);
    var e = eff === "quick" ? 0 : (eff === "heavy" ? 2 : 1);
    return MATRIX[i][e];
  }
  function glow(hex, a) {
    var h = hex.replace("#", "");
    var r = parseInt(h.substr(0,2),16), g = parseInt(h.substr(2,2),16), b = parseInt(h.substr(4,2),16);
    return "0 0 16px rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  function matrixLegend() {
    var imps = ["High","Medium","Low"], effs = ["Quick","Moderate","Heavy"];
    var cap = "font-family:var(--mono);font-size:9.5px;color:var(--muted-2);";
    var html = '<div style="' + cap + 'letter-spacing:.14em;text-transform:uppercase;margin-bottom:9px;">Impact \u00d7 Effort \u00b7 the 3\u00d73</div>';
    html += '<div style="display:inline-grid;grid-template-columns:auto repeat(3,34px);gap:4px;align-items:center;">';
    html += '<span></span>';
    html += effs.map(function (e) { return '<span style="' + cap + 'text-align:center;">' + e + '</span>'; }).join("");
    for (var i = 0; i < 3; i++) {
      html += '<span style="' + cap + 'padding-right:7px;text-align:right;">' + imps[i] + '</span>';
      for (var e2 = 0; e2 < 3; e2++) {
        var x = MATRIX[i][e2];
        html += '<span title="' + imps[i] + ' impact / ' + effs[e2] + ' effort \u2014 ' + x.l + '" style="height:18px;border-radius:3px;background:' + x.c + ';box-shadow:0 0 8px ' + x.c + '66;"></span>';
      }
    }
    html += '</div>';
    return html;
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
    var oldLeg = document.getElementById("matrixLegend");
    if (oldLeg) oldLeg.remove();
    var leg = document.createElement("div"); leg.id = "matrixLegend"; leg.style.margin = "0 0 20px";
    leg.innerHTML = matrixLegend();
    A.parentNode.insertBefore(leg, A);
    (out.advanced || []).slice(0, 10).forEach(function (idea, idx) {
      var impact = (idea.impact || "").toLowerCase() === "high" ? "impact-high" : "";
      var ef = (idea.effort || "").toLowerCase(); var ec = ef === "quick" ? "effort-quick" : (ef === "heavy" ? "effort-heavy" : "");
      var c = cell(idea.impact, idea.effort);
      var card = document.createElement("article"); card.className = "card";
      card.style.borderColor = c.color; card.style.boxShadow = glow(c.color, 0.30);
      card.innerHTML = '<div class="rank">' + ("0" + (idx + 1)).slice(-2) + ' / 10</div>'
        + '<h4>' + esc(idea.title) + '</h4>'
        + '<p class="problem">' + esc(idea.problem) + '</p>'
        + '<p class="solution">' + esc(idea.solution) + '</p>'
        + '<div class="tags">'
        + (idea.pain ? '<span class="tag pain">' + esc(idea.pain) + '</span>' : '')
        + '<span class="tag ' + impact + '">Impact · ' + esc(idea.impact || "—") + '</span>'
        + '<span class="tag ' + ec + '">Effort · ' + esc(idea.effort || "—") + '</span>'
        + '</div>'
        + '<div class="quad" style="color:' + c.color + '">' + c.label + '</div>'
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
