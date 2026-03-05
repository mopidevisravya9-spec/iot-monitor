// server.js
// FULL VERSION WITH JUNCTION CONTROL SYSTEM

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
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

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

function putToken() {
  const t = makeToken();
  TOKENS.set(t, { exp: Date.now() + TOKEN_TTL_MS });
  return t;
}

function isValidToken(t) {
  if (!t) return false;
  const row = TOKENS.get(t);
  if (!row) return false;
  if (Date.now() > row.exp) {
    TOKENS.delete(t);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  const token = req.headers["x-auth-token"];
  if (isValidToken(token)) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ======================
// DATABASE
// ======================

mongoose.connect("mongodb://127.0.0.1:27017/iot-monitor");

const deviceSchema = new mongoose.Schema({
  device_id: String,
  lat: Number,
  lng: Number,
  last_seen: Number,
  status: String
});

const Device = mongoose.model("Device", deviceSchema);

// ======================
// LOGIN PAGE
// ======================

app.get("/login",(req,res)=>{

res.send(`
<html>
<head>
<title>Login</title>
</head>
<body style="font-family:Times New Roman">

<h2>Display Monitor Login</h2>

<form id="f">

<input id="u" placeholder="Username"><br><br>

<input id="p" type="password" placeholder="Password"><br><br>

<button>Login</button>

</form>

<script>

document.getElementById("f").onsubmit=async(e)=>{

e.preventDefault()

const r=await fetch("/login",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({
username:u.value,
password:p.value
})
})

const t=await r.text()

document.open()
document.write(t)
document.close()

}

</script>

</body>
</html>
`)

})

// ======================
// LOGIN POST
// ======================

app.post("/login",(req,res)=>{

const {username,password}=req.body

if(username!==ADMIN_USER || password!==ADMIN_PASS)
return res.status(401).send("Invalid login")

const token=putToken()

res.send(renderDashboardHTML(token))

})

// ======================
// DEVICE HEARTBEAT
// ======================

app.post("/heartbeat",async(req,res)=>{

const {device_id,lat,lng}=req.body

await Device.findOneAndUpdate(
{device_id},
{
device_id,
lat,
lng,
status:"online",
last_seen:Date.now()
},
{upsert:true}
)

res.json({ok:true})

})

// ======================
// DEVICES LIST
// ======================

app.get("/devices",async(req,res)=>{

const data=await Device.find()

res.json(data)

})

// ======================
// SEND MESSAGE
// ======================

app.post("/api/simple",requireAuth,(req,res)=>{

console.log("Message to device",req.body)

res.json({ok:true})

})

// ======================
// DASHBOARD
// ======================

function renderDashboardHTML(TOKEN){

return `

<html>

<head>

<title>Traffic Control Dashboard</title>

<style>

body{
margin:0;
font-family:Times New Roman;
background:#fff7ed;
}

.sidebar{
width:250px;
background:white;
position:fixed;
height:100%;
padding:20px;
border-right:1px solid #fed7aa;
}

.content{
margin-left:260px;
padding:20px;
}

button{
padding:10px;
margin:5px;
border:1px solid #fed7aa;
background:white;
cursor:pointer;
border-radius:6px;
}

button:hover{
background:#f97316;
color:white;
}

#arms{
margin-top:20px;
}

.panel{
margin-top:20px;
padding:20px;
border:1px solid #fed7aa;
background:white;
}

</style>

</head>

<body>

<div class="sidebar">

<h3>Junctions</h3>

<div id="junctions"></div>

</div>

<div class="content">

<h2>Message Control</h2>

<div id="selected"></div>

<div id="arms"></div>

<div class="panel">

<select id="signal">

<option value="red">RED</option>

<option value="amber">AMBER</option>

<option value="green">GREEN</option>

</select>

<br><br>

<input id="line1" placeholder="Line 1"><br><br>

<input id="line2" placeholder="Line 2"><br><br>

<button onclick="send()">Send to ESP</button>

<div id="status"></div>

</div>

</div>

<script>

const TOKEN="${TOKEN}"

let CURRENT_DEVICE=null

// ======================
// JUNCTION DATA
// ======================

const JUNCTIONS={

"Ameerpet":[
{name:"North Road",device:"ameerpet_1"},
{name:"South Road",device:"ameerpet_2"},
{name:"East Road",device:"ameerpet_3"},
{name:"West Road",device:"ameerpet_4"}
],

"Paradise":[
{name:"Secunderabad Road",device:"paradise_1"},
{name:"Begumpet Road",device:"paradise_2"},
{name:"Tankbund Road",device:"paradise_3"},
{name:"MG Road",device:"paradise_4"}
],

"Punjagutta":[
{name:"Arm1",device:"punjagutta_1"},
{name:"Arm2",device:"punjagutta_2"},
{name:"Arm3",device:"punjagutta_3"},
{name:"Arm4",device:"punjagutta_4"}
]

}

// ======================
// LOAD JUNCTIONS
// ======================

function loadJunctions(){

const box=document.getElementById("junctions")

Object.keys(JUNCTIONS).forEach(j=>{

const b=document.createElement("button")

b.innerText=j

b.onclick=()=>toggleJunction(j)

box.appendChild(b)

})

}

let openJunction=null

function toggleJunction(j){

const arms=document.getElementById("arms")

if(openJunction===j){

arms.innerHTML=""

openJunction=null

return

}

openJunction=j

arms.innerHTML=""

JUNCTIONS[j].forEach(a=>{

const b=document.createElement("button")

b.innerText=a.name

b.onclick=()=>selectArm(a.device)

arms.appendChild(b)

})

}

function selectArm(device){

CURRENT_DEVICE=device

document.getElementById("selected").innerHTML=
"Selected device: <b>"+device+"</b>"

}

// ======================
// SEND MESSAGE
// ======================

async function send(){

if(!CURRENT_DEVICE){

status.innerText="Select arm first"

return

}

const payload={

device_id:CURRENT_DEVICE,

sig:signal.value,

line1:line1.value,

line2:line2.value

}

const r=await fetch("/api/simple",{

method:"POST",

headers:{
"Content-Type":"application/json",
"X-Auth-Token":TOKEN
},

body:JSON.stringify(payload)

})

status.innerText="Sent"

}

loadJunctions()

</script>

</body>

</html>

`

}

// ======================
// SERVER
// ======================

const PORT=5000

app.listen(PORT,()=>{

console.log("Server running on",PORT)

})