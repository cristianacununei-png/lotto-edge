
const $ = s => document.querySelector(s);

const APP_VERSION="14.0.0";

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

  const weights={
    historical:.20,
    recent:.20,
    overdue:.12,
    pairStrength:.18,
    structure:.22,
    sharing:.08
  };

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

  // Coverage score deliberately rewards pair diversity more than raw unique-number count.
  let score=100*(.45*numberCoverage+.55*pairCoverage);
  score-=repeatedNumbers*1.5;
  score-=repeatedPairs*3.5;
  score-=repeatedStarPairs*4;
  score=Math.max(0,Math.min(100,score));

  return {
    score,uniqueNumbers,uniquePairs,repeatedNumbers,repeatedPairs,repeatedStarPairs,
    numberCoverage,pairCoverage
  };
}

function candidatePortfolioValue(item,chosen,cfg){
  // Raw line quality matters, but marginal portfolio value matters too.
  let value=item.detail?.score||50;

  if(!chosen.length)return value;

  const chosenNums=new Map(),chosenPairs=new Map();
  chosen.forEach(x=>{
    x.line.forEach(n=>chosenNums.set(n,(chosenNums.get(n)||0)+1));
    for(let i=0;i<x.line.length;i++)for(let j=i+1;j<x.line.length;j++){
      const k=`${x.line[i]}-${x.line[j]}`;
      chosenPairs.set(k,(chosenPairs.get(k)||0)+1);
    }
  });

  let newNums=0,reusedNums=0,reusedPairs=0;
  item.line.forEach(n=>{
    if(chosenNums.has(n))reusedNums+=chosenNums.get(n);
    else newNums++;
  });

  for(let i=0;i<item.line.length;i++)for(let j=i+1;j<item.line.length;j++){
    const k=`${item.line[i]}-${item.line[j]}`;
    if(chosenPairs.has(k))reusedPairs+=chosenPairs.get(k);
  }

  // Strong numbers are allowed to repeat, but whole-pair duplication is expensive.
  value += newNums*2.2;
  value -= reusedNums*1.6;
  value -= reusedPairs*5.0;

  // Avoid near-clones.
  const maxOverlap=Math.max(...chosen.map(x=>item.line.filter(n=>x.line.includes(n)).length));
  if(maxOverlap>=cfg.picks-1)value-=30;
  else if(maxOverlap===cfg.picks-2)value-=12;

  return value;
}

function generateSmartLines(history,strategy,count,candidateCount=30000){
  const cfg=GAMES[activeGame],a=buildAnalysis(history);

  if(strategy==="Pure random"||!history.length){
    const randomLines=Array.from({length:count},()=>({
      line:sample(cfg.max,cfg.picks),
      stars:sample(cfg.starMax,cfg.stars),
      detail:null
    }));
    randomLines.portfolio=portfolioMetrics(randomLines,cfg);
    return randomLines;
  }

  const pool=[],seen=new Set();
  for(let i=0;i<candidateCount;i++){
    const line=sample(cfg.max,cfg.picks),k=line.join(",");
    if(seen.has(k))continue;
    seen.add(k);
    pool.push({line,detail:genericScore(line,strategy,a,cfg)});
  }

  // Keep a broad high-quality candidate pool; portfolio logic selects among it.
  pool.sort((x,y)=>y.detail.score-x.detail.score);
  const shortlist=pool.slice(0,Math.min(2500,pool.length));

  const chosen=[];
  const usedStarPairs=new Set();

  while(chosen.length<count && shortlist.length){
    let bestIndex=0,bestValue=-Infinity;

    for(let i=0;i<shortlist.length;i++){
      const v=candidatePortfolioValue(shortlist[i],chosen,cfg);
      if(v>bestValue){bestValue=v;bestIndex=i;}
    }

    const item=shortlist.splice(bestIndex,1)[0];
    item.portfolioValue=bestValue;

    const stars=chooseStars(a,strategy,cfg,usedStarPairs);
    item.stars=stars;
    if(stars.length)usedStarPairs.add(stars.join("-"));

    chosen.push(item);

    // Remove very similar candidates after each choice to keep the search efficient.
    for(let i=shortlist.length-1;i>=0;i--){
      const overlap=shortlist[i].line.filter(n=>item.line.includes(n)).length;
      if(overlap>=cfg.picks-1)shortlist.splice(i,1);
    }
  }

  // Fallback if aggressive pruning prevented us filling the ticket.
  while(chosen.length<count){
    const item=pool.find(x=>!chosen.some(c=>c.line.join(",")===x.line.join(",")));
    if(!item)break;
    item.stars=chooseStars(a,strategy,cfg,usedStarPairs);
    if(item.stars.length)usedStarPairs.add(item.stars.join("-"));
    chosen.push(item);
  }

  chosen.portfolio=portfolioMetrics(chosen,cfg);
  return chosen;
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
            Model weights: history 20% · recent 20% · pairs 18% · structure 22% ·
            overdue 12% · low-sharing 8%.
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
          <b>Ticket coverage ${Math.round(p.score)}/100</b>
          <span>${p.uniqueNumbers} unique numbers · ${p.uniquePairs} unique pairs</span>
        </div>
        <div class="portfolio-grid">
          <div><b>${p.repeatedNumbers}</b><small>repeated number slots</small></div>
          <div><b>${p.repeatedPairs}</b><small>repeated pairs</small></div>
          ${GAMES[activeGame].stars?`<div><b>${p.repeatedStarPairs}</b><small>repeated star pairs</small></div>`:""}
        </div>
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


function renderIntegrity(){
  const el=$("#integrityStatus");
  if(!el)return;
  const latest=latestStoredDate();
  const gaps=detectLikelyGaps();
  const dupCheck=draws.length-dedupeStrict(draws).length;
  let msg=`Latest stored draw: ${latest}. ${draws.length} unique rows in local database. `;
  msg+=dupCheck?`${dupCheck} duplicate rows detected. `:"No duplicate rows detected. ";
  msg+=gaps.count?`${gaps.count} possible historical date gaps detected in the recent archive.`:"No obvious recent date gaps detected.";
  el.textContent=msg;
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
  if(b.dataset.screen==="settingsScreen")renderIntegrity();
});

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("service-worker.js?version=12")
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
