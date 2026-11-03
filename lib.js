/*
 * Heavy ads tool: shared code for the static test pages.
 *
 * Everything runs in the browser, so the pages work from GitHub Pages or any static host.
 * Events from creative frames come back to the page with postMessage (the frames can be cross-origin).
 */
(function (w) {
  'use strict';
  var HAT = (w.HAT = {});
  var S = (HAT.state = {
    startedAt: 0, finished: false, beacons: [], cb: false, hide: false, hideAt: 0, real: false, label: '', timeoutMs: 150000,
    reports: [], beaconInfo: []
  });
  var rows = [];
  var known = [];

  function $(id) { return document.getElementById(id); }
  function pad(n, len) { return String(n).padStart(len, '0'); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  HAT.$ = $;

  // ---------------------------------------------------------------- snippets that run inside creative frames
  // The heavy ad sample script under test (unchanged apart from the pixel value).
  HAT.SAMPLE = function (pixel) {
    return [
      '(function () {',
      'var PIXEL = ' + JSON.stringify(pixel) + ';',
      '',
      '',
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
      '',
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
      '',
      '})();'
    ].join('\n');
  };

  // Load generator: keeps the main thread about 94% busy.
  HAT.BURN = '(function burn(){var s=performance.now();while(performance.now()-s<80){Math.sqrt(Math.random());}setTimeout(burn,5);})();';

  // Reporter (runs first inside the creative frame):
  //  - replaces sendBeacon with a wrapper that records the exact URL of every call (sends it only in real mode),
  //  - wraps ReportingObserver so the EXACT report objects the sample script receives (on the callback path and
  //    on the pagehide takeRecords() path) are posted to the page, without changing what the script gets,
  //  - posts diagnostics (callback ran, pagehide fired) to the page.
  HAT.reporter = function (real) {
    return '(function(){var T=window.top;function post(kind,msg,extra){try{T.postMessage({hat:1,kind:kind,msg:String(msg),extra:extra||null},"*");}catch(e){}}' +
      'var RO=window.ReportingObserver;' +
      'function rep(rs,path){try{for(var i=0;i<rs.length;i++){var r=rs[i],j=null;try{j=r.toJSON?r.toJSON():null;}catch(e){j=null;}' +
      'if(!j){var b=r.body||{};j={type:r.type,url:r.url,body:{id:b.id,message:b.message,sourceFile:b.sourceFile,lineNumber:b.lineNumber,columnNumber:b.columnNumber}};}' +
      'post("report","report seen by the script via "+path,{path:path,report:j});}}catch(e){}}' +
      'var real=' + (real ? 'true' : 'false') + ';var origSB=navigator.sendBeacon.bind(navigator);' +
      'navigator.sendBeacon=function(u,d){var ok=true;if(real){ok=false;try{ok=origSB(u,d);}catch(e){}}post("beacon",(real?"REAL":"captured, not sent")+" queued="+ok,{url:String(u),queued:ok,real:real});return ok;};' +
      'try{new RO(function(rs){rs.forEach(function(r){post("diag","observer callback got "+(r.body&&r.body.id));});},{types:["intervention"],buffered:true}).observe();}catch(e){post("diag","no ReportingObserver");}' +
      'if(RO){var W=function(cb,opts){var o=new RO(function(rs,obs){rep(rs,"observer callback");return cb.call(this,rs,obs);},opts);var tr=o.takeRecords;o.takeRecords=function(){var r=tr.call(o);rep(r,"pagehide takeRecords()");return r;};return o;};W.prototype=RO.prototype;window.ReportingObserver=W;}' +
      'window.addEventListener("pagehide",function(){post("diag","pagehide fired in the creative frame");});' +
      'post("diag","reporter armed | document origin: "+window.origin+" | storage: "+(function(){try{localStorage.length;return "allowed";}catch(e){return "BLOCKED";}})());})();';
  };

  HAT.b64 = function (s) { return btoa(unescape(encodeURIComponent(s))); };

  // Build a full creative document: reporter first, then the creative, then optionally the sample script and the burn.
  HAT.buildDoc = function (bodyHtml, o) {
    var close = '</' + 'script>';
    return '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script>' + HAT.reporter(o.real) + close + '\n' +
      bodyHtml +
      (o.addSample ? '\n<script>' + HAT.SAMPLE(o.pixel) + close : '') +
      (o.addBurn ? '\n<script>' + HAT.BURN + close : '') +
      '</body></html>';
  };

  // ---------------------------------------------------------------- page helpers
  HAT.accessible = function (f) { try { return !!f.contentDocument; } catch (e) { return false; } };
  HAT.adFrame = function () { return document.querySelector('iframe[id^="google_ads_iframe_"]'); };

  function render() {
    rows.sort(function (a, b) { return a.t - b.t; });
    var h = '';
    rows.forEach(function (r) {
      var d = new Date(r.t);
      h += '<tr class="' + r.kind + '"><td>' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2) + '.' + pad(d.getMilliseconds(), 3) +
        '</td><td>' + r.kind + '</td><td>' + esc(r.msg) + '</td></tr>';
    });
    $('log').innerHTML = h;
  }
  HAT.add = function (kind, msg, t) { rows.push({ t: t || Date.now(), kind: kind, msg: msg }); render(); };
  HAT.verdict = function (kind, text) { var v = $('verdict'); v.className = kind; v.textContent = text; HAT.add(kind.toUpperCase(), text); };

  // Show exactly what Chrome returned and exactly what the script sent.
  function pretty(o) { try { return JSON.stringify(o, null, 2); } catch (e) { return String(o); } }
  HAT.renderResult = function () {
    var el = $('result');
    if (!el) { return; }
    var h = '';
    S.reports.forEach(function (x, i) {
      h += '<h3>1. The report Chrome handed to the script' + (S.reports.length > 1 ? ' (#' + (i + 1) + ')' : '') + '</h3>' +
        '<div class="hint">Delivered via: <b>' + esc(x.path) + '</b>. This is the exact report object, as JSON.</div>' +
        '<pre>' + esc(pretty(x.report)) + '</pre>';
    });
    S.beaconInfo.forEach(function (b, i) {
      var url = b.url, at = url.indexOf('&rd='), base = at > -1 ? url.slice(0, at) : url, rdText = '', rdJson = null;
      if (at > -1) { try { rdText = decodeURIComponent(url.slice(at + 4)); rdJson = JSON.parse(rdText); } catch (e) { rdJson = null; } }
      h += '<h3>2. The beacon the script built' + (S.beaconInfo.length > 1 ? ' (#' + (i + 1) + ')' : '') + '</h3>' +
        '<div class="hint">' + (b.real ? '<b>REAL send</b>: this request was sent.' : '<b>Captured only</b>: nothing was sent.') + ' <code>sendBeacon</code> returned ' + esc(b.queued) + '.</div>' +
        '<div class="hint">Exact URL (POST, no body):</div><pre>' + esc(url) + '</pre>' +
        '<div class="hint">Pixel part (your <code>PIXEL</code> value):</div><pre>' + esc(base) + '</pre>' +
        '<div class="hint">The <code>rd</code> parameter, decoded:</div><pre>' + esc(rdJson ? pretty(rdJson) : (rdText || '(none)')) + '</pre>';
    });
    if (S.reports.length || S.beaconInfo.length) {
      h += '<div class="hint" style="margin-top:8px"><b>How to read it.</b> <code>type</code> is always <code>intervention</code> and <code>body.id</code> is ' +
        '<code>HeavyAdIntervention</code> for this case. <code>message</code> is Chrome\'s reason. <code>sourceFile</code>, <code>lineNumber</code> and ' +
        '<code>columnNumber</code> are normally <code>null</code> for heavy ads (Chrome gives no code location). The script copies only ' +
        '<code>message</code>, <code>sourceFile</code>, <code>lineNumber</code> and <code>columnNumber</code> into <code>rd</code>; ' +
        '<code>type</code>, <code>url</code> and <code>id</code> are not sent.</div>';
      if (S.reports.length && !S.beaconInfo.length) { h += '<div class="hint" style="color:#b00020"><b>A report arrived but no beacon has been built yet.</b></div>'; }
    }
    el.innerHTML = h;
  };

  // Call when a test starts. label names the creative type, shown in the verdict.
  HAT.begin = function (label, real) {
    S.startedAt = Date.now(); S.finished = false; S.beacons = []; S.cb = false; S.hide = false; S.hideAt = 0; S.real = !!real; S.label = label;
    S.reports = []; S.beaconInfo = [];
    $('verdict').className = '';
    if ($('result')) { $('result').innerHTML = ''; }
    return S.startedAt;
  };

  function status() {
    $('focus').textContent = document.hasFocus() ? 'YES' : 'NO (click the page background, not the ad)';
    $('vis').textContent = document.visibilityState;
    if (S.startedAt && !S.finished) { $('elapsed').textContent = Math.round((Date.now() - S.startedAt) / 1000) + ' s'; }
    var warn = [];
    if (/Android|Mobile|iPhone/.test(navigator.userAgent)) { warn.push('Mobile user agent: device emulation looks ON. Turn it off, the ad slots differ.'); }
    if (!/Chrome\//.test(navigator.userAgent)) { warn.push('Not Chrome: the heavy ad intervention only exists in Chrome.'); }
    $('warn').style.display = warn.length ? 'block' : 'none';
    $('warn').textContent = warn.join(' ');
    if (HAT.onStatus) { HAT.onStatus(); }
  }

  function scanFrames() {
    var list = document.querySelectorAll('iframe');
    list.forEach(function (f) {
      if (known.indexOf(f) < 0) {
        known.push(f);
        var name = f.id || f.name || '(no id)';
        HAT.add('ad', 'iframe appeared: ' + name + ' | ' + (HAT.accessible(f) ? 'same-origin (reachable)' : 'cross-origin') + ' | sandbox=' + (f.getAttribute('sandbox') === null ? 'none' : 'yes'));
        f.addEventListener('load', function () { HAT.add('ad', 'iframe fired load: ' + name); });
      }
    });
    known.forEach(function (f) { if (!f.isConnected && !f.__gone) { f.__gone = true; HAT.add('ad', 'iframe was removed from the page: ' + (f.id || f.name || '(no id)')); } });
  }

  function tick() {
    if (!S.startedAt || S.finished) { return; }
    var t = Date.now(), age = t - S.startedAt, n = S.beacons.length;
    if (n > 0 && t - S.beacons[n - 1] > 1500) {
      S.finished = true; $('elapsed').textContent = 'done';
      var path = S.cb ? 'the observer callback ran' : (S.hide ? 'only pagehide ran (takeRecords drain, callback never ran)' : 'unknown');
      HAT.verdict(n === 1 ? 'pass' : 'fail',
        (n === 1 ? 'PASS: exactly one beacon. ' : 'FAIL: ' + n + ' beacons, expected one. ') + 'Creative type: ' + S.label + '. Path: ' + path +
        '. Removed about ' + ((S.beacons[0] - S.startedAt) / 1000).toFixed(1) + ' s after Start. ' +
        (S.real ? 'REAL beacon sent (check DevTools > Network for the ping).' : 'Captured only, nothing was sent.'));
      if (HAT.onFinish) { HAT.onFinish(); }
    } else if (S.hide && n === 0 && t - S.hideAt > 2500) {
      S.finished = true;
      HAT.verdict('info', 'Creative type: ' + S.label + '. The creative frame was torn down (pagehide fired) but no beacon was sent. If Chrome did not remove it (for example the page replaced it, or the ad finished), that is correct. Check the timeline.');
      if (HAT.onFinish) { HAT.onFinish(); }
    } else if (age > S.timeoutMs) {
      S.finished = true;
      HAT.verdict('fail', 'Creative type: ' + S.label + '. Nothing happened within ' + Math.round(age / 1000) + ' s. The frame may not be ad-tagged, the tab may be unfocused or hidden, the ad may have been clicked, the creative may not be heavy enough, or the intervention is disabled in this Chrome.');
      if (HAT.onFinish) { HAT.onFinish(); }
    }
  }

  HAT.init = function () {
    setInterval(status, 400);
    setInterval(scanFrames, 300);
    setInterval(tick, 500);
    w.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || !d.hat) { return; }
      if (d.kind === 'report') {
        S.reports.push(d.extra);
        HAT.add('REPORT', JSON.stringify(d.extra.report) + '   (via ' + d.extra.path + ')');
        HAT.renderResult();
        return;
      }
      HAT.add(d.kind === 'beacon' ? 'BEACON' : 'diag', '[creative frame] ' + d.msg + (d.kind === 'beacon' && d.extra ? ' url=' + d.extra.url : ''));
      if (d.kind === 'beacon') { S.beacons.push(Date.now()); if (d.extra) { S.beaconInfo.push(d.extra); } HAT.renderResult(); }
      if (/observer callback got HeavyAdIntervention/.test(d.msg)) { S.cb = true; }
      if (/^pagehide/.test(d.msg)) { S.hide = true; S.hideAt = Date.now(); }
    });
    // Newer Chrome versions also send the report to the embedding page.
    try { new ReportingObserver(function (rs) { rs.forEach(function (r) { HAT.add('ad', 'top-level page got report: ' + (r.body && r.body.id)); }); }, { types: ['intervention'], buffered: true }).observe(); } catch (e) {}
  };
})(window);
