
const $ = s => document.querySelector(s);

const APP_VERSION="22.0.0";

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

const PLAYER_EVIDENCE_URLS={
  lotto:"https://www.lotterystats.co.uk/lotto/results",
  euromillions:"https://www.lotterystats.co.uk/euromillions/results"
};

const PLAYER_MODEL_SOURCES={
  cox:"https://eprints.soton.ac.uk/250895/",
  haigh:"https://academic.oup.com/jrsssa/article-abstract/160/2/187/7102439",
  conscious:"https://academic.oup.com/jrsssa/article/174/1/31/7100902",
  significance:"https://academic.oup.com/jrssig/article/20/1/31/7034183"
};

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
  "Validated Edge":"Recommended production mode. Historical prediction is allowed only if it survives rolling development tests and an untouched holdout; otherwise it falls back to portfolio optimisation.",
  "Edge AI Research":"Experimental historical model for research and comparison. It is not treated as validated prediction.",
  "Edge AI":"Experimental historical model + smart ticket diversification. Analytical ranking only.",
  "Balanced":"Typical historical structure plus lower-sharing-risk patterns.",
  "Low sharing risk":"Player Edge: favours combinations estimated to be less commonly selected by other players. This affects potential prize sharing, not draw probability.",
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

const PREDICTIVE_FACTORS=["historical","recent","overdue","pairStrength","structure"];

function validatedModelKey(){
  return `lottoEdgeValidatedModel:${activeGame}`;
}

function validationLedgerKey(){
  return `lottoEdgeValidationLedger:${activeGame}`;
}

const MIN_FRESH_PRODUCTION_DRAWS=150;

function getValidationLedger(){
  try{
    const raw=JSON.parse(localStorage.getItem(validationLedgerKey())||"null");
    if(raw && Array.isArray(raw.productionRuns)){
      return {schema:2,productionRuns:raw.productionRuns};
    }
  }catch{}
  return {schema:2,productionRuns:[]};
}

function saveValidationLedger(ledger){
  ledger.schema=2;
  localStorage.setItem(validationLedgerKey(),JSON.stringify(ledger));
}

function lastProductionRun(){
  return getValidationLedger().productionRuns[0]||null;
}

function lastProductionCutoffDate(){
  const last=lastProductionRun();
  // v21.1 migration: its `latest` field is the date at which reserved data was consumed.
  return normaliseDateValue(last?.cutoffDate||last?.latest||"");
}

function freshDrawsAfterCutoff(){
  const cutoff=lastProductionCutoffDate();
  if(!cutoff)return [];
  return draws
    .filter(d=>{
      const dt=normaliseDateValue(d.date);
      return dt && dt>cutoff;
    })
    .sort((a,b)=>normaliseDateValue(a.date).localeCompare(normaliseDateValue(b.date)));
}

function productionArenaState(){
  const last=lastProductionRun();
  if(!last){
    return {
      firstRun:true,
      ready:draws.length>=850,
      freshCount:null,
      required:MIN_FRESH_PRODUCTION_DRAWS,
      cutoff:null
    };
  }

  const fresh=freshDrawsAfterCutoff();
  return {
    firstRun:false,
    ready:fresh.length>=MIN_FRESH_PRODUCTION_DRAWS,
    freshCount:fresh.length,
    required:MIN_FRESH_PRODUCTION_DRAWS,
    cutoff:lastProductionCutoffDate()
  };
}

function recordProductionRun(result,cutoffDate,arenaCount){
  const ledger=getValidationLedger();
  ledger.productionRuns.unshift({
    at:new Date().toISOString(),
    cutoffDate:normaliseDateValue(cutoffDate),
    drawCount:draws.length,
    arenaCount,
    result
  });
  ledger.productionRuns=ledger.productionRuns.slice(0,20);
  saveValidationLedger(ledger);
}


function emptyPredictiveWeights(){
  return {historical:0,recent:0,overdue:0,pairStrength:0,structure:0,sharing:0};
}

function getValidatedModel(){
  try{
    const m=JSON.parse(localStorage.getItem(validatedModelKey())||"null");
    if(m && m.schema===21)return m;

    // v20 migration: preserve status for display, but require v21 model search
    // before old weights are treated as production-valid.
    if(m && m.schema===20){
      return {
        schema:21,
        status:m.status==="neutral"?"neutral":"unvalidated",
        terms:[],
        weights:emptyPredictiveWeights(),
        starStatus:m.starStatus||"unvalidated",
        starLift:m.starLift??null,
        validatedAt:m.validatedAt||null,
        datasetCount:m.datasetCount||0,
        legacy:true
      };
    }
  }catch{}
  return {
    schema:21,status:"unvalidated",terms:[],weights:emptyPredictiveWeights(),
    starStatus:"unvalidated",starLift:null,validatedAt:null,datasetCount:0
  };
}

function saveValidatedModel(model){
  localStorage.setItem(validatedModelKey(),JSON.stringify(model));
}

function validatedStatusText(){
  const m=getValidatedModel();
  if(m.status==="validated")
    return `Predictive champion active · ${m.terms?.map(termLabel).join(" + ")||"validated model"}`;
  if(m.status==="neutral")
    return "No predictive edge established · Portfolio Edge fallback active";
  return "Validation not run yet · run Full Validation Suite";
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

  // v21: deterministic horizon research. These are built from past data only.
  const horizonList=[20,50,100,200];
  const recentByHorizon={};
  const overdueByHorizon={};

  for(const h of horizonList){
    const arr=Array(cfg.max+1).fill(0);
    history.slice(0,Math.min(h,history.length))
      .forEach(d=>d.numbers.forEach(n=>arr[n]++));
    recentByHorizon[h]=arr;

    const gap=Array(cfg.max+1).fill(0);
    for(let n=1;n<=cfg.max;n++)gap[n]=Math.min(last[n],h);
    overdueByHorizon[h]=gap;
  }

  const sums=history.map(d=>d.numbers.reduce((a,b)=>a+b,0));
  const odds=history.map(d=>d.numbers.filter(n=>n%2).length);
  const lows=history.map(d=>d.numbers.filter(n=>n<=cfg.max/2).length);
  const sm=mean(sums),ssd=Math.sqrt(mean(sums.map(x=>(x-sm)**2)))||1;

  const pairVals=Object.values(pairs),pm=mean(pairVals),psd=Math.sqrt(mean(pairVals.map(x=>(x-pm)**2)))||1;

  const result={
    freq,last,pairs,recent,recentByHorizon,overdueByHorizon,
    starFreq:sf,starLast:sl,
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


const PLAYER_FEATURE_KEYS=[
  "birthdayShare",
  "lowNumberBias",
  "lucky7",
  "unlucky13",
  "consecutive",
  "sameLast",
  "arithmeticPattern",
  "allBirthday"
];

const PLAYER_PRIOR_WEIGHTS={
  birthdayShare:1.45,
  lowNumberBias:.85,
  lucky7:.55,
  unlucky13:-.28,
  consecutive:.65,
  sameLast:.28,
  arithmeticPattern:.42,
  allBirthday:.70
};

const PLAYER_MIN_FIRST_VALIDATION=80;
const PLAYER_MIN_FRESH_VALIDATION=30;

function playerEvidenceStorageKey(){
  return `lottoEdgePlayerEvidence:${activeGame}`;
}

function playerModelStorageKey(){
  return `lottoEdgePlayerModel:${activeGame}`;
}

function playerValidationLedgerKey(){
  return `lottoEdgePlayerValidationLedger:${activeGame}`;
}

function getPlayerEvidence(gameKey=activeGame){
  try{
    const x=JSON.parse(localStorage.getItem(`lottoEdgePlayerEvidence:${gameKey}`)||"[]");
    return Array.isArray(x)?x:[];
  }catch{return[]}
}

function savePlayerEvidence(rows,gameKey=activeGame){
  const seen=new Set(),out=[];
  [...rows].sort((a,b)=>normaliseDateValue(a.date).localeCompare(normaliseDateValue(b.date))).forEach(r=>{
    const k=`${normaliseDateValue(r.date)}|${(r.numbers||[]).join(",")}|${(r.stars||[]).join(",")}`;
    if(!k||seen.has(k))return;
    seen.add(k);out.push(r);
  });
  localStorage.setItem(`lottoEdgePlayerEvidence:${gameKey}`,JSON.stringify(out));
  return out;
}

function getPlayerModel(gameKey=activeGame){
  try{
    const m=JSON.parse(localStorage.getItem(`lottoEdgePlayerModel:${gameKey}`)||"null");
    if(m && m.schema===1)return m;
  }catch{}
  return {
    schema:1,
    status:"prior",
    coefficients:null,
    featureMean:null,
    featureSd:null,
    predictionMean:0,
    predictionSd:1,
    validatedAt:null,
    cutoffDate:null,
    evidenceCount:0,
    holdoutCorrelation:null,
    holdoutP:null
  };
}

function savePlayerModel(model,gameKey=activeGame){
  localStorage.setItem(`lottoEdgePlayerModel:${gameKey}`,JSON.stringify(model));
}

function getPlayerValidationLedger(gameKey=activeGame){
  try{
    const x=JSON.parse(localStorage.getItem(`lottoEdgePlayerValidationLedger:${gameKey}`)||"null");
    if(x && Array.isArray(x.runs))return x;
  }catch{}
  return {schema:1,runs:[]};
}

function savePlayerValidationLedger(ledger,gameKey=activeGame){
  ledger.schema=1;
  localStorage.setItem(`lottoEdgePlayerValidationLedger:${gameKey}`,JSON.stringify(ledger));
}

function lastPlayerValidationRun(gameKey=activeGame){
  return getPlayerValidationLedger(gameKey).runs[0]||null;
}

function recordPlayerValidationRun(run,gameKey=activeGame){
  const ledger=getPlayerValidationLedger(gameKey);
  ledger.runs.unshift(run);
  ledger.runs=ledger.runs.slice(0,20);
  savePlayerValidationLedger(ledger,gameKey);
}

function arithmeticPatternScore(line){
  if(line.length<3)return 0;
  const a=[...line].sort((x,y)=>x-y);
  let hits=0,total=0;
  for(let i=0;i<a.length;i++){
    for(let j=i+1;j<a.length;j++){
      for(let k=j+1;k<a.length;k++){
        total++;
        if(a[j]-a[i]===a[k]-a[j])hits++;
      }
    }
  }
  return total?Math.min(1,hits/2):0;
}

function playerFeatureVector(line,cfg){
  const nums=[...line].sort((a,b)=>a-b);
  const f=lineFeatures(nums,cfg);
  const meanN=nums.length?mean(nums):(cfg.max+1)/2;

  return {
    birthdayShare:nums.length?f.birthday/nums.length:0,
    lowNumberBias:nums.length?1-(meanN-1)/(cfg.max-1):.5,
    lucky7:nums.includes(7)?1:0,
    unlucky13:nums.includes(13)?1:0,
    consecutive:Math.min(1,f.consecutive/2),
    sameLast:Math.min(1,f.sameLast/3),
    arithmeticPattern:arithmeticPatternScore(nums),
    allBirthday:nums.length && nums.every(n=>n<=31)?1:0
  };
}

function playerStarPrior(stars,cfg){
  if(!cfg.stars||!stars?.length)return 0;
  const s=[...stars].sort((a,b)=>a-b);
  let raw=0;
  if(s.includes(7))raw+=.45;
  if(s.includes(13))raw-=.20;
  if(s.length===2 && s[1]===s[0]+1)raw+=.30;
  if(s.every(n=>n<=7))raw+=.20;
  return raw;
}

function priorPlayerPopularityRaw(line,stars,cfg){
  const x=playerFeatureVector(line,cfg);
  let raw=0;
  for(const k of PLAYER_FEATURE_KEYS)raw+=(PLAYER_PRIOR_WEIGHTS[k]||0)*x[k];
  raw+=playerStarPrior(stars,cfg);
  return raw;
}

function priorPlayerLowSharing(line,stars,cfg){
  const raw=priorPlayerPopularityRaw(line,stars,cfg);
  // Fixed mapping: literature-backed ranking, not a probability estimate.
  return Math.max(0,Math.min(100,82-22*raw));
}

function learnedPlayerPrediction(line,cfg,model){
  if(!model?.coefficients)return null;
  const x=playerFeatureVector(line,cfg);
  let pred=model.coefficients[0]||0;
  for(let j=0;j<PLAYER_FEATURE_KEYS.length;j++){
    const k=PLAYER_FEATURE_KEYS[j];
    const sd=model.featureSd?.[j]||1;
    const z=(x[k]-(model.featureMean?.[j]||0))/sd;
    pred+=(model.coefficients[j+1]||0)*z;
  }
  return pred;
}

function playerScoreDetails(line,stars=[],cfg=GAMES[activeGame]){
  const prior=priorPlayerLowSharing(line,stars,cfg);
  const model=getPlayerModel();
  const learned=learnedPlayerPrediction(line,cfg,model);

  let lowSharing=prior;
  let mode="literature prior";

  if(model.status==="validated" && Number.isFinite(learned)){
    const z=(learned-(model.predictionMean||0))/(model.predictionSd||1);
    const empirical=Math.max(0,Math.min(100,50-18*z));

    // Main-number empirical model plus a modest prior stabiliser.
    lowSharing=.82*empirical+.18*prior;
    mode="validated empirical";
  }

  const features=playerFeatureVector(line,cfg);
  return {
    lowSharing:Math.max(0,Math.min(100,lowSharing)),
    popularity:100-Math.max(0,Math.min(100,lowSharing)),
    prior,
    mode,
    status:model.status,
    features,
    model
  };
}

function sharingScore(line,cfg){
  return playerScoreDetails(line,[],cfg).lowSharing;
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

  const player=playerScoreDetails(line,[],cfg);
  const sharing=player.lowSharing;

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
    reasons,
    player
  };
}


const MODEL_FACTOR_LABELS={
  historical:"History",
  recent:"Recent",
  overdue:"Overdue",
  pairStrength:"Pairs",
  structure:"Structure"
};

function rawComponentForSpec(line,a,cfg,spec,baseDetail=null){
  const d=baseDetail||modelScore(line,a,cfg);
  let value=50;

  if(spec.factor==="historical"){
    value=d.historical;
  }else if(spec.factor==="pairStrength"){
    value=d.pairStrength;
  }else if(spec.factor==="structure"){
    value=d.structure;
  }else if(spec.factor==="recent"){
    const h=spec.horizon||50;
    const arr=a.recentByHorizon?.[h]||a.recent;
    value=normZ(mean(line.map(n=>zFromArray(arr,n))));
  }else if(spec.factor==="overdue"){
    const h=spec.horizon||50;
    const arr=a.overdueByHorizon?.[h]||a.last;
    value=normZ(mean(line.map(n=>zFromArray(arr,n))));
  }

  if(spec.direction===-1)value=100-value;
  return Math.max(0,Math.min(100,value));
}

function scoreFromTerms(line,a,cfg,terms){
  if(!terms?.length)return 50;
  const base=modelScore(line,a,cfg);
  const weighted=terms.reduce((s,t)=>{
    const w=t.weight??(1/terms.length);
    return s+rawComponentForSpec(line,a,cfg,t,base)*w;
  },0);
  const total=terms.reduce((s,t)=>s+(t.weight??(1/terms.length)),0)||1;
  return Math.max(0,Math.min(100,weighted/total));
}

function termLabel(t){
  const base=MODEL_FACTOR_LABELS[t.factor]||t.factor;
  const h=t.horizon?` ${t.horizon}`:"";
  const dir=t.direction===-1?" inverse":"";
  return `${base}${h}${dir}`;
}

function weightedPredictiveScore(detail,weights){
  const keys=PREDICTIVE_FACTORS.filter(k=>(weights[k]||0)>0);
  const total=keys.reduce((s,k)=>s+(weights[k]||0),0);
  if(!total)return 50;
  return keys.reduce((s,k)=>s+detail[k]*(weights[k]||0),0)/total;
}

function validatedScore(line,a,cfg){
  const base=modelScore(line,a,cfg);
  const vm=getValidatedModel();
  const predictive=(vm.status==="validated" && vm.terms?.length)
    ? scoreFromTerms(line,a,cfg,vm.terms)
    : 50;

  const termWeights={historical:0,recent:0,overdue:0,pairStrength:0,structure:0,sharing:0};
  for(const t of vm.terms||[])termWeights[t.factor]=(termWeights[t.factor]||0)+(t.weight||0);

  return {
    ...base,
    score:predictive,
    objectiveScore:vm.status==="validated"
      ? .88*predictive+.12*base.sharing
      : base.sharing,
    payoutScore:base.sharing,
    validationStatus:vm.status,
    weights:termWeights,
    validatedTerms:vm.terms||[],
    reasons:vm.status==="validated"
      ? [
          `Production model: ${(vm.terms||[]).map(termLabel).join(" + ")}.`,
          `This challenger passed both the reserved validation gate and final confirmation arena.`,
          `Low-sharing (${Math.round(base.sharing)}/100) remains outside draw prediction.`
        ]
      : [
          "No predictive challenger has cleared the v21 production gates for this game.",
          "This line is selected for portfolio coverage and the current low-sharing heuristic, not claimed predictive advantage. The low-sharing heuristic itself has not yet been empirically validated against player-selection data."
        ]
  };
}

function genericScore(line,strategy,a,cfg){
  if(strategy==="Validated Edge")return validatedScore(line,a,cfg);
  if(strategy==="Edge AI Research")return modelScore(line,a,cfg);
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


function choosePlayerStars(cfg,usedPairs){
  if(!cfg.stars)return[];
  const candidates=[];
  for(let a=1;a<=cfg.starMax;a++){
    for(let b=a+1;b<=cfg.starMax;b++){
      const stars=[a,b];
      const score=priorPlayerLowSharing([],stars,cfg);
      candidates.push({stars,score});
    }
  }
  candidates.sort((x,y)=>y.score-x.score);
  const top=candidates.slice(0,Math.min(14,candidates.length));
  const fresh=top.filter(x=>!usedPairs.has(x.stars.join("-")));
  const pool=fresh.length?fresh:top;
  if(!pool.length)return sample(cfg.starMax,cfg.stars);
  // Small randomisation avoids every ticket receiving exactly the same pair.
  const pick=pool[Math.floor(Math.random()*Math.min(5,pool.length))];
  return [...pick.stars];
}

function chooseStars(a,strategy,cfg,usedPairs){
  if(!cfg.stars)return[];
  if(strategy==="Pure random")return sample(cfg.starMax,cfg.stars);

  if(strategy==="Low sharing risk")return choosePlayerStars(cfg,usedPairs);

  if(strategy==="Validated Edge"){
    const vm=getValidatedModel();
    if(vm.starStatus!=="validated"){
      return choosePlayerStars(cfg,usedPairs);
    }
    strategy="Edge AI";
  }

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
  const avgEdge=mean(lines.map(x=>x.detail?.objectiveScore??x.detail?.score??50));
  const minEdge=Math.min(...lines.map(x=>x.detail?.objectiveScore??x.detail?.score??50));
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
    const pd=d?playerScoreDetails(x.line,x.stars||[],GAMES[activeGame]):null;
    return `
    <div class="ticket">
      <div class="ticket-head">
        <strong>Line ${i+1}</strong>
        <span class="pill">${d
  ? (d.validationStatus==="neutral"
      ? `Player ${Math.round(pd?.lowSharing??d.payoutScore)}/100`
      : d.validationStatus==="validated"
        ? `Validated ${Math.round(d.score)}/100`
        : `Research ${Math.round(d.score)}/100`)
  : "Random"}</span>
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
            <div><b>${Math.round(d.score)}</b><small>${d.validationStatus==="neutral"?"Neutral prediction":"Predictive score"}</small></div>
            <div><b>${Math.round(pd?.lowSharing??d.payoutScore??d.sharing)}</b><small>Player Edge</small></div>
            <div><b>${d.sum}</b><small>Number sum</small></div>
          </div>

          ${scoreBar("Long-term history",d.historical)}
          ${scoreBar("Recent form",d.recent)}
          ${scoreBar("Pair strength",d.pairStrength)}
          ${scoreBar("Overdue fit",d.overdue)}
          ${scoreBar("Draw structure",d.structure)}
          ${scoreBar("Player low-sharing",pd?.lowSharing??d.sharing)}

          <div class="player-explain">
            <b>${pd?.mode==="validated empirical"?"Validated empirical Player Model":"Literature-backed Player prior"}</b>
            <span>
              Birthday range ${Math.round((pd?.features?.birthdayShare||0)*100)}% ·
              ${pd?.features?.lucky7?"contains 7 · ":""}${pd?.features?.unlucky13?"contains 13 · ":""}
              consecutive pattern ${Math.round((pd?.features?.consecutive||0)*100)}%.
            </span>
          </div>

          <div class="why-copy">
            ${d.reasons.map(r=>`<p>${r}</p>`).join("")}
          </div>

          <div class="weight-note">
            ${d.validatedTerms?.length
              ? `Validated model: ${d.validatedTerms.map(t=>`${termLabel(t)} ${Math.round((t.weight||0)*100)}%`).join(" · ")}.`
              : `No validated predictive terms active.`}
            Low-sharing is excluded from draw prediction.
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
  const vm=items.validatedModel||null;
  if(c){
    $("#confidenceCard").classList.remove("hidden");
    $("#confidenceCard").innerHTML=`
      ${vm
        ? (vm.status==="validated"
            ? `<strong>Predictive status: Validated</strong>
               <div class="muted">The active predictive factors passed rolling development tests and the untouched holdout.</div>`
            : `<strong>Predictive status: Neutral</strong>
               <div class="muted">No historical predictor cleared the production holdout. These lines are being optimised as a portfolio, without claiming improved draw probability.</div>`)
        : `<strong>Research model confidence: ${c.label}</strong>
           <div class="muted">Average research score ${c.score.toFixed(1)}/100 · model agreement ${c.agreement.toFixed(0)}/100.</div>
           <div class="progress"><i style="width:${c.agreement}%"></i></div>`}

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
  const vm=getValidatedModel();
  const n=(strategy==="Validated Edge"||strategy==="Edge AI Research"||strategy==="Edge AI")?30000:9000;
  const forcedMode=(strategy==="Validated Edge" && vm.status!=="validated")?"diversified":null;
  const items=generateSmartLines(draws,strategy,lineCount,n,forcedMode);
  if(strategy==="Validated Edge")items.validatedModel=vm;
  const stamp=new Date().toISOString();
  const saved=items.map(x=>({...x,game:activeGame,strategy,created:stamp,portfolio:items.portfolio||null}));
  saved.portfolio=items.portfolio||null;
  saved.globalScore=items.globalScore||null;
  saved.conviction=items.conviction||null;
  saved.concentrationMode=items.concentrationMode||null;
  saved.validatedModel=items.validatedModel||null;
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


function hashSeed(text){
  let h=2166136261>>>0;
  for(let i=0;i<text.length;i++){
    h^=text.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return h>>>0;
}

function seededRng(seed){
  let a=seed>>>0;
  return function(){
    a|=0;a=a+0x6D2B79F5|0;
    let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}

function ruleMaxForDraw(gameKey,date){
  if(gameKey!=="lotto")return GAMES[gameKey].max;
  const d=normaliseDateValue(date);
  return d && d<"2015-10-10" ? 49 : 59;
}

function starMaxForDraw(date){
  const d=normaliseDateValue(date);
  if(!d)return 12;
  if(d<"2011-05-10")return 9;
  if(d<"2016-09-24")return 11;
  return 12;
}

function midRankPct(value,controls){
  if(!controls.length)return 50;
  const below=controls.filter(x=>x<value).length;
  const tied=controls.filter(x=>x===value).length;
  return 100*(below+.5*tied)/controls.length;
}

function candidateVariantSpecs(){
  const out=[
    {factor:"historical",direction:1},
    {factor:"historical",direction:-1},
    {factor:"pairStrength",direction:1},
    {factor:"pairStrength",direction:-1},
    {factor:"structure",direction:1},
    {factor:"structure",direction:-1}
  ];

  for(const horizon of [20,50,100,200]){
    out.push({factor:"recent",horizon,direction:1});
    out.push({factor:"recent",horizon,direction:-1});
    out.push({factor:"overdue",horizon,direction:1});
    out.push({factor:"overdue",horizon,direction:-1});
  }
  return out;
}

async function buildWindowObservations(chron,start,end,controlsPerDraw,label){
  const cfg=GAMES[activeGame];
  const specs=candidateVariantSpecs();
  const observations=[];

  for(let i=start;i<end;i++){
    const target=chron[i];
    const history=chron.slice(0,i).reverse();
    if(history.length<150)continue;

    const a=buildAnalysis(history);
    const maxN=ruleMaxForDraw(activeGame,target.date);
    const rng=seededRng(hashSeed(`${activeGame}|${target.date}|${label}`));

    const targetBase=modelScore(target.numbers,a,cfg);
    const targetValues={};
    for(const s of specs){
      const id=JSON.stringify(s);
      targetValues[id]=rawComponentForSpec(target.numbers,a,cfg,s,targetBase);
    }

    const controls=[];
    for(let c=0;c<controlsPerDraw;c++){
      const line=sample(maxN,cfg.picks,rng);
      const base=modelScore(line,a,cfg);
      const values={};
      for(const s of specs){
        values[JSON.stringify(s)]=rawComponentForSpec(line,a,cfg,s,base);
      }
      controls.push(values);
    }

    observations.push({
      date:target.date,
      targetValues,
      controls
    });

    if((i-start)%6===0)await new Promise(r=>setTimeout(r,0));
  }

  return {specs,observations};
}

function variantWindowPerformance(windowData,spec){
  const id=JSON.stringify(spec);
  const pcts=windowData.observations.map(o=>
    midRankPct(o.targetValues[id],o.controls.map(c=>c[id]))
  );
  return {
    mean:mean(pcts),
    lift:mean(pcts)-50,
    ci:meanCI95(pcts.map(x=>x-50)),
    positive:pcts.filter(x=>x>50).length,
    n:pcts.length
  };
}

function selectBestVariantPerFactor(windowDataList){
  const specs=candidateVariantSpecs();
  const factors=["historical","recent","overdue","pairStrength","structure"];
  const selected={};
  const detail={};

  for(const factor of factors){
    const candidates=specs.filter(s=>s.factor===factor);
    let best=null;

    for(const spec of candidates){
      const perWindow=windowDataList.map(w=>variantWindowPerformance(w,spec));
      const lifts=perWindow.map(x=>x.lift);
      const avg=mean(lifts);
      const sd=Math.sqrt(mean(lifts.map(x=>(x-avg)**2)))||0;
      const positiveWindows=lifts.filter(x=>x>0).length;
      const worst=Math.min(...lifts);

      // Development objective deliberately balances average lift and stability.
      const objective=avg-.28*sd+.08*worst+.20*positiveWindows;

      const row={spec,perWindow,avg,sd,positiveWindows,worst,objective};
      if(!best || row.objective>best.objective)best=row;
    }

    selected[factor]=best.spec;
    detail[factor]=best;
  }

  return {selected,detail};
}

function allFactorSubsets(){
  const factors=["historical","recent","overdue","pairStrength","structure"];
  const out=[];
  for(let mask=1;mask<(1<<factors.length);mask++){
    const arr=[];
    for(let i=0;i<factors.length;i++)if(mask&(1<<i))arr.push(factors[i]);
    out.push(arr);
  }
  return out;
}

function termsForSubset(subset,variantSelection,variantDetail){
  const raw=subset.map(f=>{
    const reliability=Math.max(.10,variantDetail[f].avg+2);
    return {...variantSelection[f],weight:reliability};
  });
  const total=raw.reduce((s,t)=>s+t.weight,0)||1;
  return raw.map(t=>({...t,weight:t.weight/total}));
}

function scoreObservationWithTerms(obs,terms){
  const target=terms.reduce((s,t)=>
    s+(obs.targetValues[JSON.stringify({...t,weight:undefined})]??50)*t.weight,0
  );

  const controls=obs.controls.map(c=>
    terms.reduce((s,t)=>
      s+(c[JSON.stringify({...t,weight:undefined})]??50)*t.weight,0
    )
  );
  return midRankPct(target,controls);
}

function specKeyWithoutWeight(t){
  const x={factor:t.factor,direction:t.direction};
  if(t.horizon)x.horizon=t.horizon;
  return JSON.stringify(x);
}

function scoreObservationWithTermsSafe(obs,terms){
  const target=terms.reduce((s,t)=>
    s+(obs.targetValues[specKeyWithoutWeight(t)]??50)*t.weight,0
  );
  const controls=obs.controls.map(c=>
    terms.reduce((s,t)=>s+(c[specKeyWithoutWeight(t)]??50)*t.weight,0)
  );
  return midRankPct(target,controls);
}

function evaluateModelOnWindow(windowData,terms){
  const pcts=windowData.observations.map(o=>scoreObservationWithTermsSafe(o,terms));
  const lifts=pcts.map(x=>x-50);
  return {
    mean:mean(pcts),
    lift:mean(lifts),
    ci:meanCI95(lifts),
    n:pcts.length
  };
}

function searchDevelopmentModels(windowDataList,selection){
  const rows=[];

  for(const subset of allFactorSubsets()){
    const terms=termsForSubset(subset,selection.selected,selection.detail);
    const perWindow=windowDataList.map(w=>evaluateModelOnWindow(w,terms));
    const lifts=perWindow.map(x=>x.lift);
    const avg=mean(lifts);
    const sd=Math.sqrt(mean(lifts.map(x=>(x-avg)**2)))||0;
    const positiveWindows=lifts.filter(x=>x>0).length;
    const worst=Math.min(...lifts);

    // Model-complexity penalty keeps development search conservative.
    const complexityPenalty=Math.max(0,subset.length-2)*.20;
    const objective=avg-.32*sd+.10*worst+.28*positiveWindows-complexityPenalty;

    rows.push({
      subset,terms,perWindow,avg,sd,positiveWindows,worst,
      objective
    });
  }

  rows.sort((a,b)=>b.objective-a.objective);
  return rows;
}

function compareModelToNeutral(windowData,terms){
  const pcts=windowData.observations.map(o=>scoreObservationWithTermsSafe(o,terms));
  const lifts=pcts.map(x=>x-50);
  return {
    mean:mean(pcts),
    lift:mean(lifts),
    ci:meanCI95(lifts),
    n:pcts.length,
    values:pcts
  };
}

function championTermsFromModel(model){
  return model?.status==="validated" && model?.terms?.length ? model.terms : [];
}

function compareChallengerToChampion(windowData,challengerTerms,championTerms){
  const challenger=windowData.observations.map(o=>scoreObservationWithTermsSafe(o,challengerTerms));
  const champion=championTerms?.length
    ? windowData.observations.map(o=>scoreObservationWithTermsSafe(o,championTerms))
    : Array(challenger.length).fill(50);

  const diff=challenger.map((x,i)=>x-champion[i]);
  return {
    challengerMean:mean(challenger),
    championMean:mean(champion),
    diff:mean(diff),
    ci:meanCI95(diff),
    n:diff.length
  };
}



function playerMonthNumber(name){
  const map={jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",
             jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12"};
  return map[String(name).slice(0,3).toLowerCase()]||"01";
}

function escapeRegExp(s){
  return String(s).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
}

function extractPlayerTierCount(block,label,gameKey){
  const re=new RegExp(`\\b${escapeRegExp(label)}\\b(?!\\s*\\+)`,"i");
  const m=re.exec(block);
  if(!m)return null;

  const after=block.slice(m.index+m[0].length,m.index+m[0].length+550);
  const cut=after.search(/\n\s*Match\s+\d|\n\s*Totals\b/i);
  const seg=(cut>=0?after.slice(0,cut):after);

  if(gameKey==="euromillions"){
    const uk=seg.match(/UK\s+Winners\s*[:|]?\s*([\d,]+)/i);
    if(uk)return Number(uk[1].replace(/,/g,""));
    const beforeCurrency=seg.split("£")[0];
    const vals=(beforeCurrency.match(/\b[\d,]+\b/g)||[])
      .map(x=>Number(x.replace(/,/g,"")))
      .filter(Number.isFinite);
    return vals.length?vals[0]:null;
  }

  const total=seg.match(/Total\s+Winners\s*[:|]?\s*([\d,]+)/i);
  if(total)return Number(total[1].replace(/,/g,""));

  const pre=seg.split(/Prize\s+Per\s+Winner|£|Free\s+Ticket/i)[0];
  const vals=(pre.match(/\b[\d,]+\b/g)||[])
    .map(x=>Number(x.replace(/,/g,"")))
    .filter(Number.isFinite);
  return vals.length?Math.max(...vals):null;
}

function parsePlayerEvidenceHtml(html,gameKey){
  try{
    const cfg=GAMES[gameKey];
    const doc=new DOMParser().parseFromString(html,"text/html");
    const text=(doc.body?.innerText||"")
      .replace(/\u00a0/g," ")
      .replace(/\r/g,"");

    const dateRe=/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?\s*,?\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/gi;
    const matches=[...text.matchAll(dateRe)];
    const out=[];

    for(let i=0;i<matches.length;i++){
      const m=matches[i];
      const start=m.index+m[0].length;
      const end=i+1<matches.length?matches[i+1].index:text.length;
      const block=text.slice(start,end);

      const headEnd=block.search(/Show\s+details|Match\s*\|/i);
      const head=(headEnd>=0?block.slice(0,headEnd):block.slice(0,350));
      const vals=(head.match(/\b\d{1,2}\b/g)||[])
        .map(Number)
        .filter(n=>n>=1 && n<=Math.max(cfg.max,cfg.starMax));

      if(vals.length<cfg.picks+cfg.stars)continue;

      const numbers=vals.slice(0,cfg.picks).filter(n=>n<=cfg.max).sort((a,b)=>a-b);
      const stars=cfg.stars?vals.slice(cfg.picks,cfg.picks+cfg.stars).filter(n=>n<=cfg.starMax).sort((a,b)=>a-b):[];
      if(numbers.length!==cfg.picks || new Set(numbers).size!==cfg.picks)continue;
      if(cfg.stars && (stars.length!==cfg.stars || new Set(stars).size!==cfg.stars))continue;

      const date=`${m[4]}-${playerMonthNumber(m[3])}-${String(Number(m[2])).padStart(2,"0")}`;
      const tiers={
        match2:extractPlayerTierCount(block,"Match 2",gameKey),
        match3:extractPlayerTierCount(block,"Match 3",gameKey),
        match4:extractPlayerTierCount(block,"Match 4",gameKey),
        match5:extractPlayerTierCount(block,"Match 5",gameKey)
      };

      if(!Number.isFinite(tiers.match2)||!Number.isFinite(tiers.match3))continue;
      out.push({date,numbers,stars,tiers,source:"UK Lottery Stats"});
    }

    return out;
  }catch{
    return [];
  }
}

async function refreshPlayerEvidence(){
  const status=$("#playerEvidenceStatus");
  const url=PLAYER_EVIDENCE_URLS[activeGame];
  if(!url)return;

  status.textContent="Refreshing recent prize-winner evidence…";

  let parsed=[];
  for(const candidate of [corsProxy(url),url]){
    try{
      const r=await fetchWithTimeout(candidate,9000);
      if(!r.ok)continue;
      parsed=parsePlayerEvidenceHtml(await r.text(),activeGame);
      if(parsed.length)break;
    }catch{}
  }

  if(!parsed.length){
    status.textContent="Could not refresh Player evidence right now. Existing cached evidence is unchanged; CSV import is available in Settings.";
    renderPlayerModelPanel();
    return;
  }

  const merged=savePlayerEvidence([...getPlayerEvidence(),...parsed]);
  status.textContent=`Player evidence refreshed: ${parsed.length} rows read, ${merged.length} unique rows cached.`;
  renderPlayerModelPanel();
  renderPlayerModelStatus();
}

function playerEvidencePressure(row){
  const t=row.tiers||{};
  const m2=Number(t.match2),m3=Number(t.match3),m4=Number(t.match4),m5=Number(t.match5);
  if(!(m2>0)||!(m3>=0))return null;

  // Winner-count ratios reduce sales-volume sensitivity. This is a proxy
  // for selection clustering, not a direct measurement of ticket popularity.
  const r3=Math.log((m3+10)/(m2+1000));
  const r4=Number.isFinite(m4)?Math.log((m4+1)/(m3+20)):0;
  const r5=Number.isFinite(m5)&&Number.isFinite(m4)?Math.log((m5+.5)/(m4+2)):0;
  return .70*r3+.22*r4+.08*r5;
}

function solveLinearSystem(A,b){
  const n=A.length;
  const M=A.map((row,i)=>[...row,b[i]]);

  for(let col=0;col<n;col++){
    let pivot=col;
    for(let r=col+1;r<n;r++)if(Math.abs(M[r][col])>Math.abs(M[pivot][col]))pivot=r;
    [M[col],M[pivot]]=[M[pivot],M[col]];

    const div=M[col][col];
    if(Math.abs(div)<1e-10)return null;
    for(let c=col;c<=n;c++)M[col][c]/=div;

    for(let r=0;r<n;r++){
      if(r===col)continue;
      const factor=M[r][col];
      for(let c=col;c<=n;c++)M[r][c]-=factor*M[col][c];
    }
  }
  return M.map(r=>r[n]);
}

function fitPlayerRidge(rows,lambda=2.5){
  const cfg=GAMES[activeGame];
  const clean=rows.map(r=>({
    row:r,
    x:playerFeatureVector(r.numbers,cfg),
    y:playerEvidencePressure(r)
  })).filter(o=>Number.isFinite(o.y));

  if(clean.length<25)return null;

  const means=PLAYER_FEATURE_KEYS.map(k=>mean(clean.map(o=>o.x[k])));
  const sds=PLAYER_FEATURE_KEYS.map((k,j)=>{
    const vals=clean.map(o=>o.x[k]);
    const m=means[j];
    return Math.sqrt(mean(vals.map(v=>(v-m)**2)))||1;
  });

  const yMean=mean(clean.map(o=>o.y));
  const ySd=Math.sqrt(mean(clean.map(o=>(o.y-yMean)**2)))||1;
  const Z=clean.map(o=>[
    1,
    ...PLAYER_FEATURE_KEYS.map((k,j)=>(o.x[k]-means[j])/sds[j])
  ]);
  const y=clean.map(o=>(o.y-yMean)/ySd);

  const p=Z[0].length;
  const A=Array.from({length:p},()=>Array(p).fill(0));
  const b=Array(p).fill(0);

  for(let i=0;i<Z.length;i++){
    for(let r=0;r<p;r++){
      b[r]+=Z[i][r]*y[i];
      for(let c=0;c<p;c++)A[r][c]+=Z[i][r]*Z[i][c];
    }
  }
  for(let j=1;j<p;j++)A[j][j]+=lambda;

  const beta=solveLinearSystem(A,b);
  if(!beta)return null;

  const preds=Z.map(z=>z.reduce((s,v,j)=>s+v*beta[j],0));
  return {
    coefficients:beta,
    featureMean:means,
    featureSd:sds,
    outcomeMean:yMean,
    outcomeSd:ySd,
    predictionMean:mean(preds),
    predictionSd:Math.sqrt(mean(preds.map(v=>(v-mean(preds))**2)))||1,
    n:clean.length
  };
}

function predictPlayerRidge(row,fit){
  const cfg=GAMES[activeGame];
  const x=playerFeatureVector(row.numbers,cfg);
  let pred=fit.coefficients[0]||0;
  for(let j=0;j<PLAYER_FEATURE_KEYS.length;j++){
    pred+=(fit.coefficients[j+1]||0)*
      ((x[PLAYER_FEATURE_KEYS[j]]-fit.featureMean[j])/(fit.featureSd[j]||1));
  }
  return pred;
}

function playerPermutationP(preds,actual,perms=600){
  const observed=correlation(preds,actual);
  const rng=seededRng(hashSeed(`${activeGame}|player-permutation|${actual.length}|${actual.join("|")}`));
  let extreme=0;

  for(let p=0;p<perms;p++){
    const shuffled=[...actual];
    for(let i=shuffled.length-1;i>0;i--){
      const j=Math.floor(rng()*(i+1));
      [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
    }
    if(correlation(preds,shuffled)>=observed)extreme++;
  }
  return {observed,p:(extreme+1)/(perms+1)};
}

function playerValidationState(){
  const evidence=getPlayerEvidence()
    .filter(r=>normaliseDateValue(r.date))
    .sort((a,b)=>normaliseDateValue(a.date).localeCompare(normaliseDateValue(b.date)));
  const last=lastPlayerValidationRun();
  if(!last){
    return {
      first:true,
      ready:evidence.length>=PLAYER_MIN_FIRST_VALIDATION,
      evidence,
      fresh:[],
      required:PLAYER_MIN_FIRST_VALIDATION
    };
  }
  const cutoff=normaliseDateValue(last.cutoffDate);
  const fresh=evidence.filter(r=>normaliseDateValue(r.date)>cutoff);
  return {
    first:false,
    ready:fresh.length>=PLAYER_MIN_FRESH_VALIDATION,
    evidence,
    fresh,
    cutoff,
    required:PLAYER_MIN_FRESH_VALIDATION
  };
}

async function runPlayerValidation(){
  const status=$("#playerEvidenceStatus");
  const result=$("#playerModelResults");
  const state=playerValidationState();

  if(state.evidence.length<PLAYER_MIN_FIRST_VALIDATION){
    status.textContent=`Player validation NOT RUN: ${state.evidence.length}/${PLAYER_MIN_FIRST_VALIDATION} evidence rows are cached. The first chronological holdout is preserved until the full production threshold is reached.`;
    renderPlayerModelPanel();
    return;
  }

  if(!state.first && !state.ready){
    status.textContent=`Player validation locked: ${state.fresh.length}/${state.required} genuinely new evidence rows exist after ${state.cutoff}.`;
    renderPlayerModelPanel();
    return;
  }

  status.textContent="Running chronological Player Model validation…";
  await new Promise(r=>setTimeout(r,0));

  let train=[],test=[];
  if(state.first){
    const split=Math.max(25,Math.floor(state.evidence.length*.70));
    train=state.evidence.slice(0,split);
    test=state.evidence.slice(split);
  }else{
    train=state.evidence.filter(r=>normaliseDateValue(r.date)<=state.cutoff);
    test=state.fresh;
  }

  const fit=fitPlayerRidge(train);
  if(!fit || test.length<12){
    status.textContent="Player validation NOT RUN: insufficient usable training/test observations after parsing.";
    return;
  }

  const testClean=test.map(r=>({
    row:r,
    y:playerEvidencePressure(r)
  })).filter(o=>Number.isFinite(o.y));

  const preds=testClean.map(o=>predictPlayerRidge(o.row,fit));
  const actual=testClean.map(o=>(o.y-fit.outcomeMean)/(fit.outcomeSd||1));
  const perm=playerPermutationP(preds,actual,600);

  const enoughForValidation=
    state.evidence.length>=PLAYER_MIN_FIRST_VALIDATION &&
    testClean.length>=24;

  const passed=
    enoughForValidation &&
    perm.observed>=.18 &&
    perm.p<=.05;

  const old=getPlayerModel();
  const cutoffDate=normaliseDateValue(test.at(-1)?.date||state.evidence.at(-1)?.date);

  const candidate={
    schema:1,
    status:passed?"validated":"prior",
    coefficients:passed?fit.coefficients:null,
    featureMean:passed?fit.featureMean:null,
    featureSd:passed?fit.featureSd:null,
    predictionMean:passed?fit.predictionMean:0,
    predictionSd:passed?fit.predictionSd:1,
    validatedAt:new Date().toISOString(),
    cutoffDate,
    evidenceCount:state.evidence.length,
    trainCount:train.length,
    holdoutCount:testClean.length,
    holdoutCorrelation:perm.observed,
    holdoutP:perm.p,
    sources:"winner-count ratio proxy"
  };

  // A failed challenger does not erase an already validated Player Model.
  if(passed || old.status!=="validated")savePlayerModel(candidate);

  recordPlayerValidationRun({
    at:new Date().toISOString(),
    cutoffDate,
    evidenceCount:state.evidence.length,
    trainCount:train.length,
    testCount:testClean.length,
    correlation:perm.observed,
    p:perm.p,
    passed
  });

  const coefRows=PLAYER_FEATURE_KEYS.map((k,j)=>({
    key:k,
    beta:fit.coefficients[j+1]||0
  })).sort((a,b)=>Math.abs(b.beta)-Math.abs(a.beta));

  const labels={
    birthdayShare:"Birthday-range share",
    lowNumberBias:"Lower-number preference",
    lucky7:"Contains 7",
    unlucky13:"Contains 13",
    consecutive:"Consecutive numbers",
    sameLast:"Repeated last digit",
    arithmeticPattern:"Arithmetic pattern",
    allBirthday:"All numbers ≤31"
  };

  result.innerHTML=`
    <div class="validation-decision ${passed?"decision-pass":"decision-neutral"}">
      <b>${passed?"Player Model validated":"Player Model not yet validated"}</b>
      <p>
        Holdout correlation between predicted popularity pressure and later winner-count pressure:
        ${perm.observed.toFixed(3)} · one-sided permutation p=${perm.p.toFixed(3)}.
        ${enoughForValidation?"":"This run is exploratory because the evidence set is still below the production threshold."}
      </p>
    </div>

    <div class="bt-grid">
      <div class="bt-card"><b>${state.evidence.length}</b><small>evidence rows</small></div>
      <div class="bt-card"><b>${train.length}</b><small>training rows</small></div>
      <div class="bt-card"><b>${testClean.length}</b><small>later holdout rows</small></div>
      <div class="bt-card"><b>${perm.observed.toFixed(3)}</b><small>holdout correlation</small></div>
      <div class="bt-card"><b>${perm.p.toFixed(3)}</b><small>permutation p-value</small></div>
      <div class="bt-card"><b>${passed?"empirical":"prior"}</b><small>production Player Model</small></div>
    </div>

    <div class="settings-card">
      <b>Learned feature directions — research output</b>
      <p class="selection-bias-note">
        Coefficients are fitted on the training period. Only the later holdout correlation above is evidential.
      </p>
      <table class="bt-table">
        <tr><th>Feature</th><th>Coefficient</th><th>Interpretation</th></tr>
        ${coefRows.map(x=>`
          <tr>
            <td>${labels[x.key]}</td>
            <td>${formatSigned(x.beta,3)}</td>
            <td>${x.beta>0?"more winner pressure / more popular":"less winner pressure / less popular"}</td>
          </tr>`).join("")}
      </table>
    </div>

    <div class="settings-card private-evidence-card">
      <b>What is being tested</b>
      <p class="muted">
        Prize-tier winner counts are converted into ratios such as Match 3 / Match 2 to reduce the effect of changing ticket sales.
        The model asks whether human-choice features of the winning line predict unusually high or low numbers of winners.
      </p>
      <p class="muted">
        This is an indirect proxy for player selection popularity, not direct ticket-level choice data.
      </p>
    </div>
  `;

  status.textContent="Player Model validation complete.";
  renderPlayerModelPanel();
  renderPlayerModelStatus();
  renderProductionStatus();
}

function renderPlayerModelStatus(){
  const m=getPlayerModel();
  const evidence=getPlayerEvidence();
  const last=lastPlayerValidationRun();

  const status=m.status==="validated"
    ? `Validated empirical Player Model · holdout r=${Number(m.holdoutCorrelation||0).toFixed(3)}, p=${Number(m.holdoutP||1).toFixed(3)}`
    : `Literature-backed prior · local empirical validation not established`;

  const el=$("#playerModelStatus");
  if(el){
    el.textContent=`${status}. ${evidence.length} prize-breakdown evidence rows cached.${last?` Last production-style Player test ended ${last.cutoffDate}.`:""}`;
  }
}

function renderPlayerModelPanel(){
  const el=$("#playerModelPanel");
  if(!el)return;

  const m=getPlayerModel();
  const evidence=getPlayerEvidence();
  const state=playerValidationState();

  const ready=state.first
    ? `${evidence.length}/${PLAYER_MIN_FIRST_VALIDATION} rows toward full production validation`
    : `${state.fresh.length}/${PLAYER_MIN_FRESH_VALIDATION} fresh rows toward next validation`;

  el.innerHTML=`
    <div class="player-head">
      <div>
        <span class="label">PLAYER EDGE</span>
        <h3>${m.status==="validated"?"Empirical model active":"Literature prior active"}</h3>
      </div>
      <span class="pill">${m.status==="validated"?"VALIDATED":"PRIOR"}</span>
    </div>
    <p class="muted">
      Estimates how commonly other players may choose a combination. It does not change draw probability;
      the objective is to reduce potential prize sharing.
    </p>
    <div class="player-metrics">
      <div><b>${evidence.length}</b><small>evidence rows</small></div>
      <div><b>${m.status==="validated"?Number(m.holdoutCorrelation||0).toFixed(2):"—"}</b><small>holdout r</small></div>
      <div><b>${m.status==="validated"?Number(m.holdoutP||1).toFixed(3):"—"}</b><small>p-value</small></div>
    </div>
    <div class="player-readiness">${ready}</div>
  `;
}

function splitCsvRow(line){
  const out=[];let cur="",q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;
    }else if(ch===","&&!q){out.push(cur.trim());cur="";}else cur+=ch;
  }
  out.push(cur.trim());return out;
}

function parsePlayerEvidenceCsv(text,gameKey){
  const cfg=GAMES[gameKey];
  const lines=String(text||"").replace(/\r/g,"").split("\n").filter(x=>x.trim());
  if(lines.length<2)return[];

  const headers=splitCsvRow(lines[0]).map(h=>h.toLowerCase().replace(/[_-]/g," ").trim());
  const find=aliases=>headers.findIndex(h=>aliases.includes(h));
  const nIdx=[];
  for(let i=1;i<=cfg.picks;i++)nIdx.push(find([`n${i}`,`ball ${i}`,`ball${i}`,`number ${i}`,`number${i}`]));
  const sIdx=[];
  for(let i=1;i<=cfg.stars;i++)sIdx.push(find([`s${i}`,`star ${i}`,`star${i}`,`lucky star ${i}`,`luckystar${i}`]));

  const dateIdx=find(["date","draw date","drawdate"]);
  const m2Idx=find(["match2","match 2","match 2 ukwinners","match 2 uk winners"]);
  const m3Idx=find(["match3","match 3","match 3 ukwinners","match 3 uk winners"]);
  const m4Idx=find(["match4","match 4","match 4 ukwinners","match 4 uk winners"]);
  const m5Idx=find(["match5","match 5","match 5 ukwinners","match 5 uk winners"]);

  if(dateIdx<0 || nIdx.some(i=>i<0) || m2Idx<0 || m3Idx<0)return[];

  const out=[];
  for(let r=1;r<lines.length;r++){
    const v=splitCsvRow(lines[r]);
    const numbers=nIdx.map(i=>Number(v[i])).sort((a,b)=>a-b);
    const stars=sIdx.map(i=>Number(v[i])).filter(Number.isFinite).sort((a,b)=>a-b);

    if(numbers.some(n=>!Number.isInteger(n)||n<1||n>cfg.max) || new Set(numbers).size!==cfg.picks)continue;
    if(cfg.stars && (stars.length!==cfg.stars || new Set(stars).size!==cfg.stars))continue;

    const num=i=>{
      if(i<0)return null;
      const x=Number(String(v[i]||"").replace(/[£,\s]/g,""));
      return Number.isFinite(x)?x:null;
    };

    const tiers={match2:num(m2Idx),match3:num(m3Idx),match4:num(m4Idx),match5:num(m5Idx)};
    if(!Number.isFinite(tiers.match2)||!Number.isFinite(tiers.match3))continue;

    out.push({date:v[dateIdx],numbers,stars,tiers,source:"CSV import"});
  }
  return out;
}

async function importPlayerEvidenceCsv(){
  const f=$("#playerCsvInput")?.files?.[0];
  const status=$("#playerImportStatus");
  if(!f){
    status.textContent="Choose a Player evidence CSV first.";
    return;
  }
  const rows=parsePlayerEvidenceCsv(await f.text(),activeGame);
  if(!rows.length){
    status.textContent="No compatible evidence rows found. Required: date, ball columns, Match 2 winners and Match 3 winners.";
    return;
  }
  const merged=savePlayerEvidence([...getPlayerEvidence(),...rows]);
  status.textContent=`Imported ${rows.length} evidence rows · ${merged.length} unique rows cached.`;
  renderPlayerModelPanel();
  renderPlayerModelStatus();
}
function renderHoldoutSafetyStatus(){
  const el=$("#holdoutSafetyStatus");
  if(!el)return;

  const state=productionArenaState();

  if(state.firstRun){
    el.className="holdout-safety holdout-fresh";
    el.innerHTML=`
      <b>Private production arena has not been consumed</b>
      <span>The first production search will choose its challenger using older development data only, then spend the newest ${MIN_FRESH_PRODUCTION_DRAWS} draws once as the final arena.</span>`;
    return;
  }

  if(state.ready){
    el.className="holdout-safety holdout-fresh";
    el.innerHTML=`
      <b>Fresh production arena ready</b>
      <span>${state.freshCount} genuinely new draws exist after the previous production cutoff (${state.cutoff}). All of them are unseen by the production challenger search.</span>`;
  }else{
    el.className="holdout-safety holdout-used";
    el.innerHTML=`
      <b>Production arena locked</b>
      <span>${state.freshCount}/${state.required} genuinely new draws have accumulated after the previous cutoff (${state.cutoff}). Advanced development/research can continue, but a new production claim is not allowed yet.</span>`;
  }
}

function renderProductionStatus(){
  const el=$("#productionStatus");
  if(!el)return;
  const m=getValidatedModel();
  const cls=m.status==="validated"?"status-good":m.status==="neutral"?"status-warn":"status-neutral";
  el.className=`production-status ${cls}`;
  const drawStatus=m.status==="validated"
    ? `validated · ${(m.terms||[]).map(termLabel).join(" + ")}`
    : m.status==="neutral"
      ? "no predictive edge established"
      : "not validated";

  el.innerHTML=`
    <b>${m.status==="validated"?"Validated Edge active":m.status==="neutral"?"Portfolio Edge active":"Validated Edge not yet tested"}</b>
    <span><strong>Draw Model:</strong> ${drawStatus}</span>
    <span><strong>Player Model:</strong> ${getPlayerModel().status==="validated"?"validated empirical popularity model":"literature-backed prior; local validation pending"}</span>
    <span><strong>Portfolio Optimiser:</strong> active</span>
    <span>${validatedStatusText()}</span>`;
}

async function runFullValidationSuite(){
  if(draws.length<850){
    $("#backtestStatus").textContent="v21.2 model search needs at least 850 historical draws.";
    return;
  }

  const state=productionArenaState();

  if(!state.firstRun && !state.ready){
    $("#backtestStatus").textContent=
      `Production validation NOT RUN: only ${state.freshCount}/${state.required} genuinely new draws exist after the last production cutoff (${state.cutoff}). The private arena remains locked.`;
    renderHoldoutSafetyStatus();
    return;
  }

  const btn=$("#runFullValidation");
  btn.disabled=true;
  $("#backtestResults").innerHTML="";

  const chron=[...draws].sort((a,b)=>
    normaliseDateValue(a.date).localeCompare(normaliseDateValue(b.date))
  );

  let devChron=[];
  let arenaChron=[];

  if(state.firstRun){
    // First production claim: newest 150 draws are completely untouched.
    arenaChron=chron.slice(-MIN_FRESH_PRODUCTION_DRAWS);
    devChron=chron.slice(0,-MIN_FRESH_PRODUCTION_DRAWS);
  }else{
    // Subsequent production claims: every arena draw must be genuinely newer
    // than the previous production cutoff. No overlap is allowed.
    const cutoff=state.cutoff;
    devChron=chron.filter(d=>normaliseDateValue(d.date)<=cutoff);
    arenaChron=chron.filter(d=>normaliseDateValue(d.date)>cutoff);
  }

  const minHistory=300;
  const windowCount=6;
  const windowSize=Math.min(75,Math.floor((devChron.length-minHistory)/windowCount));

  if(windowSize<45){
    $("#backtestStatus").textContent="Insufficient development history for six search windows.";
    btn.disabled=false;
    return;
  }

  const devWindows=[];
  for(let w=windowCount-1;w>=0;w--){
    const start=devChron.length-(w+1)*windowSize;
    devWindows.push({start,end:start+windowSize});
  }

  // ---------------------------------------------------------
  // STEP 1 — SEARCH ONLY. Selection-biased by design.
  // ---------------------------------------------------------
  const devData=[];
  for(let w=0;w<devWindows.length;w++){
    $("#backtestStatus").textContent=
      `v21.2 step 1/4 · development search window ${w+1}/${devWindows.length}…`;
    devData.push(await buildWindowObservations(
      devChron,devWindows[w].start,devWindows[w].end,45,`v21-2-dev-${w}`
    ));
  }

  const variantSelection=selectBestVariantPerFactor(devData);

  // ---------------------------------------------------------
  // STEP 2 — search all 31 subsets. Still search, not evidence.
  // ---------------------------------------------------------
  $("#backtestStatus").textContent=
    "v21.2 step 2/4 · searching all 31 factor combinations (development only)…";
  const modelSearch=searchDevelopmentModels(devData,variantSelection);
  const challenger=modelSearch[0];

  // ---------------------------------------------------------
  // STEP 3 — ONE genuinely private final arena.
  // ---------------------------------------------------------
  $("#backtestStatus").textContent=
    `v21.2 step 3/4 · final private arena (${arenaChron.length} unseen draws)…`;

  // Build observations using a combined chronological stream so each arena
  // target can use prior arena draws exactly as live walk-forward operation would.
  const combinedChron=[...devChron,...arenaChron];
  const arenaStart=devChron.length;
  const arenaData=await buildWindowObservations(
    combinedChron,arenaStart,combinedChron.length,90,"v21-2-private-arena"
  );

  const arenaNeutral=compareModelToNeutral(arenaData,challenger.terms);

  const oldChampion=getValidatedModel();
  const oldChampionTerms=championTermsFromModel(oldChampion);
  const arenaVsChampion=compareChallengerToChampion(
    arenaData,challenger.terms,oldChampionTerms
  );

  // This is the only production evidential gate.
  const arenaPass=
    arenaNeutral.n>=MIN_FRESH_PRODUCTION_DRAWS &&
    arenaNeutral.mean>50.5 &&
    arenaNeutral.ci.lo>0;

  // If a validated champion exists, replacement requires the challenger to
  // beat it with its own paired CI above zero on the same genuinely fresh arena.
  const challengerBeatsChampion=!oldChampionTerms.length || (
    arenaVsChampion.n>=MIN_FRESH_PRODUCTION_DRAWS &&
    arenaVsChampion.diff>0 &&
    arenaVsChampion.ci.lo>0
  );

  const productionPass=arenaPass && challengerBeatsChampion;

  // ---------------------------------------------------------
  // STEP 4 — secondary Stars + save production decision.
  // ---------------------------------------------------------
  $("#backtestStatus").textContent=
    "v21.2 step 4/4 · secondary Star test and production decision…";

  let starStatus="neutral";
  let starLift=null;

  if(activeGame==="euromillions"){
    const starEval=await evaluateValidationWindow(
      combinedChron,arenaStart,combinedChron.length,55,null,"v21-2-star-arena"
    );
    starLift=starEval.stars.lift;

    // Separate secondary claim: same strict lower-CI requirement.
    if(
      starEval.stars.n>=MIN_FRESH_PRODUCTION_DRAWS &&
      starEval.stars.mean>50.5 &&
      starEval.stars.ci.lo>0
    ){
      starStatus="validated";
    }
  }

  const selectedTerms=challenger.terms.map(t=>({...t}));

  const newModel={
    schema:21,
    status:productionPass?"validated":"neutral",
    terms:productionPass?selectedTerms:[],
    weights:emptyPredictiveWeights(),
    starStatus,
    starLift,
    validatedAt:new Date().toISOString(),
    datasetCount:draws.length,

    development:{
      windows:devWindows.length,
      windowSize,
      selectedSubset:challenger.subset,
      objective:challenger.objective,
      meanLift:challenger.avg,
      positiveWindows:challenger.positiveWindows,
      label:"selection-biased search output; not evidence"
    },

    arena:{
      mean:arenaNeutral.mean,
      ci:arenaNeutral.ci,
      n:arenaNeutral.n,
      pass:arenaPass,
      firstDate:normaliseDateValue(arenaChron[0]?.date),
      lastDate:normaliseDateValue(arenaChron.at(-1)?.date)
    },

    championDecision:{
      previousStatus:oldChampion.status||"none",
      challengerBeatsChampion,
      comparison:arenaVsChampion
    },

    portfolioBaseline:"diversified"
  };

  // A failed challenger never replaces an already validated champion.
  if(!productionPass && oldChampion.schema===21 && oldChampion.status==="validated" && oldChampion.terms?.length){
    saveValidatedModel(oldChampion);
  }else{
    saveValidatedModel(newModel);
  }

  // The entire final arena has now been consumed. Future production claims
  // require 150 draws strictly newer than this cutoff date.
  const cutoffDate=normaliseDateValue(arenaChron.at(-1)?.date);
  recordProductionRun({
    productionPass,
    arenaMean:arenaNeutral.mean,
    arenaCI:arenaNeutral.ci,
    challenger:selectedTerms.map(termLabel),
    challengerVsChampion:arenaVsChampion.diff
  },cutoffDate,arenaChron.length);

  // Neutral production deliberately defaults to broad diversification.
  if(!productionPass){
    localStorage.setItem(`lottoEdgeCalibratedConcentration:${activeGame}`,"diversified");
    saveConcentrationMode("auto");
  }

  const factorRows=Object.entries(variantSelection.detail).map(([factor,d])=>`
    <tr>
      <td>${MODEL_FACTOR_LABELS[factor]}</td>
      <td>${termLabel(d.spec)}</td>
      <td>${formatSigned(d.avg,2)} pts</td>
      <td>${d.positiveWindows}/${devWindows.length}</td>
    </tr>
  `).join("");

  const topModels=modelSearch.slice(0,5).map((m,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${m.terms.map(termLabel).join(" + ")}</td>
      <td>${formatSigned(m.avg,2)} pts</td>
      <td>${m.positiveWindows}/${devWindows.length}</td>
      <td>${m.objective.toFixed(2)}</td>
    </tr>
  `).join("");

  const finalSaved=getValidatedModel();

  const decision=productionPass
    ? `Challenger promoted: ${selectedTerms.map(termLabel).join(" + ")}.`
    : (oldChampion.schema===21 && oldChampion.status==="validated" && oldChampion.terms?.length
        ? "Challenger failed the fresh private arena; previous validated champion retained."
        : "Challenger failed the fresh private arena. Portfolio Edge remains production mode.");

  $("#backtestStatus").textContent="v21.2 model search complete.";

  $("#backtestResults").innerHTML=`
    <div class="validation-decision ${productionPass?"decision-pass":"decision-neutral"}">
      <b>${productionPass?"New predictive champion promoted":"No new predictive champion"}</b>
      <p>${decision}</p>
    </div>

    <div class="search-warning">
      <b>Development search output — NOT evidence</b>
      <span>
        Normal/inverse direction, four horizons and 31 subsets are deliberately searched for the best-looking development result.
        Positive development lift is expected from selection. Only the private arena below can support a production claim.
      </span>
    </div>

    <div class="bt-grid">
      <div class="bt-card"><b>31</b><small>subsets searched</small></div>
      <div class="bt-card"><b>22</b><small>direction/horizon variants searched</small></div>
      <div class="bt-card"><b>${devWindows.length}</b><small>development search windows</small></div>
      <div class="bt-card"><b>${arenaNeutral.n}</b><small>genuinely fresh arena draws</small></div>
      <div class="bt-card"><b>${arenaNeutral.mean.toFixed(1)}th</b><small>private arena percentile</small></div>
      <div class="bt-card"><b>${formatSigned(arenaNeutral.ci.lo,1)}</b><small>arena CI lower bound</small></div>
      <div class="bt-card"><b>${formatSigned(arenaVsChampion.diff,1)}</b><small>challenger vs champion</small></div>
      <div class="bt-card"><b>${finalSaved.status}</b><small>production status</small></div>
    </div>

    <div class="settings-card search-only-card">
      <b>Search-selected signal variants</b>
      <p class="selection-bias-note">
        These values are selection-biased by construction and must not be interpreted as independent findings.
      </p>
      <table class="bt-table">
        <tr><th>Factor</th><th>Selected search variant</th><th>Dev lift</th><th>Positive windows</th></tr>
        ${factorRows}
      </table>
    </div>

    <div class="settings-card search-only-card">
      <b>Top development search candidates</b>
      <p class="selection-bias-note">
        Ranking is useful only to freeze a challenger before the private arena. It is not evidence of predictability.
      </p>
      <table class="bt-table">
        <tr><th>#</th><th>Model</th><th>Dev lift</th><th>Positive windows</th><th>Search score</th></tr>
        ${topModels}
      </table>
    </div>

    <div class="settings-card private-evidence-card">
      <b>Private production evidence</b>
      <p class="muted">
        Arena dates: ${normaliseDateValue(arenaChron[0]?.date)} → ${cutoffDate}.
        None of these ${arenaNeutral.n} draws were available to the challenger search.
      </p>
      <p class="muted">
        Challenger vs neutral:
        ${arenaNeutral.mean.toFixed(2)}th percentile ·
        95% lift CI ${formatCI(arenaNeutral.ci,2)} ·
        ${arenaPass?"PRODUCTION PASS":"FAIL"}.
      </p>
      <p class="muted">
        Challenger vs current champion:
        ${formatSigned(arenaVsChampion.diff,2)} percentile points ·
        95% paired CI ${formatCI(arenaVsChampion.ci,2)} ·
        ${oldChampionTerms.length?(challengerBeatsChampion?"replacement criterion passed":"replacement criterion failed"):"no existing champion"}.
      </p>
      <p class="ci-note">
        This arena is now spent. The next production validation is locked until at least
        ${MIN_FRESH_PRODUCTION_DRAWS} draws dated after ${cutoffDate} have accumulated.
      </p>
    </div>
  `;

  renderProductionStatus();
  renderValidatedModelStatus();
  renderHoldoutSafetyStatus();
  btn.disabled=false;
}


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

function renderWeightStatus(){
  const el=$("#weightStatus");
  if(!el)return;
  const w=getModelWeights();
  el.textContent=`Research weights — history ${Math.round(w.historical*100)}%, recent ${Math.round(w.recent*100)}%, overdue ${Math.round(w.overdue*100)}%, pairs ${Math.round(w.pairStrength*100)}%, structure ${Math.round(w.structure*100)}%, low-sharing ${Math.round(w.sharing*100)}%.`;
}

function renderValidatedModelStatus(){
  const m=getValidatedModel();
  const el=$("#validatedModelStatus");
  if(el){
    const model=(m.terms||[]).length
      ? m.terms.map(termLabel).join(" + ")
      : "none";
    el.textContent=
      `${validatedStatusText()}. Production model: ${model}. `+
      `Portfolio baseline: ${m.portfolioBaseline||"not calibrated"}. `+
      `Dataset at last search: ${m.datasetCount||0} draws.`;
  }
  renderProductionStatus();
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
  renderValidatedModelStatus();
  renderPlayerModelStatus();
  renderPlayerModelPanel();
  renderHoldoutSafetyStatus();
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
$("#strategy").onchange=e=>{
  $("#strategyInfo").textContent=descriptions[e.target.value];
  renderProductionStatus();
};
$("#concentrationMode").value=getConcentrationMode();
$("#concentrationMode").onchange=e=>{
  saveConcentrationMode(e.target.value);
  renderConcentrationInfo();
};
renderConcentrationInfo();
renderValidatedModelStatus();
renderPlayerModelStatus();
renderPlayerModelPanel();
renderHoldoutSafetyStatus();
$("#minusLine").onclick=()=>{$("#lineCount").textContent=lineCount=Math.max(1,lineCount-1)};
$("#plusLine").onclick=()=>{$("#lineCount").textContent=lineCount=Math.min(10,lineCount+1)};
$("#generateBtn").onclick=generate;
$("#lottoGame").onclick=()=>switchGame("lotto");
$("#euroGame").onclick=()=>switchGame("euromillions");
$("#refreshBtn").onclick=refreshData;
$("#refreshPlayerEvidence").onclick=refreshPlayerEvidence;
$("#runPlayerValidation").onclick=runPlayerValidation;
$("#runFullValidation").onclick=runFullValidationSuite;
$("#runBacktest").onclick=runBacktest;
$("#calibrateModel").onclick=calibrateWeights;
$("#calibrateConcentration").onclick=calibrateConcentration;
$("#comparePortfolioModes").onclick=comparePortfolioModes;
$("#runAblation").onclick=runFactorAblation;
$("#importBtn").onclick=importCsv;
$("#playerImportBtn").onclick=importPlayerEvidenceCsv;
$("#clearHistory").onclick=()=>{localStorage.removeItem("lottoEdgeHistory");renderHistory()};

$$(".segmented button").forEach(b=>b.onclick=()=>{
  $$(".segmented button").forEach(x=>x.classList.remove("active"));b.classList.add("active");renderStats(b.dataset.stat);
});

$$(".bottom-nav button").forEach(b=>b.onclick=()=>{
  $$(".bottom-nav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");
  $$(".screen").forEach(x=>x.classList.remove("active"));$("#"+b.dataset.screen).classList.add("active");
  if(b.dataset.screen==="historyScreen")renderHistory();
  if(b.dataset.screen==="statsScreen")renderPlayerModelPanel();
  if(b.dataset.screen==="settingsScreen"){renderIntegrity();renderWeightStatus();renderValidatedModelStatus();renderPlayerModelStatus();renderConcentrationInfo();}
});

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("service-worker.js?version=22")
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
