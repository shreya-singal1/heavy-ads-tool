// Local test bed for the Heavy Ad Test Tool.
//
//   node server.js        then open one of:
//
//   http://localhost:8770/            Index of the test pages, one per creative type
//   http://localhost:8770/panel       Google's public test ad plus the test panel (heavy-ad-tester.js)
//   http://localhost:8770/vpaid       A heavy VPAID (video) VAST creative played by the IMA SDK
//   http://localhost:8770/creative    Load ANY creative (or ../heavy-creative.html) into a real GPT ad frame, in a
//                                     same-origin frame, a cross-origin nested frame, or a sandboxed cross-origin
//                                     frame (SafeFrame-like), and see whether your pixel arrives
//   http://localhost:8770/gam?unit=/NETWORK/AD_UNIT&size=300x250
//                                     A page for YOUR Google Ad Manager ad unit. Put heavy-creative.html in a GAM
//                                     creative that serves to that unit, then open this page.
//
// The server only serves pages and records the pixel hits of /creative. It sends nothing anywhere.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8770;
const ROOT = path.join(__dirname, "..");
const hits = [];
const diag = [];
const store = {}; // id -> { html, addSample, addBurn }
let nextId = 1;

const GPT = '<script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>';

// ---- snippets added around a creative ----
const SAMPLE = [
  "(function () {",
  'var PIXEL = "__PIXEL__";',
  "",
  "",
  "function send(reports) {",
  "    for (var i = 0; i < reports.length; i++) {",
  "        try {",
  "            var body = reports[i].body;",
  '            if (!body || body.id !== "HeavyAdIntervention") {',
  "                continue;",
  "            }",
  '            var sep = "&";',
  '            navigator.sendBeacon(PIXEL + sep + "rd=" + encodeURIComponent(JSON.stringify({',
  "                message: body.message,",
  "                sourceFile: body.sourceFile,",
  "                lineNumber: body.lineNumber,",
  "                columnNumber: body.columnNumber",
  "            })));",
  "        } catch (e) {",
  "        }",
  "    }",
  "}",
  "",
  "try {",
  "    var observer = new ReportingObserver(send, {",
  '        types: ["intervention"],',
  "        buffered: true",
  "    });",
  "    observer.observe();",
  '    window.addEventListener("pagehide", function () {',
  "        send(observer.takeRecords());",
  "    });",
  "} catch (e) {",
  "}",
  "",
  "})();",
].join("\n");

const DIAG =
  '(function(){function d(e){try{navigator.sendBeacon("/diag?e="+encodeURIComponent(e)+"&t="+Date.now());}catch(x){}}' +
  'd("diagnostics armed in the creative frame | url origin: "+(function(){try{return location.origin;}catch(e){return "?";}})()+" | document origin: "+window.origin+" | storage: "+(function(){try{localStorage.length;return "allowed";}catch(e){return "BLOCKED (sandboxed)";}})());' +
  'try{new ReportingObserver(function(rs){rs.forEach(function(r){d("observer callback got "+(r.body&&r.body.id));});},{types:["intervention"],buffered:true}).observe();}catch(e){d("no ReportingObserver");}' +
  'window.addEventListener("pagehide",function(){d("pagehide fired in the creative frame");});})();';

const BURN =
  "(function burn(){var s=performance.now();while(performance.now()-s<80){Math.sqrt(Math.random());}setTimeout(burn,5);})();";

// Build the final document for a stored creative. origin is the origin the frame is served from,
// so the pixel is a same-origin request for that frame.
function buildFrameHtml(id, origin) {
  const c = store[id];
  if (!c) { return "<p>unknown creative id</p>"; }
  const pixel = origin + "/pixel?cid=" + (c.html.trim() ? "CUSTOM" : "CREATIVE") + "&bidder=local&size=300x250";
  let body;
  if (c.html.trim()) {
    body = c.html;
    if (c.addSample) { body += "\n<script>\n" + SAMPLE.replace("__PIXEL__", pixel) + "\n</script>"; }
    if (c.addBurn) { body += "\n<script>" + BURN + "</script>"; }
  } else {
    // default creative: heavy-creative.html already contains the sample script and the burn
    body = fs.readFileSync(path.join(ROOT, "heavy-creative.html"), "utf8").replace('"HEAVY_AD_PIXEL"', JSON.stringify(pixel));
  }
  return '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><script>' + DIAG + "</script>\n" + body + "</body></html>";
}

const PANEL_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Heavy ad test bed</title>${GPT}
<script>
window.googletag = window.googletag || { cmd: [] };
googletag.cmd.push(function () {
  googletag.defineSlot('/6355419/Travel/Europe/France/Paris', [300, 250], 'ad-slot').addService(googletag.pubads());
  googletag.enableServices();
  googletag.display('ad-slot');
});
</script></head>
<body style="font-family:sans-serif">
<h3>Heavy ad test bed (Google public test ad)</h3>
<p>Wait for the test ad, then use the panel at the bottom right. Do not click inside the ad.
<a href="/">Back to the test bed index</a> (all creative types).</p>
<div id="ad-slot" style="width:300px;height:250px;background:#eee"></div>
<script src="/heavy-ad-tester.js"></script>
</body></html>`;

// Shared page chrome: status bar, timeline, and the script that watches the ad slot.
const COMMON_CSS = `
body{font-family:system-ui,sans-serif;margin:16px;max-width:980px;color:#1a1a1a}
h2{margin:0 0 8px}
.bar{background:#eef3fb;border:1px solid #b9c9e6;border-radius:6px;padding:8px 10px;font-size:13px}
.note{background:#fff7e0;border:1px solid #e6c866;border-radius:6px;padding:8px 10px;font-size:13px;margin:8px 0}
button{padding:8px 12px;font-size:13px;cursor:pointer;margin:4px 6px 4px 0}
button[disabled]{opacity:.5;cursor:not-allowed}
fieldset{border:1px solid #bbb;border-radius:6px;margin:8px 0;padding:8px 10px;font-size:13px}
textarea{width:100%;box-sizing:border-box;font:12px ui-monospace,Consolas,monospace}
select{font-size:13px}
#verdict{margin:10px 0;padding:10px 12px;border-radius:6px;font-size:14px;display:none}
#verdict.pass{display:block;background:#bdf0bd;border:1px solid #6cc06c}
#verdict.fail{display:block;background:#ffc9c9;border:1px solid #e07070}
#verdict.info{display:block;background:#fff3cd;border:1px solid #e6c866}
table{border-collapse:collapse;width:100%;font-size:12px;margin-top:8px}
td{border-bottom:1px solid #ddd;padding:3px 6px;vertical-align:top;word-break:break-all}
tr.PIXEL td{background:#e3f6e3}tr.ACTION td{background:#e6eefc;font-weight:600}tr.diag td{color:#555}tr.PASS td{background:#bdf0bd;font-weight:600}tr.FAIL td{background:#ffc9c9;font-weight:600}tr.INFO td{background:#fff3cd;font-weight:600}tr.ad td{background:#f3eaff}
`;

const COMMON_JS = `
var startedAt = 0, finished = false, rows = [], seen = {}, slotFrame = null, hits = [], diag = [];
function $(i){return document.getElementById(i);}
function pad(n,w){return String(n).padStart(w,'0');}
function add(t,kind,msg){rows.push({t:t,kind:kind,msg:msg});render();}
function render(){rows.sort(function(a,b){return a.t-b.t;});var h='';rows.forEach(function(r){var d=new Date(r.t);h+='<tr class="'+r.kind+'"><td>'+pad(d.getMinutes(),2)+':'+pad(d.getSeconds(),2)+'.'+pad(d.getMilliseconds(),3)+'</td><td>'+r.kind+'</td><td>'+r.msg+'</td></tr>';});$('log').innerHTML=h;}
function adFrame(){return document.querySelector('iframe[id^="google_ads_iframe_"]');}
function accessible(f){try{return !!f.contentDocument;}catch(e){return false;}}
function status(){var f=adFrame();$('focus').textContent=document.hasFocus()?'YES':'NO (click the page background, not the ad)';$('vis').textContent=document.visibilityState;
  $('frame').textContent=!f?'waiting for ad':(accessible(f)?'ready (same-origin)':'present (cross-origin)');
  if(startedAt&&!finished){$('elapsed').textContent=Math.round((Date.now()-startedAt)/1000)+' s';}
  if(/Android|Mobile/.test(navigator.userAgent)){$('warn').style.display='block';$('warn').textContent='Mobile user agent: device emulation looks ON. Turn it off, the ad slots differ.';}}
setInterval(status,400);
function verdict(kind,text){var v=$('verdict');v.className=kind;v.textContent=text;add(Date.now(),kind.toUpperCase(),text);}
// Top-level ReportingObserver: newer Chrome versions also send the report to the embedding page.
try{new ReportingObserver(function(rs){rs.forEach(function(r){add(Date.now(),'ad','top-level page got report: '+(r.body&&r.body.id));});},{types:['intervention'],buffered:true}).observe();}catch(e){}
function watchFrame(f){
  if(!f||f===slotFrame)return;slotFrame=f;
  add(Date.now(),'ad','ad frame present: '+f.id);
  f.addEventListener('load',function(){add(Date.now(),'ad','ad iframe fired load');});
}
setInterval(function(){var f=adFrame();if(f&&f!==slotFrame){watchFrame(f);}
  if(slotFrame&&!slotFrame.isConnected&&!slotFrame.__gone){slotFrame.__gone=true;add(Date.now(),'ad','ad frame was removed from the page');}},300);
`;

const INDEX_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Heavy ads tool: test bed</title>
<style>${COMMON_CSS}
table.t td,table.t th{border-bottom:1px solid #ddd;padding:8px 10px;vertical-align:top;font-size:14px;text-align:left}
table.t th{background:#eef3fb}
a.go{display:inline-block;background:#1a4fa0;color:#fff;padding:5px 10px;border-radius:5px;text-decoration:none;font-size:13px;white-space:nowrap}
</style></head><body>
<h2>Heavy ads tool: test bed</h2>
<p>Checks the heavy ad detection script (the one that reports when Chrome removes an ad for using too many resources). Pick the kind of creative you want to test.
Desktop Chrome only. Keep the tab in front and do not click inside the ad.</p>
<table class="t"><thead><tr><th>Creative type</th><th>What it is</th><th>Open</th></tr></thead><tbody>
<tr><td><b>Simple banner</b></td><td>HTML creative in a same-origin frame, like a GAM friendly iframe. The creative runs inside the ad frame itself.</td><td><a class="go" href="/creative?type=friendly">Test</a></td></tr>
<tr><td><b>Cross-origin iframe banner</b></td><td>The creative is served from another origin and sits in an iframe nested inside the ad frame.</td><td><a class="go" href="/creative?type=cross">Test</a></td></tr>
<tr><td><b>SafeFrame-like banner</b></td><td>Cross-origin and sandboxed (opaque origin, storage blocked), the strictest frame a creative can get. A stand-in for a Google SafeFrame.</td><td><a class="go" href="/creative?type=sandbox">Test</a></td></tr>
<tr><td><b>VPAID video (IBV)</b></td><td>A heavy VPAID VAST creative played by Google's IMA SDK. IMA runs the VPAID code in its own cross-origin iframe.</td><td><a class="go" href="/vpaid">Test</a></td></tr>
<tr><td><b>Your GAM creative</b></td><td>A creative served by your own Google Ad Manager ad unit. Open <code>/gam?unit=/NETWORK/AD_UNIT&amp;size=300x250</code>.</td><td><a class="go" href="/gam">Test</a></td></tr>
<tr><td><b>Any live page</b></td><td>The DevTools panel picks a same-origin ad frame on any page. Shown here on Google's test ad.</td><td><a class="go" href="/panel">Panel demo</a></td></tr>
</tbody></table>
<p>The banner pages also take <b>any creative HTML</b> that you paste or load from a file, with or without the sample script and the CPU burn.</p>
</body></html>`;

const CREATIVE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Creative test</title>${GPT}
<style>${COMMON_CSS}</style>
<script>
window.googletag = window.googletag || { cmd: [] };
googletag.cmd.push(function () {
  googletag.defineSlot('/6355419/Travel/Europe/France/Paris', [300, 250], 'ad-slot').addService(googletag.pubads());
  googletag.enableServices();
  googletag.display('ad-slot');
});
</script></head><body>
<h2>Creative test (local)</h2>
<div class="bar">Page focus: <b id="focus">?</b> &nbsp;|&nbsp; Visibility: <b id="vis">?</b> &nbsp;|&nbsp; Ad frame: <b id="frame">?</b> &nbsp;|&nbsp; Elapsed: <b id="elapsed">-</b></div>
<div class="note" id="warn" style="display:none"></div>
<div class="note">This page serves Google's real test ad so Chrome treats the frame as an ad, then loads your creative into it, the way GAM does.
The creative burns CPU, Chrome removes it, and the creative's script sends its pixel to this server (a real request). Do not click inside the ad. Keep this tab in front.</div>
<fieldset><legend>Creative</legend>
<label>Frame type:
<select id="ftype">
<option value="friendly">Simple banner: same-origin frame (GAM friendly iframe)</option>
<option value="cross">Cross-origin iframe banner (creative served from another origin)</option>
<option value="sandbox">SafeFrame-like banner: cross-origin and sandboxed (opaque origin)</option>
</select></label>
<p style="margin:6px 0 2px">Your creative HTML (leave empty to use <code>heavy-creative.html</code>, which already contains the sample script and the burn):</p>
<textarea id="chtml" rows="6" placeholder="Paste any creative HTML here, or choose a file below"></textarea>
<div style="margin-top:4px"><input type="file" id="cfile"></div>
<label><input type="checkbox" id="addSample" checked> add the heavy ad sample script to my creative</label>
&nbsp;<label><input type="checkbox" id="addBurn" checked> add the CPU burn (forces Chrome to remove it)</label>
<div style="color:#666;font-size:12px">The two boxes only apply when you paste your own creative.</div>
</fieldset>
<button id="start">Start: load the creative into the ad</button><button id="reload">Reload for a fresh ad</button>
<div id="slotwrap" style="margin-top:8px"><div id="ad-slot" style="width:300px;height:250px;background:#eee"></div></div>
<div id="verdict"></div>
<table><tbody id="log"></tbody></table>
<script>${COMMON_JS}
function poll(){fetch('/hits').then(function(r){return r.json();}).then(function(j){hits=j.hits;diag=j.diag;
  j.hits.forEach(function(h){var k='p'+h.t;if(seen[k])return;seen[k]=1;var rd='';try{rd=decodeURIComponent(h.url.split('&rd=')[1]||'');}catch(e){}add(h.t,'PIXEL','server received '+h.method+' '+h.url.split('&rd=')[0]+' &rd='+rd);});
  j.diag.forEach(function(d){var k='d'+d.t+d.e;if(seen[k])return;seen[k]=1;add(d.t,'diag','[creative frame] '+d.e);});check();}).catch(function(){});}
setInterval(poll,500);
function check(){
  if(!startedAt||finished)return;
  var hs=hits.filter(function(h){return h.t>=startedAt;});var ds=diag.filter(function(d){return d.t>=startedAt;});
  var cb=ds.some(function(d){return d.e.indexOf('observer callback got')===0;});var ph=ds.some(function(d){return d.e.indexOf('pagehide')===0;});
  var age=Date.now()-startedAt;
  if(hs.length>0&&Date.now()-hs[0].t>1500){finished=true;$('elapsed').textContent='done';$('start').disabled=true;
    verdict(hs.length===1?'pass':'fail','Creative type: '+$('ftype').options[$('ftype').selectedIndex].text+'. Server received '+hs.length+' pixel(s) over the real network, '+((hs[0].t-startedAt)/1000).toFixed(1)+' s after the creative started. Path: '+(cb?'the observer callback ran':(ph?'only pagehide ran (takeRecords drain)':'unknown'))+'. '+(hs.length===1?'Exactly one, no duplicate.':'Expected exactly one.'));}
  else if(age>150000){finished=true;$('start').disabled=true;verdict('fail','Creative type: '+$('ftype').options[$('ftype').selectedIndex].text+'. No pixel within '+Math.round(age/1000)+' s. The frame may not be ad-tagged, the tab may be hidden or unfocused, the ad may have been clicked, the creative may not be heavy, or the intervention is disabled in this Chrome.');}
}
var qt=new URLSearchParams(location.search).get('type');if(qt&&['friendly','cross','sandbox'].indexOf(qt)>-1){$('ftype').value=qt;}
$('reload').onclick=function(){fetch('/reset').then(function(){location.reload();});};
$('cfile').onchange=function(){var f=$('cfile').files[0];if(!f)return;var r=new FileReader();r.onload=function(){$('chtml').value=r.result;};r.readAsText(f);};
$('start').onclick=async function(){
  var f=adFrame();
  if(!f||!accessible(f)){add(Date.now(),'FAIL','The test ad is not ready yet. Wait for it to appear, then click Start.');return;}
  var ft=$('ftype').value;
  var res=await fetch('/creative-custom',{method:'POST',body:JSON.stringify({html:$('chtml').value,addSample:$('addSample').checked,addBurn:$('addBurn').checked})}).then(function(r){return r.json();});
  startedAt=Date.now();finished=false;$('start').disabled=true;
  add(startedAt,'ACTION','Start | frame type: '+ft+' | '+($('chtml').value.trim()?'your creative':'heavy-creative.html')+' | focus: '+document.hasFocus()+' | visibility: '+document.visibilityState);
  var d=f.contentDocument;
  d.open();
  if(ft==='friendly'){
    var html=await fetch('/frame/'+res.id).then(function(r){return r.text();});
    d.write(html);
  } else {
    d.write('<body style="margin:0"><iframe src="http://127.0.0.1:${PORT}/frame/'+res.id+'" '+(ft==='sandbox'?'sandbox="allow-scripts allow-popups allow-forms" ':'')+'style="width:100%;height:250px;border:0"></iframe></body>');
  }
  d.close();
  add(Date.now(),'ACTION','Creative loaded. It is burning CPU now. Waiting for Chrome to remove the ad (about 15 to 60 s).');
};
</script></body></html>`;

const GAM_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>GAM heavy creative test</title>${GPT}
<style>${COMMON_CSS}</style>
<script>
window.googletag = window.googletag || { cmd: [] };
var q = new URLSearchParams(location.search);
var unit = q.get('unit') || '';
var sz = (q.get('size') || '300x250').split('x').map(Number);
googletag.cmd.push(function () {
  if (!/^\\/\\d+\\/[\\w\\-\\/.]+$/.test(unit)) { return; }
  var slot = googletag.defineSlot(unit, [sz], 'gam-slot').addService(googletag.pubads());
  googletag.pubads().addEventListener('slotRenderEnded', function (e) {
    window.__renderEnded = {empty: e.isEmpty, size: e.size, t: Date.now()};
  });
  googletag.enableServices();
  googletag.display('gam-slot');
});
</script></head><body>
<h2>GAM heavy creative test page</h2>
<div class="bar">Page focus: <b id="focus">?</b> &nbsp;|&nbsp; Visibility: <b id="vis">?</b> &nbsp;|&nbsp; Ad frame: <b id="frame">?</b> &nbsp;|&nbsp; Since render: <b id="elapsed">-</b></div>
<div class="note" id="warn" style="display:none"></div>
<div class="note">Ad unit: <b id="unitshow"></b>. Put <code>heavy-creative.html</code> in a Google Ad Manager creative (with your real pixel in place of
<code>HEAVY_AD_PIXEL</code>) on a line item that serves to this ad unit, then load this page. The creative burns CPU on its own and Chrome should remove
it after about 15 to 60 s. Do not click the ad. Keep this tab in front. To see the pixel, open DevTools > Network, tick Preserve log and filter on your pixel host.</div>
<button id="reload">Reload page for a fresh ad</button>
<div id="slotwrap" style="margin-top:8px"><div id="gam-slot" style="min-width:300px;min-height:50px;background:#eee"></div></div>
<div id="verdict"></div>
<table><tbody id="log"></tbody></table>
<script>${COMMON_JS}
$('unitshow').textContent=unit||'(none: add ?unit=/NETWORK/AD_UNIT&size=300x250 to the URL)';
var badUnit=!/^\\/\\d+\\/[\\w\\-\\/.]+$/.test(unit);
if(badUnit){verdict('fail','Missing or invalid ad unit. Open this page as /gam?unit=/NETWORK_CODE/AD_UNIT_PATH&size=300x250');}
var renderSeen=false;
setInterval(function(){
  if(window.__renderEnded&&!renderSeen){renderSeen=true;startedAt=window.__renderEnded.t;
    add(startedAt,'ad','slot rendered: '+(window.__renderEnded.empty?'EMPTY (no ad served, check line item targeting)':'ad served, size '+(window.__renderEnded.size||[]).join('x')));}
  if(startedAt&&!finished&&slotFrame&&!slotFrame.isConnected){finished=true;$('elapsed').textContent='done';
    verdict('info','The ad frame left the page about '+Math.round((Date.now()-startedAt)/1000)+' s after render. Check your Network tab for the ping to your pixel. If the ad was replaced by a refresh instead of Chrome, retry.');}
},500);
$('reload').onclick=function(){location.reload();};
</script></body></html>`;

// ---------------------------------------------------------------- VPAID (IMA SDK) test
// Your heavy VPAID VAST fixture, parameterised. The VPAID code is the fixture's code as given; the options only
// change how many files it fetches, and (optionally) prepend the heavy ad sample script plus a reporter that posts
// its events back to the page with postMessage (the VPAID frame is cross-origin).
function vpaidOpts(sp) {
  const pixel = String(sp.get("pixel") || "");
  return {
    detect: sp.get("detect") === "1",
    real: sp.get("real") === "1",
    flood: Math.max(0, Math.min(100, parseInt(sp.get("flood") || "10", 10) || 0)),
    burnMs: 5000,
    mode: sp.get("mode") === "url" ? "url" : "data",
    pixel: /^https:\/\/[^"\s<>\\]+$/.test(pixel) ? pixel : "https://example.com/hv?cid=VPAID&bidder=testbidder&size=640x360",
  };
}

function detectionCode(o) {
  return (
    "(function(){var T=window.top;function post(kind,msg){try{T.postMessage({hat:1,kind:kind,msg:String(msg)},'*');}catch(e){}}\n" +
    "var real=" + (o.real ? "true" : "false") + ";var origSB=navigator.sendBeacon.bind(navigator);\n" +
    "navigator.sendBeacon=function(u,d){var ok=true;if(real){ok=false;try{ok=origSB(u,d);}catch(e){}}post('beacon',(real?'REAL':'captured, not sent')+' queued='+ok+' url='+String(u).slice(0,90));return ok;};\n" +
    "try{new ReportingObserver(function(rs){rs.forEach(function(r){post('diag','observer callback got '+(r.body&&r.body.id));});},{types:['intervention'],buffered:true}).observe();}catch(e){post('diag','no ReportingObserver');}\n" +
    "window.addEventListener('pagehide',function(){post('diag','pagehide fired in the VPAID frame');});\n" +
    "post('diag','detection armed | document origin: '+window.origin);})();\n" +
    SAMPLE.replace("__PIXEL__", o.pixel) +
    "\n"
  );
}

function vpaidSource(o) {
  return (o.detect ? detectionCode(o) : "") + `
(function() {
  var HeavyAdVpaid = function() {
    this.eventsCallbacks = {};
  };
  HeavyAdVpaid.prototype.initAd = function(w, h, vm, b, cd, ev) {
    this.callEvent('AdLoaded');
  };
  HeavyAdVpaid.prototype.startAd = function() {
    this.callEvent('AdStarted');
    this.callEvent('AdImpression');
    console.log("[VPAID] Starting heavy load...");

    // Burn CPU for 5 seconds (enough for longtask, but won't starve observer)
    const start = performance.now();
    const duration = ${o.burnMs};
    function burn() {
      const now = performance.now();
      while (performance.now() - now < 100) {
        for (let i = 0; i < 1000000; i++) Math.sqrt(i);
      }
      if (performance.now() - start < duration) {
        setTimeout(burn, 10);
      } else {
        console.log("[VPAID] CPU burn complete.");
      }
    }
    burn();

    // NETWORK FLOODING (to trigger the > 4MB network limit). The fixture used 50 requests; the page default is lower.
    for (let i = 0; i < ${o.flood}; i++) {
        fetch('https://storage.googleapis.com/gvabox/media/samples/android.mp4?cache=' + Math.random() + i)
            .then(r => r.blob())
            .then(b => console.log("[VPAID] Downloaded: " + b.size))
            .catch(e => console.log("[VPAID] Fetch error (expected if intervened): " + e.message));
    }
  };
  HeavyAdVpaid.prototype.stopAd = function() { this.callEvent('AdStopped'); };
  HeavyAdVpaid.prototype.subscribe = function(cb, e) { this.eventsCallbacks[e] = cb; };
  HeavyAdVpaid.prototype.unsubscribe = function(e) { delete this.eventsCallbacks[e]; };
  HeavyAdVpaid.prototype.callEvent = function(e) { if (this.eventsCallbacks[e]) this.eventsCallbacks[e](); };
  HeavyAdVpaid.prototype.getAdLinear = function() { return true; };
  HeavyAdVpaid.prototype.getAdRemainingTime = function() { return 30; };
  HeavyAdVpaid.prototype.getAdDuration = function() { return 30; };
  HeavyAdVpaid.prototype.handshakeVersion = function(v) { return '2.0'; };
  HeavyAdVpaid.prototype.resizeAd = function(w, h, vm) {};
  HeavyAdVpaid.prototype.pauseAd = function() {};
  HeavyAdVpaid.prototype.resumeAd = function() {};
  HeavyAdVpaid.prototype.expandAd = function() {};
  HeavyAdVpaid.prototype.collapseAd = function() {};
  HeavyAdVpaid.prototype.skipAd = function() {};
  HeavyAdVpaid.prototype.getAdWidth = function() { return 640; };
  HeavyAdVpaid.prototype.getAdHeight = function() { return 360; };
  HeavyAdVpaid.prototype.getAdIcons = function() { return false; };
  HeavyAdVpaid.prototype.getAdSkippableState = function() { return false; };
  HeavyAdVpaid.prototype.getAdExpanded = function() { return false; };
  HeavyAdVpaid.prototype.getAdVolume = function() { return 1.0; };
  HeavyAdVpaid.prototype.setAdVolume = function(v) {};
  window.getVPAIDAd = function() { return new HeavyAdVpaid(); };
})();
`;
}

function vastXml(o, origin, search) {
  const media =
    o.mode === "url"
      ? origin + "/vpaid.js?" + search
      : "data:application/javascript;base64," + Buffer.from(vpaidSource(o)).toString("base64");
  return `<VAST version="3.0">
              <Ad id="heavy-ad-unit">
                <InLine>
                  <AdSystem>Test System</AdSystem>
                  <AdTitle>Reliable Heavy Ad</AdTitle>
                  <Impression><![CDATA[https://example.com/impression]]></Impression>
                  <Creatives>
                    <Creative id="creative-1">
                      <Linear>
                        <Duration>00:00:30</Duration>
                        <MediaFiles>
                          <MediaFile delivery="progressive" type="application/javascript" apiFramework="VPAID" width="640" height="360">
                            <![CDATA[${media}]]>
                          </MediaFile>
                        </MediaFiles>
                      </Linear>
                    </Creative>
                  </Creatives>
                </InLine>
              </Ad>
            </VAST>`;
}

const VPAID_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>VPAID heavy creative test</title>
<script src="https://imasdk.googleapis.com/js/sdkloader/ima3.js"></script>
<style>${COMMON_CSS}</style></head><body>
<h2>VPAID heavy creative test (IMA SDK)</h2>
<div class="bar">Page focus: <b id="focus">?</b> &nbsp;|&nbsp; Visibility: <b id="vis">?</b> &nbsp;|&nbsp; IMA SDK: <b id="sdk">?</b> &nbsp;|&nbsp; Elapsed: <b id="elapsed">-</b></div>
<div class="note" id="warn" style="display:none"></div>
<div class="note">This page plays your heavy VPAID VAST creative with Google's IMA SDK. IMA runs a VPAID ad in its own iframe, which Chrome should treat as an ad.
The creative floods the network (it fetches a 6 MB sample video repeatedly) until Chrome removes the ad. With the first box ticked, the heavy ad sample script is added
at the top of the VPAID code and its events are posted back to this page. Do not click the ad. Keep this tab in front.</div>
<fieldset><legend>Options</legend>
<label><input type="checkbox" id="detect" checked> add the heavy ad sample script (and a reporter) to the VPAID code</label><br>
<label>Beacon: <select id="real"><option value="0">Capture only (nothing is sent)</option><option value="1">Send a real beacon to the pixel URL</option></select></label>
&nbsp;<label>Pixel URL: <input type="text" id="pix" size="60" value="https://example.com/hv?cid=VPAID&bidder=testbidder&size=640x360"></label><br>
<label>Files fetched (6 MB each, your fixture used 50): <input type="number" id="flood" value="10" min="0" max="100" style="width:60px"></label>
&nbsp;<label>VPAID code delivery: <select id="mode"><option value="data">data: URI (as in your fixture)</option><option value="url">served by this server</option></select></label>
</fieldset>
<button id="start">Start: play the VPAID creative</button><button id="reload">Reload</button>
<a href="/vpaid-vast?detect=0&flood=50&mode=data" target="_blank" style="font-size:13px">Open the VAST XML (as in your fixture, no sample script)</a>
<div style="position:relative;width:640px;height:360px;background:#000;margin-top:8px"><video id="vid" width="640" height="360" muted playsinline></video><div id="adc" style="position:absolute;left:0;top:0;width:640px;height:360px"></div></div>
<div id="verdict"></div>
<table><tbody id="log"></tbody></table>
<script>
var startedAt=0,finished=false,rows=[],beacons=[],cbSeen=false,hideSeen=false,hideAt=0,known=[],adsManager=null,realMode=false;
function $(i){return document.getElementById(i);}
function pad(n,w){return String(n).padStart(w,'0');}
function add(t,kind,msg){rows.push({t:t,kind:kind,msg:msg});render();}
function render(){rows.sort(function(a,b){return a.t-b.t;});var h='';rows.forEach(function(r){var d=new Date(r.t);h+='<tr class="'+r.kind+'"><td>'+pad(d.getMinutes(),2)+':'+pad(d.getSeconds(),2)+'.'+pad(d.getMilliseconds(),3)+'</td><td>'+r.kind+'</td><td>'+String(r.msg).replace(/</g,'&lt;')+'</td></tr>';});$('log').innerHTML=h;}
function verdict(kind,text){var v=$('verdict');v.className=kind;v.textContent=text;add(Date.now(),kind.toUpperCase(),text);}
function status(){$('focus').textContent=document.hasFocus()?'YES':'NO (click the page background, not the ad)';$('vis').textContent=document.visibilityState;
  $('sdk').textContent=(window.google&&google.ima)?'loaded':'NOT loaded (offline or blocked)';
  if(startedAt&&!finished){$('elapsed').textContent=Math.round((Date.now()-startedAt)/1000)+' s';}
  if(/Android|Mobile/.test(navigator.userAgent)){$('warn').style.display='block';$('warn').textContent='Mobile user agent: device emulation looks ON. Turn it off.';}}
setInterval(status,400);
try{new ReportingObserver(function(rs){rs.forEach(function(r){add(Date.now(),'ad','top-level page got report: '+(r.body&&r.body.id));});},{types:['intervention'],buffered:true}).observe();}catch(e){}
window.addEventListener('message',function(e){var d=e.data;if(!d||!d.hat)return;
  add(Date.now(),d.kind==='beacon'?'BEACON':'diag','[VPAID frame] '+d.msg);
  if(d.kind==='beacon'){beacons.push(Date.now());}
  if(/observer callback got HeavyAdIntervention/.test(d.msg)){cbSeen=true;}
  if(/^pagehide/.test(d.msg)){hideSeen=true;hideAt=Date.now();}});
function scanFrames(){var list=document.querySelectorAll('iframe');
  list.forEach(function(f){if(known.indexOf(f)<0){known.push(f);var acc=false,o='?';try{acc=!!f.contentDocument;}catch(e){}
    var src=(f.getAttribute('src')||'(no src)');try{o=new URL(f.src,location.href).origin;}catch(e){}
    add(Date.now(),'ad','iframe appeared: '+(f.id||f.name||'(no id)')+' | origin '+o+' | '+(acc?'same-origin':'cross-origin')+' | sandbox='+(f.getAttribute('sandbox')===null?'none':'yes'));
    f.addEventListener('load',function(){add(Date.now(),'ad','iframe fired load: '+(f.id||f.name||'(no id)'));});}});
  known.forEach(function(f){if(!f.isConnected&&!f.__gone){f.__gone=true;add(Date.now(),'ad','iframe was removed from the page: '+(f.id||f.name||'(no id)'));}});}
setInterval(scanFrames,300);
setInterval(function(){
  if(!startedAt||finished)return;var t=Date.now(),age=t-startedAt;
  if(beacons.length>0&&t-beacons[beacons.length-1]>1500){finished=true;$('elapsed').textContent='done';
    verdict(beacons.length===1?'pass':'fail',(beacons.length===1?'PASS: exactly one beacon. ':'FAIL: '+beacons.length+' beacons, expected one. ')+'Path: '+(cbSeen?'the observer callback ran':(hideSeen?'only pagehide ran (takeRecords drain)':'unknown'))+'. Removed about '+((beacons[0]-startedAt)/1000).toFixed(1)+' s after Start. '+(realMode?'REAL beacon sent (check the Network tab).':'Captured only, nothing was sent.'));}
  else if(hideSeen&&beacons.length===0&&t-hideAt>2500){finished=true;verdict('info','The VPAID frame was torn down (pagehide fired) but no beacon was sent. If Chrome did not remove it (for example the ad finished or errored), that is correct. Check the timeline above.');}
  else if(age>120000){finished=true;verdict('fail','Nothing happened within '+Math.round(age/1000)+' s. The VPAID frame may not be ad-tagged, the tab may be unfocused, or the ad failed to start (see the timeline). Try the other VPAID code delivery option.');}
},500);
$('reload').onclick=function(){location.reload();};
$('start').onclick=async function(){
  if(!(window.google&&google.ima)){add(Date.now(),'FAIL','The IMA SDK did not load (offline, or blocked by an extension).');return;}
  $('start').disabled=true;startedAt=Date.now();finished=false;realMode=$('real').value==='1';
  var q='detect='+($('detect').checked?1:0)+'&real='+$('real').value+'&flood='+encodeURIComponent($('flood').value)+'&mode='+$('mode').value+'&pixel='+encodeURIComponent($('pix').value);
  add(startedAt,'ACTION','Start | sample script: '+$('detect').checked+' | beacon: '+(realMode?'REAL':'capture')+' | files: '+$('flood').value+' | delivery: '+$('mode').value+' | focus: '+document.hasFocus()+' | visibility: '+document.visibilityState);
  var vast=await fetch('/vpaid-vast?'+q).then(function(r){return r.text();});
  try{
    google.ima.settings.setVpaidMode(google.ima.ImaSdkSettings.VpaidMode.ENABLED);
    var dc=new google.ima.AdDisplayContainer($('adc'),$('vid'));dc.initialize();
    var loader=new google.ima.AdsLoader(dc);
    loader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR,function(e){var er=e.getError();add(Date.now(),'FAIL','IMA ad error: '+er.getErrorCode()+' '+er.getMessage());},false);
    loader.addEventListener(google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,function(e){
      adsManager=e.getAdsManager($('vid'));
      adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR,function(ev){var er=ev.getError();add(Date.now(),'FAIL','IMA ad error: '+er.getErrorCode()+' '+er.getMessage());});
      ['LOADED','STARTED','IMPRESSION','COMPLETE','ALL_ADS_COMPLETED'].forEach(function(n){adsManager.addEventListener(google.ima.AdEvent.Type[n],function(){add(Date.now(),'ad','IMA event: '+n);});});
      add(Date.now(),'ACTION','IMA loaded the VAST. Initialising and starting the ad (the VPAID code runs in its own iframe).');
      adsManager.init(640,360,google.ima.ViewMode.NORMAL);adsManager.start();},false);
    var req=new google.ima.AdsRequest();req.adsResponse=vast;req.linearAdSlotWidth=640;req.linearAdSlotHeight=360;req.nonLinearAdSlotWidth=640;req.nonLinearAdSlotHeight=150;
    loader.requestAds(req);
  }catch(err){add(Date.now(),'FAIL','Could not start IMA: '+err.message);}
};
</script></body></html>`;

http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://localhost:" + PORT);
    const p = u.pathname;
    const html = (body) => { res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); res.end(body); };
    if (p === "/") { html(INDEX_PAGE); }
    else if (p === "/panel") { html(PANEL_PAGE); }
    else if (p === "/creative") { html(CREATIVE_PAGE); }
    else if (p === "/gam") { html(GAM_PAGE); }
    else if (p === "/vpaid") { html(VPAID_PAGE); }
    else if (p === "/vpaid-vast") {
      res.writeHead(200, { "Content-Type": "text/xml", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
      res.end(vastXml(vpaidOpts(u.searchParams), "http://" + req.headers.host, u.searchParams.toString()));
    } else if (p === "/vpaid.js") {
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
      res.end(vpaidSource(vpaidOpts(u.searchParams)));
    }
    else if (p === "/creative-custom" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let o = {};
        try { o = JSON.parse(body); } catch (e) {}
        const id = String(nextId++);
        store[id] = { html: String(o.html || ""), addSample: o.addSample !== false, addBurn: o.addBurn !== false };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id }));
      });
    } else if (p.indexOf("/frame/") === 0) {
      const id = p.slice(7);
      html(buildFrameHtml(id, "http://" + req.headers.host));
    } else if (p === "/heavy-ad-tester.js") {
      res.writeHead(200, { "Content-Type": "application/javascript", "Cache-Control": "no-store" });
      res.end(fs.readFileSync(path.join(ROOT, "heavy-ad-tester.js")));
    } else if (p === "/pixel") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        hits.push({ t: Date.now(), method: req.method, url: req.url });
        console.log("PIXEL", req.method, req.url.slice(0, 140));
        res.writeHead(204);
        res.end();
      });
    } else if (p === "/diag") {
      diag.push({ t: Date.now(), e: u.searchParams.get("e") });
      res.writeHead(204);
      res.end();
    } else if (p === "/hits") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ hits, diag }));
    } else if (p === "/reset") {
      hits.length = 0;
      diag.length = 0;
      res.writeHead(200);
      res.end("ok");
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log("test bed on http://localhost:" + PORT));
