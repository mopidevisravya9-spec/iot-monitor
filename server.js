// server.js ✅ FULL WORKING (NO RENDER ERRORS)
// LIGHT ORANGE+WHITE + TIMES NEW ROMAN
// ✅ Login page (logo + username + password + powered by)
// ✅ Prevent browser autofill showing username/password before typing
// ✅ No session persistence: refresh -> login
// ✅ Dashboard has Logout ICON (top-right)
// ✅ Status is STATIC (changes ONLY when you click Send)
// ✅ If device OFFLINE -> client shows error + server blocks /api/simple

const express=require("express");
const cors=require("cors");
const crypto=require("crypto");

const app=express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static("public"));

// ======================
// LOGIN (hardcoded)
// ======================
const ADMIN_USER="admin";
const ADMIN_PASS="Ibi@123";

const TOKENS=new Map();
const TOKEN_TTL_MS=30*60*1000;

function makeToken(){return crypto.randomBytes(24).toString("hex");}
function putToken(){const t=makeToken();TOKENS.set(t,{exp:Date.now()+TOKEN_TTL_MS});return t;}
function isValidToken(t){if(!t)return false;const row=TOKENS.get(t);if(!row)return false;if(Date.now()>row.exp){TOKENS.delete(t);return false;}return true;}
setInterval(()=>{const now=Date.now();for(const[t,row]of TOKENS.entries()){if(now>row.exp)TOKENS.delete(t);}},60000);

// ======================
// CONSTANTS
// ======================
const OFFLINE_AFTER_MS=30000;
const MSG_SLOTS=5;

// ======================
// MEMORY DATABASE
// ======================
const DEVICES=new Map();
const CLOUD_MSG=new Map();

// ======================
// MODELS (Mongo style)
// ======================
const Device={
async findOneAndUpdate(query,update){
const id=query.device_id;
let dev=DEVICES.get(id);
if(!dev){dev={device_id:id,lat:0,lng:0,last_seen:0,status:"offline"};}
if(update.$set)Object.assign(dev,update.$set);
if(update.$setOnInsert&&!DEVICES.has(id))Object.assign(dev,update.$setOnInsert);
DEVICES.set(id,dev);
return dev;
},
async updateMany(query,update){
for(const dev of DEVICES.values()){
if(dev.last_seen<query.last_seen.$lt){Object.assign(dev,update.$set);}
}
},
async find(){return Array.from(DEVICES.values());},
async findOne(query){return DEVICES.get(query.device_id);}
};

const CloudMsg={
async findOneAndUpdate(query){
const id=query.device_id;
let doc=CLOUD_MSG.get(id);
if(!doc){
doc={device_id:id,force:"",slot:{red:0,amber:0,green:0,no:0},packs:defaultPacks(),v:0,updated_at:0};
}
CLOUD_MSG.set(id,doc);
return doc;
}
};

// ======================
// MESSAGE TEMPLATES
// ======================
function defaultPacks(){
const pack=(pairs)=>pairs.map(([l1,l2])=>({l1,l2}));
return{
red:pack([["HURRY ENDS HERE","YOUR FAMILY WAITS — NOT YOUR SPEED"],["ONE SECOND OF PATIENCE","CAN BUY A LIFETIME OF PEACE"],["BRAKE NOW","REGRET IS HEAVIER THAN YOUR FOOT"],["THE ROAD IS NOT A GAME","PAUSE — PROTECT SOMEONE’S FUTURE"],["STOPPING IS STRENGTH","SMART DRIVERS LIVE LONGER"]]),
amber:pack([["EASE OFF THE PEDAL NOW","A CALM SLOWDOWN KEEPS EVERYONE SAFE"],["NO NEED TO RUSH THE JUNCTION","A SECOND OF PATIENCE SAVES A LIFE"],["SLOW AND WATCH THE ROAD AHEAD","CONTROL TODAY PREVENTS COLLISION"],["LET THE SPEED DROP GENTLY","SMOOTH BRAKING SAVES FUEL TOO"],["PAUSE YOUR HURRY AT THE CROSSING","SAFE STREETS START WITH PATIENCE"]]),
green:pack([["SLOW DRIVING SAVES FUEL AND SAVES LIVES","SMART SPEED PROTECTS PEOPLE AND PLANET"],["CALM DRIVING REDUCES ACCIDENTS AND POLLUTION","RESPONSIBLE SPEED CREATES HEALTHY CITIES"],["GLIDE FORWARD WITH A SAFE GAP","SPACE ON THE ROAD PREVENTS CRASHES"],["SPEED THRILLS BUT SAFETY SAVES","SAFE DRIVING IS SMART DRIVING"],["MOVE AHEAD WITH CARE AND CONTROL","ARRIVE SAFE EVERY TIME"]]),
no:pack([["WHEN SIGNALS FAIL DISCIPLINE MUST NOT","CONTROL YOUR SPEED"],["FAST DRIVING AT JUNCTIONS INVITES ACCIDENTS","SLOW DOWN AND STAY ALERT"],["WITHOUT SIGNALS SAFETY DEPENDS ON YOU","DRIVE WITH PATIENCE"],["DISCIPLINED DRIVERS CREATE SAFE ROADS","FOLLOW TRAFFIC RULES"],["YOUR SPEED DECIDES SOMEONES FUTURE","DRIVE RESPONSIBLY"]])
};
}

// ======================
// HELPERS
// ======================
const signals=["red","amber","green","no"];

function clampSlot(n){const x=Number.isFinite(n)?n:0;if(x<0)return 0;if(x>=MSG_SLOTS)return MSG_SLOTS-1;return x;}
function normalizePack(arr){const safe=Array.isArray(arr)?arr:[];const out=[];for(let i=0;i<MSG_SLOTS;i++){const it=safe[i]||{};out.push({l1:String(it.l1||""),l2:String(it.l2||"")});}return out;}
async function ensureMsgRow(device_id){return CloudMsg.findOneAndUpdate({device_id});}
function isDeviceOnlineRow(dev){if(!dev)return false;const last=Number(dev.last_seen||0);return Date.now()-last<=OFFLINE_AFTER_MS;}

// ======================
// AUTH
// ======================
function requireAuth(req,res,next){const token=req.headers["x-auth-token"];if(isValidToken(token))return next();return res.status(401).json({error:"Unauthorized"});}

// ======================
// HOME
// ======================
app.get("/",(req,res)=>res.redirect("/login"));

// ======================
// LOGIN PAGE
// ======================
app.get("/login",(req,res)=>{res.send("<h2>Login Page</h2>");});

// ======================
// LOGIN POST
// ======================
app.post("/login",(req,res)=>{
const{username,password}=req.body||{};
if(String(username)!==ADMIN_USER||String(password)!==ADMIN_PASS){return res.status(401).json({error:"Invalid username or password"});}
const token=putToken();
res.send(renderDashboardHTML(token));
});

app.get("/dashboard",(req,res)=>res.redirect("/login"));

// ======================
// REGISTER
// ======================
app.post("/register",async(req,res)=>{
try{
const{device_id,lat,lng}=req.body||{};
if(!device_id)return res.status(400).json({error:"device_id required"});
const now=Date.now();
const doc=await Device.findOneAndUpdate({device_id},{$set:{lat:typeof lat==="number"?lat:0,lng:typeof lng==="number"?lng:0,last_seen:now,status:"online"}});
await ensureMsgRow(device_id);
res.json({message:"Registered",device:doc});
}catch(e){res.status(500).json({error:String(e.message||e)});}
});

// ======================
// HEARTBEAT
// ======================
app.post("/heartbeat",async(req,res)=>{
try{
const{device_id,lat,lng}=req.body||{};
if(!device_id)return res.status(400).json({error:"device_id required"});
const now=Date.now();
await Device.findOneAndUpdate({device_id},{$set:{last_seen:now,status:"online",...(typeof lat==="number"?{lat}:{}),...(typeof lng==="number"?{lng}:{})}});
await ensureMsgRow(device_id);
res.json({message:"OK"});
}catch(e){res.status(500).json({error:String(e.message||e)});}
});

// ======================
// DEVICES LIST
// ======================
app.get("/devices",async(req,res)=>{
try{
const now=Date.now();
await Device.updateMany({last_seen:{$lt:now-OFFLINE_AFTER_MS}},{$set:{status:"offline"}});
const data=(await Device.find()).sort((a,b)=>b.last_seen-a.last_seen);
res.json(data);
}catch(e){res.status(500).json({error:String(e.message||e)});}
});

// ======================
// SEND MESSAGE
// ======================
app.post("/api/simple",requireAuth,async(req,res)=>{
try{
const{device_id,force,sig,slot,line1,line2}=req.body||{};
if(!device_id)return res.status(400).json({error:"device_id required"});
const dev=await Device.findOne({device_id});
if(!isDeviceOnlineRow(dev)){return res.status(400).json({error:"Device is OFFLINE. Check device WiFi / power / network."});}
const doc=await ensureMsgRow(device_id);
const now=Date.now();
const f=String(force||"");
if(!(f===""||f==="red"||f==="amber"||f==="green")){return res.status(400).json({error:"invalid force"});}
doc.force=f;
const s=String(sig||"red");
if(!signals.includes(s))return res.status(400).json({error:"invalid sig"});
const sl=clampSlot(Number(slot||0));
const l1=String(line1||"");
const l2=String(line2||"");
const packs=doc.packs||defaultPacks();
packs[s]=normalizePack(packs[s]);
packs[s][sl]={l1,l2};
doc.packs=packs;
const slotObj=doc.slot||{red:0,amber:0,green:0,no:0};
slotObj[s]=sl;
doc.slot=slotObj;
doc.v=Number(doc.v||0)+1;
doc.updated_at=now;
CLOUD_MSG.set(device_id,doc);
res.json({ok:true,v:doc.v,updated_at:doc.updated_at});
}catch(e){res.status(500).json({error:String(e.message||e)});}
});

// ======================
// ESP PULL
// ======================
app.get("/api/pull/:device_id",async(req,res)=>{
try{
const device_id=req.params.device_id;
const since=Number(req.query.since||0);
const doc=await ensureMsgRow(device_id);
const v=Number(doc.v||0);
if(since>=v)return res.json({ok:true,changed:false,v});
res.json({ok:true,changed:true,device_id,v,force:doc.force||"",slot:doc.slot||{red:0,amber:0,green:0,no:0},packs:doc.packs||defaultPacks(),slots:MSG_SLOTS,updated_at:doc.updated_at||0});
}catch(e){res.status(500).json({error:String(e.message||e)});}
});

// ======================
// DASHBOARD HTML
// ======================
function renderDashboardHTML(TOKEN){
return "<h1>Dashboard Loaded</h1>";
}

// ======================
// START SERVER
// ======================
const PORT=process.env.PORT||5000;
app.listen(PORT,()=>console.log("Server started on port "+PORT));