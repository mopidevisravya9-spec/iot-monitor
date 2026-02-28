// server.js — Cloud Message Test + /dashboard (Render ready)

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Optional: static files if you want later
app.use(express.static("public"));

// -------------------- In-memory store (TEST) --------------------
// Later we can switch to Mongo, but first make it 100% working.
const store = new Map(); // device_id -> {device_id, force, sig, slot, l1, l2, updated_at}
const seen = new Map();  // device_id -> last_seen_ms

const now = () => Date.now();

// -------------------- Health --------------------
app.get("/", (req, res) => res.send("OK - iot-monitor running"));

// -------------------- Dashboard UI --------------------
app.get("/dashboard", (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>ESP Cloud Dashboard</title>
  <style>
    body{margin:0;font-family:Segoe UI,Arial;background:#070b18;color:#eaf0ff}
    .wrap{max-width:980px;margin:26px auto;padding:0 16px}
    .card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
      border-radius:18px;padding:18px;box-shadow:0 18px 40px rgba(0,0,0,.35)}
    h1{margin:0 0 6px}
    .sub{opacity:.8;margin:0 0 16px;line-height:1.4}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    label{font-size:12px;opacity:.85}
    input,select,button{
      width:100%;padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,.14);
      background:rgba(8,12,22,.8);color:#eaf0ff;outline:none;font-size:14px
    }
    button{cursor:pointer;background:linear-gradient(135deg,#0b5ed7,#0b5ed799);
      border-color:rgba(173,210,255,.35);font-weight:800}
    .ok{color:#2dbb4e;font-weight:800}
    .bad{color:#ff5b5b;font-weight:800}
    .tiny{font-size:12px;opacity:.75;margin-top:10px;line-height:1.4}
    .code{font-family:Consolas,monospace;background:rgba(0,0,0,.35);padding:6px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.12)}
    .row{margin-top:12px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>ESP Cloud Dashboard</h1>
      <p class="sub">
        This page sends to <span class="code">POST /api/simple</span>.
        ESP pulls from <span class="code">GET /api/pull/ESP_001</span> every 2 seconds.
        Works from any network (cloud).
      </p>

      <div class="grid">
        <div>
          <label>Device ID</label>
          <input id="device_id" value="ESP_001"/>
        </div>
        <div>
          <label>Force</label>
          <select id="force">
            <option value="AUTO">AUTO</option>
            <option value="red">RED</option>
            <option value="amber">AMBER</option>
            <option value="green">GREEN</option>
          </select>
        </div>
      </div>

      <div class="grid row">
        <div>
          <label>Signal group</label>
          <select id="sig">
            <option value="red">RED</option>
            <option value="amber">AMBER</option>
            <option value="green">GREEN</option>
            <option value="no">NO SIGNAL</option>
          </select>
        </div>
        <div>
          <label>Slot</label>
          <select id="slot">
            <option value="0">Message 1</option>
            <option value="1">Message 2</option>
            <option value="2">Message 3</option>
            <option value="3">Message 4</option>
            <option value="4">Message 5</option>
          </select>
        </div>
      </div>

      <div class="row">
        <label>Line 1</label>
        <input id="l1" value="HELLO FROM CLOUD"/>
      </div>

      <div class="row">
        <label>Line 2</label>
        <input id="l2" value="DRIVE SAFE"/>
      </div>

      <div class="row">
        <button onclick="sendNow()">Send to ESP (Cloud)</button>
      </div>

      <div class="row tiny" id="status">Status: <span class="bad">Idle</span></div>

      <div class="tiny">
        <div>Check pull JSON: <span class="code">/api/pull/ESP_001</span></div>
        <div>Check devices: <span class="code">/devices</span></div>
      </div>
    </div>
  </div>

<script>
  async function sendNow(){
    const device_id = document.getElementById("device_id").value.trim();
    const force = document.getElementById("force").value;
    const sig = document.getElementById("sig").value;
    const slot = Number(document.getElementById("slot").value);
    const l1 = document.getElementById("l1").value;
    const l2 = document.getElementById("l2").value;

    const status = document.getElementById("status");
    status.innerHTML = 'Status: <span class="bad">Sending...</span>';

    try{
      const res = await fetch("/api/simple", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ device_id, force, sig, slot, l1, l2 })
      });
      const out = await res.json();

      if(res.ok){
        status.innerHTML = 'Status: <span class="ok">Sent ✅</span> updated_at=' + out.saved.updated_at;
      }else{
        status.innerHTML = 'Status: <span class="bad">Failed ❌</span> ' + (out.error||"");
      }
    }catch(e){
      status.innerHTML = 'Status: <span class="bad">Network error ❌</span> ' + e;
    }
  }
</script>
</body>
</html>`);
});

// -------------------- Dashboard writes message --------------------
app.post("/api/simple", (req, res) => {
  const device_id = String(req.body?.device_id || "").trim();
  if (!device_id) return res.status(400).json({ error: "device_id required" });

  const payload = {
    device_id,
    force: String(req.body?.force || "AUTO"),
    sig: String(req.body?.sig || "red"),
    slot: Number(req.body?.slot || 0),
    l1: String(req.body?.l1 || ""),
    l2: String(req.body?.l2 || ""),
    updated_at: now(),
  };

  store.set(device_id, payload);
  res.json({ ok: true, saved: payload });
});

// -------------------- ESP pulls latest message --------------------
app.get("/api/pull/:device_id", (req, res) => {
  const device_id = String(req.params.device_id || "").trim();
  if (!device_id) return res.status(400).json({ error: "device_id required" });

  const cur = store.get(device_id);
  if (!cur) {
    return res.json({
      device_id,
      force: "AUTO",
      sig: "red",
      slot: 0,
      l1: "",
      l2: "",
      updated_at: 0,
    });
  }
  res.json(cur);
});

// -------------------- heartbeat --------------------
app.post("/heartbeat", (req, res) => {
  const device_id = String(req.body?.device_id || "").trim();
  if (!device_id) return res.status(400).json({ error: "device_id required" });

  seen.set(device_id, now());
  res.json({ ok: true, device_id });
});

// -------------------- devices list --------------------
app.get("/devices", (req, res) => {
  const OFFLINE_AFTER_MS = 30000; // 30 seconds (no 1-sec flicker)
  const t = now();
  const out = [];

  for (const [device_id, last_seen] of seen.entries()) {
    out.push({
      device_id,
      last_seen,
      status: (t - last_seen) <= OFFLINE_AFTER_MS ? "online" : "offline",
    });
  }
  for (const device_id of store.keys()) {
    if (!seen.has(device_id)) out.push({ device_id, last_seen: 0, status: "offline" });
  }

  out.sort((a, b) => (b.last_seen || 0) - (a.last_seen || 0));
  res.json(out);
});

// -------------------- START (REQUIRED FOR RENDER) --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("Server started on port " + PORT));