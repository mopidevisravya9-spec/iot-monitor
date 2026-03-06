// server.js ✅ FULL WORKING (NO DATABASE VERSION)
// LIGHT ORANGE + WHITE + TIMES NEW ROMAN
// Devices appear only when ESP sends JSON
// Dashboard auto updates from ESP heartbeat
// Added AMBULANCE FORCE MODE

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));


// ======================
// LOGIN
// ======================

const ADMIN_USER = "admin";
const ADMIN_PASS = "Ibi@123";

const TOKENS = new Map();
const TOKEN_TTL_MS = 30 * 60 * 1000;

function makeToken(){
  return crypto.randomBytes(24).toString("hex");
}

function putToken(){
  const t = makeToken();
  TOKENS.set(t,{exp:Date.now()+TOKEN_TTL_MS});
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


// ======================
// MEMORY STORAGE
// ======================

const DEVICES = new Map();
const MSGS = new Map();

const OFFLINE_AFTER_MS = 30000;
const MSG_SLOTS = 5;


// ======================
// DEFAULT MESSAGE PACKS
// ======================

function defaultPacks(){
 return {

red:[
{l1:"HURRY ENDS HERE",l2:"YOUR FAMILY WAITS"},
{l1:"BRAKE NOW",l2:"REGRET IS HEAVIER"},
{l1:"STOPPING IS STRENGTH",l2:"SMART DRIVERS WAIT"},
{l1:"THE ROAD IS NOT A GAME",l2:"PROTECT LIFE"},
{l1:"PAUSE YOUR SPEED",l2:"SAFETY FIRST"}
],

amber:[
{l1:"EASE OFF SPEED",l2:"SLOW DOWN"},
{l1:"CONTROL VEHICLE",l2:"PREPARE TO STOP"},
{l1:"REDUCE SPEED",l2:"WATCH SIGNAL"},
{l1:"SLOW YOUR DRIVE",l2:"STAY ALERT"},
{l1:"READY TO STOP",l2:"CHECK TRAFFIC"}
],

green:[
{l1:"MOVE SAFELY",l2:"KEEP SAFE DISTANCE"},
{l1:"GO WITH CONTROL",l2:"DRIVE RESPONSIBLY"},
{l1:"SAFE DRIVING",l2:"SMART DRIVING"},
{l1:"MAINTAIN SPEED",l2:"FOLLOW RULES"},
{l1:"DRIVE SAFE",l2:"ARRIVE SAFE"}
],

no:[
{l1:"SIGNAL UNAVAILABLE",l2:"FOLLOW TRAFFIC RULES"},
{l1:"NO CONTROLLER DATA",l2:"PROCEED CAREFULLY"},
{l1:"SIGNAL HOLD",l2:"CONTROL SPEED"},
{l1:"WAIT AND WATCH",l2:"SAFE CROSSING"},
{l1:"MANUAL CONTROL",l2:"FOLLOW POLICE"}
],

ambulance:[
{l1:"AMBULANCE APPROACHING",l2:"CLEAR THE ROAD"},
{l1:"EMERGENCY VEHICLE",l2:"GIVE WAY"},
{l1:"LIFE SAVING VEHICLE",l2:"STOP IMMEDIATELY"},
{l1:"AMBULANCE PRIORITY",l2:"MOVE ASIDE"},
{l1:"EMERGENCY PASSAGE",l2:"KEEP ROAD CLEAR"}
]

 };
}


// ======================
// AUTH
// ======================

function requireAuth(req,res,next){
 const token = req.headers["x-auth-token"];
 if(isValidToken(token)) return next();
 return res.status(401).json({error:"Unauthorized"});
}


// ======================
// LOGIN PAGE
// ======================

app.get("/",(req,res)=>res.redirect("/login"));

app.get("/login",(req,res)=>{
res.send(`<!DOCTYPE html>
<html>
<head>
<title>Login</title>
<style>
body{
font-family:Times New Roman;
background:#fff7ed;
display:flex;
justify-content:center;
align-items:center;
height:100vh;
}
.box{
background:white;
padding:30px;
border-radius:10px;
border:1px solid #fed7aa;
}
input{
display:block;
margin:10px 0;
padding:10px;
width:250px;
}
button{
padding:10px;
background:#f97316;
color:white;
border:none;
cursor:pointer;
}
</style>
</head>
<body>

<div class="box">

<h2>Display Health Monitor</h2>

<input id="u" placeholder="Username">
<input id="p" type="password" placeholder="Password">

<button onclick="login()">Login</button>

<div id="err"></div>

</div>

<script>

async function login(){

const r = await fetch("/login",{
method:"POST",
headers:{'Content-Type':'application/json'},
body:JSON.stringify({
username:document.getElementById("u").value,
password:document.getElementById("p").value
})
});

if(!r.ok){
document.getElementById("err").innerText="Invalid Login";
return;
}

const html = await r.text();

document.open();
document.write(html);
document.close();

}

</script>

</body>
</html>`);
});


// ======================
// LOGIN POST
// ======================

app.post("/login",(req,res)=>{

const {username,password}=req.body;

if(username!==ADMIN_USER || password!==ADMIN_PASS)
return res.status(401).json({error:"Invalid login"});

const token = putToken();

res.send(renderDashboardHTML(token));

});


// ======================
// HEARTBEAT FROM ESP
// ======================

app.post("/heartbeat",(req,res)=>{

const {device_id,lat,lng}=req.body;

if(!device_id)
return res.status(400).json({error:"device_id required"});

DEVICES.set(device_id,{
device_id,
lat:lat||0,
lng:lng||0,
last_seen:Date.now()
});

if(!MSGS.has(device_id)){
MSGS.set(device_id,{
force:"",
slot:{red:0,amber:0,green:0,no:0,ambulance:0},
packs:defaultPacks(),
v:0
});
}

res.json({ok:true});

});


// ======================
// DEVICE LIST
// ======================

app.get("/devices",(req,res)=>{

const now=Date.now();
const arr=[];

DEVICES.forEach(d=>{

const online = (now-d.last_seen)<=OFFLINE_AFTER_MS;

arr.push({
device_id:d.device_id,
lat:d.lat,
lng:d.lng,
status:online?"online":"offline",
last_seen:d.last_seen
});

});

res.json(arr);

});


// ======================
// SEND MESSAGE
// ======================

app.post("/api/simple",requireAuth,(req,res)=>{

const {device_id,force,sig,slot,line1,line2}=req.body;

if(!MSGS.has(device_id))
return res.status(400).json({error:"Device not registered"});

const msg=MSGS.get(device_id);

msg.force=force||"";

msg.packs[sig][slot]={l1:line1,l2:line2};

msg.slot[sig]=slot;

msg.v++;

MSGS.set(device_id,msg);

res.json({ok:true,v:msg.v});

});


// ======================
// ESP PULL
// ======================

app.get("/api/pull/:device_id",(req,res)=>{

const device_id=req.params.device_id;

if(!MSGS.has(device_id))
return res.json({changed:false});

const msg=MSGS.get(device_id);

res.json({
changed:true,
force:msg.force,
slot:msg.slot,
packs:msg.packs,
v:msg.v
});

});


// ======================
// DASHBOARD HTML
// ======================

function renderDashboardHTML(TOKEN){

return `
<!DOCTYPE html>
<html>

<head>

<title>Display Health Monitor</title>

<link rel="stylesheet"
href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>

<script
src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<style>

body{
margin:0;
font-family:Times New Roman;
background:#fff7ed;
}

#map{
height:90vh;
}

</style>

</head>

<body>

<div id="map"></div>

<script>

const AUTH_TOKEN="${TOKEN}";

const map=L.map('map').setView([17.38,78.48],12);

L.tileLayer(
'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
).addTo(map);

const markers=new Map();

async function load(){

const r=await fetch("/devices");
const data=await r.json();

data.forEach(d=>{

if(!markers.has(d.device_id)){

const m=L.marker([d.lat,d.lng])
.addTo(map)
.bindPopup(d.device_id);

markers.set(d.device_id,m);

}else{

markers.get(d.device_id)
.setLatLng([d.lat,d.lng]);

}

});

}

load();
setInterval(load,2000);

</script>

</body>
</html>

`;

}


// ======================
// START SERVER
// ======================

const PORT=process.env.PORT||5000;

app.listen(PORT,()=>{
console.log("Server started "+PORT);
});