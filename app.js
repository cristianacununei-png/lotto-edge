
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const EURO_REMOTE =
  "https://raw.githubusercontent.com/daowa89/lottery-archive/main/eu/euromillions/results.csv";

const GAMES = {
  lotto:{name:"Lotto",label:"UK LOTTO · 6 / 59",max:59,picks:6,stars:0,starMax:0,storage:"lottoEdgeDraws"},
  euromillions:{name:"EuroMillions",label:"EUROMILLIONS · 5 / 50 + 2 / 12",max:50,picks:5,stars:2,starMax:12,storage:"lottoEdgeEuroDraws"}
};

const LOTTO_DEMO = [
  {date:"2026-08-15",numbers:[17,27,28,42,47,59],stars:[]},
  {date:"2026-08-12",numbers:[3,14,22,24,34,54],stars:[]},
  {date:"2026-08-08",numbers:[14,18,26,45,50,53],stars:[]},
  {date:"2026-08-05",numbers:[24,26,27,39,47,50],stars:[]},
  {date:"2026-08-01",numbers:[16,19,32,33,34,44],stars:[]}
];

const descriptions = {
  "Edge AI":"Recommended. Multi-factor historical model + smart ticket diversification. Analytical ranking only.",
  "Balanced":"Typical historical structure plus lower-sharing-risk patterns.",
  "Low sharing risk":"Avoids birthday-heavy and obvious human number patterns.",
  "Hot numbers":"Favours historically frequent numbers.",
  "Overdue numbers":"Favours numbers absent for longer.",
  "Pure random":"No historical weighting."
};

let activeGame=localStorage.getItem("lottoEdgeGame")||"lotto";
let draws=[];
let lineCount=5;
let activeStat="hot";

function parseCsv(text, gameKey){
  const cfg=GAMES[gameKey];
  const lines=text.replace(/\r/g,"").split("\n").filter(x=>x.trim());
  if(lines.length<2)return[];

  const split=line=>{
    const out=[];let cur="",q=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){
        if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;
      }else if(ch===","&&!q){out.push(cur.trim());cur="";}else cur+=ch;
    }
    out.push(cur.trim());return out;
  };

  const headers=split(lines[0]).map(h=>h.toLowerCase().replace(/[_-]/g," ").trim());
  const find=aliases=>headers.findIndex(h=>aliases.includes(h));
  const idx=[];
  for(let i=1;i<=cfg.picks;i++)idx.push(find([`n${i}`,`ball ${i}`,`ball${i}`,`number ${i}`,`number${i}`]));
  if(idx.some(i=>i<0))return[];
  const dateIdx=find(["date","draw date","drawdate"]);
  const starIdx=[];
  for(let i=1;i<=cfg.stars;i++)starIdx.push(find([`s${i}`,`star ${i}`,`star${i}`,`lucky star ${i}`,`luckystar${i}`]));

  const out=[];
  for(let r=1;r<lines.length;r++){
    const v=split(lines[r]);
    const nums=idx.map(i=>Number(v[i]));
    if(nums.some(n=>!Number.isInteger(n)||n<1||n>cfg.max)||new Set(nums).size!==cfg.picks)continue;
    const stars=starIdx.map(i=>Number(v[i])).filter(n=>Number.isInteger(n)&&n>=1&&n<=cfg.starMax);
    if(cfg.stars&&stars.length!==cfg.stars)continue;
    out.push({date:dateIdx>=0?v[dateIdx]:"",numbers:nums.sort((a,b)=>a-b),stars:stars.sort((a,b)=>a-b)});
  }
  return out;
}

function dedupe(items){
  const seen=new Set(),out=[];
  for(const d of items){
    const k=`${d.date}|${d.numbers.join(",")}|${(d.stars||[]).join(",")}`;
    if(seen.has(k))continue;seen.add(k);out.push(d);
  }
  // ISO source sorts correctly lexically. For other formats, preserve current order.
  return out;
}

function loadStored(key){
  try{return JSON.parse(localStorage.getItem(GAMES[key].storage)||"[]")||[]}catch{return[]}
}
function saveStored(key,d){localStorage.setItem(GAMES[key].storage,JSON.stringify(d))}

async function ensureData(key){
  if(key==="lotto"){
    let d=loadStored(key);if(!d.length){d=LOTTO_DEMO;saveStored(key,d)}return d;
  }
  let d=loadStored(key);
  if(!d.length){
    try{
      const r=await fetch("euromillions_history.csv",{cache:"no-store"});
      if(r.ok){d=parseCsv(await r.text(),key);if(d.length)saveStored(key,d)}
    }catch{}
  }
  return d;
}

function mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
function mode(a,fallback){
  const c={};a.forEach(n=>c[n]=(c[n]||0)+1);
  const x=Object.entries(c).sort((p,q)=>q[1]-p[1]);
  return x.length?Number(x[0][0]):fallback;
}
function zFromArray(arr,n){
  const vals=arr.slice(1),m=mean(vals),sd=Math.sqrt(mean(vals.map(x=>(x-m)**2)))||1;
  return (arr[n]-m)/sd;
}
function normZ(z){return Math.max(0,Math.min(100,50+15*z))}

function buildAnalysis(history=draws){
  const cfg=GAMES[activeGame];
  const freq=Array(cfg.max+1).fill(0),last=Array(cfg.max+1).fill(history.length);
  const pairs={};
  const sf=Array(cfg.starMax+1).fill(0),sl=Array(cfg.starMax+1).fill(history.length);

  history.forEach((d,idx)=>{
    d.numbers.forEach(n=>{freq[n]++;if(last[n]===history.length)last[n]=idx});
    for(let i=0;i<d.numbers.length;i++)for(let j=i+1;j<d.numbers.length;j++){
      const k=`${d.numbers[i]}-${d.numbers[j]}`;pairs[k]=(pairs[k]||0)+1;
    }
    (d.stars||[]).forEach(s=>{sf[s]++;if(sl[s]===history.length)sl[s]=idx});
  });

  const recentN=Math.max(20,Math.min(100,Math.round(history.length*.1)));
  const recent=Array(cfg.max+1).fill(0);
  history.slice(0,recentN).forEach(d=>d.numbers.forEach(n=>recent[n]++));

  const sums=history.map(d=>d.numbers.reduce((a,b)=>a+b,0));
  const odds=history.map(d=>d.numbers.filter(n=>n%2).length);
  const lows=history.map(d=>d.numbers.filter(n=>n<=cfg.max/2).length);
  const sm=mean(sums),ssd=Math.sqrt(mean(sums.map(x=>(x-sm)**2)))||1;

  const pairVals=Object.values(pairs),pm=mean(pairVals),psd=Math.sqrt(mean(pairVals.map(x=>(x-pm)**2)))||1;

  return {
    freq,last,pairs,recent,starFreq:sf,starLast:sl,
    sumMean:sm,sumStd:ssd,
    oddMode:mode(odds,Math.floor(cfg.picks/2)),
    lowMode:mode(lows,Math.floor(cfg.picks/2)),
    pairMean:pm,pairStd:psd
  };
}

function sample(max,k,rng=Math.random){
  const p=Array.from({length:max},(_,i)=>i+1),o=[];
  for(let i=0;i<k;i++)o.push(p.splice(Math.floor(rng()*p.length),1)[0]);
  return o.sort((a,b)=>a-b);
}

function lineFeatures(line,cfg){
  let consecutive=0,sameLast=0;
  for(let i=0;i<line.length-1;i++)if(line[i+1]===line[i]+1)consecutive++;
  for(let i=0;i<line.length;i++)for(let j=i+1;j<line.length;j++)if(line[i]%10===line[j]%10)sameLast++;
  return {
    odd:line.filter(n=>n%2).length,
    low:line.filter(n=>n<=cfg.max/2).length,
    birthday:line.filter(n=>n<=31).length,
    consecutive,sameLast,
    sum:line.reduce((a,b)=>a+b,0)
  };
}

function sharingScore(line,cfg){
  const f=lineFeatures(line,cfg);
  let p=Math.max(0,f.birthday-2)*10+f.consecutive*12+Math.max(0,f.sameLast-1)*4;
  return Math.max(0,Math.min(100,100-p));
}

function modelScore(line,a,cfg){
  const f=lineFeatures(line,cfg);
  let structure=100;
  structure-=Math.abs(f.odd-a.oddMode)*8;
  structure-=Math.abs(f.low-a.lowMode)*7;
  structure-=Math.min(30,Math.abs(f.sum-a.sumMean)/a.sumStd*10);
  structure-=f.consecutive*4;
  structure=Math.max(0,Math.min(100,structure));

  const historical=normZ(mean(line.map(n=>zFromArray(a.freq,n))));
  const recent=normZ(mean(line.map(n=>zFromArray(a.recent,n))));
  const overdue=normZ(mean(line.map(n=>zFromArray(a.last,n))));

  let pairAvg=0,pairCount=0;
  for(let i=0;i<line.length;i++)for(let j=i+1;j<line.length;j++){
    pairAvg+=a.pairs[`${line[i]}-${line[j]}`]||0;pairCount++;
  }
  pairAvg=pairCount?pairAvg/pairCount:0;
  const pairStrength=normZ((pairAvg-a.pairMean)/a.pairStd);
  const sharing=sharingScore(line,cfg);

  const score=
    historical*.20+
    recent*.20+
    overdue*.12+
    pairStrength*.18+
    structure*.22+
    sharing*.08;

  return {score,historical,recent,overdue,pairStrength,structure,sharing,sum:f.sum};
}

function genericScore(line,strategy,a,cfg){
  if(strategy==="Edge AI")return modelScore(line,a,cfg);
  const m=modelScore(line,a,cfg);
  if(strategy==="Balanced")m.score=.65*m.structure+.35*m.sharing;
  if(strategy==="Low sharing risk")m.score=.80*m.sharing+.20*m.structure;
  if(strategy==="Hot numbers")m.score=.60*m.historical+.25*m.structure+.15*m.sharing;
  if(strategy==="Overdue numbers")m.score=.60*m.overdue+.25*m.structure+.15*m.sharing;
  return m;
}

function starPool(a,strategy,cfg){
  const rows=[];
  for(let s=1;s<=cfg.starMax;s++){
    const hot=normZ(zFromArray(a.starFreq,s));
    const due=normZ(zFromArray(a.starLast,s));
    let value=50;
    if(strategy==="Edge AI")value=.58*hot+.42*due;
    else if(strategy==="Hot numbers")value=hot;
    else if(strategy==="Overdue numbers")value=due;
    else value=.55*hot+.45*due;
    rows.push({s,value});
  }
  return rows.sort((x,y)=>y.value-x.value);
}

function chooseStars(a,strategy,cfg,usedPairs){
  if(!cfg.stars)return[];
  if(strategy==="Pure random")return sample(cfg.starMax,cfg.stars);

  const ranked=starPool(a,strategy,cfg);
  const candidates=[];
  for(let i=0;i<ranked.length;i++)for(let j=i+1;j<ranked.length;j++){
    candidates.push({
      stars:[ranked[i].s,ranked[j].s].sort((a,b)=>a-b),
      score:(ranked[i].value+ranked[j].value)/2
    });
  }
  candidates.sort((a,b)=>b.score-a.score);
  const fresh=candidates.find(x=>!usedPairs.has(x.stars.join("-")));
  return (fresh||candidates[0]).stars;
}

function generateSmartLines(history,strategy,count,candidateCount=30000){
  const cfg=GAMES[activeGame],a=buildAnalysis(history);
  if(strategy==="Pure random"||!history.length){
    return Array.from({length:count},()=>({line:sample(cfg.max,cfg.picks),stars:sample(cfg.starMax,cfg.stars),detail:null}));
  }

  const pool=[],seen=new Set();
  for(let i=0;i<candidateCount;i++){
    const line=sample(cfg.max,cfg.picks),k=line.join(",");
    if(seen.has(k))continue;seen.add(k);
    pool.push({line,detail:genericScore(line,strategy,a,cfg)});
  }
  pool.sort((x,y)=>y.detail.score-x.detail.score);

  const chosen=[],usedStarPairs=new Set(),numberUsage=new Map();
  for(const item of pool){
    // Smart-ticket penalty discourages near-duplicate lines and excessive reuse.
    const overlapOk=chosen.every(x=>item.line.filter(n=>x.line.includes(n)).length<=cfg.picks-2);
    if(!overlapOk)continue;

    const reuse=item.line.reduce((s,n)=>s+(numberUsage.get(n)||0),0);
    const adjusted=item.detail.score-reuse*1.5;
    if(chosen.length && adjusted < chosen[Math.max(0,chosen.length-1)]?.adjusted-12)continue;

    const stars=chooseStars(a,strategy,cfg,usedStarPairs);
    usedStarPairs.add(stars.join("-"));
    item.stars=stars;
    item.adjusted=adjusted;
    chosen.push(item);
    item.line.forEach(n=>numberUsage.set(n,(numberUsage.get(n)||0)+1));
    if(chosen.length===count)break;
  }
  return chosen;
}

function confidenceFor(items){
  if(!items.length||!items[0].detail)return null;
  const avg=mean(items.map(x=>x.detail.score));
  const spread=Math.sqrt(mean(items.map(x=>(x.detail.score-avg)**2)));
  let label="Moderate";
  if(avg>=70&&spread<8)label="High";
  if(avg<55)label="Low";
  return {label,score:avg};
}

function renderPicks(items){
  $("#results").innerHTML=items.map((x,i)=>`
    <div class="ticket">
      <div class="ticket-head">
        <strong>Line ${i+1}</strong>
        <span class="pill">${x.detail?`Edge ${Math.round(x.detail.score)}/100`:"Random"}</span>
      </div>
      <div class="balls">${x.line.map(n=>`<span class="ball">${n}</span>`).join("")}</div>
      ${x.stars?.length?`<div class="ticket-meta" style="font-size:13px"><b>Lucky Stars</b>&nbsp; ⭐ ${x.stars.join(" &nbsp; ⭐ ")}</div>`:""}
      ${x.detail?`
        <div class="model-grid">
          <div class="model-chip"><b>${Math.round(x.detail.historical)}</b><small>History</small></div>
          <div class="model-chip"><b>${Math.round(x.detail.recent)}</b><small>Recent</small></div>
          <div class="model-chip"><b>${Math.round(x.detail.pairStrength)}</b><small>Pairs</small></div>
          <div class="model-chip"><b>${Math.round(x.detail.overdue)}</b><small>Overdue</small></div>
          <div class="model-chip"><b>${Math.round(x.detail.structure)}</b><small>Structure</small></div>
          <div class="model-chip"><b>${Math.round(x.detail.sharing)}</b><small>Low-sharing</small></div>
        </div>`:""}
    </div>`).join("");

  const c=confidenceFor(items);
  if(c){
    $("#confidenceCard").classList.remove("hidden");
    $("#confidenceCard").innerHTML=`<strong>Model agreement: ${c.label}</strong><div class="muted">Average Edge score ${c.score.toFixed(1)}/100 across this ticket.</div>`;
  }else $("#confidenceCard").classList.add("hidden");
}

function generate(){
  const strategy=$("#strategy").value;
  const n=strategy==="Edge AI"?30000:9000;
  const items=generateSmartLines(draws,strategy,lineCount,n);
  const stamp=new Date().toISOString();
  const saved=items.map(x=>({...x,game:activeGame,strategy,created:stamp}));
  const old=JSON.parse(localStorage.getItem("lottoEdgeHistory")||"[]");
  localStorage.setItem("lottoEdgeHistory",JSON.stringify([...saved,...old].slice(0,100)));
  renderPicks(saved);
  navigator.vibrate?.(35);
}

function summary(){
  const cfg=GAMES[activeGame],a=buildAnalysis(draws);
  $("#drawCount").textContent=draws.length;
  if(!draws.length){$("#hotNumber").textContent="—";$("#overdueNumber").textContent="—";return}
  let h=1,d=1;
  for(let n=2;n<=cfg.max;n++){if(a.freq[n]>a.freq[h])h=n;if(a.last[n]>a.last[d])d=n}
  $("#hotNumber").textContent=h;$("#overdueNumber").textContent=d;
}

function renderStats(kind=activeStat){
  activeStat=kind;
  const cfg=GAMES[activeGame],a=buildAnalysis(draws),el=$("#statList");
  if(!draws.length){el.innerHTML='<div class="empty">No historical data loaded.</div>';return}

  if(kind==="heat"){
    const mx=Math.max(...a.freq.slice(1)),mn=Math.min(...a.freq.slice(1));
    el.innerHTML=`<div class="heat-grid">${Array.from({length:cfg.max},(_,i)=>i+1).map(n=>{
      const t=(a.freq[n]-mn)/Math.max(1,mx-mn);
      return `<div class="heat-ball" style="box-shadow:inset 0 0 0 ${1+Math.round(t*4)}px rgba(232,255,84,${.15+t*.7})">${n}</div>`;
    }).join("")}</div>`;
    return;
  }

  let rows=[];
  if(kind==="pairs"){
    rows=Object.entries(a.pairs).sort((x,y)=>y[1]-x[1]).slice(0,20).map(([k,v])=>({label:k.replace("-"," + "),v}));
  }else{
    for(let n=1;n<=cfg.max;n++)rows.push({label:n,v:kind==="hot"?a.freq[n]:a.last[n]});
    rows.sort((x,y)=>y.v-x.v);rows=rows.slice(0,20);
  }
  const mx=Math.max(...rows.map(x=>x.v),1);
  el.innerHTML=rows.map(r=>`<div class="stat-row"><div class="numdot">${r.label}</div><div class="bar"><i style="width:${r.v/mx*100}%"></i></div><div class="stat-value">${r.v}</div></div>`).join("");
}

function renderHistory(){
  const h=JSON.parse(localStorage.getItem("lottoEdgeHistory")||"[]");
  $("#ticketHistory").innerHTML=h.length?h.map(x=>`
    <div class="ticket"><div class="ticket-head"><strong>${GAMES[x.game]?.name||x.game} · ${x.strategy}</strong><span class="pill">${new Date(x.created).toLocaleDateString()}</span></div>
    <div class="balls">${x.line.map(n=>`<span class="ball">${n}</span>`).join("")}</div>
    ${x.stars?.length?`<div class="ticket-meta"><b>Lucky Stars</b>&nbsp; ⭐ ${x.stars.join(" &nbsp; ⭐ ")}</div>`:""}</div>`).join("")
    :'<div class="empty">Your generated lines will be saved here.</div>';
}

function matchCount(a,b){return a.filter(n=>b.includes(n)).length}

function quickModelLine(history){
  // Backtest uses 1800 candidates per test draw for mobile performance.
  // Same factor model; fewer search candidates than live generation.
  return generateSmartLines(history,"Edge AI",1,1800)[0];
}

async function runBacktest(){
  const requested=Number($("#testSize").value);
  if(draws.length<80){$("#backtestStatus").textContent="Not enough history for a useful backtest.";return}

  const tests=Math.min(requested,draws.length-60);
  $("#backtestStatus").textContent=`Running ${tests} walk-forward tests…`;
  $("#backtestResults").innerHTML=`<div class="progress"><i id="btProgress" style="width:0%"></i></div>`;

  const cfg=GAMES[activeGame];
  const edge={matches:0,starMatches:0,two:0,three:0,four:0,five:0};
  const rnd={matches:0,starMatches:0,two:0,three:0,four:0,five:0};

  // draws are newest-first. Test historical targets while using only older draws.
  for(let t=0;t<tests;t++){
    const targetIndex=t;
    const target=draws[targetIndex];
    const history=draws.slice(targetIndex+1);
    if(history.length<60)break;

    const edgePick=quickModelLine(history);
    const randPick={line:sample(cfg.max,cfg.picks),stars:sample(cfg.starMax,cfg.stars)};

    for(const [bucket,pick] of [[edge,edgePick],[rnd,randPick]]){
      const m=matchCount(pick.line,target.numbers);
      const sm=cfg.stars?matchCount(pick.stars||[],target.stars||[]):0;
      bucket.matches+=m;bucket.starMatches+=sm;
      if(m>=2)bucket.two++;if(m>=3)bucket.three++;if(m>=4)bucket.four++;if(m>=5)bucket.five++;
    }

    if(t%5===0){
      $("#btProgress").style.width=`${(t+1)/tests*100}%`;
      await new Promise(r=>setTimeout(r,0));
    }
  }

  const avgE=edge.matches/tests,avgR=rnd.matches/tests;
  const delta=avgE-avgR;
  let interpretation="No clear historical advantage over random in this sample.";
  if(delta>0.08)interpretation="Edge AI produced a higher historical average in this sample.";
  if(delta<-0.08)interpretation="Random performed better in this sample.";

  $("#backtestStatus").textContent="Backtest complete.";
  $("#backtestResults").innerHTML=`
    <div class="bt-grid">
      <div class="bt-card"><b>${avgE.toFixed(3)}</b><small>Edge AI avg main matches</small></div>
      <div class="bt-card"><b>${avgR.toFixed(3)}</b><small>Random avg main matches</small></div>
    </div>
    <table class="bt-table">
      <tr><th>Result</th><th>Edge AI</th><th>Random</th></tr>
      <tr><td>2+ main matches</td><td>${edge.two}</td><td>${rnd.two}</td></tr>
      <tr><td>3+ main matches</td><td>${edge.three}</td><td>${rnd.three}</td></tr>
      <tr><td>4+ main matches</td><td>${edge.four}</td><td>${rnd.four}</td></tr>
      <tr><td>5 main matches</td><td>${edge.five}</td><td>${rnd.five}</td></tr>
      ${cfg.stars?`<tr><td>Total Lucky Star matches</td><td>${edge.starMatches}</td><td>${rnd.starMatches}</td></tr>`:""}
    </table>
    <div class="settings-card" style="margin-top:12px"><b>${interpretation}</b><p class="muted">This is descriptive historical testing, not evidence that future random draws are predictable.</p></div>`;
}

async function switchGame(key){
  activeGame=key;localStorage.setItem("lottoEdgeGame",key);
  draws=await ensureData(key);
  $("#gameLabel").textContent=GAMES[key].label;
  $("#lottoGame").classList.toggle("active",key==="lotto");
  $("#euroGame").classList.toggle("active",key==="euromillions");
  $("#results").innerHTML="";$("#confidenceCard").classList.add("hidden");
  summary();renderStats(activeStat);
  $("#importStatus").textContent=`${GAMES[key].name}: ${draws.length} draws stored locally.`;
}

async function refreshData(){
  if(activeGame!=="euromillions"){
    $("#updateStatus").textContent="Lotto currently uses local/imported history.";
    return;
  }
  if(!navigator.onLine){$("#updateStatus").textContent="Offline. Using stored EuroMillions history.";return}
  try{
    $("#updateStatus").textContent="Checking EuroMillions updates…";
    const r=await fetch(EURO_REMOTE,{cache:"no-store"});
    if(!r.ok)throw new Error();
    const incoming=parseCsv(await r.text(),"euromillions");
    if(!incoming.length)throw new Error();
    const before=draws.length;
    draws=dedupe([...incoming,...draws]);saveStored("euromillions",draws);
    summary();renderStats(activeStat);
    $("#updateStatus").textContent=`Updated. ${Math.max(0,draws.length-before)} new draws; ${draws.length} total.`;
  }catch{$("#updateStatus").textContent="Update unavailable. Stored history is still usable offline."}
}

async function importCsv(){
  const f=$("#csvInput").files[0];
  if(!f){$("#importStatus").textContent="Choose a CSV first.";return}
  const inc=parseCsv(await f.text(),activeGame);
  if(!inc.length){$("#importStatus").textContent="No valid rows detected for this game.";return}
  draws=dedupe([...inc,...draws]);saveStored(activeGame,draws);
  summary();renderStats(activeStat);
  $("#importStatus").textContent=`Imported ${inc.length} rows; ${draws.length} total stored.`;
}

$("#strategyInfo").textContent=descriptions[$("#strategy").value];
$("#strategy").onchange=e=>$("#strategyInfo").textContent=descriptions[e.target.value];
$("#minusLine").onclick=()=>{$("#lineCount").textContent=lineCount=Math.max(1,lineCount-1)};
$("#plusLine").onclick=()=>{$("#lineCount").textContent=lineCount=Math.min(10,lineCount+1)};
$("#generateBtn").onclick=generate;
$("#lottoGame").onclick=()=>switchGame("lotto");
$("#euroGame").onclick=()=>switchGame("euromillions");
$("#refreshBtn").onclick=refreshData;
$("#runBacktest").onclick=runBacktest;
$("#importBtn").onclick=importCsv;
$("#clearHistory").onclick=()=>{localStorage.removeItem("lottoEdgeHistory");renderHistory()};

$$(".segmented button").forEach(b=>b.onclick=()=>{
  $$(".segmented button").forEach(x=>x.classList.remove("active"));b.classList.add("active");renderStats(b.dataset.stat);
});

$$(".bottom-nav button").forEach(b=>b.onclick=()=>{
  $$(".bottom-nav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");
  $$(".screen").forEach(x=>x.classList.remove("active"));$("#"+b.dataset.screen).classList.add("active");
  if(b.dataset.screen==="historyScreen")renderHistory();
});

if("serviceWorker"in navigator)navigator.serviceWorker.register("service-worker.js");

(async()=>{
  await switchGame(activeGame);
  renderHistory();
})();
