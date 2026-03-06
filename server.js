// server.js
// JSON based device monitor (NO DATABASE)

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* =========================
LOGIN
========================= */

const ADMIN_USER = "admin";
const ADMIN_PASS = "Ibi@123";

const TOKENS = new Map();
const TOKEN_TTL = 30 * 60 * 1000;

function makeToken(){
  return crypto.randomBytes(24).toString("hex");
}

function putToken(){
  const t = makeToken();
  TOKENS.set(t,{exp:Date.now()+TOKEN_TTL});
  return t;
}

function isValidToken(t){
  if(!t) return false;
  const row = TOKENS.get(t);
  if(!row) return false;
  if(Date.now()>row.exp){
    TOKENS.delete(t);
    return false;
  }
  return true;
}

function requireAuth(req,res,next){
  const token = req.headers["x-auth-token"];
  if(isValidToken(token)) return next();
  res.status(401).json({error:"Unauthorized"});
}

/* =========================
DEVICE STORE (JSON MEMORY)
========================= */

const devices = {};

const OFFLINE_AFTER = 30000;

/* =========================
DEVICE HEARTBEAT
========================= */

app.post("/heartbeat",(req,res)=>{

  const {device_id,junction_name,arm_name,lat,lng}=req.body;

  if(!device_id){
    return res.status(400).json({error:"device_id required"});
  }

  const now = Date.now();

  devices[device_id] = {
    device_id,
    junction_name: junction_name || "",
    arm_name: arm_name || "",
    lat: Number(lat||0),
    lng: Number(lng||0),
    last_seen: now,
    status: "online"
  };

  res.json({ok:true});
});

/* =========================
DEVICES LIST
========================= */

app.get("/devices",(req,res)=>{

  const now = Date.now();

  const list = Object.values(devices).map(d=>{

    if(now - d.last_seen > OFFLINE_AFTER){
      d.status = "offline";
    }

    return d;

  });

  res.json(list);
});

/* =========================
MESSAGE CONTROL
========================= */

const messages = {};

app.post("/api/simple",requireAuth,(req,res)=>{

  const {device_id,force,line1,line2}=req.body;

  if(!devices[device_id]){
    return res.status(400).json({error:"device not found"});
  }

  if(devices[device_id].status!=="online"){
    return res.status(400).json({error:"device offline"});
  }

  messages[device_id] = {
    force: force || "",
    line1: line1 || "",
    line2: line2 || "",
    updated: Date.now()
  };

  res.json({ok:true});
});

app.get("/api/pull/:device_id",(req,res)=>{

  const id = req.params.device_id;

  if(!messages[id]){
    return res.json({changed:false});
  }

  res.json({
    changed:true,
    ...messages[id]
  });

});

/* =========================
LOGIN PAGE
========================= */

app.get("/login",(req,res)=>{

res.send(`

<!DOCTYPE html>
<html>
<head>
<title>Login</title>
<style>
body{
font-family:"Times New Roman";
background:#fff7ed;
display:flex;
justify-content:center;
align-items:center;
height:100vh;
}

.card{
background:white;
padding:30px;
border-radius:10px;
border:1px solid #fed7aa;
}

input{
width:250px;
padding:10px;
margin-top:10px;
}

button{
width:100%;
padding:10px;
margin-top:10px;
background:#f97316;
color:white;
border:none;
cursor:pointer;
}
</style>
</head>

<body>

<div class="card">

<h2>Display Monitor</h2>

<input id="u" placeholder="username"><br>
<input id="p" type="password" placeholder="password"><br>

<button onclick="login()">Login</button>

<div id="err"></div>

</div>

<script>

async function login(){

const username=document.getElementById("u").value;
const password=document.getElementById("p").value;

const r=await fetch("/login",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({username,password})
});

if(!r.ok){
document.getElementById("err").innerText="Invalid login";
return;
}

document.write(await r.text());

}

</script>

</body>
</html>

`);

});

/* =========================
LOGIN POST
========================= */

app.post("/login",(req,res)=>{

const {username,password}=req.body;

if(username!==ADMIN_USER || password!==ADMIN_PASS){
return res.status(401).json({error:"Invalid"});
}

const token=putToken();

res.send(renderDashboard(token));

});

/* =========================
DASHBOARD
========================= */

function renderDashboard(TOKEN){

return `

<!DOCTYPE html>
<html>

<head>

<title>Display Dashboard</title>

<link rel="stylesheet"
href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>

<script
src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>

body{
margin:0;
font-family:"Times New Roman";
}

#map{
height:100vh;
}

.sidebar{
position:absolute;
left:0;
top:0;
width:260px;
height:100%;
background:white;
border-right:1px solid #ccc;
overflow:auto;
}

.device{
padding:10px;
border-bottom:1px solid #eee;
cursor:pointer;
}

</style>

</head>

<body>

<div class="sidebar">

<h3>Devices</h3>

<div id="devlist"></div>

</div>

<div id="map"></div>

<script>

const map=L.map('map').setView([17.385,78.486],12);

L.tileLayer(
'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
).addTo(map);

const markers={};

async function load(){

const r=await fetch("/devices");
const data=await r.json();

const box=document.getElementById("devlist");
box.innerHTML="";

data.forEach(d=>{

const pos=[d.lat,d.lng];

if(markers[d.device_id]){
markers[d.device_id].setLatLng(pos);
}else{

markers[d.device_id]=L.marker(pos).addTo(map);

}

markers[d.device_id].bindPopup(
"<b>"+d.device_id+"</b><br>"
+d.junction_name+"<br>"
+d.arm_name+"<br>"
+d.status
);

const div=document.createElement("div");

div.className="device";

div.innerHTML=d.device_id+" ("+d.status+")";

div.onclick=()=>{
map.setView(pos,17);
};

box.appendChild(div);

});

}

load();

setInterval(load,2000);

</script>

</body>

</html>

`;

}

/* =========================
START SERVER
========================= */

const PORT=5000;

app.listen(PORT,()=>{

console.log("Server running on "+PORT);

});