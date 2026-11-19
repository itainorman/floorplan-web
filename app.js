// Floor Plan web app: screens, camera, tilt sensors, drawing and PDF export.
// There is no network code in this file: nothing measured here leaves the phone.
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var screens = ["start", "scan", "result"];
  function show(name) {
    screens.forEach(function (s) { $(s).classList.toggle("on", s === name); });
  }

  var WALL = "rgb(74,79,107)", TEXT = "rgb(51,54,69)", DIM = "rgb(115,120,135)";
  var FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  var height = 1.4;
  var stream = null;
  var smoothed = null;      // the camera's direction, steadied against hand shake
  var aim = null;           // where the cross currently meets the floor
  var corners = [];         // the corners marked so far
  var sensorSeen = false;
  var drawing = false;
  var labelSpots = [];      // where each wall's length is written on the result screen, for tapping
  var wakeLock = null;       // keeps the screen from dimming while measuring

  // --- Start screen ---

  try {
    var saved = parseFloat(localStorage.getItem("phoneHeight"));
    if (saved >= 0.6 && saved <= 2) height = saved;
  } catch (e) { /* storage can be unavailable; the default height is fine */ }
  $("height").value = height.toFixed(2);
  $("heightValue").textContent = height.toFixed(2) + " m";
  $("height").addEventListener("input", function () {
    height = parseFloat(this.value);
    $("heightValue").textContent = height.toFixed(2) + " m";
    try { localStorage.setItem("phoneHeight", String(height)); } catch (e) { /* see above */ }
  });

  function problem(text) { $("problem").textContent = text || ""; }

  if (!window.isSecureContext) {
    problem("This page must be opened with https:// for the camera and sensors to work.");
  }

  $("begin").addEventListener("click", function () {
    problem("");
    // iPhones only allow the tilt sensors after a tap, and this request must come first.
    var askMotion = (typeof DeviceOrientationEvent !== "undefined" &&
                     typeof DeviceOrientationEvent.requestPermission === "function")
      ? DeviceOrientationEvent.requestPermission()
      : Promise.resolve("granted");

    askMotion.then(function (answer) {
      if (answer !== "granted") throw new Error("motion-denied");
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("no-camera-api");
      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
    }).then(function (s) {
      stream = s;
      $("video").srcObject = s;
      return $("video").play().catch(function () { /* autoplay attribute covers this */ });
    }).then(function () {
      corners = [];
      smoothed = null;
      aim = null;
      sensorSeen = false;
      window.addEventListener("deviceorientation", onTilt);
      show("scan");
      updateButtons();
      keepAwake();
      drawing = true;
      requestAnimationFrame(frame);
      setTimeout(function () {
        if (!sensorSeen && drawing) {
          $("readout").textContent = "This device is not reporting its tilt, so it cannot measure.";
        }
      }, 2500);
    }).catch(function (err) {
      stopCamera();
      if (err && err.message === "motion-denied") {
        problem("Motion access was refused. On iPhone, close Safari completely, open the link again and tap Allow. " +
                "If it does not ask, go to Settings, Apps, Safari, Advanced, Website Data and remove this site.");
      } else if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        problem("Camera access was refused. Tap the page settings button in the address bar, choose Website Settings, " +
                "set Camera to Allow, then try again.");
      } else {
        problem("Could not start: " + (err && (err.message || err.name) || "unknown error"));
      }
    });
  });

  $("sample").addEventListener("click", function () {
    corners = Core.sampleCorners();
    showResult();
  });

  // --- Measuring screen ---

  function onTilt(e) {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    sensorSeen = true;
    var d = Core.cameraDirection(e.alpha, e.beta, e.gamma);
    if (!smoothed) smoothed = d;
    else {
      var k = 0.25;
      smoothed = {
        x: smoothed.x + (d.x - smoothed.x) * k,
        y: smoothed.y + (d.y - smoothed.y) * k,
        z: smoothed.z + (d.z - smoothed.z) * k,
      };
    }
    aim = Core.floorPoint(smoothed, height);
  }

  function updateButtons() {
    $("undo").disabled = corners.length === 0;
    $("finish").disabled = corners.length < 3;
    $("mark").textContent = "Mark corner " + (corners.length + 1);
  }

  function frame() {
    if (!drawing) return;
    if (sensorSeen) {
      if (aim) {
        var dist = Math.hypot(aim.x, aim.y);
        $("readout").textContent = corners.length === 0
          ? "Aim at a floor corner · " + dist.toFixed(2) + " m away"
          : dist.toFixed(2) + " m away · " + corners.length + " marked";
      } else {
        $("readout").textContent = "Tilt the phone down, towards the floor";
      }
      $("mark").disabled = !aim;
    }
    drawMini();
    requestAnimationFrame(frame);
  }

  $("mark").addEventListener("click", function () {
    if (!aim) return;
    corners.push({ x: aim.x, y: aim.y });
    // iPhones do not let a web page vibrate, so a brief flash confirms the tap there.
    if (navigator.vibrate) navigator.vibrate(25);
    var flash = $("flash");
    flash.classList.add("on");
    setTimeout(function () { flash.classList.remove("on"); }, 60);
    updateButtons();
  });
  $("undo").addEventListener("click", function () { corners.pop(); updateButtons(); });
  $("cancel").addEventListener("click", function () { stopCamera(); show("start"); });
  $("finish").addEventListener("click", function () { stopCamera(); showResult(); });

  function keepAwake() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request("screen").then(function (lock) { wakeLock = lock; })
      .catch(function () { /* not allowed right now; measuring still works */ });
  }

  // If the phone is locked or the tab is left mid-measure, the camera stops. Start again cleanly on return.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && drawing) {
      stopCamera();
      show("start");
      problem("Measuring stopped because the page was left. Tap Start measuring to begin again.");
    }
  });

  function stopCamera() {
    drawing = false;
    if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; }
    window.removeEventListener("deviceorientation", onTilt);
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
    $("video").srcObject = null;
  }

  function prepare(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  // The small live map in the corner: you in the middle, the corners marked so far, and the current aim.
  function drawMini() {
    var c = prepare($("mini")), ctx = c.ctx;
    ctx.clearRect(0, 0, c.w, c.h);
    var pts = corners.concat(aim ? [aim] : []);
    var reach = 2;
    pts.forEach(function (p) { reach = Math.max(reach, Math.abs(p.x), Math.abs(p.y)); });
    var scale = (c.w / 2 - 12) / reach;
    var px = function (p) { return { x: c.w / 2 + p.x * scale, y: c.h / 2 + p.y * scale }; };

    if (corners.length) {
      ctx.beginPath();
      corners.forEach(function (p, i) {
        var q = px(p);
        if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
      });
      ctx.strokeStyle = WALL;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.stroke();
      if (aim) {
        var last = px(corners[corners.length - 1]), now = px(aim);
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(now.x, now.y);
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      corners.forEach(function (p) {
        var q = px(p);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = WALL;
        ctx.fill();
      });
    }
    if (aim) {
      var a = px(aim);
      ctx.beginPath();
      ctx.arc(a.x, a.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "#0a7aff";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(c.w / 2, c.h / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#c82828";
    ctx.fill();
  }

  // --- Result screen ---

  function outline() {
    return $("squared").checked ? Core.squareUp(corners) : Core.rotate(corners, 0);
  }

  function showResult() {
    show("result");
    drawPlan($("plan"), outline(), null);
  }
  $("squared").addEventListener("change", function () { drawPlan($("plan"), outline(), null); });
  window.addEventListener("resize", function () {
    if ($("result").classList.contains("on")) drawPlan($("plan"), outline(), null);
  });
  $("again").addEventListener("click", function () { show("start"); });

  // Every distance comes from the phone height, so one wrong height scales the whole plan.
  // One real tape measurement is enough to put it right, and to correct the height for the next room.
  function correctScale(measured, real) {
    if (!(measured > 0) || !(real >= 0.2 && real <= 40)) return false;
    var factor = real / measured;
    corners = corners.map(function (p) { return { x: p.x * factor, y: p.y * factor }; });
    height = Math.min(2, Math.max(0.6, height * factor));
    $("height").value = height.toFixed(2);
    $("heightValue").textContent = height.toFixed(2) + " m";
    try { localStorage.setItem("phoneHeight", String(height)); } catch (e) { /* storage unavailable */ }
    $("scaleNote").textContent = "Scale corrected from your measurement. Phone height is now set to " +
      height.toFixed(2) + " m for the next room.";
    drawPlan($("plan"), outline(), null);
    return true;
  }

  $("plan").addEventListener("click", function (e) {
    var box = this.getBoundingClientRect();
    var x = e.clientX - box.left, y = e.clientY - box.top;
    var best = null, bestDist = 34; // a finger is not precise, so accept taps near a length
    labelSpots.forEach(function (s) {
      var d = Math.hypot(s.x - x, s.y - y);
      if (d < bestDist) { bestDist = d; best = s; }
    });
    if (!best) return;
    var answer = window.prompt("How long is this wall really, in metres?", best.metres.toFixed(2));
    if (answer === null) return;
    var real = parseFloat(String(answer).replace(",", "."));
    if (!correctScale(best.metres, real)) {
      $("scaleNote").textContent = "That length was not understood. Type a number in metres, for example 3.2";
    }
  });

  // Draws the plan. With `fixed` it draws at an exact pixel size for export; otherwise it fills the canvas on screen.
  function drawPlan(canvas, pts, fixed) {
    var ctx, W, H;
    if (fixed) {
      canvas.width = fixed.w * fixed.scale;
      canvas.height = fixed.h * fixed.scale;
      ctx = canvas.getContext("2d");
      ctx.setTransform(fixed.scale, 0, 0, fixed.scale, 0, 0);
      W = fixed.w; H = fixed.h;
    } else {
      var c = prepare(canvas);
      ctx = c.ctx; W = c.w; H = c.h;
    }
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var text = function (str, x, y, size, color, weight) {
      ctx.font = (weight || 400) + " " + size + "px " + FONT;
      ctx.fillStyle = color;
      ctx.fillText(str, x, y);
    };

    text("Floorplan", W / 2, 34, 24, TEXT, 600);
    if (pts.length < 3) {
      text("Not enough corners were marked.", W / 2, H / 2, 15, DIM);
      return;
    }
    var b = Core.bounds(pts);
    text("Approximately " + Core.area(pts).toFixed(1) + " m²  ·  " +
         b.width.toFixed(1) + " m × " + b.height.toFixed(1) + " m", W / 2, 60, 13, DIM);

    var header = 82, padY = 44, padX = 66;
    var availW = Math.max(W - padX * 2, 10), availH = Math.max(H - header - padY * 2, 10);
    var scale = Math.min(availW / Math.max(b.width, 0.01), availH / Math.max(b.height, 0.01));
    var offX = padX + (availW - b.width * scale) / 2;
    var offY = header + padY + (availH - b.height * scale) / 2;
    var px = function (p) { return { x: (p.x - b.minX) * scale + offX, y: (p.y - b.minY) * scale + offY }; };
    var wall = Math.min(Math.max(0.14 * scale, 4), 12);

    var middle = { x: 0, y: 0 };
    pts.forEach(function (p) { var q = px(p); middle.x += q.x / pts.length; middle.y += q.y / pts.length; });

    ctx.beginPath();
    pts.forEach(function (p, i) {
      var q = px(p);
      if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(10,122,255,0.05)";
    ctx.fill();
    ctx.strokeStyle = WALL;
    ctx.lineWidth = wall;
    ctx.lineJoin = "miter";
    ctx.stroke();

    // Wall lengths, placed just outside each wall.
    if (!fixed) labelSpots = [];
    for (var i = 0; i < pts.length; i++) {
      var p0 = pts[i], p1 = pts[(i + 1) % pts.length];
      var metres = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      var a = px(p0), c2 = px(p1);
      var len = Math.hypot(c2.x - a.x, c2.y - a.y);
      if (len < 40) continue;
      var mid = { x: (a.x + c2.x) / 2, y: (a.y + c2.y) / 2 };
      var nx = -(c2.y - a.y) / len, ny = (c2.x - a.x) / len;
      if (nx * (mid.x - middle.x) + ny * (mid.y - middle.y) < 0) { nx = -nx; ny = -ny; }
      var gap = wall / 2 + 9 + Math.abs(nx) * 14;
      var lx = mid.x + nx * gap, ly = mid.y + ny * gap;
      text(metres.toFixed(2) + " m", lx, ly, fixed ? 10 : 12, fixed ? DIM : "#0a7aff", fixed ? 400 : 600);
      if (!fixed) labelSpots.push({ x: lx, y: ly, metres: metres });
    }
  }

  // --- PDF export ---

  // Builds a one-page A4 PDF holding the plan picture. Done by hand so no outside library is needed.
  function pdfFromJpeg(jpeg, pxW, pxH) {
    var enc = new TextEncoder();
    var chunks = [], offsets = [], length = 0;
    var push = function (part) {
      var bytes = typeof part === "string" ? enc.encode(part) : part;
      chunks.push(bytes);
      length += bytes.length;
    };
    var object = function (n, body) { offsets[n] = length; push(n + " 0 obj\n" + body + "\nendobj\n"); };

    push("%PDF-1.4\n");
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    object(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
              "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>");
    offsets[4] = length;
    push("4 0 obj\n<< /Type /XObject /Subtype /Image /Width " + pxW + " /Height " + pxH +
         " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpeg.length + " >>\nstream\n");
    push(jpeg);
    push("\nendstream\nendobj\n");
    var content = "q 595 0 0 842 0 0 cm /Im0 Do Q";
    object(5, "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream");

    var xref = length;
    var table = "xref\n0 6\n0000000000 65535 f \n";
    for (var n = 1; n <= 5; n++) table += ("0000000000" + offsets[n]).slice(-10) + " 00000 n \n";
    push(table + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");

    var out = new Uint8Array(length), at = 0;
    chunks.forEach(function (ch) { out.set(ch, at); at += ch.length; });
    return out;
  }

  function buildPdf() {
    var page = document.createElement("canvas");
    drawPlan(page, outline(), { w: 595, h: 842, scale: 2 });
    var base64 = page.toDataURL("image/jpeg", 0.92).split(",")[1];
    var raw = atob(base64), jpeg = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) jpeg[i] = raw.charCodeAt(i);
    return pdfFromJpeg(jpeg, page.width, page.height);
  }

  $("share").addEventListener("click", function () {
    var file = new File([buildPdf()], "Floorplan.pdf", { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: "Floor plan" }).catch(function () { /* share sheet closed */ });
      return;
    }
    var link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = "Floorplan.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  // --- Self-check hooks, used when testing the page without a phone ---
  var query = new URLSearchParams(location.search);
  if (query.has("sample")) {
    corners = Core.sampleCorners();
    showResult();
  }
  if (query.has("scalecheck")) {
    // Pretend the tester measured the first labelled wall at half the plan's value.
    corners = Core.sampleCorners();
    showResult();
    correctScale(labelSpots[0].metres, labelSpots[0].metres / 2);
  }
  if (query.has("pdfcheck")) {
    corners = Core.sampleCorners();
    var bytes = buildPdf(), binary = "";
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    var pre = document.createElement("pre");
    pre.id = "pdfcheck";
    pre.textContent = btoa(binary);
    document.body.appendChild(pre);
  }
})();
