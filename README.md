# Heavy Ads Tool

Test pages and tools for the **heavy ad detection script**: the small script that reports when Chrome removes an ad for using too many resources.

Chrome unloads an ad frame that uses more than **4 MB of network**, or more than **15 s of main-thread CPU in any 30 s window**, or more than
**60 s of CPU in total**. It raises an `intervention` report (`HeavyAdIntervention`) through the Reporting API. The script listens for that report and
fires a pixel. This repo lets you prove that, for each kind of creative.

**Live site (GitHub Pages): https://shreya-singal1.github.io/heavy-ads-tool/**

Desktop Chrome only (other browsers have no such intervention). The site is plain static files: no server, no install.

## What are you testing?

| Creative type | Where the creative runs | Page | Result when tested |
|---|---|---|---|
| **Simple banner** | Same-origin frame (like a GAM friendly iframe) | `banner.html?type=friendly` | Removed after about 17.7 s, one beacon |
| **Cross-origin iframe banner** | Iframe with its own opaque origin (a `data:` frame) nested inside the ad frame | `banner.html?type=cross` | Removed after about 17.4 s, one beacon |
| **SafeFrame-like banner** | Opaque origin plus the `sandbox` attribute (storage blocked) | `banner.html?type=sandbox` | Removed after about 17.5 s, one beacon |
| **VPAID video (IBV)** | VPAID code run by Google's IMA SDK in its own cross-origin iframe | `vpaid.html` | Removed after about 2 s (network flood), one beacon |
| **Your GAM creative** | A creative served by your own Google Ad Manager ad unit | `gam.html?unit=...` | Not run here (needs your ad unit and line item) |
| **Any live page** | Same-origin ad frames on any site, via the DevTools panel | `panel.html`, `install.html` | Run on a live news site, one real beacon seen in DevTools |

Not tested: a real Google SafeFrame (the sandboxed opaque-origin frame is the stand-in), and creatives served from your own GAM account.
The banner pages also accept **any creative HTML** that you paste or load from a file.

All results above are from desktop Chrome against Google's public test ad and the IMA SDK. The VPAID code ran in a frame on
`tpc.googlesyndication.com`, a real cross-origin frame.

## How to run a test

1. Open the live site (or run it locally, see below) and pick a creative type from the index.
2. Wait for the page to load its ad. Keep the tab in front and **do not click inside the ad** (a click exempts it from the intervention).
3. Click **Start**. The creative burns CPU or floods the network on purpose.
4. After about 2 to 60 s Chrome removes the ad. The page shows **PASS** (exactly one beacon), FAIL or INFO, with a timeline.

The verdict names the creative type that was tested and which path sent the beacon: the observer callback, or the `pagehide` drain (`takeRecords()`),
which catches a report that arrives too late for the callback.

### About beacons
- **Capture only** (the default): the script's `sendBeacon` is replaced by a recorder, so nothing leaves your browser. The page shows the exact URL it would have sent.
- **Send a real beacon**: sends exactly one request to the pixel URL you set (you are asked to confirm). To see it, open DevTools > Network, tick
  **Preserve log**, filter on the pixel host, and look for a `ping` row with an `rd` parameter.
- The static site cannot log pixels server-side. For that, use the optional local test bed (below).

## The script under test

```js
(function () {
var PIXEL = "HEAVY_AD_PIXEL";

function send(reports) {
    for (var i = 0; i < reports.length; i++) {
        try {
            var body = reports[i].body;
            if (!body || body.id !== "HeavyAdIntervention") { continue; }
            var sep = "&";
            navigator.sendBeacon(PIXEL + sep + "rd=" + encodeURIComponent(JSON.stringify({
                message: body.message, sourceFile: body.sourceFile,
                lineNumber: body.lineNumber, columnNumber: body.columnNumber
            })));
        } catch (e) {}
    }
}
try {
    var observer = new ReportingObserver(send, { types: ["intervention"], buffered: true });
    observer.observe();
    window.addEventListener("pagehide", function () { send(observer.takeRecords()); });
} catch (e) {}
})();
```

Your pixel URL must already contain a `?`, because the script appends `&rd=...`.

## Using each test

### Banner creatives (simple, cross-origin, SafeFrame-like)
Open `banner.html`, pick the creative type. Leave the box empty to load `heavy-creative.html`, or paste any creative HTML (or choose a file).
Tick **add the sample script** and **add the CPU burn** to arm and stress your own creative, or untick them to see whether your creative gets
removed on its own.

### VPAID video (IBV)
Open `vpaid.html`. It plays a heavy VPAID VAST creative with the IMA SDK (a short CPU burn plus repeated fetches of a 6 MB Google sample video, to
pass the 4 MB network limit). Options: add the sample script and a reporter, capture or really send the beacon, and how many files to fetch (the
original fixture used 50, the page defaults to 10). **Show the VAST XML** displays the creative so you can copy it into an ad server or player.

### Your own GAM creative
1. Put `heavy-creative.html` in a GAM **Custom HTML** creative (real pixel instead of `HEAVY_AD_PIXEL`) on a line item that serves to a test ad unit.
2. Open `gam.html?unit=/NETWORK_CODE/AD_UNIT_PATH&size=300x250`.
3. Watch your pixel in DevTools > Network (Preserve log, filter on your pixel host). A `ping` row with an `rd` parameter is the proof.

### A live page (the panel)
1. Open the page in desktop Chrome, let ads load, and turn **device emulation off** (Ctrl+Shift+M in DevTools).
2. Open `install.html`, click **Copy tool code**, paste it into the DevTools Console and press Enter (type `allow pasting` first if Chrome asks).
3. Pick an ad frame in the panel, choose **Capture only** or **Send a real beacon**, and click **Start test**.

The panel can only drive same-origin frames. Cross-origin frames are listed greyed out.

## Run it locally

```
node serve.js
```

Open `http://localhost:8080/`. Same files as the live site. (Pages that load a creative need `http://`, not a double-clicked file.)

### Optional: local test bed with server-side pixel logging
```
node local-test-bed/server.js
```
Open `http://localhost:8770/`. It serves the same kinds of tests, but the pixel goes to the local server, which logs every hit, and the cross-origin
test uses a real second origin (`127.0.0.1` against `localhost`). Use it when you want proof of arrival without watching DevTools.

## Files

| File | What it is |
|---|---|
| `index.html` | Index of the test pages, one per creative type. |
| `banner.html`, `vpaid.html`, `gam.html`, `panel.html` | The test pages. |
| `lib.js`, `style.css` | Shared code and styles for the pages. |
| `heavy-creative.html` | Banner creative to paste into a GAM **Custom HTML** creative. It has the script plus a CPU burn. Replace `HEAVY_AD_PIXEL` with your pixel. |
| `heavy-ad-tester.js` | The DevTools panel for live pages. |
| `install.html` | Copy-paste box and bookmarklet for the panel (generated by `node build.js`). |
| `serve.js` | Tiny static server for local preview. |
| `local-test-bed/server.js` | Optional local server with pixel logging. |

## What the verdicts mean

| Verdict | Meaning |
|---|---|
| PASS | Chrome removed the frame and exactly one beacon was sent. The text says which path sent it. |
| FAIL: more than one beacon | The script sent duplicates. |
| FAIL: nothing happened | The frame was probably not tagged as an ad, the tab was hidden or unfocused, the ad was clicked, the creative was not heavy enough, or the intervention is disabled in this Chrome. |
| INFO: torn down, no beacon | The frame was removed by the page (for example an ad refresh), not by Chrome. No beacon is correct. Retry. |

## Things that commonly go wrong

- **Device emulation on**: the page serves a mobile layout with different ad slots, and DevTools can turn emulation back on when you open it.
- **Ad refresh**: many sites replace ad frames every few seconds. The panel disables `googletag.pubads().refresh()` for the page view by default.
- **Frame not reachable**: the panel only works on same-origin frames. Cross-origin creatives carry their own script (use the banner pages or `heavy-creative.html`).
- **Chrome only**: other browsers have no heavy ad intervention.
- **Noisy thresholds**: Chrome adds random noise to the limits, so removal usually happens after 15 to 20 s of CPU but can take up to about 60 s.
- **The VPAID test downloads real files**: it fetches a Google sample video. The downloads stop when Chrome removes the frame.
- **Needs internet**: the ad comes from Google's ad tag, and the VPAID page loads the IMA SDK.

## What the tools change

- `heavy-creative.html` and the VPAID creative: run the sample script and a load generator inside their own frame, nothing else.
- Test pages: write your creative into the test ad frame, add a reporter that replaces `navigator.sendBeacon` with a recorder (sends only in real mode)
  and posts events back to the page.
- The panel: inside the chosen frame only, the same kind of wrapper and listeners, and optionally replaces `googletag.pubads().refresh` with a no-op.
  Close the panel with the x button, or reload the page, to remove everything.
