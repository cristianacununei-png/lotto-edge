
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const EURO_REMOTE =
  "https://raw.githubusercontent.com/daowa89/lottery-archive/main/eu/euromillions/results.csv";

const GAMES = {
  lotto: {
    name: "Lotto",
    label: "UK LOTTO · 6 / 59",
    max: 59,
    picks: 6,
    stars: 0,
    starMax: 0,
    storage: "lottoEdgeDraws",
    bundled: null
  },
  euromillions: {
    name: "EuroMillions",
    label: "EUROMILLIONS · 5 / 50 + 2 / 12",
    max: 50,
    picks: 5,
    stars: 2,
    starMax: 12,
    storage: "lottoEdgeEuroDraws",
    bundled: "euromillions_history.csv"
  }
};

const LOTTO_DEMO = [
  {date:"2026-08-15",numbers:[17,27,28,42,47,59],stars:[]},
  {date:"2026-08-12",numbers:[3,14,22,24,34,54],stars:[]},
  {date:"2026-08-08",numbers:[14,18,26,45,50,53],stars:[]},
  {date:"2026-08-05",numbers:[24,26,27,39,47,50],stars:[]},
  {date:"2026-08-01",numbers:[16,19,32,33,34,44],stars:[]}
];

const descriptions = {
  "Best Chance":"Multi-factor model: long-term frequency, recent form, overdue status, pair strength, historical structure and line diversification. This is an analytical ranking, not a higher mathematical lottery probability.",
  "Balanced":"Uses historically typical structure while avoiding overly human-looking combinations.",
  "Low sharing risk":"Avoids birthday-heavy, sequential and other common human-picking patterns.",
  "Hot numbers":"Favours numbers that have appeared more often historically.",
  "Overdue numbers":"Favours numbers that have gone longer since appearing.",
  "Pure random":"No historical weighting. A clean random baseline."
};

let activeGame = localStorage.getItem("lottoEdgeGame") || "lotto";
let lineCount = 5;
let draws = [];
let deferredPrompt = null;

function parseCsv(text, gameKey) {
  const cfg = GAMES[gameKey];
  const lines = text.replace(/\r/g,"").split("\n").filter(x => x.trim());
  if (lines.length < 2) return [];

  const parseLine = line => {
    const out=[]; let cur="", quoted=false;
    for (let i=0;i<line.length;i++) {
      const ch=line[i];
      if (ch === '"') {
        if (quoted && line[i+1] === '"') {cur+='"';i++;}
        else quoted=!quoted;
      } else if (ch === "," && !quoted) {
        out.push(cur.trim()); cur="";
      } else cur+=ch;
    }
    out.push(cur.trim());
    return out;
  };

  const headers=parseLine(lines[0]).map(h=>h.toLowerCase().replace(/[_-]/g," ").trim());
  const find = aliases => headers.findIndex(h=>aliases.includes(h));

  const numberIdx=[];
  for(let i=1;i<=cfg.picks;i++){
    numberIdx.push(find([`n${i}`,`ball ${i}`,`ball${i}`,`number ${i}`,`number${i}`]));
  }
  if(numberIdx.some(i=>i<0)) return [];

  const dateIdx=find(["date","draw date","drawdate"]);
  const starIdx=[];
  if(cfg.stars){
    for(let i=1;i<=cfg.stars;i++){
      starIdx.push(find([
        `s${i}`,`star ${i}`,`star${i}`,
        `lucky star ${i}`,`luckystar${i}`
      ]));
    }
  }

  const out=[];
  for(let r=1;r<lines.length;r++){
    const vals=parseLine(lines[r]);
    const nums=numberIdx.map(i=>Number(vals[i]));
    if(nums.length!==cfg.picks ||
       nums.some(n=>!Number.isInteger(n)||n<1||n>cfg.max) ||
       new Set(nums).size!==cfg.picks) continue;

    const stars=starIdx.map(i=>i>=0?Number(vals[i]):NaN)
      .filter(n=>Number.isInteger(n)&&n>=1&&n<=cfg.starMax);

    if(cfg.stars && stars.length!==cfg.stars) continue;

    out.push({
      date: dateIdx>=0 ? vals[dateIdx] : "",
      numbers: nums.sort((a,b)=>a-b),
      stars: stars.sort((a,b)=>a-b)
    });
  }
  return out;
}

function dedupeSort(items){
  const seen=new Set(), out=[];
  for(const d of items){
    const key=`${d.date||""}|${d.numbers.join(",")}|${(d.stars||[]).join(",")}`;
    if(seen.has(key)) continue;
    seen.add(key); out.push(d);
  }
  out.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  return out;
}

function saveGameDraws(gameKey, items){
  localStorage.setItem(GAMES[gameKey].storage, JSON.stringify(items));
}

function loadStored(gameKey){
  try{
    return JSON.parse(localStorage.getItem(GAMES[gameKey].storage)||"[]") || [];
  }catch{return []}
}

async function ensureGameData(gameKey){
  if(gameKey==="lotto"){
    let d=loadStored("lotto");
    if(!d.length){ d=LOTTO_DEMO; saveGameDraws("lotto",d); }
    return d;
  }

  let d=loadStored("euromillions");
  if(!d.length){
    try{
      const r=await fetch("euromillions_history.csv",{cache:"no-store"});
      if(r.ok){
        d=parseCsv(await r.text(),"euromillions");
        if(d.length) saveGameDraws("euromillions",d);
      }
    }catch{}
  }
  return d;
}

function makeCounts(){
  const cfg=GAMES[activeGame];
  const freq=Array(cfg.max+1).fill(0);
  const last=Array(cfg.max+1).fill(draws.length);
  const pairs={};
  const starFreq=Array((cfg.starMax||0)+1).fill(0);
  const starLast=Array((cfg.starMax||0)+1).fill(draws.length);

  draws.forEach((d,idx)=>{
    d.numbers.forEach(n=>{
      freq[n]++;
      if(last[n]===draws.length) last[n]=idx;
    });
    for(let i=0;i<d.numbers.length;i++){
      for(let j=i+1;j<d.numbers.length;j++){
        const k=`${d.numbers[i]}-${d.numbers[j]}`;
        pairs[k]=(pairs[k]||0)+1;
      }
    }
    (d.stars||[]).forEach(s=>{
      starFreq[s]++;
      if(starLast[s]===draws.length) starLast[s]=idx;
    });
  });

  return {freq,last,pairs,starFreq,starLast};
}

function mode(arr, fallback){
  const m={}; arr.forEach(n=>m[n]=(m[n]||0)+1);
  const sorted=Object.entries(m).sort((a,b)=>b[1]-a[1]);
  return sorted.length ? Number(sorted[0][0]) : fallback;
}

function analysis(){
  const cfg=GAMES[activeGame], c=makeCounts();
  const sums=draws.map(d=>d.numbers.reduce((a,b)=>a+b,0));
  const odds=draws.map(d=>d.numbers.filter(n=>n%2).length);
  const lows=draws.map(d=>d.numbers.filter(n=>n<=cfg.max/2).length);
  const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
  const sm=mean(sums);
  const sd=Math.sqrt(mean(sums.map(x=>(x-sm)**2)))||1;
  return {
    ...c,
    sumMean:sm,
    sumStd:sd,
    oddMode:mode(odds,Math.floor(cfg.picks/2)),
    lowMode:mode(lows,Math.floor(cfg.picks/2))
  };
}

function zScore(arr,n){
  const vals=arr.slice(1);
  if(!vals.length) return 0;
  const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
  const sd=Math.sqrt(vals.reduce((s,x)=>s+(x-mean)**2,0)/vals.length)||1;
  return (arr[n]-mean)/sd;
}

function sample(max,k){
  const pool=Array.from({length:max},(_,i)=>i+1), out=[];
  for(let i=0;i<k;i++){
    out.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
  }
  return out.sort((a,b)=>a-b);
}

function features(line){
  const cfg=GAMES[activeGame];
  const odd=line.filter(n=>n%2).length;
  const low=line.filter(n=>n<=cfg.max/2).length;
  const birthday=line.filter(n=>n<=31).length;
  let consecutive=0,sameLast=0;
  for(let i=0;i<line.length-1;i++) if(line[i+1]===line[i]+1) consecutive++;
  for(let i=0;i<line.length;i++)
    for(let j=i+1;j<line.length;j++)
      if(line[i]%10===line[j]%10) sameLast++;
  const diffs=line.slice(1).map((n,i)=>n-line[i]);
  const d={}; diffs.forEach(x=>d[x]=(d[x]||0)+1);
  const repeatedGap=Math.max(0,...Object.values(d));
  return {
    odd,low,birthday,consecutive,sameLast,repeatedGap,
    sum:line.reduce((a,b)=>a+b,0)
  };
}

function lowSharing(line){
  const f=features(line);
  let penalty=0;
  penalty+=Math.max(0,f.birthday-2)*10;
  penalty+=f.consecutive*12;
  penalty+=Math.max(0,f.sameLast-1)*4;
  penalty+=Math.max(0,f.repeatedGap-2)*7;
  return Math.max(0,Math.min(100,100-penalty));
}

function scoreLine(line,strategy,s){
  const f=features(line);
  let balance=100;
  balance-=Math.abs(f.odd-s.oddMode)*8;
  balance-=Math.abs(f.low-s.lowMode)*7;
  balance-=Math.min(30,Math.abs(f.sum-s.sumMean)/s.sumStd*10);
  balance-=f.consecutive*4;
  balance=Math.max(0,Math.min(100,balance));

  const sharing=lowSharing(line);
  const hot=line.reduce((a,n)=>a+zScore(s.freq,n),0)/line.length;
  const overdue=line.reduce((a,n)=>a+zScore(s.last,n),0)/line.length;

  // Recent-form signal from the most recent ~10% of the history, capped at 120 draws.
  const cfg=GAMES[activeGame];
  const recentN=Math.max(20,Math.min(120,Math.round(draws.length*.10)));
  const recentFreq=Array(cfg.max+1).fill(0);
  draws.slice(0,recentN).forEach(d=>d.numbers.forEach(n=>recentFreq[n]++));
  const recent=line.reduce((a,n)=>a+zScore(recentFreq,n),0)/line.length;

  // Pair strength: how often the pairs in this candidate occurred together historically.
  let pairTotal=0, pairCount=0;
  for(let i=0;i<line.length;i++){
    for(let j=i+1;j<line.length;j++){
      pairTotal += s.pairs[`${line[i]}-${line[j]}`] || 0;
      pairCount++;
    }
  }
  const pairAvg=pairCount ? pairTotal/pairCount : 0;
  const allPairVals=Object.values(s.pairs);
  const pairMean=allPairVals.length ? allPairVals.reduce((a,b)=>a+b,0)/allPairVals.length : 0;
  const pairSd=Math.sqrt(allPairVals.length ? allPairVals.reduce((a,x)=>a+(x-pairMean)**2,0)/allPairVals.length : 1) || 1;
  const pairZ=(pairAvg-pairMean)/pairSd;

  let score=50;
  if(strategy==="Balanced") score=.55*balance+.45*sharing;
  if(strategy==="Low sharing risk") score=.75*sharing+.25*balance;
  if(strategy==="Hot numbers") score=50+hot*14+sharing*.22+balance*.18;
  if(strategy==="Overdue numbers") score=50+overdue*14+sharing*.22+balance*.18;

  // "Best Chance" is deliberately multi-factor rather than a single hot/overdue heuristic.
  // Signals are compressed to 0..100 so one noisy factor cannot dominate.
  if(strategy==="Best Chance"){
    const norm = z => Math.max(0,Math.min(100,50+z*15));
    const historical=norm(hot);
    const recentScore=norm(recent);
    const overdueScore=norm(overdue);
    const pairScore=norm(pairZ);
    score =
      historical*.20 +
      recentScore*.20 +
      overdueScore*.12 +
      pairScore*.18 +
      balance*.22 +
      sharing*.08;
    return {
      score:Math.max(0,Math.min(100,score)),
      balance,sharing,sum:f.sum,
      historical,recent:recentScore,pairStrength:pairScore,overdueFit:overdueScore
    };
  }

  return {
    score:Math.max(0,Math.min(100,score)),
    balance,sharing,sum:f.sum
  };
}
function chooseStars(strategy,s){
  const cfg=GAMES[activeGame];
  if(!cfg.stars) return [];
  if(strategy==="Pure random" || !draws.length) return sample(cfg.starMax,cfg.stars);

  const ranked=[];
  for(let star=1;star<=cfg.starMax;star++){
    let value=0;
    if(strategy==="Hot numbers") value=zScore(s.starFreq,star);
    else if(strategy==="Overdue numbers") value=zScore(s.starLast,star);
    else if(strategy==="Best Chance") value=.45*zScore(s.starFreq,star)+.25*zScore(s.starLast,star)+Math.random()*.30;
    else value=.5*zScore(s.starFreq,star)+.2*zScore(s.starLast,star)+Math.random()*.3;
    ranked.push({star,value:value+Math.random()*.12});
  }
  ranked.sort((a,b)=>b.value-a.value);
  return ranked.slice(0,cfg.stars).map(x=>x.star).sort((a,b)=>a-b);
}

function generate(){
  const cfg=GAMES[activeGame];
  const strategy=$("#strategy").value;
  const s=analysis();
  const pool=[];

  if(strategy==="Pure random" || !draws.length){
    for(let i=0;i<lineCount;i++){
      pool.push({
        line:sample(cfg.max,cfg.picks),
        stars:chooseStars(strategy,s),
        detail:null
      });
    }
  } else {
    const seen=new Set();
    const trials=strategy==="Best Chance" ? Math.max(30000,lineCount*5000) : Math.max(7000,lineCount*1200);
    for(let i=0;i<trials;i++){
      const line=sample(cfg.max,cfg.picks), k=line.join(",");
      if(seen.has(k)) continue;
      seen.add(k);
      pool.push({
        line,
        stars:chooseStars(strategy,s),
        detail:scoreLine(line,strategy,s)
      });
    }
    pool.sort((a,b)=>b.detail.score-a.detail.score);

    const picked=[];
    for(const item of pool){
      if(picked.every(x=>item.line.filter(n=>x.line.includes(n)).length<=cfg.picks-2)){
        picked.push(item);
      }
      if(picked.length===lineCount) break;
    }
    pool.splice(0,pool.length,...picked);

    // Reduce repeated Lucky-Star pairs across a multi-line EuroMillions ticket.
    if(cfg.stars){
      const usedStarPairs=new Set();
      pool.forEach(item=>{
        let best=item.stars, tries=0;
        while(tries++<30){
          const candidate=chooseStars(strategy,s);
          const key=candidate.join("-");
          if(!usedStarPairs.has(key)){ best=candidate; break; }
        }
        item.stars=best;
        usedStarPairs.add(best.join("-"));
      });
    }
  }

  const stamp=new Date().toISOString();
  const saved=pool.map(x=>({...x,game:activeGame,strategy,created:stamp}));
  const old=JSON.parse(localStorage.getItem("lottoEdgeHistory")||"[]");
  localStorage.setItem("lottoEdgeHistory",JSON.stringify([...saved,...old].slice(0,100)));
  renderPicks(saved);
  navigator.vibrate?.(35);
}

function renderPicks(items){
  $("#results").innerHTML=items.map((x,i)=>`
    <div class="ticket">
      <div class="ticket-head">
        <strong>Line ${i+1}</strong>
        <span class="pill">${x.detail?`Score ${Math.round(x.detail.score)}/100`:"Random"}</span>
      </div>
      <div class="balls">${x.line.map(n=>`<span class="ball">${n}</span>`).join("")}</div>
      ${x.stars?.length?`
        <div class="ticket-meta" style="font-size:13px;margin-top:10px">
          <span><b>Lucky Stars</b> ⭐ ${x.stars.join(" &nbsp; ⭐ ")}</span>
        </div>`:""}
      <div class="ticket-meta">
        ${x.detail?
          `<span>Balance ${Math.round(x.detail.balance)}</span>
           <span>Low-sharing ${Math.round(x.detail.sharing)}</span>
           <span>Sum ${x.detail.sum}</span>
           ${x.strategy==="Best Chance" && x.detail.historical!==undefined ?
             `<span>History ${Math.round(x.detail.historical)}</span>
              <span>Recent ${Math.round(x.detail.recent)}</span>
              <span>Pairs ${Math.round(x.detail.pairStrength)}</span>
              <span>Overdue ${Math.round(x.detail.overdueFit)}</span>`:""}`:
          `<span>Pure random selection</span>`}
      </div>
    </div>`).join("");
}

function updateSummary(){
  const cfg=GAMES[activeGame], s=analysis();
  $("#drawCount").textContent=draws.length;
  if(!draws.length){
    $("#hotNumber").textContent="—";
    $("#overdueNumber").textContent="—";
    return;
  }
  let hot=1,due=1;
  for(let n=2;n<=cfg.max;n++){
    if(s.freq[n]>s.freq[hot]) hot=n;
    if(s.last[n]>s.last[due]) due=n;
  }
  $("#hotNumber").textContent=hot;
  $("#overdueNumber").textContent=due;
}

function renderStats(kind="hot"){
  const cfg=GAMES[activeGame], s=analysis(), target=$("#statList");
  if(!draws.length){
    target.innerHTML='<div class="empty">No historical data for this game yet.</div>';
    return;
  }
  let rows=[];
  if(kind==="pairs"){
    rows=Object.entries(s.pairs).sort((a,b)=>b[1]-a[1]).slice(0,20)
      .map(([k,v])=>({label:k.replace("-"," + "),v}));
  } else {
    for(let n=1;n<=cfg.max;n++){
      rows.push({label:n,v:kind==="hot"?s.freq[n]:s.last[n]});
    }
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

  if(activeGame==="euromillions" && kind!=="pairs"){
    const sf=[];
    for(let n=1;n<=cfg.starMax;n++){
      sf.push({n,v:kind==="hot"?s.starFreq[n]:s.starLast[n]});
    }
    sf.sort((a,b)=>b.v-a.v);
    target.innerHTML += `<h3 style="margin-top:22px">Lucky Stars</h3>`+
      sf.map(r=>`
        <div class="stat-row">
          <div class="numdot">⭐${r.n}</div>
          <div class="bar"><i style="width:${r.v/Math.max(...sf.map(x=>x.v),1)*100}%"></i></div>
          <div class="stat-value">${r.v}</div>
        </div>`).join("");
  }
}

function renderHistory(){
  const h=JSON.parse(localStorage.getItem("lottoEdgeHistory")||"[]");
  const el=$("#ticketHistory");
  if(!h.length){
    el.innerHTML='<div class="empty">Your generated lines will be saved here on this phone.</div>';
    return;
  }
  el.innerHTML=h.map(x=>`
    <div class="ticket">
      <div class="ticket-head">
        <strong>${GAMES[x.game]?.name||"Lotto"} · ${x.strategy}</strong>
        <span class="pill">${new Date(x.created).toLocaleDateString()}</span>
      </div>
      <div class="balls">${x.line.map(n=>`<span class="ball">${n}</span>`).join("")}</div>
      ${x.stars?.length?`<div class="ticket-meta"><b>Lucky Stars</b>&nbsp; ⭐ ${x.stars.join(" &nbsp; ⭐ ")}</div>`:""}
    </div>`).join("");
}

async function switchGame(gameKey){
  activeGame=gameKey;
  localStorage.setItem("lottoEdgeGame",gameKey);
  draws=await ensureGameData(gameKey);
  $("#gameLabel").textContent=GAMES[gameKey].label;
  $("#lottoGame").style.borderColor=gameKey==="lotto"?"#e8ff54":"";
  $("#euroGame").style.borderColor=gameKey==="euromillions"?"#e8ff54":"";
  $("#results").innerHTML="";
  updateSummary();
  renderStats("hot");
  updateSettingsText();
}

function updateSettingsText(){
  const info=$("#importStatus");
  if(activeGame==="euromillions"){
    info.textContent=`EuroMillions: ${draws.length} historical draws stored locally.`;
  } else {
    info.textContent=`Lotto: ${draws.length} draws stored locally.`;
  }
}

async function importSelectedCsv(){
  const file=$("#csvInput").files[0];
  if(!file){$("#importStatus").textContent="Choose a CSV file first.";return;}
  const imported=parseCsv(await file.text(),activeGame);
  if(!imported.length){
    $("#importStatus").textContent="No valid rows for the selected game were detected.";
    return;
  }
  draws=dedupeSort([...imported,...draws]);
  saveGameDraws(activeGame,draws);
  $("#importStatus").textContent=`Imported ${imported.length} rows. ${draws.length} draws stored locally.`;
  updateSummary(); renderStats("hot");
}

async function updateEuroFromInternet(manual=false){
  if(activeGame!=="euromillions") return;
  if(!navigator.onLine){
    if(manual) $("#updateStatus").textContent="Offline. Using EuroMillions history stored on this phone.";
    return;
  }
  try{
    if(manual) $("#updateStatus").textContent="Checking EuroMillions history…";
    const r=await fetch(EURO_REMOTE,{cache:"no-store"});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const incoming=parseCsv(await r.text(),"euromillions");
    if(!incoming.length) throw new Error("No draw rows found");
    const before=draws.length;
    draws=dedupeSort([...incoming,...draws]);
    saveGameDraws("euromillions",draws);
    localStorage.setItem("lottoEdgeEuroLastUpdate",Date.now());
    updateSummary(); renderStats("hot");
    if(manual) $("#updateStatus").textContent=`EuroMillions updated: ${draws.length-before} new draws; ${draws.length} total.`;
  }catch(e){
    if(manual) $("#updateStatus").textContent="Update unavailable right now. The full stored history remains usable offline.";
  }
}

function autoUpdateEuro(){
  if(activeGame!=="euromillions" || !navigator.onLine) return;
  const last=Number(localStorage.getItem("lottoEdgeEuroLastUpdate")||0);
  if(Date.now()-last>12*60*60*1000) updateEuroFromInternet(false);
}

$("#strategy").addEventListener("change",e=>{
  $("#strategyInfo").textContent=descriptions[e.target.value];
});
$("#strategyInfo").textContent=descriptions[$("#strategy").value];

$("#minusLine").onclick=()=>{
  lineCount=Math.max(1,lineCount-1);
  $("#lineCount").textContent=lineCount;
};
$("#plusLine").onclick=()=>{
  lineCount=Math.min(10,lineCount+1);
  $("#lineCount").textContent=lineCount;
};
$("#generateBtn").onclick=generate;
$("#lottoGame").onclick=()=>switchGame("lotto");
$("#euroGame").onclick=()=>switchGame("euromillions");

$$(".bottom-nav button").forEach(b=>b.onclick=()=>{
  $$(".bottom-nav button").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  $$(".screen").forEach(x=>x.classList.remove("active"));
  $("#"+b.dataset.screen).classList.add("active");
  if(b.dataset.screen==="historyScreen") renderHistory();
  if(b.dataset.screen==="settingsScreen") updateSettingsText();
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

$("#importBtn").onclick=importSelectedCsv;

// Existing "Check updates" button from the base app.
$("#refreshBtn")?.addEventListener("click",()=>{
  if(activeGame==="euromillions") updateEuroFromInternet(true);
  else $("#updateStatus").textContent="Automatic update is currently enabled for EuroMillions. Lotto can still be updated by CSV import.";
});

// Hide/remove obsolete generic remote URL controls if present.
const urlBox=$("#updateUrl");
if(urlBox){
  const card=urlBox.closest(".settings-card");
  if(card) card.style.display="none";
}

if("serviceWorker" in navigator){
  navigator.serviceWorker.register("service-worker.js");
}

(async()=>{
  await switchGame(activeGame);
  renderHistory();
  autoUpdateEuro();
})();
