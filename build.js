// Builds install.html (bookmarklet + copy-paste box) from heavy-ad-tester.js.
// Run:  node build.js
const fs = require("fs");
const path = require("path");

const code = fs.readFileSync(path.join(__dirname, "heavy-ad-tester.js"), "utf8");
const bookmarklet = "javascript:" + encodeURIComponent(code + "\nvoid 0;");
const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Heavy ad test tool: install</title>
<style>
body{font-family:system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#1a1a1a;line-height:1.45}
h1{font-size:22px}h2{font-size:17px;margin-top:26px}
.box{background:#f4f6fa;border:1px solid #cfd6e4;border-radius:8px;padding:12px 14px}
a.bm{display:inline-block;background:#1a4fa0;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600}
textarea{width:100%;height:200px;font:11px ui-monospace,Consolas,monospace}
button{padding:6px 12px;font-size:13px;cursor:pointer}
code{background:#eef1f6;padding:1px 4px;border-radius:3px}
</style></head><body>
<h1>Heavy ad test tool</h1>
<p>Runs a panel inside any page. It finds ad iframes, installs the heavy ad sample script into the one you pick, makes that frame burn CPU until Chrome removes it, and reports what the script did.</p>

<h2>Option 1 (most reliable): paste into DevTools</h2>
<div class="box">
<ol>
<li>Open the page you want to test in desktop Chrome and wait for ads to load. Turn device emulation off.</li>
<li>Press F12, open the <b>Console</b>.</li>
<li>Click the button below, then paste into the Console and press Enter.</li>
</ol>
<button id="copy">Copy tool code</button> <span id="msg"></span>
<textarea id="code" readonly>${escaped}</textarea>
</div>

<h2>Option 2: bookmarklet</h2>
<div class="box">
<p>Drag this link to your bookmarks bar, then click it on any page:</p>
<p><a class="bm" href="${bookmarklet.replace(/"/g, "&quot;")}">Heavy ad test</a></p>
<p>Some sites block bookmarklets. If nothing appears, use Option 1.</p>
</div>

<h2>Using the panel</h2>
<ol>
<li>Pick an ad frame from the list. Only same-origin frames (for example Google ad frames named <code>google_ads_iframe_...</code>) can be used. Cross-origin frames are listed greyed out.</li>
<li>Leave <b>Capture only</b> selected to send nothing, or choose <b>Send a real beacon</b> to send exactly one to the pixel URL you set.</li>
<li>Click <b>Start test</b>. Keep the tab in front and do not click inside the ad.</li>
<li>Wait about 20 s. The panel shows PASS, FAIL or INFO, and a timeline. <b>Copy report</b> copies it as text.</li>
</ol>
<p>See README.md for what each verdict means.</p>
<script>
document.getElementById('copy').onclick=function(){var t=document.getElementById('code');t.select();
try{navigator.clipboard.writeText(t.value).then(function(){document.getElementById('msg').textContent='Copied.';},function(){document.execCommand('copy');document.getElementById('msg').textContent='Copied.';});}catch(e){document.execCommand('copy');document.getElementById('msg').textContent='Copied.';}};
</script>
</body></html>`;

fs.writeFileSync(path.join(__dirname, "install.html"), html);
console.log("wrote install.html (" + Math.round(html.length / 1024) + " KB)");
