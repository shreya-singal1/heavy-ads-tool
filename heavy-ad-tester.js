/*
 * Heavy Ad Test Tool
 *
 * A panel you run inside any page (DevTools console, DevTools Snippet or bookmarklet).
 * It finds ad iframes, installs the HEAVY_AD sample script into the one you pick, makes that frame
 * burn CPU until Chrome removes it, and reports what the script did.
 *
 * Limits: Chrome only (other browsers have no heavy ad intervention). The frame must be reachable
 * from this page (same origin, e.g. GPT friendly iframes). Cross-origin frames are listed but cannot be used.
 * Do not click inside the ad (a click exempts it from the intervention). Keep the tab in front.
 */
(function () {
  'use strict';
  if (window.__heavyAdTester && window.__heavyAdTester.destroy) {
    try { window.__heavyAdTester.destroy(); } catch (e) {}
  }

  var DEFAULT_PIXEL = 'https://example.com/hv?cid=TEST123&bidder=testbidder&size=300x250';
  var TIMEOUT_MS = 150000;
  var S = {
    frame: null, win: null, startedAt: 0, running: false, finished: false,
    events: [], beacons: [], navigated: false, gotCb: false, gotHide: false,
    hideAt: 0, lastBeaconAt: 0, opts: null, verdictKind: '', verdictText: ''
  };
  var candidates = [];
  var tickTimer = null;

  // ---------------------------------------------------------------- panel
  var host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483647;';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = [
    '<style>',
    '.p{font:12px/1.35 system-ui,sans-serif;color:#1a1a1a;background:#fff;border:1px solid #777;border-radius:8px;',
    'box-shadow:0 4px 18px rgba(0,0,0,.35);width:390px;max-height:84vh;overflow:auto;padding:8px 10px}',
    '.h{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:13px}',
    '.s{background:#eef3fb;border:1px solid #b9c9e6;border-radius:5px;padding:4px 6px;margin-bottom:4px}',
    '.w{background:#fff3cd;border:1px solid #e6c866;border-radius:5px;padding:4px 6px;margin-bottom:4px;display:none}',
    '.l{margin:6px 0 2px;font-weight:600}',
    '.fr{border:1px solid #ccc;border-radius:5px;max-height:120px;overflow:auto;padding:2px 4px}',
    '.fr label{display:block;padding:1px 0;word-break:break-all}',
    '.fr .no{color:#999}',
    'label.f{display:block;margin-top:4px}',
    'input[type=text],select{width:100%;box-sizing:border-box;font:11px system-ui;padding:2px}',
    '.b{display:flex;gap:6px;margin-top:6px}',
    'button{font:12px system-ui;padding:4px 8px;cursor:pointer}',
    'button[disabled]{opacity:.5;cursor:not-allowed}',
    '#verdict{margin-top:6px;padding:6px;border-radius:5px;display:none}',
    '#verdict.pass{display:block;background:#bdf0bd;border:1px solid #6cc06c}',
    '#verdict.fail{display:block;background:#ffc9c9;border:1px solid #e07070}',
    '#verdict.info{display:block;background:#fff3cd;border:1px solid #e6c866}',
    '#log{margin-top:6px;font:11px/1.3 ui-monospace,Consolas,monospace;max-height:170px;overflow:auto;border-top:1px solid #ddd;padding-top:4px}',
    '#log div{word-break:break-all}',
    '#log .BEACON{color:#0a7a0a;font-weight:700}#log .diag{color:#555}#log .PASS{color:#0a7a0a;font-weight:700}',
    '#log .FAIL{color:#b00020;font-weight:700}#log .INFO{color:#8a6d00;font-weight:700}#log .ACTION{color:#1a4fa0;font-weight:700}',
    '</style>',
    '<div class="p">',
    '<div class="h"><b>Heavy ad test tool</b><button id="x" title="Close">x</button></div>',
    '<div class="s">Focus: <b id="f">?</b> | Visible: <b id="v">?</b> | Time: <b id="t">-</b></div>',
    '<div class="w" id="warn"></div>',
    '<div class="l">Ad frames (select one)</div>',
    '<div class="fr" id="frames"></div>',
    '<div class="b"><button id="rescan">Rescan</button></div>',
    '<label class="f">Pixel URL<input type="text" id="pix"></label>',
    '<label class="f">Beacon<select id="bm"><option value="capture">Capture only (nothing is sent)</option>',
    '<option value="real">Send a real beacon</option></select></label>',
    '<label class="f">Burn<select id="burn"><option value="cpu">CPU burn (about 94% busy)</option>',
    '<option value="block">Block the thread for 40 s (page freezes)</option></select></label>',
    '<label class="f">My creative HTML (optional, replaces the frame content)<textarea id="chtml" rows="3" style="width:100%;box-sizing:border-box;font:11px ui-monospace,Consolas,monospace"></textarea></label>',
    '<label class="f"><input type="checkbox" id="addsample" checked> add the sample script to my creative &nbsp;<input type="checkbox" id="addburn" checked> add the burn</label>',
    '<label class="f"><input type="checkbox" id="norefresh" checked> Disable googletag refresh() during the test</label>',
    '<div class="b"><button id="start">Start test</button><button id="stop">Stop</button><button id="copy">Copy report</button></div>',
    '<div id="verdict"></div>',
    '<div id="log"></div>',
    '</div>'
  ].join('');
  document.documentElement.appendChild(host);
  var $ = function (id) { return root.getElementById(id); };
  $('pix').value = DEFAULT_PIXEL;

  // ---------------------------------------------------------------- helpers
  function now() { return Date.now(); }
  function rel(t) { return ((t - (S.startedAt || t)) / 1000).toFixed(2) + 's'; }
  function short(u) { u = String(u); return u.length > 90 ? u.slice(0, 90) + '...' : u; }

  function log(kind, msg) {
    var e = { t: now(), kind: kind, msg: String(msg) };
    S.events.push(e);
    if (kind === 'diag') {
      if (/^observer callback got HeavyAdIntervention/.test(e.msg)) { S.gotCb = true; }
      if (/^pagehide fired/.test(e.msg)) { S.gotHide = true; S.hideAt = e.t; }
    }
    var d = document.createElement('div');
    d.className = kind;
    d.textContent = (S.startedAt ? '+' + rel(e.t) : '--') + '  ' + kind + '  ' + e.msg;
    var box = $('log');
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }

  function setVerdict(kind, text) {
    S.verdictKind = kind;
    S.verdictText = text;
    var v = $('verdict');
    v.className = kind;
    v.textContent = text;
  }

  // ---------------------------------------------------------------- frame discovery
  function collect(doc, depth, out) {
    var list = doc.querySelectorAll('iframe');
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var r = f.getBoundingClientRect();
      var d = null;
      try { d = f.contentDocument; } catch (e) { d = null; }
      var entry = {
        el: f, acc: !!d, id: f.id || f.name || '(no id)', w: Math.round(r.width), h: Math.round(r.height),
        bodyLen: d && d.body ? d.body.innerHTML.length : 0, nested: d ? d.querySelectorAll('iframe').length : 0, depth: depth
      };
      if (entry.w >= 50 && entry.h >= 40) { out.push(entry); }
      if (d && depth < 2) { collect(d, depth + 1, out); }
    }
  }

  var lastScan = 0;
  function rescan() {
    lastScan = now();
    candidates = [];
    collect(document, 0, candidates);
    candidates.sort(function (a, b) {
      var sa = (a.acc ? 2 : 0) + (/google_ads|dfp|gpt|banner|ad/i.test(a.id) ? 1 : 0);
      var sb = (b.acc ? 2 : 0) + (/google_ads|dfp|gpt|banner|ad/i.test(b.id) ? 1 : 0);
      return sb - sa;
    });
    var box = $('frames');
    box.textContent = '';
    if (!candidates.length) {
      box.textContent = 'No iframes of a usable size found. Scroll so ads load, then Rescan.';
      S.frame = null;
      return;
    }
    var chosen = false;
    candidates.forEach(function (c, i) {
      var lab = document.createElement('label');
      var rb = document.createElement('input');
      rb.type = 'radio';
      rb.name = 'fr';
      rb.disabled = !c.acc;
      rb.onchange = function () { S.frame = c.el; };
      if (!chosen && c.acc && c.bodyLen > 1000) { rb.checked = true; S.frame = c.el; chosen = true; }
      lab.appendChild(rb);
      lab.appendChild(document.createTextNode(' ' + c.id + ' (' + c.w + 'x' + c.h + ', ' + (c.acc ? Math.round(c.bodyLen / 1000) + ' KB, ' + c.nested + ' nested' : 'not reachable, cross-origin') + ')'));
      if (!c.acc) { lab.className = 'no'; }
      box.appendChild(lab);
    });
    if (!chosen) { S.frame = null; }
  }

  // ---------------------------------------------------------------- code injected into the ad frame
  function buildFrameCode(o) {
    var burn = o.burn === 'block'
      ? 'setTimeout(function(){var s=Date.now();while(Date.now()-s<40000){Math.sqrt(Math.random());}},0);'
      : 'window.__stopBurn=false;(function burn(){if(window.__stopBurn){return;}var s=performance.now();while(performance.now()-s<80){Math.sqrt(Math.random());}setTimeout(burn,5);})();';
    var sample = [
      '(function () {',
      'var PIXEL = ' + JSON.stringify(o.pixel) + ';',
      'function send(reports) {',
      '    for (var i = 0; i < reports.length; i++) {',
      '        try {',
      '            var body = reports[i].body;',
      '            if (!body || body.id !== "HeavyAdIntervention") {',
      '                continue;',
      '            }',
      '            var sep = "&";',
      '            navigator.sendBeacon(PIXEL + sep + "rd=" + encodeURIComponent(JSON.stringify({',
      '                message: body.message,',
      '                sourceFile: body.sourceFile,',
      '                lineNumber: body.lineNumber,',
      '                columnNumber: body.columnNumber',
      '            })));',
      '        } catch (e) {',
      '        }',
      '    }',
      '}',
      'try {',
      '    var observer = new ReportingObserver(send, {',
      '        types: ["intervention"],',
      '        buffered: true',
      '    });',
      '    observer.observe();',
      '    window.addEventListener("pagehide", function () {',
      '        send(observer.takeRecords());',
      '    });',
      '} catch (e) {',
      '}',
      '})();'
    ].join('\n');
    return [
      '(function () {',
      'var L = window.__hatLog, B = window.__hatBeacon, real = ' + (o.real ? 'true' : 'false') + ';',
      'var origSB = navigator.sendBeacon.bind(navigator);',
      'navigator.sendBeacon = function (u, d) {',
      '  var ok = true;',
      '  if (real) { ok = false; try { ok = origSB(u, d); } catch (e) { try { L("diag", "sendBeacon threw " + e.name); } catch (x) {} } }',
      '  try { B(String(u), ok); } catch (e) {}',
      '  return ok;',
      '};',
      'document.addEventListener("securitypolicyviolation", function (e) { try { L("diag", "CSP violation: " + e.violatedDirective); } catch (x) {} });',
      'try { new ReportingObserver(function (r) { r.forEach(function (x) { try { L("diag", "observer callback got " + (x.body && x.body.id)); } catch (e) {} }); }, { types: ["intervention"], buffered: true }).observe(); } catch (e) {}',
      'window.addEventListener("pagehide", function () { try { L("diag", "pagehide fired in ad frame"); } catch (x) {} });',
      '// ---- sample script under test ----',
      o.addSample === false ? '' : sample,
      '// ---- load generator ----',
      o.addBurn === false ? '' : burn,
      'try { L("diag", "installed in the ad frame, load started"); } catch (e) {}',
      '})();'
    ].join('\n');
  }

  // ---------------------------------------------------------------- run
  function stopBurn() { try { if (S.win) { S.win.__stopBurn = true; } } catch (e) {} }

  function finish(kind, text) {
    if (S.finished) { return; }
    S.finished = true;
    S.running = false;
    stopBurn();
    setVerdict(kind, text);
    log(kind.toUpperCase(), text);
    $('start').disabled = false;
    $('t').textContent = 'done';
  }

  function start() {
    if (S.running) { return; }
    var fr = S.frame;
    if (!fr || !fr.isConnected) { setVerdict('fail', 'Select a reachable ad frame first (Rescan if the list is empty).'); return; }
    var w, d;
    try { w = fr.contentWindow; d = fr.contentDocument; if (!d || !d.body) { throw new Error('no document'); } }
    catch (e) { setVerdict('fail', 'That frame is not reachable from this page (cross-origin).'); return; }
    var custom = $('chtml').value;
    var o = {
      pixel: $('pix').value.trim() || DEFAULT_PIXEL, real: $('bm').value === 'real', burn: $('burn').value,
      custom: custom, addSample: custom.trim() ? $('addsample').checked : true, addBurn: custom.trim() ? $('addburn').checked : true
    };
    if (o.real && !window.confirm('Send ONE real beacon to this URL when the ad is removed?\n\n' + o.pixel)) { return; }

    S.events = []; S.beacons = []; S.navigated = false; S.gotCb = false; S.gotHide = false;
    S.hideAt = 0; S.lastBeaconAt = 0; S.finished = false; S.win = w; S.opts = o;
    $('log').textContent = '';
    setVerdict('', '');
    $('verdict').className = '';
    S.startedAt = now();
    S.running = true;
    $('start').disabled = true;

    if ($('norefresh').checked) {
      try { window.googletag.pubads().refresh = function () { return; }; log('ACTION', 'googletag refresh() disabled for this page view (reload the page to undo)'); } catch (e) {}
    }
    var hatLog = function (k, m) { log(k, m); };
    var hatBeacon = function (u, ok) {
      S.beacons.push({ t: now(), url: u, queued: ok });
      S.lastBeaconAt = now();
      log('BEACON', 'sendBeacon called' + (o.real ? '' : ' (captured, not sent)') + ', queued=' + ok + ' url=' + short(u));
    };
    w.__hatLog = hatLog;
    w.__hatBeacon = hatBeacon;
    fr.addEventListener('load', function () {
      if (now() - S.startedAt < 1500) { return; } // our own write also fires load
      S.navigated = true;
      log('diag', 'ad iframe element fired load (frame navigated)');
    });

    log('ACTION', 'Start | focus: ' + document.hasFocus() + ' | visibility: ' + document.visibilityState + ' | beacon: ' + (o.real ? 'REAL' : 'capture only') + ' | burn: ' + o.burn);
    try {
      if (o.custom.trim()) {
        d.open();
        var w2 = fr.contentWindow;
        w2.__hatLog = hatLog;
        w2.__hatBeacon = hatBeacon;
        S.win = w2;
        d.write(o.custom + '<script>' + buildFrameCode(o) + '<\/script>');
        d.close();
        log('ACTION', 'Replaced the frame content with your creative' + (o.addSample ? ', sample script added' : '') + (o.addBurn ? ', burn added' : ''));
      } else {
        var s = d.createElement('script');
        s.textContent = buildFrameCode(o);
        d.body.appendChild(s);
      }
    } catch (e) {
      finish('fail', 'Could not install into the frame: ' + e.message);
    }
  }

  function stop() {
    if (S.running) { finish('info', 'Stopped by you. The burn loop was told to stop.'); } else { stopBurn(); }
  }

  function pathText() { return S.gotCb ? 'the observer callback ran' : 'only pagehide ran: the report was drained by takeRecords() (callback never ran)'; }

  function tick() {
    $('f').textContent = document.hasFocus() ? 'YES' : 'NO (click the page background, not the ad)';
    $('v').textContent = document.visibilityState;
    var warn = [];
    if (/Android|Mobile|iPhone/.test(navigator.userAgent)) { warn.push('Mobile user agent: device emulation looks ON. Ad slots differ from desktop; turn it off.'); }
    if (!/Chrome\//.test(navigator.userAgent)) { warn.push('Not Chrome: the heavy ad intervention only exists in Chrome.'); }
    $('warn').style.display = warn.length ? 'block' : 'none';
    $('warn').textContent = warn.join(' ');
    if (!S.running && (!S.frame || !S.frame.isConnected) && now() - lastScan > 2000) { rescan(); }
    if (!S.running || S.finished) { return; }
    var t = now(), age = t - S.startedAt;
    $('t').textContent = Math.round(age / 1000) + ' s';
    if (S.beacons.length > 0 && t - S.lastBeaconAt > 1500) {
      var n = S.beacons.length;
      finish(n === 1 ? 'pass' : 'fail',
        (n === 1 ? 'PASS: exactly one beacon. ' : 'FAIL: ' + n + ' beacons, expected one. ') +
        'Path: ' + pathText() + '. Removed after ' + rel(S.beacons[0].t) + '. Mode: ' +
        (S.opts.real ? 'REAL send (check your Network tab for the ping)' : 'capture only, nothing was sent') + '.');
      return;
    }
    if (S.gotHide && S.beacons.length === 0 && t - S.hideAt > 1800) {
      if (S.frame && !S.frame.isConnected) {
        finish('info', 'The page itself removed or replaced the frame (for example an ad refresh), not Chrome. No beacon was sent, which is correct. Rescan, pick a frame and retry.');
      } else if (S.navigated) {
        finish('fail', 'FAIL: Chrome navigated the frame but no beacon was sent.');
      }
    }
    if (age > TIMEOUT_MS) {
      finish('fail', 'FAIL: nothing happened within ' + Math.round(age / 1000) + ' s. Likely causes: the frame is not ad-tagged by Chrome, the tab was hidden or unfocused, the ad was clicked, or the Chrome heavy ad intervention is disabled.');
    }
  }

  function report() {
    var lines = [];
    lines.push('Heavy ad test report');
    lines.push('Page: ' + location.origin + location.pathname);
    lines.push('Browser: ' + navigator.userAgent);
    lines.push('Frame: ' + (S.frame ? (S.frame.id || S.frame.name || '(no id)') : 'none'));
    if (S.opts) { lines.push('Options: beacon=' + (S.opts.real ? 'REAL' : 'capture') + ', burn=' + S.opts.burn + ', pixel=' + S.opts.pixel); }
    lines.push('Verdict: ' + (S.verdictText || 'not finished'));
    lines.push('Events:');
    S.events.forEach(function (e) { lines.push('  +' + rel(e.t) + ' ' + e.kind + ' ' + e.msg); });
    return lines.join('\n');
  }

  function copyReport() {
    var text = report();
    var done = function () { log('ACTION', 'Report copied to the clipboard'); };
    try {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } catch (e) { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  function destroy() {
    if (tickTimer) { clearInterval(tickTimer); }
    stopBurn();
    if (host.parentNode) { host.parentNode.removeChild(host); }
    delete window.__heavyAdTester;
  }

  // ---------------------------------------------------------------- wire up
  $('x').onclick = destroy;
  $('rescan').onclick = rescan;
  $('start').onclick = start;
  $('stop').onclick = stop;
  $('copy').onclick = copyReport;
  tickTimer = setInterval(tick, 300);
  rescan();
  window.__heavyAdTester = { start: start, stop: stop, rescan: rescan, report: report, state: S, destroy: destroy };
})();
