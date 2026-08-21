
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let draws = [];
let lineCount = 5;
let deferredPrompt = null;

const DEFAULT_DRAWS = [
  {date:"2026-08-15",numbers:[17,27,28,42,47,59]},
  {date:"2026-08-12",numbers:[3,14,22,24,34,54]},
  {date:"2026-08-08",numbers:[14,18,26,45,50,53]},
  {date:"2026-08-05",numbers:[24,26,27,39,47,50]},
  {date:"2026-08-01",numbers:[16,19,32,33,34,44]}
];

const descriptions = {
  "Balanced":"Typical historical structure + lower-sharing-risk patterns.",
  "Low sharing risk":"Avoids birthdays, obvious sequences and common human patterns.",
  "Hot numbers":"Weights numbers that appeared more often historically.",
  "Overdue numbers":"Weights numbers absent for longer periods.",
  "Pure random":"No historical weighting. A clean random baseline."
};

function saveDraws(){
  localStorage.setItem("lottoEdgeDraws", JSON.stringify(draws));
}
function loadLocalDraws(){
  const saved = localStorage.getItem("lottoEdgeDraws");
  if(saved){
    try{ draws = JSON.parse(saved) || []; }catch(e){ draws=[]; }
  }
  if(!draws.length){ draws = DEFAULT_DRAWS; saveDraws(); }
}
function saveHistory(items){
  const old = JSON.parse(localStorage.getItem("lottoEdgeHistory") || "[]");
  localStorage.setItem("lottoEdgeHistory", JSON.stringify([...items,...old].slice(0,100)));
}
function getHistory(){ return JSON.parse(localStorage.getItem("lottoEdgeHistory") || "[]"); }

function dedupeAndSort(items){
  const seen = new Set(), out = [];
  for(const d of items){
    if(!d || !Array.isArray(d.numbers) || d.numbers.length!==6) continue;
    const nums = [...new Set(d.numbers.map(Number))].sort((a,b)=>a-b);
    if(nums.length!==6 || nums.some(n=>n<1||n>59)) continue;
    const key = `${d.date||""}|${nums.join(",")}`;
    if(seen.has(key)) continue;
    seen.add(key);
    out.push({date:d.date||"",numbers:nums,bonus:d.bonus??null});
  }
  out.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  return out;
}

function counts(){
  const freq = Array(60).fill(0), last = Array(60).fill(draws.length);
  const pairs = {};
  draws.forEach((d,idx)=>{
    d.numbers.forEach(n=>{freq[n]++; if(last[n]===draws.length) last[n]=idx;});
    for(let i=0;i<6;i++)for(let j=i+1;j<6;j++){
      const k=`${d.numbers[i]}-${d.numbers[j]}`;
      pairs[k]=(pairs[k]||0)+1;
    }
  });
  return {freq,last,pairs};
}
function drawStats(){
  const c=counts();
  const flat=draws.map(d=>d.numbers);
  const sums=flat.map(a=>a.reduce((x,y)=>x+y,0));
  const odds=flat.map(a=>a.filter(n=>n%2).length);
  const lows=flat.map(a=>a.filter(n=>n<=29).length);
  const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
  const mode=a=>{
    const x=Object.entries(a.reduce((o,n)=>(o[n]=(o[n]||0)+1,o),{})).sort((p,q)=>q[1]-p[1]);
    return x.length ? +x[0][0] : 3;
  };
  const sm=mean(sums);
  const ss=Math.sqrt(mean(sums.map(x=>(x-sm)**2)))||1;
  return {...c,sumMean:sm,sumStd:ss,oddMode:mode(odds),lowMode:mode(lows)};
}
function zscore(arr,n){
  const vals=arr.slice(1), m=vals.reduce((a,b)=>a+b,0)/vals.length;
  const sd=Math.sqrt(vals.reduce((s,x)=>s+(x-m)**2,0)/vals.length)||1;
  return (arr[n]-m)/sd;
}
function sample6(){
  const pool=Array.from({length:59},(_,i)=>i+1), out=[];
  for(let i=0;i<6;i++){
    const j=Math.floor(Math.random()*pool.length);
    out.push(pool.splice(j,1)[0]);
  }
  return out.sort((a,b)=>a-b);
}
function features(line){
  const odd=line.filter(n=>n%2).length, low=line.filter(n=>n<=29).length;
  let consecutive=0,sameLast=0;
  for(let i=0;i<5;i++) if(line[i+1]===line[i]+1) consecutive++;
  for(let i=0;i<6;i++)for(let j=i+1;j<6;j++) if(line[i]%10===line[j]%10) sameLast++;
  const birthday=line.filter(n=>n<=31).length;
  const diffs=line.slice(1).map((n,i)=>n-line[i]);
  const dc={};diffs.forEach(d=>dc[d]=(dc[d]||0)+1);
  const repeatedGap=Math.max(0,...Object.values(dc));
  return {odd,low,sum:line.reduce((a,b)=>a+b,0),consecutive,sameLast,birthday,repeatedGap};
}
function sharing(line){
  const f=features(line);let p=0;
  p+=Math.max(0,f.birthday-2)*10;
  p+=f.consecutive*12;
  p+=Math.max(0,f.sameLast-1)*4;
  p+=Math.max(0,f.repeatedGap-2)*7;
  return Math.max(0,Math.min(100,100-p));
}
function score(line,strategy,s){
  const f=features(line);
  let balance=100-Math.abs(f.odd-s.oddMode)*8-Math.abs(f.low-s.lowMode)*7;
  balance-=Math.min(30,Math.abs(f.sum-s.sumMean)/s.sumStd*10);
  balance-=f.consecutive*4;
  balance=Math.max(0,Math.min(100,balance));
  const share=sharing(line);
  const hot=line.reduce((a,n)=>a+zscore(s.freq,n),0)/6;
  const due=line.reduce((a,n)=>a+zscore(s.last,n),0)/6;
  let sc=50;
  if(strategy==="Balanced") sc=.55*balance+.45*share;
  if(strategy==="Low sharing risk") sc=.75*share+.25*balance;
  if(strategy==="Hot numbers") sc=50+hot*14+share*.22+balance*.18;
  if(strategy==="Overdue numbers") sc=50+due*14+share*.22+balance*.18;
  return {score:Math.max(0,Math.min(100,sc)),balance,share,...f};
}
function generate(){
  const strategy=$("#strategy").value, s=drawStats(), pool=[];
  if(strategy==="Pure random"){
    for(let i=0;i<lineCount;i++) pool.push({line:sample6(),detail:null});
  } else {
    const seen=new Set();
    for(let i=0;i<7000;i++){
      const line=sample6(),k=line.join(",");
      if(seen.has(k))continue;
      seen.add(k);
      pool.push({line,detail:score(line,strategy,s)});
    }
    pool.sort((a,b)=>b.detail.score-a.detail.score);
    const chosen=[];
    for(const item of pool){
      if(chosen.every(x=>item.line.filter(n=>x.line.includes(n)).length<=4))chosen.push(item);
      if(chosen.length===lineCount)break;
    }
    pool.splice(0,pool.length,...chosen);
  }
  const stamp=new Date().toISOString();
  const saved=pool.map(x=>({...x,strategy,created:stamp}));
  saveHistory(saved);
  renderPicks(saved);
  navigator.vibrate?.(35);
}
function renderPicks(items){
  $("#results").innerHTML=items.map((x,i)=>`
    <div class="ticket">
      <div class="ticket-head"><strong>Line ${i+1}</strong><span class="pill">${x.detail?`Score ${Math.round(x.detail.score)}/100`:"Random"}</span></div>
      <div class="balls">${x.line.map(n=>`<span class="ball">${n}</span>`).join("")}</div>
      <div class="ticket-meta">${x.detail?`<span>Balance ${Math.round(x.detail.balance)}</span><span>Low-sharing ${Math.round(x.detail.share)}</span><span>Sum ${x.detail.sum}</span>`:"<span>Pure random selection</span>"}</div>
    </div>`).join("");
}
function updateSummary(){
  const s=drawStats();
  $("#drawCount").textContent=draws.length;
  if(!draws.length){$("#hotNumber").textContent="—";$("#overdueNumber").textContent="—";return;}
  let hot=1,due=1;
  for(let n=2;n<=59;n++){
    if(s.freq[n]>s.freq[hot])hot=n;
    if(s.last[n]>s.last[due])due=n;
  }
  $("#hotNumber").textContent=hot;
  $("#overdueNumber").textContent=due;
}
function renderStats(kind="hot"){
  const s=drawStats(), target=$("#statList");
  if(!draws.length){target.innerHTML='<div class="empty">Import draw history first.</div>';return;}
  let rows=[];
  if(kind==="pairs"){
    rows=Object.entries(s.pairs).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([k,v])=>({label:k.replace("-", " + "),v}));
  } else {
    for(let n=1;n<=59;n++) rows.push({label:n,v:kind==="hot"?s.freq[n]:s.last[n]});
    rows.sort((a,b)=>b.v-a.v);
    rows=rows.slice(0,20);
  }
  const max=Math.max(...rows.map(r=>r.v),1);
  target.innerHTML=rows.map(r=>`
    <div class="stat-row">
      <div class="numdot">${r.label}</div>
      <div class="bar"><i style="width:${r.v/max*100}%"></i></div>
      <div class="stat-value">${r.v}</div>
    </div>`).join("");
}
function renderHistory(){
  const h=getHistory(), el=$("#ticketHistory");
  if(!h.length){el.innerHTML='<div class="empty">Your generated lines will be saved here on this phone.</div>';return;}
  el.innerHTML=h.map(x=>`
    <div class="ticket">
      <div class="ticket-head"><strong>${x.strategy}</strong><span class="pill">${new Date(x.created).toLocaleDateString()}</span></div>
      <div class="balls">${x.line.map(n=>`<span class="ball">${n}</span>`).join("")}</div>
    </div>`).join("");
}
function parseCSV(text){
  const lines=text.replace(/\r/g,"").split("\n").filter(x=>x.trim());
  if(lines.length<2) return [];
  const parseLine=line=>{
    const out=[];let cur="",q=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){
        if(q && line[i+1]==='"'){cur+='"';i++;}
        else q=!q;
      } else if(ch==="," && !q){out.push(cur.trim());cur="";}
      else cur+=ch;
    }
    out.push(cur.trim());return out;
  };
  const headers=parseLine(lines[0]).map(h=>h.toLowerCase().replace(/[_-]/g," ").trim());
  const find=(aliases)=>headers.findIndex(h=>aliases.includes(h));
  const idxs=[];
  for(let i=1;i<=6;i++){
    idxs.push(find([`n${i}`,`ball ${i}`,`ball${i}`,`number ${i}`,`number${i}`]));
  }
  const dateIdx=find(["date","draw date","drawdate"]);
  const bonusIdx=find(["bonus","bonus ball","bonusball","ball 7","ball7"]);
  if(idxs.some(i=>i<0)) return [];

  const out=[];
  for(let r=1;r<lines.length;r++){
    const vals=parseLine(lines[r]);
    const nums=idxs.map(i=>Number(vals[i]));
    if(nums.length!==6 || nums.some(n=>!Number.isFinite(n)||n<1||n>59) || new Set(nums).size!==6) continue;
    const b=bonusIdx>=0 ? Number(vals[bonusIdx]) : null;
    out.push({
      date:dateIdx>=0 ? vals[dateIdx] : "",
      numbers:nums.sort((a,b)=>a-b),
      bonus:Number.isFinite(b)?b:null
    });
  }
  return out;
}
async function importCSV(file){
  const text=await file.text();
  const imported=parseCSV(text);
  if(!imported.length) throw new Error("No valid 6-number Lotto rows were detected.");
  draws=dedupeAndSort([...imported,...draws]);
  saveDraws();
  updateSummary();renderStats();
  return imported.length;
}
async function checkUpdates(manual=false){
  const url=localStorage.getItem("lottoEdgeUpdateUrl")||"";
  if(!url){
    if(manual) $("#updateStatus").textContent="No update source is saved. Add one in Settings, or import a CSV.";
    return;
  }
  if(!navigator.onLine){
    if(manual) $("#updateStatus").textContent="Offline. Lotto Edge is using the draw history already stored on this phone.";
    return;
  }
  try{
    if(manual) $("#updateStatus").textContent="Checking for new draws…";
    const r=await fetch(url,{cache:"no-store"});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const imported=parseCSV(await r.text());
    if(!imported.length) throw new Error("No recognisable draw rows found.");
    const before=draws.length;
    draws=dedupeAndSort([...imported,...draws]);
    saveDraws();
    updateSummary();renderStats();
    localStorage.setItem("lottoEdgeLastUpdate",Date.now());
    if(manual) $("#updateStatus").textContent=`Updated. ${draws.length-before} new draw rows added; ${draws.length} stored locally.`;
  }catch(e){
    if(manual) $("#updateStatus").textContent=`Could not update from that source: ${e.message}`;
  }
}
function autoUpdateOnOpen(){
  const url=localStorage.getItem("lottoEdgeUpdateUrl")||"";
  if(!url || !navigator.onLine) return;
  const last=+(localStorage.getItem("lottoEdgeLastUpdate")||0);
  if(Date.now()-last>6*60*60*1000) checkUpdates(false);
}

$("#strategy").addEventListener("change",e=>$("#strategyInfo").textContent=descriptions[e.target.value]);
$("#strategyInfo").textContent=descriptions[$("#strategy").value];
$("#minusLine").onclick=()=>{lineCount=Math.max(1,lineCount-1);$("#lineCount").textContent=lineCount};
$("#plusLine").onclick=()=>{lineCount=Math.min(10,lineCount+1);$("#lineCount").textContent=lineCount};
$("#generateBtn").onclick=generate;

$$(".bottom-nav button").forEach(b=>b.onclick=()=>{
  $$(".bottom-nav button").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  $$(".screen").forEach(x=>x.classList.remove("active"));
  $("#"+b.dataset.screen).classList.add("active");
  if(b.dataset.screen==="historyScreen")renderHistory();
});

$$(".segmented button").forEach(b=>b.onclick=()=>{
  $$(".segmented button").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  renderStats(b.dataset.stat);
});

$("#clearHistory").onclick=()=>{
  localStorage.removeItem("lottoEdgeHistory");
  renderHistory();
};

$("#refreshBtn").onclick=()=>checkUpdates(true);

$("#importBtn").onclick=async()=>{
  const file=$("#csvInput").files[0];
  if(!file){$("#importStatus").textContent="Choose a CSV file first.";return;}
  $("#importStatus").textContent="Importing…";
  try{
    const n=await importCSV(file);
    $("#importStatus").textContent=`Imported ${n} valid draw rows. ${draws.length} stored locally.`;
  }catch(e){
    $("#importStatus").textContent=e.message;
  }
};

$("#saveUrlBtn").onclick=()=>{
  const url=$("#updateUrl").value.trim();
  if(!url){
    localStorage.removeItem("lottoEdgeUpdateUrl");
    $("#urlStatus").textContent="Update source removed.";
    return;
  }
  localStorage.setItem("lottoEdgeUpdateUrl",url);
  $("#urlStatus").textContent="Saved. Lotto Edge will check this source when opened and when you tap Check updates.";
};

window.addEventListener("beforeinstallprompt",e=>{
  e.preventDefault();
  deferredPrompt=e;
  $("#installBtn").classList.remove("hidden");
});
$("#installBtn").onclick=async()=>{
  if(!deferredPrompt)return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt=null;
  $("#installBtn").classList.add("hidden");
};

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("service-worker.js");
}

loadLocalDraws();
$("#updateUrl").value=localStorage.getItem("lottoEdgeUpdateUrl")||"";
updateSummary();
renderStats();
renderHistory();
autoUpdateOnOpen();
