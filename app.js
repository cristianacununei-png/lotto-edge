
const $ = s => document.querySelector(s);

const APP_VERSION="19.0.0";

async function checkAppVersionInBackground(){
  try{
    const r=await fetch("version.json?ts="+Date.now(),{cache:"no-store"});
    if(!r.ok)return;
    const v=await r.json();
    const seen=localStorage.getItem("lottoEdgeAppVersion");

    if(!seen){
      localStorage.setItem("lottoEdgeAppVersion",v.version);
      return;
    }

    if(seen!==v.version){
      localStorage.setItem("lottoEdgeAppVersion",v.version);
      const reg=await navigator.serviceWorker?.getRegistration();
      reg?.update().catch(()=>{});
      localStorage.setItem("lottoEdgeUpdateReady","1");
    }
  }catch{}
}

const $$ = s => [...document.querySelectorAll(s)];

const EURO_REMOTE =
  "https://raw.githubusercontent.com/daowa89/lottery-archive/main/eu/euromillions/results.csv";
const LOTTO_REMOTE =
  "https://raw.githubusercontent.com/sa-ccr/Trading/master/inst/extdata/UK_Lottery_history.csv";
const LOTTO_SOURCES = [LOTTO_REMOTE];

const LOTTO_CURRENT_ARCHIVES = [
  "https://www.national-lottery.com/lotto/results/2025-archive",
  "https://www.national-lottery.com/lotto/results/2026-archive"
];

function corsProxy(url){
  return "https://api.allorigins.win/raw?url="+encodeURIComponent(url);
}

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
const DEFAULT_WEIGHTS={
  historical:.20,
  recent:.20,
  overdue:.12,
  pairStrength:.18,
  structure:.22,
  sharing:.08
};

function weightStorageKey(){
  return `lottoEdgeWeights:${activeGame}`;
}
function getModelWeights(){
  try{
    const w=JSON.parse(localStorage.getItem(weightStorageKey())||"null");
    if(w && Object.keys(DEFAULT_WEIGHTS).every(k=>Number.isFinite(w[k])))return w;
  }catch{}
  return {...DEFAULT_WEIGHTS};
}
function saveModelWeights(w){
  localStorage.setItem(weightStorageKey(),JSON.stringify(w));
}

function concentrationStorageKey(){
  return `lottoEdgeConcentration:${activeGame}`;
}

function getConcentrationMode(){
  return localStorage.getItem(concentrationStorageKey()) || "auto";
}

function saveConcentrationMode(mode){
  localStorage.setItem(concentrationStorageKey(),mode);
}

let analysisCache={key:null,value:null};
let backgroundLoads={lotto:false,euromillions:false};

function invalidateAnalysis(){
  analysisCache={key:null,value:null};
}


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

function parseUkLottoCsv(text){
  const lines=String(text||"").trim().split(/\r?\n/);
  if(lines.length<1000)return [];
  const out=[];
  for(let i=1;i<lines.length;i++){
    const c=lines[i].split(",").map(x=>x.trim().replace(/^"|"$/g,""));
    if(c.length<8)continue;
    const nums=c.slice(1,7).map(Number);
    const bonus=Number(c[7]);
    if(nums.length!==6 || nums.some(n=>!Number.isFinite(n)||n<1||n>59) || new Set(nums).size!==6)continue;
    out.push({date:c[0],numbers:nums.sort((a,b)=>a-b),stars:[],bonus:Number.isFinite(bonus)?bonus:null});
  }
  return out; // source is already newest-first
}

function monthNumber(name){
  const m={january:"01",february:"02",march:"03",april:"04",may:"05",june:"06",
           july:"07",august:"08",september:"09",october:"10",november:"11",december:"12"};
  return m[String(name).toLowerCase()]||"01";
}

function parseCurrentLottoArchive(html){
  try{
    const doc=new DOMParser().parseFromString(html,"text/html");
    let text=(doc.body?.innerText||"").replace(/\u00a0/g," ").replace(/[ \t]+/g," ");
    const dateRe=/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*(\d{1,2})(?:st|nd|rd|th)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(2025|2026)/gi;
    const matches=[...text.matchAll(dateRe)];
    const out=[];

    for(let i=0;i<matches.length;i++){
      const m=matches[i];
      const start=m.index+m[0].length;
      const end=i+1<matches.length ? matches[i+1].index : text.length;
      let block=text.slice(start,end);

      // Results occur before the jackpot amount. Keeping only this part avoids
      // prize/winner numbers contaminating the ball extraction.
      const pound=block.indexOf("£");
      if(pound>=0) block=block.slice(0,pound);

      // Strip labels but preserve the sequence of ball numbers.
      const nums=(block.match(/\b\d{1,2}\b/g)||[]).map(Number).filter(n=>n>=1&&n<=59);
      if(nums.length<7)continue;

      const yyyy=m[4], mm=monthNumber(m[3]), dd=String(Number(m[2])).padStart(2,"0");
      const date=`${yyyy}-${mm}-${dd}`;

      // Some special Lotto dates contain Round 1 and Round 2 (14 ball values).
      // Treat each round as a separate observed draw for pattern analysis.
      if(nums.length>=14 && /Round\s*2/i.test(block)){
        for(let r=0;r<2;r++){
          const seven=nums.slice(r*7,r*7+7);
          const main=seven.slice(0,6).sort((a,b)=>a-b);
          const bonus=seven[6];
          if(new Set(main).size===6) out.push({date:`${date}-R${r+1}`,numbers:main,stars:[],bonus});
        }
      }else{
        const seven=nums.slice(0,7);
        const main=seven.slice(0,6).sort((a,b)=>a-b);
        const bonus=seven[6];
        if(new Set(main).size===6)out.push({date,numbers:main,stars:[],bonus});
      }
    }
    return out;
  }catch{return []}
}

async function fetchRecentLottoHistory(){
  let recent=[];
  for(const archive of LOTTO_CURRENT_ARCHIVES){
    try{
      const r=await fetchWithTimeout(corsProxy(archive),6000);
      if(!r.ok)continue;
      const parsed=parseCurrentLottoArchive(await r.text());
      recent=dedupe([...recent,...parsed]);
    }catch{}
  }
  return recent;
}

function parseLottoJson(payload){
  try{
    const rows=typeof payload==="string" ? JSON.parse(payload) : payload;
    if(!Array.isArray(rows)) return [];
    return rows.map(r=>{
      const nums=String(r.main_numbers||"").split(",").map(Number).filter(Number.isFinite);
      if(nums.length!==6 || new Set(nums).size!==6 || nums.some(n=>n<1||n>59)) return null;
      const bonus=Number(r.extra_numbers);
      return {
        date:r.draw_date||"",
        numbers:nums.sort((a,b)=>a-b),
        stars:[],
        bonus:Number.isFinite(bonus)?bonus:null
      };
    }).filter(Boolean);
  }catch{return []}
}

function dedupe(items){
  return sortedByDateDesc(dedupeStrict(items));
}

function loadStored(key){
  try{return JSON.parse(localStorage.getItem(GAMES[key].storage)||"[]")||[]}catch{return[]}
}
function saveStored(key,d){localStorage.setItem(GAMES[key].storage,JSON.stringify(d))}


async function fetchWithTimeout(url,ms=4500){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  try{
    return await fetch(url,{cache:"no-store",signal:controller.signal});
  }finally{
    clearTimeout(timer);
  }
}

async function fetchFullLottoHistoryFast(){
  try{
    const r=await fetchWithTimeout(LOTTO_REMOTE,6500);
    if(!r.ok)return [];
    const parsed=parseUkLottoCsv(await r.text());
    return parsed.length>3000 ? parsed : [];
  }catch{
    return [];
  }
}

async function backgroundRefreshGame(key,manual=false){
  if(!navigator.onLine)return;
  const mainStatus=$("#dataStatusMain");
  if(key==="lotto"){
    if(mainStatus && activeGame==="lotto")mainStatus.textContent="Checking recent Lotto draws in the background…";
    try{
      const deep=await fetchFullLottoHistoryFast();
      const recent=await fetchRecentLottoHistory();
      let merged=dedupe([
        ...recent,
        ...(deep.length?deep:[]),
        ...loadStored("lotto")
      ]);
      if(merged.length>3000){
        saveStored("lotto",merged);
        localStorage.setItem("lottoEdgeLottoLastUpdate",Date.now());
        if(activeGame==="lotto"){
          draws=merged;invalidateAnalysis?.();summary();renderStats(activeStat);
          if(mainStatus)updateFreshnessStatus();
        }
        if(manual)$("#updateStatus").textContent=`Lotto updated: ${merged.length} historical/current draws stored.`;
      }
    }catch{
      if(mainStatus && activeGame==="lotto")mainStatus.textContent=`${draws.length} Lotto draws stored locally.`;
    }
    return;
  }

  try{
    const r=await fetchWithTimeout(EURO_REMOTE,6000);
    if(!r.ok)throw new Error();
    const inc=parseCsv(await r.text(),"euromillions");
    const merged=dedupe([...inc,...loadStored("euromillions")]);
    saveStored("euromillions",merged);
    localStorage.setItem("lottoEdgeEuroLastUpdate",Date.now());
    if(activeGame==="euromillions"){
      draws=merged;invalidateAnalysis?.();summary();renderStats(activeStat);
      if(mainStatus)updateFreshnessStatus();
    }
  }catch{}
}

async function ensureData(key){
  let d=loadStored(key);

  if(key==="lotto"){
    // If a full history has already been downloaded, startup is instant.
    if(d.length>1000)return d;

    // Optional bundled snapshot: if present in a later release, prefer it.
    try{
      const r=await fetch("lotto_history.csv",{cache:"force-cache"});
      if(r.ok){
        const local=parseUkLottoCsv(await r.text());
        if(local.length>1000){
          saveStored(key,local);
          return local;
        }
      }
    }catch{}

    // Never block the UI waiting for the internet.
    if(!d.length){d=LOTTO_DEMO;saveStored(key,d);}
    return d;
  }

  if(!d.length){
    try{
      const r=await fetch("euromillions_history.csv",{cache:"force-cache"});
      if(r.ok){
        d=parseCsv(await r.text(),"euromillions");
        if(d.length)saveStored(key,d);
      }
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
  const isCurrent=history===draws;
  const cacheKey=isCurrent ? `${activeGame}:${history.length}:${history[0]?.date||""}` : null;
  if(isCurrent && analysisCache.key===cacheKey)return analysisCache.value;
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

  const result={
    freq,last,pairs,recent,starFreq:sf,starLast:sl,
    sumMean:sm,sumStd:ssd,
    oddMode:mode(odds,Math.floor(cfg.picks/2)),
    lowMode:mode(lows,Math.floor(cfg.picks/2)),
    pairMean:pm,pairStd:psd
  };
  if(isCurrent)analysisCache={key:cacheKey,value:result};
  return result;
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
  for(let i=0;i<line.length;i++){
    for(let j=i+1;j<line.length;j++){
      pairAvg += a.pairs[`${line[i]}-${line[j]}`] || 0;
      pairCount++;
    }
  }
  pairAvg=pairCount?pairAvg/pairCount:0;
  const pairStrength=normZ((pairAvg-a.pairMean)/a.pairStd);

  const sharing=sharingScore(line,cfg);

  const weights=getModelWeights();

  const score=
    historical*weights.historical+
    recent*weights.recent+
    overdue*weights.overdue+
    pairStrength*weights.pairStrength+
    structure*weights.structure+
    sharing*weights.sharing;

  const components={historical,recent,overdue,pairStrength,structure,sharing};
  const ranked=Object.entries(components).sort((a,b)=>b[1]-a[1]);

  const labelMap={
    historical:"Long-term history",
    recent:"Recent form",
    overdue:"Overdue fit",
    pairStrength:"Pair strength",
    structure:"Draw structure",
    sharing:"Low-sharing profile"
  };

  const reasons=[];
  ranked.slice(0,3).forEach(([k,v])=>{
    if(v>=60)reasons.push(`${labelMap[k]} is strong (${Math.round(v)}/100).`);
  });

  const weak=[...ranked].reverse().find(([k,v])=>v<45);
  if(weak)reasons.push(`${labelMap[weak[0]]} is the main weak point (${Math.round(weak[1])}/100).`);

  if(!reasons.length)reasons.push("The line scores consistently across the model without one dominant signal.");

  return {
    score:Math.max(0,Math.min(100,score)),
    historical,recent,overdue,pairStrength,structure,sharing,
    sum:f.sum,
    odd:f.odd,
    low:f.low,
    weights,
    reasons
  };
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


function individualNumberSignals(a,cfg){
  const rows=[];
  for(let n=1;n<=cfg.max;n++){
    const historical=normZ(zFromArray(a.freq,n));
    const recent=normZ(zFromArray(a.recent,n));
    const overdue=normZ(zFromArray(a.last,n));

    // Pair support: average relationship strength with all other numbers.
    let pairTotal=0,pairCount=0;
    for(let m=1;m<=cfg.max;m++){
      if(m===n)continue;
      const k=n<m?`${n}-${m}`:`${m}-${n}`;
      pairTotal+=a.pairs[k]||0;
      pairCount++;
    }
    const pairAvg=pairCount?pairTotal/pairCount:0;
    const pair=normZ((pairAvg-a.pairMean)/a.pairStd);

    const score=
      historical*.30+
      recent*.30+
      overdue*.15+
      pair*.25;

    rows.push({n,score,historical,recent,overdue,pair});
  }
  rows.sort((x,y)=>y.score-x.score);

  // Conviction strength is not simply the top score: it measures separation
  // between the strongest numbers and the field.
  const all=rows.map(x=>x.score);
  const avg=mean(all);
  const sd=Math.sqrt(mean(all.map(x=>(x-avg)**2)))||1;
  rows.forEach((x,i)=>{
    x.z=(x.score-avg)/sd;
    x.tier=x.z>=1.25?"core":x.z>=.65?"strong":x.z>=.05?"supporting":"diversifier";
    x.rank=i+1;
  });
  return rows;
}

function convictionProfile(a,cfg){
  const ranked=individualNumberSignals(a,cfg);
  const core=ranked.filter(x=>x.tier==="core");
  const strong=ranked.filter(x=>x.tier==="strong");

  const top=ranked.slice(0,Math.max(5,cfg.picks));
  const rest=ranked.slice(Math.max(10,cfg.picks*2));
  const topAvg=mean(top.map(x=>x.score));
  const restAvg=rest.length?mean(rest.map(x=>x.score)):mean(ranked.map(x=>x.score));
  const separation=Math.max(0,topAvg-restAvg);

  let strength="weak";
  if(separation>=10 && core.length>=2)strength="strong";
  else if(separation>=6 && (core.length>=1 || strong.length>=3))strength="moderate";

  return {ranked,core,strong,separation,strength};
}

function repeatAllowance(profile,count,cfg,mode){
  // How many lines a number may reasonably occupy.
  if(mode==="diversified")return {core:1,strong:1,supporting:1,diversifier:1};
  if(mode==="balanced")return {core:Math.min(3,count),strong:Math.min(2,count),supporting:1,diversifier:1};
  if(mode==="concentrated")return {core:Math.min(4,count),strong:Math.min(3,count),supporting:2,diversifier:1};

  // Auto: conviction determines concentration, with historical calibration as a baseline.
  const calibrated=localStorage.getItem(`lottoEdgeCalibratedConcentration:${activeGame}`)||"balanced";

  if(profile.strength==="strong")
    return {core:Math.min(4,count),strong:Math.min(3,count),supporting:2,diversifier:1};
  if(profile.strength==="moderate"){
    if(calibrated==="concentrated")
      return {core:Math.min(4,count),strong:Math.min(2,count),supporting:1,diversifier:1};
    if(calibrated==="diversified")
      return {core:Math.min(2,count),strong:Math.min(2,count),supporting:1,diversifier:1};
    return {core:Math.min(3,count),strong:Math.min(2,count),supporting:1,diversifier:1};
  }

  if(calibrated==="concentrated")
    return {core:Math.min(3,count),strong:Math.min(2,count),supporting:1,diversifier:1};
  if(calibrated==="diversified")
    return {core:1,strong:1,supporting:1,diversifier:1};
  return {core:Math.min(2,count),strong:1,supporting:1,diversifier:1};
}

function numberTierMap(profile){
  const m=new Map();
  profile.ranked.forEach(x=>m.set(x.n,x));
  return m;
}

function portfolioMetrics(lines,cfg){
  const numberCounts=new Map();
  const pairCounts=new Map();
  const starPairCounts=new Map();

  lines.forEach(item=>{
    item.line.forEach(n=>numberCounts.set(n,(numberCounts.get(n)||0)+1));
    for(let i=0;i<item.line.length;i++){
      for(let j=i+1;j<item.line.length;j++){
        const k=`${item.line[i]}-${item.line[j]}`;
        pairCounts.set(k,(pairCounts.get(k)||0)+1);
      }
    }
    if((item.stars||[]).length){
      const sk=(item.stars||[]).join("-");
      starPairCounts.set(sk,(starPairCounts.get(sk)||0)+1);
    }
  });

  const uniqueNumbers=numberCounts.size;
  const totalPairs=lines.reduce((s,x)=>s+(x.line.length*(x.line.length-1)/2),0);
  const uniquePairs=pairCounts.size;
  const repeatedNumbers=[...numberCounts.values()].reduce((s,c)=>s+Math.max(0,c-1),0);
  const repeatedPairs=[...pairCounts.values()].reduce((s,c)=>s+Math.max(0,c-1),0);
  const repeatedStarPairs=[...starPairCounts.values()].reduce((s,c)=>s+Math.max(0,c-1),0);

  const maxUnique=Math.min(cfg.max,lines.length*cfg.picks);
  const numberCoverage=maxUnique?uniqueNumbers/maxUnique:0;
  const pairCoverage=totalPairs?uniquePairs/totalPairs:0;

  let score=100*(.42*numberCoverage+.58*pairCoverage);
  score-=repeatedNumbers*1.5;
  score-=repeatedPairs*4.0;
  score-=repeatedStarPairs*4.0;
  score=Math.max(0,Math.min(100,score));

  return {
    score,uniqueNumbers,uniquePairs,repeatedNumbers,repeatedPairs,repeatedStarPairs,
    numberCoverage,pairCoverage
  };
}

function ticketObjective(lines,cfg,profile,mode){
  const pm=portfolioMetrics(lines,cfg);
  const avgEdge=mean(lines.map(x=>x.detail?.score||50));
  const minEdge=Math.min(...lines.map(x=>x.detail?.score||50));
  const tierMap=numberTierMap(profile);
  const allowances=repeatAllowance(profile,lines.length,cfg,mode);

  const counts=new Map();
  lines.forEach(x=>x.line.forEach(n=>counts.set(n,(counts.get(n)||0)+1)));

  let justifiedRepeatReward=0;
  let unjustifiedRepeatPenalty=0;

  for(const [n,c] of counts){
    if(c<=1)continue;
    const sig=tierMap.get(n);
    const tier=sig?.tier||"diversifier";
    const allowed=allowances[tier]||1;

    // Repeating a high-conviction number is rewarded up to its allowance.
    const justified=Math.min(c,allowed)-1;
    if(justified>0){
      const strength=Math.max(0,(sig?.score||50)-50);
      justifiedRepeatReward += justified*(1.5+strength*.08);
    }

    // Repeats beyond conviction allowance become expensive.
    const excess=Math.max(0,c-allowed);
    unjustifiedRepeatPenalty += excess*7;
  }

  let maxOverlap=0;
  for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
    maxOverlap=Math.max(maxOverlap,lines[i].line.filter(n=>lines[j].line.includes(n)).length);
  }

  // Adaptive blend: strong conviction shifts weight from raw coverage toward
  // repeated high-quality signal exploitation.
  let qualityWeight=.54,coverageWeight=.38;
  if(mode==="concentrated" || (mode==="auto"&&profile.strength==="strong")){
    qualityWeight=.61;coverageWeight=.27;
  }else if(mode==="balanced" || (mode==="auto"&&profile.strength==="moderate")){
    qualityWeight=.58;coverageWeight=.32;
  }else if(mode==="diversified" || (mode==="auto"&&profile.strength==="weak")){
    qualityWeight=.51;coverageWeight=.41;
  }

  let total=
    avgEdge*qualityWeight+
    pm.score*coverageWeight+
    minEdge*.08+
    justifiedRepeatReward-
    unjustifiedRepeatPenalty;

  if(maxOverlap>=cfg.picks-1)total-=22;
  else if(maxOverlap===cfg.picks-2)total-=8;

  // Pair repetition remains expensive, but less so when the repeated pair is made
  // entirely of high-conviction numbers.
  const pairCounts=new Map();
  lines.forEach(x=>{
    for(let i=0;i<x.line.length;i++)for(let j=i+1;j<x.line.length;j++){
      const k=`${x.line[i]}-${x.line[j]}`;
      pairCounts.set(k,(pairCounts.get(k)||0)+1);
    }
  });
  for(const [k,c] of pairCounts){
    if(c<=1)continue;
    const [a,b]=k.split("-").map(Number);
    const sa=tierMap.get(a),sb=tierMap.get(b);
    const high=(["core","strong"].includes(sa?.tier)&&["core","strong"].includes(sb?.tier));
    total-=(c-1)*(high?1.2:4.5);
  }

  total-=pm.repeatedStarPairs*1.5;

  return {
    total,avgEdge,maxOverlap,
    justifiedRepeatReward,unjustifiedRepeatPenalty,
    convictionStrength:profile.strength,
    separation:profile.separation,
    ...pm
  };
}

function cloneTicket(ticket){
  return ticket.map(x=>({
    line:[...x.line],
    stars:[...(x.stars||[])],
    detail:x.detail,
    portfolioValue:x.portfolioValue
  }));
}

function randomTicketFromPool(pool,count,cfg,a,strategy){
  const picked=[],used=new Set(),usedStars=new Set();
  let attempts=0;
  while(picked.length<count && attempts++<500){
    const item=pool[Math.floor(Math.random()*Math.min(pool.length,1400))];
    if(!item)break;
    const key=item.line.join(",");
    if(used.has(key))continue;
    used.add(key);
    const copy={...item,line:[...item.line],stars:chooseStars(a,strategy,cfg,usedStars)};
    if(copy.stars.length)usedStars.add(copy.stars.join("-"));
    picked.push(copy);
  }
  return picked;
}

function mutateTicket(ticket,pool,cfg,a,strategy){
  const out=cloneTicket(ticket);
  if(!out.length)return out;
  const idx=Math.floor(Math.random()*out.length);
  const used=new Set(out.filter((_,i)=>i!==idx).map(x=>x.line.join(",")));
  for(let tries=0;tries<100;tries++){
    const cand=pool[Math.floor(Math.random()*Math.min(pool.length,1700))];
    if(!cand)continue;
    const key=cand.line.join(",");
    if(used.has(key))continue;
    out[idx]={
      ...cand,
      line:[...cand.line],
      stars:chooseStars(a,strategy,cfg,new Set(out.filter((_,i)=>i!==idx).map(x=>(x.stars||[]).join("-"))))
    };
    break;
  }
  return out;
}

function generateSmartLines(history,strategy,count,candidateCount=30000,modeOverride=null){
  const cfg=GAMES[activeGame],a=buildAnalysis(history);
  const mode=modeOverride||getConcentrationMode();

  if(strategy==="Pure random"||!history.length){
    const randomLines=Array.from({length:count},()=>({
      line:sample(cfg.max,cfg.picks),
      stars:sample(cfg.starMax,cfg.stars),
      detail:null
    }));
    randomLines.portfolio=portfolioMetrics(randomLines,cfg);
    randomLines.globalScore={total:randomLines.portfolio.score,convictionStrength:"none",separation:0};
    randomLines.conviction=null;
    return randomLines;
  }

  const profile=convictionProfile(a,cfg);
  const pool=[],seen=new Set();

  for(let i=0;i<candidateCount;i++){
    const line=sample(cfg.max,cfg.picks),k=line.join(",");
    if(seen.has(k))continue;
    seen.add(k);
    pool.push({line,detail:genericScore(line,strategy,a,cfg),stars:[]});
  }

  pool.sort((x,y)=>y.detail.score-x.detail.score);
  const shortlist=pool.slice(0,Math.min(2600,pool.length));

  const population=[];
  const seeds=Math.max(28,Math.min(70,count*12));
  for(let i=0;i<seeds;i++){
    const t=randomTicketFromPool(shortlist,count,cfg,a,strategy);
    if(t.length===count)population.push(t);
  }

  // A conviction-seeded ticket deliberately encourages core numbers to recur
  // when profile strength is high.
  const seeded=[];
  const usedStars=new Set();
  const tierMap=numberTierMap(profile);
  const allowances=repeatAllowance(profile,count,cfg,mode);
  const counts=new Map();

  for(const cand of shortlist){
    if(seeded.length===count)break;
    let okay=true;
    for(const n of cand.line){
      const tier=tierMap.get(n)?.tier||"diversifier";
      if((counts.get(n)||0)>=(allowances[tier]||1)){okay=false;break;}
    }
    if(!okay)continue;

    seeded.push({...cand,line:[...cand.line],stars:chooseStars(a,strategy,cfg,usedStars)});
    seeded.at(-1).line.forEach(n=>counts.set(n,(counts.get(n)||0)+1));
    if(seeded.at(-1).stars.length)usedStars.add(seeded.at(-1).stars.join("-"));
  }
  if(seeded.length===count)population.push(seeded);

  let best=population[0]||seeded;
  let bestObj=ticketObjective(best,cfg,profile,mode);

  const iterations=count<=5?1100:650;
  for(let i=0;i<iterations;i++){
    const base=population.length
      ? population[Math.floor(Math.random()*population.length)]
      : best;
    const cand=mutateTicket(base,shortlist,cfg,a,strategy);
    if(cand.length!==count)continue;
    const obj=ticketObjective(cand,cfg,profile,mode);

    if(obj.total>bestObj.total){
      best=cand;
      bestObj=obj;
    }

    if(i%22===0 && population.length){
      population.sort((x,y)=>
        ticketObjective(y,cfg,profile,mode).total-ticketObjective(x,cfg,profile,mode).total
      );
      population.splice(Math.ceil(population.length*.68));
      population.push(cloneTicket(best));
    }
  }

  best.portfolio=portfolioMetrics(best,cfg);
  best.globalScore=bestObj;
  best.conviction=profile;
  best.concentrationMode=mode;
  return best;
}
function confidenceFor(items){
  const valid=items.filter(x=>x.detail);
  if(!valid.length)return null;

  const avg=mean(valid.map(x=>x.detail.score));
  const componentSpreads=valid.map(x=>{
    const vals=[
      x.detail.historical,x.detail.recent,x.detail.overdue,
      x.detail.pairStrength,x.detail.structure,x.detail.sharing
    ];
    const m=mean(vals);
    return Math.sqrt(mean(vals.map(v=>(v-m)**2)));
  });
  const avgSpread=mean(componentSpreads);

  let label="Moderate";
  if(avg>=68 && avgSpread<=18)label="High";
  if(avg<52 || avgSpread>28)label="Low";

  return {label,score:avg,agreement:Math.max(0,Math.min(100,100-avgSpread*2.5))};
}
function scoreBar(label,value){
  const v=Math.max(0,Math.min(100,Math.round(value)));
  return `
    <div class="score-row">
      <div class="score-label"><span>${label}</span><b>${v}</b></div>
      <div class="score-track"><i style="width:${v}%"></i></div>
    </div>`;
}

function renderPicks(items){
  $("#results").innerHTML=items.map((x,i)=>{
    const d=x.detail;
    return `
    <div class="ticket">
      <div class="ticket-head">
        <strong>Line ${i+1}</strong>
        <span class="pill">${d?`Edge ${Math.round(d.score)}/100`:"Random"}</span>
      </div>

      <div class="balls">${x.line.map(n=>`<span class="ball">${n}</span>`).join("")}</div>

      ${x.stars?.length?`
        <div class="ticket-meta" style="font-size:13px">
          <b>Lucky Stars</b>&nbsp; ⭐ ${x.stars.join(" &nbsp; ⭐ ")}
        </div>`:""}

      ${d?`
        <button class="why-btn" data-target="why-${i}">
          Why this line?
        </button>

        <div id="why-${i}" class="why-panel hidden">
          <div class="edge-summary">
            <div><b>${Math.round(d.score)}</b><small>Edge score</small></div>
            <div><b>${d.sum}</b><small>Number sum</small></div>
            <div><b>${d.odd}/${x.line.length-d.odd}</b><small>Odd / even</small></div>
          </div>

          ${scoreBar("Long-term history",d.historical)}
          ${scoreBar("Recent form",d.recent)}
          ${scoreBar("Pair strength",d.pairStrength)}
          ${scoreBar("Overdue fit",d.overdue)}
          ${scoreBar("Draw structure",d.structure)}
          ${scoreBar("Low-sharing profile",d.sharing)}

          <div class="why-copy">
            ${d.reasons.map(r=>`<p>${r}</p>`).join("")}
          </div>

          <div class="weight-note">
            Model weights: history ${Math.round(d.weights.historical*100)}% ·
            recent ${Math.round(d.weights.recent*100)}% ·
            pairs ${Math.round(d.weights.pairStrength*100)}% ·
            structure ${Math.round(d.weights.structure*100)}% ·
            overdue ${Math.round(d.weights.overdue*100)}% ·
            low-sharing ${Math.round(d.weights.sharing*100)}%.
          </div>
        </div>`:""}
    </div>`;
  }).join("");

  $$(".why-btn").forEach(btn=>btn.onclick=()=>{
    const panel=$("#"+btn.dataset.target);
    panel.classList.toggle("hidden");
    btn.textContent=panel.classList.contains("hidden")?"Why this line?":"Hide explanation";
  });

  const c=confidenceFor(items);
  const p=items.portfolio || portfolioMetrics(items,GAMES[activeGame]);
  if(c){
    $("#confidenceCard").classList.remove("hidden");
    $("#confidenceCard").innerHTML=`
      <strong>Model confidence: ${c.label}</strong>
      <div class="muted">
        Average Edge score ${c.score.toFixed(1)}/100 ·
        model agreement ${c.agreement.toFixed(0)}/100.
      </div>
      <div class="progress"><i style="width:${c.agreement}%"></i></div>

      <div class="portfolio-card">
        <div class="portfolio-head">
          <b>Global ticket score ${Math.round(items.globalScore?.total||p.score)}/100</b>
          <span>Coverage ${Math.round(p.score)}/100 · ${p.uniqueNumbers} unique numbers · ${p.uniquePairs} unique pairs</span>
        </div>
        <div class="portfolio-grid">
          <div><b>${p.repeatedNumbers}</b><small>repeated number slots</small></div>
          <div><b>${p.repeatedPairs}</b><small>repeated pairs</small></div>
          ${GAMES[activeGame].stars?`<div><b>${p.repeatedStarPairs}</b><small>repeated star pairs</small></div>`:""}
        </div>
        ${items.conviction?`
          <div class="conviction-summary">
            <b>Adaptive conviction: ${items.conviction.strength}</b>
            <span>Signal separation ${items.conviction.separation.toFixed(1)} points · mode ${items.concentrationMode}</span>
            <small>
              Core: ${items.conviction.core.slice(0,6).map(x=>x.n).join(", ")||"none"} ·
              Strong: ${items.conviction.strong.slice(0,8).map(x=>x.n).join(", ")||"none"}
            </small>
          </div>`:""}
      </div>`;
  }else{
    $("#confidenceCard").classList.add("hidden");
  }
}
function generate(){
  const strategy=$("#strategy").value;
  const n=strategy==="Edge AI"?30000:9000;
  const items=generateSmartLines(draws,strategy,lineCount,n);
  const stamp=new Date().toISOString();
  const saved=items.map(x=>({...x,game:activeGame,strategy,created:stamp,portfolio:items.portfolio||null}));
  const old=JSON.parse(localStorage.getItem("lottoEdgeHistory")||"[]");
  localStorage.setItem("lottoEdgeHistory",JSON.stringify([...saved,...old].slice(0,100)));
  renderPicks(saved);
  navigator.vibrate?.(35);
}


function normaliseDateValue(value){
  const raw=String(value||"").replace(/-R\d$/,"").trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;

  // UK archive format can be dd/mm/yyyy.
  let m=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m)return `${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;

  // Fallback to browser date parsing where safe.
  const d=new Date(raw);
  if(!Number.isNaN(d.getTime())){
    const y=d.getFullYear(),mo=String(d.getMonth()+1).padStart(2,"0"),da=String(d.getDate()).padStart(2,"0");
    return `${y}-${mo}-${da}`;
  }
  return "";
}

function uniqueDrawKey(d){
  return `${normaliseDateValue(d.date)}|${d.numbers.join(",")}|${(d.stars||[]).join(",")}`;
}

function dedupeStrict(items){
  const seen=new Set(),out=[];
  for(const d of items){
    const k=uniqueDrawKey(d);
    if(seen.has(k))continue;
    seen.add(k);
    out.push(d);
  }
  return out;
}

function sortedByDateDesc(items){
  return [...items].sort((a,b)=>{
    const ad=normaliseDateValue(a.date),bd=normaliseDateValue(b.date);
    return bd.localeCompare(ad);
  });
}

function latestStoredDate(){
  const dated=draws.map(d=>normaliseDateValue(d.date)).filter(Boolean).sort().reverse();
  return dated[0]||"Unknown";
}

function detectLikelyGaps(){
  const cfg=GAMES[activeGame];
  const ds=sortedByDateDesc(draws)
    .map(d=>normaliseDateValue(d.date))
    .filter(Boolean)
    .map(x=>new Date(x+"T00:00:00"));

  if(ds.length<3)return {count:0,examples:[]};

  // Lotto and EuroMillions are normally twice weekly. We flag unusually long gaps
  // rather than assuming exact draw weekdays, because historical schedules changed.
  const thresholdDays=activeGame==="lotto"?10:10;
  const examples=[];
  let count=0;

  for(let i=0;i<Math.min(ds.length-1,250);i++){
    const diff=(ds[i]-ds[i+1])/(1000*60*60*24);
    if(diff>thresholdDays){
      count++;
      if(examples.length<3){
        examples.push(`${ds[i+1].toISOString().slice(0,10)} → ${ds[i].toISOString().slice(0,10)}`);
      }
    }
  }
  return {count,examples};
}

function updateFreshnessStatus(){
  const el=$("#dataStatusMain");
  if(!el)return;
  const latest=latestStoredDate();
  const gaps=detectLikelyGaps();
  let txt=`${draws.length} ${GAMES[activeGame].name} draws stored locally · latest: ${latest}`;
  if(gaps.count){
    txt+=` · ${gaps.count} possible gap${gaps.count===1?"":"s"} detected`;
  }else{
    txt+=" · archive looks consistent";
  }
  el.textContent=txt;
}

function latestDateLabel(){
  const first=draws[0];
  if(!first?.date)return "Unknown";
  return String(first.date).replace(/-R\d$/,"");
}

function summary(){
  const cfg=GAMES[activeGame],a=buildAnalysis(draws);
  $("#drawCount").textContent=draws.length;
  if(!draws.length){$("#hotNumber").textContent="—";$("#overdueNumber").textContent="—";return}
  let h=1,d=1;
  for(let n=2;n<=cfg.max;n++){if(a.freq[n]>a.freq[h])h=n;if(a.last[n]>a.last[d])d=n}
  $("#hotNumber").textContent=h;$("#overdueNumber").textContent=d;
  const main=$("#dataStatusMain");
  if(main && !main.textContent.includes("Checking")){
    updateFreshnessStatus();
  }
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

function quickModelLine(history,weightsOverride=null,modeOverride=null,candidateCount=850){
  const saved=getModelWeights();
  if(weightsOverride)saveModelWeights(weightsOverride);

  const cfg=GAMES[activeGame];
  const a=buildAnalysis(history);
  let best=null;

  for(let i=0;i<candidateCount;i++){
    const line=sample(cfg.max,cfg.picks);
    const detail=genericScore(line,"Edge AI",a,cfg);
    if(!best || detail.score>best.detail.score){
      best={line,detail};
    }
  }

  const usedStars=new Set();
  best.stars=chooseStars(a,"Edge AI",cfg,usedStars);

  if(weightsOverride)saveModelWeights(saved);
  return best;
}

function weightCandidates(){
  return [
    {...DEFAULT_WEIGHTS},
    {historical:.16,recent:.28,overdue:.12,pairStrength:.16,structure:.20,sharing:.08},
    {historical:.24,recent:.16,overdue:.10,pairStrength:.22,structure:.20,sharing:.08},
    {historical:.18,recent:.18,overdue:.16,pairStrength:.20,structure:.20,sharing:.08},
    {historical:.18,recent:.20,overdue:.10,pairStrength:.16,structure:.28,sharing:.08},
    {historical:.22,recent:.22,overdue:.12,pairStrength:.18,structure:.18,sharing:.08}
  ];
}

async function evaluateWeights(weights,testCount=50){
  const cfg=GAMES[activeGame];
  const tests=Math.min(testCount,draws.length-80);
  if(tests<=0)return {score:-Infinity,avg:0,two:0,three:0,four:0,five:0};

  let matches=0,two=0,three=0,four=0,five=0,stars=0;
  for(let t=0;t<tests;t++){
    const target=draws[t];
    const history=draws.slice(t+1);
    const pick=quickModelLine(history,weights);
    const m=matchCount(pick.line,target.numbers);
    matches+=m;
    if(m>=2)two++;if(m>=3)three++;if(m>=4)four++;if(m>=5)five++;
    if(cfg.stars)stars+=matchCount(pick.stars||[],target.stars||[]);
    if(t%8===0)await new Promise(r=>setTimeout(r,0));
  }
  const avg=matches/tests;
  const score=avg + two*.004 + three*.02 + four*.10 + five*.50 + stars*.003;
  return {score,avg,two,three,four,five,stars,tests};
}

async function calibrateWeights(){
  if(draws.length<120){
    $("#backtestStatus").textContent="Not enough history to calibrate this game.";
    return;
  }
  const button=$("#calibrateModel");
  button.disabled=true;
  $("#backtestStatus").textContent="Calibrating model weights with walk-forward validation…";

  const sets=weightCandidates();
  let best=null;
  for(let i=0;i<sets.length;i++){
    $("#backtestStatus").textContent=`Calibration ${i+1}/${sets.length}…`;
    const res=await evaluateWeights(sets[i],50);
    if(!best || res.score>best.res.score)best={weights:sets[i],res};
  }

  saveModelWeights(best.weights);
  $("#backtestStatus").textContent=
    `Calibration complete. Best historical average ${best.res.avg.toFixed(3)} main matches over ${best.res.tests} draws. New weights saved for ${GAMES[activeGame].name}.`;
  button.disabled=false;
}

async function evaluateConcentration(mode,testCount=40){
  const cfg=GAMES[activeGame];
  const tests=Math.min(testCount,draws.length-80);
  if(tests<=0)return {score:-Infinity};

  let mainMatches=0,threePlus=0,fourPlus=0,stars=0,coverage=0;

  for(let t=0;t<tests;t++){
    const target=draws[t];
    const history=draws.slice(t+1);
    const ticket=generateSmartLines(history,"Edge AI",3,1000,mode);

    let bestMain=0,bestStars=0;
    for(const pick of ticket){
      const m=matchCount(pick.line,target.numbers);
      bestMain=Math.max(bestMain,m);
      if(cfg.stars)bestStars=Math.max(bestStars,matchCount(pick.stars||[],target.stars||[]));
    }

    mainMatches+=bestMain;
    if(bestMain>=3)threePlus++;
    if(bestMain>=4)fourPlus++;
    stars+=bestStars;
    coverage+=(ticket.portfolio?.score||0);
    if(t%5===0)await new Promise(r=>setTimeout(r,0));
  }

  const avg=mainMatches/tests;
  const avgCoverage=coverage/tests;
  const score=avg+threePlus*.025+fourPlus*.18+stars*.004+avgCoverage*.0004;
  return {score,avg,threePlus,fourPlus,stars,avgCoverage,tests};
}

async function calibrateConcentration(){
  if(draws.length<120){
    $("#backtestStatus").textContent="Not enough history to calibrate portfolio concentration.";
    return;
  }

  const button=$("#calibrateConcentration");
  button.disabled=true;
  const modes=["diversified","balanced","concentrated"];
  let best=null;

  for(let i=0;i<modes.length;i++){
    $("#backtestStatus").textContent=`Testing portfolio style ${i+1}/${modes.length}: ${modes[i]}…`;
    const res=await evaluateConcentration(modes[i],40);
    if(!best||res.score>best.res.score)best={mode:modes[i],res};
  }

  localStorage.setItem(`lottoEdgeCalibratedConcentration:${activeGame}`,best.mode);
  saveConcentrationMode("auto");
  $("#concentrationMode").value="auto";
  $("#backtestStatus").textContent=
    `Portfolio calibration complete. Historical preference: ${best.mode}. `+
    `Best-draw average ${best.res.avg.toFixed(3)} main matches over ${best.res.tests} tests. `+
    `Adaptive mode remains enabled and will use this as its baseline.`;

  button.disabled=false;
  renderConcentrationInfo();
}

function randomPortfolio(cfg,count){
  return Array.from({length:count},()=>({
    line:sample(cfg.max,cfg.picks),
    stars:sample(cfg.starMax,cfg.stars)
  }));
}

function portfolioOutcome(ticket,target,cfg){
  let bestMain=0,bestStars=0,totalMain=0,totalStars=0;
  let tiers={m0:0,m1:0,m2:0,m3:0,m4:0,m5:0,stars1:0,stars2:0};

  for(const pick of ticket){
    const m=matchCount(pick.line,target.numbers);
    const s=cfg.stars?matchCount(pick.stars||[],target.stars||[]):0;
    bestMain=Math.max(bestMain,m);
    bestStars=Math.max(bestStars,s);
    totalMain+=m;totalStars+=s;
    tiers[`m${Math.min(5,m)}`]++;
    if(s>=1)tiers.stars1++;
    if(s>=2)tiers.stars2++;
  }

  return {bestMain,bestStars,totalMain,totalStars,tiers};
}

function percentile(value,arr){
  if(!arr.length)return 0;
  // Mid-rank percentile: ties count as half, not as outright wins.
  // This matters for lottery backtests because match totals are highly discrete.
  const below=arr.filter(x=>x<value).length;
  const tied=arr.filter(x=>x===value).length;
  return 100*(below+0.5*tied)/arr.length;
}

function correlation(xs,ys){
  if(xs.length!==ys.length || xs.length<3)return 0;
  const mx=mean(xs),my=mean(ys);
  const num=xs.reduce((s,x,i)=>s+(x-mx)*(ys[i]-my),0);
  const dx=Math.sqrt(xs.reduce((s,x)=>s+(x-mx)**2,0));
  const dy=Math.sqrt(ys.reduce((s,y)=>s+(y-my)**2,0));
  return dx&&dy?num/(dx*dy):0;
}

function quantile(values,q){
  if(!values.length)return 0;
  const a=[...values].sort((x,y)=>x-y);
  const pos=(a.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos);
  return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(pos-lo);
}

function meanCI95(values){
  if(!values.length)return {mean:0,lo:0,hi:0};
  const m=mean(values);
  if(values.length<2)return {mean:m,lo:m,hi:m};
  const variance=values.reduce((s,x)=>s+(x-m)**2,0)/(values.length-1);
  const se=Math.sqrt(variance/values.length);
  return {mean:m,lo:m-1.96*se,hi:m+1.96*se};
}

function ciVerdict(ci,positiveMeansBetter=true){
  if(ci.lo>0)return positiveMeansBetter?"helpful":"harmful";
  if(ci.hi<0)return positiveMeansBetter?"harmful":"helpful";
  return "inconclusive";
}

function verdictClass(v){
  return v==="helpful"?"verdict-good":v==="harmful"?"verdict-bad":"verdict-neutral";
}

function formatCI(ci,d=3){
  return `${formatSigned(ci.lo,d)} to ${formatSigned(ci.hi,d)}`;
}

function formatSigned(n,d=3){return `${n>=0?"+":""}${n.toFixed(d)}`}

async function runBacktest(){
  const requested=Number($("#testSize").value);
  const controls=Number($("#controlRuns").value);
  if(draws.length<80){
    $("#backtestStatus").textContent="Not enough history for a useful backtest.";
    return;
  }

  const tests=Math.min(requested,draws.length-60);
  const cfg=GAMES[activeGame];
  const linesPerTicket=Math.min(5,lineCount);

  $("#backtestStatus").textContent=`Running ${tests} walk-forward tests with ${controls} random controls each…`;
  $("#backtestResults").innerHTML=`<div class="progress"><i id="btProgress" style="width:0%"></i></div>`;

  let edgeBestMain=0,edgeTotalMain=0,edgeStars=0;
  let randomBestMain=0,randomTotalMain=0,randomStars=0;
  let edge2=0,edge3=0,edge4=0,edge5=0;
  let random2=0,random3=0,random4=0,random5=0;
  let percentileSum=0,percentileBestSum=0;
  const edgeScores=[],futureHits=[];
  const bestDiffs=[],totalDiffs=[],drawPercentiles=[];

  for(let t=0;t<tests;t++){
    const target=draws[t];
    const history=draws.slice(t+1);
    if(history.length<60)break;

    const edgeTicket=generateSmartLines(history,"Edge AI",linesPerTicket,1200,getConcentrationMode());
    const eo=portfolioOutcome(edgeTicket,target,cfg);

    edgeBestMain+=eo.bestMain;
    edgeTotalMain+=eo.totalMain;
    edgeStars+=eo.totalStars;
    if(eo.bestMain>=2)edge2++;
    if(eo.bestMain>=3)edge3++;
    if(eo.bestMain>=4)edge4++;
    if(eo.bestMain>=5)edge5++;

    // Edge score correlation uses average line score vs actual best-main outcome.
    edgeScores.push(mean(edgeTicket.map(x=>x.detail?.score||0)));
    futureHits.push(eo.bestMain);

    const controlTotals=[],controlBests=[];
    let ctrlTotalMain=0,ctrlBestMain=0,ctrlStars=0;
    let c2=0,c3=0,c4=0,c5=0;

    for(let c=0;c<controls;c++){
      const rt=randomPortfolio(cfg,linesPerTicket);
      const ro=portfolioOutcome(rt,target,cfg);
      controlTotals.push(ro.totalMain);
      controlBests.push(ro.bestMain);
      ctrlTotalMain+=ro.totalMain;
      ctrlBestMain+=ro.bestMain;
      ctrlStars+=ro.totalStars;
      if(ro.bestMain>=2)c2++;
      if(ro.bestMain>=3)c3++;
      if(ro.bestMain>=4)c4++;
      if(ro.bestMain>=5)c5++;
    }

    const drawTotalPct=percentile(eo.totalMain,controlTotals);
    const drawBestPct=percentile(eo.bestMain,controlBests);
    percentileSum+=drawTotalPct;
    percentileBestSum+=drawBestPct;
    drawPercentiles.push(drawBestPct);
    bestDiffs.push(eo.bestMain-(ctrlBestMain/controls));
    totalDiffs.push(eo.totalMain-(ctrlTotalMain/controls));

    randomTotalMain+=ctrlTotalMain/controls;
    randomBestMain+=ctrlBestMain/controls;
    randomStars+=ctrlStars/controls;
    random2+=c2/controls;
    random3+=c3/controls;
    random4+=c4/controls;
    random5+=c5/controls;

    if(t%2===0){
      const p=$("#btProgress");
      if(p)p.style.width=`${(t+1)/tests*100}%`;
      await new Promise(r=>setTimeout(r,0));
    }
  }

  const avgEdgeBest=edgeBestMain/tests;
  const avgRandBest=randomBestMain/tests;
  const avgEdgeTotal=edgeTotalMain/tests;
  const avgRandTotal=randomTotalMain/tests;
  const avgPercentile=percentileSum/tests;
  const avgBestPercentile=percentileBestSum/tests;
  const corr=correlation(edgeScores,futureHits);
  const bestCI=meanCI95(bestDiffs);
  const totalCI=meanCI95(totalDiffs);
  const pctLo=quantile(drawPercentiles,.025),pctHi=quantile(drawPercentiles,.975);

  const bestLiftVerdict=ciVerdict(bestCI,true);
  const totalLiftVerdict=ciVerdict(totalCI,true);

  let interpretation="No statistically clear historical advantage over the random-control distribution.";
  if(bestLiftVerdict==="helpful" || totalLiftVerdict==="helpful"){
    interpretation="At least one paired lift measure is above zero with a 95% confidence interval that does not cross zero in this sample.";
  }
  if(bestLiftVerdict==="harmful" && totalLiftVerdict==="harmful"){
    interpretation="Edge AI underperformed the random controls on both paired lift measures in this sample.";
  }

  $("#backtestStatus").textContent="Robust backtest complete.";
  $("#backtestResults").innerHTML=`
    <div class="bt-grid">
      <div class="bt-card"><b>${avgEdgeBest.toFixed(3)}</b><small>Edge best-line avg main matches</small></div>
      <div class="bt-card"><b>${avgRandBest.toFixed(3)}</b><small>Random-control best-line avg</small></div>
      <div class="bt-card"><b>${avgBestPercentile.toFixed(1)}th</b><small>Edge best-line percentile</small></div>
      <div class="bt-card"><b>${avgPercentile.toFixed(1)}th</b><small>Edge total-ticket percentile</small></div>
      <div class="bt-card"><b>${avgEdgeTotal.toFixed(3)}</b><small>Edge total matches / ticket</small></div>
      <div class="bt-card"><b>${avgRandTotal.toFixed(3)}</b><small>Random total matches / ticket</small></div>
      <div class="bt-card"><b>${corr.toFixed(3)}</b><small>Edge score → future-hit correlation</small></div>
      <div class="bt-card"><b>${tests}</b><small>walk-forward draws tested</small></div>
      <div class="bt-card"><b>${formatSigned(bestCI.mean)}</b><small>best-line lift vs random</small></div>
      <div class="bt-card"><b>${formatSigned(totalCI.mean)}</b><small>total-ticket lift vs random</small></div>
    </div>

    <table class="bt-table">
      <tr><th>Best-line result</th><th>Edge AI</th><th>Random expected</th></tr>
      <tr><td>2+ main matches</td><td>${edge2}</td><td>${random2.toFixed(1)}</td></tr>
      <tr><td>3+ main matches</td><td>${edge3}</td><td>${random3.toFixed(1)}</td></tr>
      <tr><td>4+ main matches</td><td>${edge4}</td><td>${random4.toFixed(1)}</td></tr>
      <tr><td>5 main matches</td><td>${edge5}</td><td>${random5.toFixed(1)}</td></tr>
      ${cfg.stars?`<tr><td>Total Lucky Star matches</td><td>${edgeStars}</td><td>${randomStars.toFixed(1)}</td></tr>`:""}
    </table>

    <div class="settings-card" style="margin-top:12px">
      <b>${interpretation}</b>
      <p class="muted">
        Percentiles use a tie-corrected mid-rank calculation against ${controls} random-control portfolios per historical draw:
        controls below Edge count fully, ties count half. A 50th percentile result is roughly random-average performance.
      </p>
      <p class="muted">
        Edge-score correlation tests whether higher model scores were actually associated with better subsequent outcomes.
        Values near zero mean the model score did not meaningfully rank future hits in this sample.
      </p>
      <div class="validation-verdicts">
        <div><span>Best-line lift</span><b class="${verdictClass(bestLiftVerdict)}">${bestLiftVerdict}</b><small>95% CI ${formatCI(bestCI)}</small></div>
        <div><span>Total-ticket lift</span><b class="${verdictClass(totalLiftVerdict)}">${totalLiftVerdict}</b><small>95% CI ${formatCI(totalCI)}</small></div>
      </div>
      <p class="ci-note">
        Per-draw best-line percentile range (2.5–97.5%): ${pctLo.toFixed(1)}th–${pctHi.toFixed(1)}th.
        A paired lift interval that crosses zero is treated as inconclusive.
      </p>
    </div>`;
}

async function evaluateAblationVariant(weights,testCount){
  const tests=Math.min(testCount,draws.length-80);
  const outcomes=[];

  for(let t=0;t<tests;t++){
    const target=draws[t];
    const history=draws.slice(t+1);

    // Average two searches to reduce optimiser/random-search noise.
    let hits=0;
    for(let rep=0;rep<2;rep++){
      const pick=quickModelLine(history,weights,null,700);
      hits+=matchCount(pick.line,target.numbers);
    }
    outcomes.push(hits/2);

    if(t%6===0)await new Promise(r=>setTimeout(r,0));
  }

  return {avg:mean(outcomes),outcomes,tests};
}

async function runFactorAblation(){
  if(draws.length<120){
    $("#backtestStatus").textContent="Not enough history for factor ablation.";
    return;
  }

  const btn=$("#runAblation");
  btn.disabled=true;

  const base=getModelWeights();
  const labels={
    historical:"Long-term history",
    recent:"Recent form",
    overdue:"Overdue",
    pairStrength:"Pair strength",
    structure:"Structure",
    sharing:"Low-sharing"
  };

  // Cap ablation at 100 draws because each factor is tested twice per draw.
  const requested=Math.min(Number($("#testSize").value),100);
  $("#backtestStatus").textContent=`Running paired factor ablation across ${requested} walk-forward draws…`;

  const baseline=await evaluateAblationVariant(base,requested);
  const rows=[{
    factor:"Full model",
    avg:baseline.avg,
    delta:0,
    ci:{mean:0,lo:0,hi:0},
    verdict:"baseline"
  }];

  for(const key of Object.keys(base)){
    const w={...base,[key]:0};
    const sum=Object.values(w).reduce((a,b)=>a+b,0)||1;
    Object.keys(w).forEach(k=>w[k]/=sum);

    $("#backtestStatus").textContent=`Ablation: removing ${labels[key]}…`;
    const r=await evaluateAblationVariant(w,requested);

    // removed - full. Positive means the model improved when the factor was removed.
    const paired=r.outcomes.map((x,i)=>x-baseline.outcomes[i]);
    const ci=meanCI95(paired);

    let verdict="inconclusive";
    if(ci.hi<0)verdict="helpful";   // removing it hurt performance
    if(ci.lo>0)verdict="harmful";   // removing it improved performance

    rows.push({
      factor:`Without ${labels[key]}`,
      avg:r.avg,
      delta:r.avg-baseline.avg,
      ci,
      verdict
    });
  }

  const diagnostics=rows.filter(x=>x.factor!=="Full model");
  const helpful=diagnostics.filter(x=>x.verdict==="helpful");
  const harmful=diagnostics.filter(x=>x.verdict==="harmful");

  $("#backtestStatus").textContent="Factor ablation complete.";

  $("#backtestResults").innerHTML=`
    <table class="bt-table ablation-table">
      <tr><th>Model</th><th>Avg matches</th><th>Δ vs full</th><th>95% CI</th><th>Verdict</th></tr>
      ${rows.map(r=>`
        <tr>
          <td>${r.factor}</td>
          <td>${r.avg.toFixed(3)}</td>
          <td>${r.factor==="Full model"?"—":formatSigned(r.delta)}</td>
          <td>${r.factor==="Full model"?"—":formatCI(r.ci)}</td>
          <td>${r.factor==="Full model"
            ? '<span class="verdict-neutral">baseline</span>'
            : `<span class="${verdictClass(r.verdict)}">${r.verdict}</span>`}</td>
        </tr>`).join("")}
    </table>

    <div class="settings-card" style="margin-top:12px">
      <b>Factor diagnostic</b>
      <p class="muted">
        Each factor is removed while the remaining weights are renormalised. Results are paired draw-by-draw against the full model.
        “Helpful” means removing the factor reduced performance with a 95% interval below zero.
        “Harmful” means removing it improved performance with a 95% interval above zero.
      </p>
      <p class="muted">
        Helpful factors: ${helpful.length?helpful.map(x=>x.factor.replace("Without ","")).join(", "):"none established"}.
        Potentially harmful factors: ${harmful.length?harmful.map(x=>x.factor.replace("Without ","")).join(", "):"none established"}.
        Everything else is inconclusive in this validation window.
      </p>
      <p class="ci-note">
        Do not automatically delete a factor from one ablation run. Re-run on different historical windows before changing the live model.
      </p>
    </div>`;

  btn.disabled=false;
}

async function comparePortfolioModes(){
  const modes=["diversified","balanced","concentrated","auto"];
  const results=[];
  $("#backtestStatus").textContent="Comparing portfolio modes head-to-head…";

  for(let i=0;i<modes.length;i++){
    $("#backtestStatus").textContent=`Mode comparison ${i+1}/${modes.length}: ${modes[i]}…`;
    const res=await evaluateConcentration(modes[i],40);
    results.push({mode:modes[i],...res});
  }

  results.sort((a,b)=>b.score-a.score);
  const best=results[0];

  $("#backtestStatus").textContent=`Mode comparison complete. Best historical mode: ${best.mode}.`;
  $("#backtestResults").innerHTML=`
    <table class="bt-table">
      <tr><th>Mode</th><th>Avg best-main</th><th>3+</th><th>4+</th><th>Coverage</th></tr>
      ${results.map(r=>`
        <tr>
          <td>${r.mode}</td>
          <td>${r.avg.toFixed(3)}</td>
          <td>${r.threePlus}</td>
          <td>${r.fourPlus}</td>
          <td>${r.avgCoverage.toFixed(1)}</td>
        </tr>`).join("")}
    </table>
    <div class="settings-card" style="margin-top:12px">
      <b>Best historical portfolio style: ${best.mode}</b>
      <p class="muted">Adaptive remains preferable operationally because it can still respond to current signal strength rather than using one fixed concentration policy forever.</p>
    </div>`;
}
async function switchGame(key){
  // UI changes immediately; network work never blocks the game button.
  activeGame=key;
  localStorage.setItem("lottoEdgeGame",key);
  $("#gameLabel").textContent=GAMES[key].label;
  $("#lottoGame").classList.toggle("active",key==="lotto");
  $("#euroGame").classList.toggle("active",key==="euromillions");
  $("#results").innerHTML="";
  $("#confidenceCard").classList.add("hidden");

  draws=await ensureData(key);
  invalidateAnalysis();
  summary();
  renderStats(activeStat);
  $("#importStatus").textContent=`${GAMES[key].name}: ${draws.length} draws stored locally.`;
  renderWeightStatus();
  $("#concentrationMode").value=getConcentrationMode();
  renderConcentrationInfo();
  renderIntegrity();

  const mainStatus=$("#dataStatusMain");
  if(mainStatus){
    mainStatus.textContent=draws.length<1000 && key==="lotto"
      ? "Using local fallback while full Lotto history updates in the background…"
      : `${draws.length} ${GAMES[key].name} draws stored locally.`;
  }

  const stampKey=key==="lotto"?"lottoEdgeLottoLastUpdate":"lottoEdgeEuroLastUpdate";
  const last=Number(localStorage.getItem(stampKey)||0);
  if(navigator.onLine && (draws.length<1000 || Date.now()-last>12*60*60*1000)){
    setTimeout(()=>backgroundRefreshGame(key,false),1800);
  }
}

async function refreshData(){
  $("#updateStatus").textContent=`Checking ${GAMES[activeGame].name} updates and archive integrity…`;
  await backgroundRefreshGame(activeGame,true);
  const gaps=detectLikelyGaps();
  $("#updateStatus").textContent=
    `${GAMES[activeGame].name}: ${draws.length} draws · latest ${latestStoredDate()} · `+
    (gaps.count?`${gaps.count} possible recent gap(s) detected.`:"no obvious recent gaps detected.");
  updateFreshnessStatus();
  renderIntegrity();
}

async function importCsv(){
  const f=$("#csvInput").files[0];
  if(!f){$("#importStatus").textContent="Choose a CSV first.";return}
  const inc=parseCsv(await f.text(),activeGame);
  if(!inc.length){$("#importStatus").textContent="No valid rows detected for this game.";return}
  draws=dedupe([...inc,...draws]);saveStored(activeGame,draws);
  invalidateAnalysis();summary();renderStats(activeStat);
  $("#importStatus").textContent=`Imported ${inc.length} rows; ${draws.length} total stored.`;
}


const concentrationDescriptions={
  auto:"Lets signal strength decide how much repetition is justified. Historical calibration is used as a baseline.",
  diversified:"Maximises independent coverage. Strong numbers are generally used once.",
  balanced:"Allows core numbers to repeat across several lines while keeping broad coverage.",
  concentrated:"Leans into the highest-conviction numbers and pairs across multiple lines."
};

function renderConcentrationInfo(){
  const mode=$("#concentrationMode")?.value||getConcentrationMode();
  const calibrated=localStorage.getItem(`lottoEdgeCalibratedConcentration:${activeGame}`)||"not calibrated";
  const info=$("#concentrationInfo");
  if(info)info.textContent=concentrationDescriptions[mode]+
    (mode==="auto"?` Historical baseline: ${calibrated}.`:"");

  const status=$("#concentrationStatus");
  if(status)status.textContent=
    `Portfolio mode: ${getConcentrationMode()}. Historical concentration baseline: ${calibrated}.`;
}

$("#versionBadge").textContent=`v${APP_VERSION.split(".")[0]}`;
$("#strategyInfo").textContent=descriptions[$("#strategy").value];
$("#strategy").onchange=e=>$("#strategyInfo").textContent=descriptions[e.target.value];
$("#concentrationMode").value=getConcentrationMode();
$("#concentrationMode").onchange=e=>{
  saveConcentrationMode(e.target.value);
  renderConcentrationInfo();
};
renderConcentrationInfo();
$("#minusLine").onclick=()=>{$("#lineCount").textContent=lineCount=Math.max(1,lineCount-1)};
$("#plusLine").onclick=()=>{$("#lineCount").textContent=lineCount=Math.min(10,lineCount+1)};
$("#generateBtn").onclick=generate;
$("#lottoGame").onclick=()=>switchGame("lotto");
$("#euroGame").onclick=()=>switchGame("euromillions");
$("#refreshBtn").onclick=refreshData;
$("#runBacktest").onclick=runBacktest;
$("#calibrateModel").onclick=calibrateWeights;
$("#calibrateConcentration").onclick=calibrateConcentration;
$("#comparePortfolioModes").onclick=comparePortfolioModes;
$("#runAblation").onclick=runFactorAblation;
$("#importBtn").onclick=importCsv;
$("#clearHistory").onclick=()=>{localStorage.removeItem("lottoEdgeHistory");renderHistory()};

$$(".segmented button").forEach(b=>b.onclick=()=>{
  $$(".segmented button").forEach(x=>x.classList.remove("active"));b.classList.add("active");renderStats(b.dataset.stat);
});

$$(".bottom-nav button").forEach(b=>b.onclick=()=>{
  $$(".bottom-nav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");
  $$(".screen").forEach(x=>x.classList.remove("active"));$("#"+b.dataset.screen).classList.add("active");
  if(b.dataset.screen==="historyScreen")renderHistory();
  if(b.dataset.screen==="settingsScreen"){renderIntegrity();renderWeightStatus();renderConcentrationInfo();}
});

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("service-worker.js?version=18")
    .then(reg=>{
      // Check for a newer worker after the app has already rendered.
      setTimeout(()=>reg.update().catch(()=>{}),1500);
    })
    .catch(()=>{});
}

(async()=>{
  checkAppVersionInBackground();
  await switchGame(activeGame);
  renderHistory();
})();
