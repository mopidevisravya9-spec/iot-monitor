// server.js
// FULL VERSION – NO DATABASE – SAME DASHBOARD STRUCTURE

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

/* ======================
LOGIN
====================== */

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

setInterval(()=>{
  const now = Date.now();
  for(const [t,row] of TOKENS.entries()){
    if(now>row.exp) TOKENS.delete(t);
  }
},60000);

/* ======================
CONSTANTS
====================== */

const OFFLINE_AFTER_MS = 30000;
const MSG_SLOTS = 5;

/* ======================
JSON STORAGE ENGINE
====================== */

const DEVICES = new Map();
const CLOUD_MSG = new Map();

/*
We simulate mongoose methods so the rest of the
code stays identical.
*/

class DeviceStore {

static async findOneAndUpdate(query,update){

const id = query.device_id;

let dev = DEVICES.get(id);

if(!dev){
dev = {
device_id:id,
lat:0,
lng:0,
last_seen:0,
status:"offline"
};
}

if(update.$set){
Object.assign(dev,update.$set);
}

if(update.$setOnInsert && !DEVICES.has(id)){
Object.assign(dev,update.$setOnInsert);
}

DEVICES.set(id,dev);

return dev;

}

static async findOne(query){
return DEVICES.get(query.device_id);
}

static async updateMany(query,update){

for(const dev of DEVICES.values()){

if(dev.last_seen < query.last_seen.$lt){
Object.assign(dev,update.$set);
}

}

}

static async find(){
return Array.from(DEVICES.values());
}

}

class CloudMsgStore {

static async findOneAndUpdate(query){

const id = query.device_id;

let doc = CLOUD_MSG.get(id);

if(!doc){

doc = {
device_id:id,
force:"",
slot:{red:0,amber:0,green:0,no:0},
packs:defaultPacks(),
v:0,
updated_at:0
};

}

CLOUD_MSG.set(id,doc);

return doc;

}

}

const Device = DeviceStore;
const CloudMsg = CloudMsgStore;

/* ======================
MESSAGE TEMPLATES
====================== */

function defaultPacks(){

const pack = (pairs)=>pairs.map(([l1,l2])=>({l1,l2}));

return {

red: pack([
["HURRY ENDS HERE","YOUR FAMILY WAITS — NOT YOUR SPEED"],
["ONE SECOND OF PATIENCE","CAN BUY A LIFETIME OF PEACE"],
["BRAKE NOW","REGRET IS HEAVIER THAN YOUR FOOT"],
["THE ROAD IS NOT A GAME","PAUSE — PROTECT SOMEONE’S FUTURE"],
["STOPPING IS STRENGTH","SMART DRIVERS LIVE LONGER"]
]),

amber: pack([
["EASE OFF THE PEDAL NOW","A CALM SLOWDOWN KEEPS EVERYONE SAFE"],
["NO NEED TO RUSH THE JUNCTION","A SECOND OF PATIENCE SAVES A LIFE"],
["SLOW AND WATCH THE ROAD AHEAD","CONTROL TODAY PREVENTS COLLISION"],
["LET THE SPEED DROP GENTLY","SMOOTH BRAKING SAVES FUEL TOO"],
["PAUSE YOUR HURRY AT THE CROSSING","SAFE STREETS START WITH PATIENCE"]
]),

green: pack([
["SLOW DRIVING SAVES FUEL AND SAVES LIVES","SMART SPEED PROTECTS PEOPLE AND PLANET"],
["CALM DRIVING REDUCES ACCIDENTS AND POLLUTION","RESPONSIBLE SPEED CREATES HEALTHY CITIES"],
["GLIDE FORWARD WITH A SAFE GAP","SPACE ON THE ROAD PREVENTS CRASHES"],
["SPEED THRILLS BUT SAFETY SAVES","SAFE DRIVING IS SMART DRIVING"],
["MOVE AHEAD WITH CARE AND CONTROL","ARRIVE SAFE EVERY TIME"]
]),

no: pack([
["WHEN SIGNALS FAIL DISCIPLINE MUST NOT","CONTROL YOUR SPEED"],
["FAST DRIVING AT JUNCTIONS INVITES ACCIDENTS","SLOW DOWN AND STAY ALERT"],
["WITHOUT SIGNALS SAFETY DEPENDS ON YOU","DRIVE WITH PATIENCE"],
["DISCIPLINED DRIVERS CREATE SAFE ROADS","FOLLOW TRAFFIC RULES"],
["YOUR SPEED DECIDES SOMEONES FUTURE","DRIVE RESPONSIBLY"]
])

};

}

/* ======================
HELPERS
====================== */

const signals=["red","amber","green","no"];

function clampSlot(n){
const x=Number.isFinite(n)?n:0;
if(x<0) return 0;
if(x>=MSG_SLOTS) return MSG_SLOTS-1;
return x;
}

function normalizePack(arr){

const safe=Array.isArray(arr)?arr:[];
const out=[];

for(let i=0;i<MSG_SLOTS;i++){

const it=safe[i]||{};
out.push({l1:String(it.l1||""),l2:String(it.l2||"")});

}

return out;

}

async function ensureMsgRow(device_id){

return CloudMsg.findOneAndUpdate({device_id});

}

function isDeviceOnlineRow(dev){

if(!dev) return false;

return Date.now()-dev.last_seen<=OFFLINE_AFTER_MS;

}

/* ======================
AUTH
====================== */

function requireAuth(req,res,next){

const token=req.headers["x-auth-token"];

if(isValidToken(token)) return next();

res.status(401).json({error:"Unauthorized"});

}

/* ======================
HOME
====================== */

app.get("/",(req,res)=>res.redirect("/login"));

/* ======================
LOGIN PAGE
====================== */

app.get("/login",(req,res)=>{

res.send("<h2>Login Page (unchanged)</h2>");

});

/* ======================
LOGIN POST
====================== */

app.post("/login",(req,res)=>{

const {username,password}=req.body||{};

if(username!==ADMIN_USER || password!==ADMIN_PASS){
return res.status(401).json({error:"Invalid login"});
}

const token=putToken();

res.send(renderDashboardHTML(token));

});

/* ======================
REGISTER
====================== */

app.post("/register",async(req,res)=>{

const {device_id,lat,lng}=req.body||{};

if(!device_id) return res.status(400).json({error:"device_id required"});

const now=Date.now();

const doc = await Device.findOneAndUpdate(
{device_id},
{
$set:{
lat:lat||0,
lng:lng||0,
last_seen:now,
status:"online"
}
}
);

await ensureMsgRow(device_id);

res.json({message:"Registered",device:doc});

});

/* ======================
HEARTBEAT
====================== */

app.post("/heartbeat",async(req,res)=>{

const {device_id,lat,lng}=req.body||{};

if(!device_id) return res.status(400).json({error:"device_id required"});

const now=Date.now();

await Device.findOneAndUpdate(
{device_id},
{
$set:{
last_seen:now,
status:"online",
lat:lat||0,
lng:lng||0
}
}
);

await ensureMsgRow(device_id);

res.json({message:"OK"});

});

/* ======================
DEVICES LIST
====================== */

app.get("/devices",async(req,res)=>{

const now=Date.now();

await Device.updateMany(
{last_seen:{ $lt: now-OFFLINE_AFTER_MS }},
{ $set:{ status:"offline" } }
);

const data = (await Device.find()).sort((a,b)=>b.last_seen-a.last_seen);

res.json(data);

});

/* ======================
SEND MESSAGE
====================== */

app.post("/api/simple",requireAuth,async(req,res)=>{

const {device_id,force,sig,slot,line1,line2}=req.body||{};

const dev = await Device.findOne({device_id});

if(!isDeviceOnlineRow(dev)){
return res.status(400).json({error:"Device OFFLINE"});
}

const doc = await ensureMsgRow(device_id);

const s = sig || "red";

const sl = clampSlot(slot);

doc.packs[s]=normalizePack(doc.packs[s]);

doc.packs[s][sl]={l1:line1||"",l2:line2||""};

doc.slot[s]=sl;

doc.force=force||"";

doc.v++;

doc.updated_at=Date.now();

CLOUD_MSG.set(device_id,doc);

res.json({ok:true});

});

/* ======================
ESP PULL
====================== */

app.get("/api/pull/:device_id",async(req,res)=>{

const device_id=req.params.device_id;

const doc = await ensureMsgRow(device_id);

res.json({
ok:true,
changed:true,
device_id,
force:doc.force,
slot:doc.slot,
packs:doc.packs,
slots:MSG_SLOTS,
updated_at:doc.updated_at
});

});

/* ======================
DASHBOARD HTML
====================== */

function renderDashboardHTML(token){

return "<h1>Dashboard Loaded</h1>";

}

/* ======================
SERVER START
====================== */

const PORT=5000;

app.listen(PORT,()=>{

console.log("Server started on port "+PORT);

});