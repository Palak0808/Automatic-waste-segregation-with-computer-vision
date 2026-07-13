'use strict';

// ── Config matching app.py exactly ──────────────────────────
const BIN_ANGLES = {
  'reject':        15,
  'metal waste':   45,
  'organic waste': 75,
  'plastic waste': 105,
  'paper waste':   135,
  'e-waste':       165,
};

const BIN_EMOJIS = {
  'plastic waste':'🧴','paper waste':'📄','metal waste':'🔩',
  'organic waste':'🍃','e-waste':'💡','reject':'🗑',
};

const CAT_MAP = {
  'plastic waste':'plastic','paper waste':'paper','metal waste':'metal',
  'organic waste':'organic','e-waste':'ewaste','reject':'reject',
};

const CLASS_COLORS = {
  'plastic waste':'#00ffe1','paper waste':'#00ff88','metal waste':'#00b4ff',
  'organic waste':'#64dd17','e-waste':'#c864ff','reject':'#ff3c3c',
};

const ARC_LEN = 266.9;

// ── State ────────────────────────────────────────────────────
let chart;
let lastClass   = null;
let simRunning  = false;
let binFills    = {};
let prevStep    = '';
let dialMkPos   = false;

// ── Standalone Browser Simulation Mode ──
let localSimMode = false;
let localStats = {
  'plastic waste': 0,
  'paper waste': 0,
  'metal waste': 0,
  'organic waste': 0,
  'E-waste': 0,
  'reject': 0
};
let localLogs = [];

// ════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════
window.onload = () => {
  initBgCanvas();
  initClock();
  initChart();
  positionDialMarkers();
  
  // Start polling/loops
  setInterval(pollStatus, 800);
  setInterval(pollIR, 500);
};

// ════════════════════════════════════════════════════════════
// BG CANVAS — hex grid + particles
// ════════════════════════════════════════════════════════════
function initBgCanvas() {
  const canvas = document.getElementById('bgCanvas');
  const ctx    = canvas.getContext('2d');
  let W, H, pts = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function drawHex() {
    const sz = 38;
    ctx.clearRect(0,0,W,H);
    ctx.strokeStyle = 'rgba(0,255,225,0.04)';
    ctx.lineWidth   = 0.8;
    const xS = sz * Math.sqrt(3), yS = sz * 1.5;
    for (let r = -1; r < H/yS+2; r++) {
      for (let c = -1; c < W/xS+2; c++) {
        const x = c*xS + (r%2 ? xS/2 : 0), y = r*yS;
        ctx.beginPath();
        for (let i=0;i<6;i++) {
          const a = Math.PI/180*(60*i-30);
          i===0 ? ctx.moveTo(x+sz*Math.cos(a),y+sz*Math.sin(a))
                : ctx.lineTo(x+sz*Math.cos(a),y+sz*Math.sin(a));
        }
        ctx.closePath(); ctx.stroke();
      }
    }
  }

  for (let i=0;i<25;i++) {
    pts.push({x:Math.random()*1920,y:Math.random()*1080,
      vy:-(0.2+Math.random()*0.4),sz:0.8+Math.random()*1.5,
      op:0.1+Math.random()*0.25,fd:Math.random()>0.5?0.002:-0.002});
  }

  function anim() {
    if (!W) return requestAnimationFrame(anim);
    ctx.clearRect(0,0,W,H); drawHex();
    pts.forEach(p => {
      p.y+=p.vy; p.op+=p.fd;
      if(p.y<0){p.y=H;p.x=Math.random()*W;}
      if(p.op<=0.05||p.op>=0.3) p.fd*=-1;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.sz,0,Math.PI*2);
      ctx.fillStyle=`rgba(0,255,225,${p.op})`; ctx.fill();
    });
    requestAnimationFrame(anim);
  }

  window.addEventListener('resize',resize);
  resize(); anim();
}

// ════════════════════════════════════════════════════════════
// CLOCK
// ════════════════════════════════════════════════════════════
function initClock() {
  const tick = () => {
    document.getElementById('clockTime').textContent =
      new Date().toLocaleTimeString('en-GB',{hour12:false});
  };
  tick(); setInterval(tick,1000);
}

// ════════════════════════════════════════════════════════════
// CHART
// ════════════════════════════════════════════════════════════
function initChart() {
  const ctx = document.getElementById('wasteChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Plastic','Paper','Metal','Organic','E-waste','Reject'],
      datasets: [{
        data: [0,0,0,0,0,0],
        backgroundColor: ['rgba(0,255,225,0.4)','rgba(0,255,136,0.4)','rgba(0,180,255,0.4)','rgba(100,221,23,0.4)','rgba(200,100,255,0.4)','rgba(255,60,60,0.4)'],
        borderColor:     ['#00ffe1','#00ff88','#00b4ff','#64dd17','#c864ff','#ff3c3c'],
        borderWidth:2, borderRadius:5, borderSkipped:false,
      }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{backgroundColor:'rgba(6,11,20,0.95)',borderColor:'rgba(0,255,225,0.3)',
          borderWidth:1,titleColor:'#00ffe1',bodyColor:'#00ff88',
          titleFont:{family:'Share Tech Mono',size:10},bodyFont:{family:'Share Tech Mono',size:11}}
      },
      scales:{
        x:{ticks:{color:'rgba(0,255,225,0.5)',font:{family:'Share Tech Mono',size:9}},
           grid:{color:'rgba(0,255,225,0.05)'},border:{color:'rgba(0,255,225,0.1)'}},
        y:{ticks:{color:'rgba(0,255,225,0.5)',font:{family:'Share Tech Mono',size:9},stepSize:1},
           grid:{color:'rgba(0,255,225,0.05)'},border:{color:'rgba(0,255,225,0.1)'},beginAtZero:true}
      }
    }
  });
}

// ════════════════════════════════════════════════════════════
// DIAL MARKER POSITIONS (0–180° range, offset from top)
// ════════════════════════════════════════════════════════════
function positionDialMarkers() {
  const r = 46; // radius for marker placement
  document.querySelectorAll('.dmk').forEach(mk => {
    const aStr = mk.style.getPropertyValue('--a') || '0deg';
    const deg  = parseFloat(aStr);
    const visual = deg - 90; // center at 90
    const rad    = visual * Math.PI / 180;
    mk.style.left = (50 + r * Math.sin(rad)) + 'px';
    mk.style.top  = (50 - r * Math.cos(rad)) + 'px';
  });
}

// ════════════════════════════════════════════════════════════
// POLL /status
// ════════════════════════════════════════════════════════════
async function pollStatus() {
  if (localSimMode) {
    // Run simulation loop updates
    return;
  }

  try {
    const res  = await fetch('/status');
    const data = await res.json();

    const cls  = (data.class || 'Waiting...').toLowerCase();
    const pct  = parseFloat(data.confidence) || 0;
    const step = data.step || 'IDLE';
    const busy = data.busy || false;

    // ── System online indicator ──
    document.getElementById('sysDot').style.background = '#00ff88';
    document.getElementById('sysText').textContent     = busy ? 'PROCESSING' : 'ONLINE';

    // ── Model tag ──
    document.getElementById('modelTag').textContent =
      (data.model && data.model !== 'DEMO') ? 'YOLO · RPi' : 'DEMO MODE';

    // ── Step badge ──
    const sb = document.getElementById('stepBadge');
    sb.textContent  = step;
    sb.className    = 'badge' + (busy ? ' badge-active' : '');

    // ── Scan sweep active during scanning ──
    const sw = document.getElementById('scanSweep');
    sw.classList.toggle('active', step === 'DETECTING');
    document.getElementById('camMode').textContent =
      step === 'DETECTING' ? 'SCANNING' : 'READY';

    // ── GPIO pin indicators ──
    document.getElementById('gval17').textContent = data.servo1_angle + '°';
    document.getElementById('gval27').textContent = data.servo2 || 'CLOSED';
    document.getElementById('gpin17').classList.toggle('active', busy);
    document.getElementById('gpin27').classList.toggle('active', data.servo2 === 'OPEN');

    // ── Detection result ──
    updateResult(cls, pct);

    // ── Chart ──
    updateChart(data.stats);
    updateBinLevels(data.stats);

    // ── HW Badge ──
    const hwb = document.getElementById('hwBadge');
    if (busy) {
      hwb.textContent = step; hwb.className = 'badge badge-active';
    } else {
      hwb.textContent = 'STANDBY'; hwb.className = 'badge badge-yellow';
    }

    // ── Sync servo UI to actual backend state ──
    syncServoUI(data);

    // ── Logs from backend ──
    if (data.log && data.log.length) {
      syncLogs(data.log);
    }

    // ── Trigger sim only on new class ──
    if (cls && cls !== 'waiting...' && pct > 0 && cls !== lastClass && !simRunning) {
      lastClass = cls;
      runServoSim(cls, pct);
    }

  } catch(e) {
    // Switch to local simulation mode automatically
    localSimMode = true;
    document.getElementById('sysDot').style.background = '#00ff88';
    document.getElementById('sysDot').classList.add('dot-blink');
    document.getElementById('sysText').textContent = 'ONLINE (SIM)';
    document.getElementById('modelTag').textContent = 'YOLO · SIM';
    uiLog('[ SYS ] Backend offline — switched to BROWSER SIMULATION mode', 'warn');
  }
}

// ════════════════════════════════════════════════════════════
// POLL IR SENSOR
// ════════════════════════════════════════════════════════════
async function pollIR() {
  if (localSimMode) return;

  try {
    const res  = await fetch('/ir_status');
    const data = await res.json();
    const det  = data.detected;

    const dot  = document.getElementById('irDot');
    const val  = document.getElementById('irVal');
    const box  = document.getElementById('irBox');
    const gv   = document.getElementById('gval22');

    dot.classList.toggle('active', det);
    val.textContent = det ? 'OBJECT DETECTED' : 'CLEAR';
    box.classList.toggle('triggered', det);
    gv.textContent  = det ? 'TRIGGERED' : 'CLEAR';
  } catch(e) {}
}

// ════════════════════════════════════════════════════════════
// SYNC SERVER STATE → UI (keeps UI in sync with real hardware)
// ════════════════════════════════════════════════════════════
function syncServoUI(data) {
  if (!simRunning) {
    const angle = data.servo1_angle || 0;
    setDialArm(angle);
    document.getElementById('s1Angle').textContent = angle + '°';

    const lidOpen = data.servo2 === 'OPEN';
    document.getElementById('lidWrap').classList.toggle('open', lidOpen);
    document.getElementById('s2Status').textContent = data.servo2 || 'CLOSED';

    document.getElementById('convState').textContent = data.conveyor || 'IDLE';
    document.getElementById('convBelt').classList.toggle('moving', data.conveyor === 'MOVING');
  }
}

// ════════════════════════════════════════════════════════════
// UPDATE RESULT UI
// ════════════════════════════════════════════════════════════
function updateResult(cls, pct) {
  const name = cls === 'waiting...' ? 'WAITING...'
             : cls.replace(' waste','').toUpperCase();

  document.getElementById('detectedClass').textContent = name;
  document.getElementById('resultIcon').textContent    = BIN_EMOJIS[cls] || '❓';
  document.getElementById('resultSub').textContent     =
    cls === 'waiting...'  ? 'Waiting for IR sensor to detect object'
    : cls === 'reject'    ? `Low confidence — routed to REJECT bin (15°)`
    : `Confidence ${pct}% — routing to ${cls} bin (${BIN_ANGLES[cls] || 0}°)`;

  // Confidence arc
  const offset = ARC_LEN - (pct/100)*ARC_LEN;
  document.getElementById('confArc').style.strokeDashoffset = offset;
  document.getElementById('confNum').textContent = pct > 0 ? pct : '--';

  // Pills
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  const key = CAT_MAP[cls];
  if (key) document.querySelector(`.pill[data-cat="${key}"]`)?.classList.add('active');

  // Alert
  const box = document.getElementById('alertBox');
  const ang  = BIN_ANGLES[cls] || 0;
  if (cls === 'waiting...') {
    box.className = 'alert-box';
    document.getElementById('alertIcon').textContent = 'ℹ';
    document.getElementById('alertText').textContent = 'System ready. IR sensor monitoring chute.';
  } else if (cls === 'reject') {
    box.className = 'alert-box warn';
    document.getElementById('alertIcon').textContent = '⚠';
    document.getElementById('alertText').textContent = `Low confidence — Servo 1 → 15° (REJECT)`;
  } else {
    box.className = 'alert-box ok';
    document.getElementById('alertIcon').textContent = '✓';
    document.getElementById('alertText').textContent = `${name} detected — Servo 1 → ${ang}°`;
  }

  // Result badge
  const rb = document.getElementById('resultBadge');
  rb.textContent = pct > 0 && cls !== 'waiting...' ? name : 'IDLE';
}

// ════════════════════════════════════════════════════════════
// CHART + BIN LEVELS
// ════════════════════════════════════════════════════════════
function updateChart(stats) {
  if (!chart) return;
  chart.data.datasets[0].data = [
    stats['plastic waste']||0, stats['paper waste']||0, stats['metal waste']||0,
    stats['organic waste']||0, stats['E-waste']||0,     stats['reject']||0,
  ];
  chart.update('none');
  const total = Object.values(stats).reduce((a,b)=>a+b,0);
  document.getElementById('totalBadge').textContent = total + ' ITEMS';
}

function updateBinLevels(stats) {
  const map = {
    'plastic waste':'plastic','paper waste':'paper','metal waste':'metal',
    'organic waste':'organic','E-waste':'ewaste','reject':'reject'
  };
  for (const [key,alias] of Object.entries(map)) {
    const v = stats[key]||0;
    document.getElementById(`bcnt-${alias}`).textContent = v;
    document.getElementById(`bbar-${alias}`).style.width = Math.min(100,(v/20)*100)+'%';
  }
}

// ════════════════════════════════════════════════════════════
// SERVO SIMULATION (visual, mirrors actual hardware)
// ════════════════════════════════════════════════════════════
function setDialArm(angleDeg) {
  const visual = angleDeg - 90;
  document.getElementById('dialArm').style.transform =
    `rotate(${visual}deg) translateY(-2px)`;

  // Highlight active marker
  document.querySelectorAll('.dmk').forEach(mk => mk.classList.remove('active'));
  const active = document.querySelector(`.dmk[id$="${angleDeg}"]`) ||
    [...document.querySelectorAll('.dmk')].find(m => {
      const a = parseFloat(m.style.getPropertyValue('--a'));
      return Math.abs(a - angleDeg) < 10;
    });
  if (active) active.classList.add('active');
}

async function runServoSim(cls, conf) {
  if (simRunning) return;
  simRunning = true;

  const isReject = cls === 'reject' || conf < 75;
  const target   = isReject ? 'reject' : cls;
  const angle    = BIN_ANGLES[target] ?? 15;
  const emoji    = BIN_EMOJIS[target] || '?';
  const label    = target.replace(' waste','').toUpperCase();

  ['hwS1','hwS2','hwConv'].forEach(id =>
    document.getElementById(id)?.classList.add('active'));

  uiLog(`[ DETECT ] ${label} · Conf: ${conf}% · Servo1 → ${angle}°`, 'info');

  // S1 rotate
  await wait(300);
  uiLog(`[ GPIO 17 ] PWM → duty ${angleToDuty(angle).toFixed(1)}% (${angle}°)`, 'ok');
  setDialArm(angle);
  document.getElementById('s1Angle').textContent = angle + '°';
  document.getElementById('gval17').textContent  = angle + '°';
  document.getElementById('gpin17').classList.add('active');

  // Chute flow
  animChute();
  await wait(1300);

  // Lid open
  uiLog(`[ GPIO 27 ] Lid opening → 90°`, 'ok');
  document.getElementById('lidWrap').classList.add('open');
  document.getElementById('s2Status').textContent = 'OPEN';
  document.getElementById('gval27').textContent   = 'OPEN';
  document.getElementById('gpin27').classList.add('active');
  document.getElementById('binEmoji').textContent = emoji;
  document.getElementById('binName').textContent  = label;

  await wait(900);

  // Conveyor
  uiLog(`[ CHUTE ] ${emoji} ${label} sliding to bin...`, 'info');
  document.getElementById('convState').textContent = 'MOVING';
  document.getElementById('convBelt').classList.add('moving');
  const ci = document.getElementById('convItem');
  ci.textContent = emoji; ci.style.opacity = '1';
  await wait(200);
  ci.classList.add('go');
  document.getElementById('convDest').textContent = `→ ${label} BIN`;

  await wait(1700);

  // Deposit
  uiLog(`[ DEPOSIT ] ✓ ${emoji} ${label} deposited into bin`, 'ok');
  const alias = CAT_MAP[target]||'reject';
  binFills[alias] = Math.min(100,(binFills[alias]||0)+14);
  document.getElementById('binFillVis').style.height = binFills[alias]+'%';

  if (isReject && cls !== 'reject') {
    uiLog(`[ WARN ] Low confidence (${conf}%) → reject bin (15°)`, 'warn');
  }

  await wait(500);

  // Close lid
  uiLog(`[ GPIO 27 ] Lid closing → 0°`, 'ok');
  document.getElementById('lidWrap').classList.remove('open');
  document.getElementById('s2Status').textContent = 'CLOSED';
  document.getElementById('gval27').textContent   = 'CLOSED';

  await wait(700);

  // Conveyor reset
  document.getElementById('convBelt').classList.remove('moving');
  ci.classList.remove('go');
  ci.style.opacity = '0.2';
  document.getElementById('convState').textContent = 'IDLE';
  document.getElementById('convDest').textContent  = '[ BIN ]';

  // Recalibrate
  uiLog(`[ IR ] Waiting for chute to clear...`, 'info');
  await wait(1000);
  uiLog(`[ RECAL ] Both servos → home position (0°)`, 'ok');
  setDialArm(0);
  document.getElementById('s1Angle').textContent = '0°';
  document.getElementById('gval17').textContent  = '0°';
  document.getElementById('gpin17').classList.remove('active');
  document.getElementById('gpin27').classList.remove('active');

  ['hwS1','hwS2','hwConv'].forEach(id =>
    document.getElementById(id)?.classList.remove('active'));

  uiLog(`[ SYS ] ✓ Cycle complete — ${label} sorted · System IDLE`, 'ok');
  document.getElementById('chuteLbl').textContent = 'IDLE';

  simRunning = false;
}

function angleToDuty(angle) {
  return 2.5 + (angle / 180) * 10;
}

function animChute() {
  const fill = document.getElementById('chuteFill');
  const lbl  = document.getElementById('chuteLbl');
  lbl.textContent = 'ROUTING';
  let w = 0;
  const iv = setInterval(() => {
    w += 2.5; fill.style.width = Math.min(w,100)+'%';
    if (w>=100) { clearInterval(iv); setTimeout(()=>fill.style.width='0%',500); }
  },30);
}

// ════════════════════════════════════════════════════════════
// BUTTONS
// ════════════════════════════════════════════════════════════
async function manualTrigger() {
  const btn = document.getElementById('detectBtn');
  btn.disabled = true;
  btn.classList.add('scanning');
  btn.textContent = '⟳ DETECTING...';

  setAlert('scanning','⟳','Manually triggered — running detection...');

  if (localSimMode) {
    // Run simulated detection locally
    document.getElementById('sysText').textContent = 'PROCESSING';
    document.getElementById('stepBadge').textContent = 'DETECTING';
    document.getElementById('stepBadge').className = 'badge badge-active';
    document.getElementById('scanSweep').classList.add('active');
    document.getElementById('camMode').textContent = 'SCANNING';
    document.getElementById('hwBadge').textContent = 'DETECTING';
    document.getElementById('hwBadge').className = 'badge badge-active';

    // Simulate IR Sensor trigger
    document.getElementById('irDot').classList.add('active');
    document.getElementById('irVal').textContent = 'OBJECT DETECTED';
    document.getElementById('irBox').classList.add('triggered');
    document.getElementById('gval22').textContent = 'TRIGGERED';

    setTimeout(() => {
      // Choose random waste category
      const categories = ['plastic waste', 'paper waste', 'metal waste', 'organic waste', 'e-waste', 'reject'];
      const selected = categories[Math.floor(Math.random() * categories.length)];
      const conf = Math.floor(Math.random() * 25) + 75; // 75-99%

      // Run local classification
      updateResult(selected, conf);
      localStats[selected]++;
      updateChart(localStats);
      updateBinLevels(localStats);
      
      // Stop scanning state
      btn.disabled = false;
      btn.classList.remove('scanning');
      btn.innerHTML = '▶ MANUAL TRIGGER <div class="btn-shine"></div>';

      document.getElementById('sysText').textContent = 'ONLINE (SIM)';
      document.getElementById('stepBadge').textContent = 'IDLE';
      document.getElementById('stepBadge').className = 'badge';
      document.getElementById('scanSweep').classList.remove('active');
      document.getElementById('camMode').textContent = 'READY';

      // Run the visual servo simulator
      runServoSim(selected, conf);

      // Clear IR
      setTimeout(() => {
        document.getElementById('irDot').classList.remove('active');
        document.getElementById('irVal').textContent = 'CLEAR';
        document.getElementById('irBox').classList.remove('triggered');
        document.getElementById('gval22').textContent = 'CLEAR';
      }, 5000);

    }, 2000);

  } else {
    try {
      await fetch('/detect', {method:'POST'});
    } catch(e) {}

    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('scanning');
      btn.innerHTML = '▶ MANUAL TRIGGER <div class="btn-shine"></div>';
    }, 2500);
  }
}

async function recalibrate() {
  uiLog('[ SYS ] Manual recalibration requested...', 'info');
  
  if (localSimMode) {
    setDialArm(0);
    document.getElementById('s1Angle').textContent = '0°';
    document.getElementById('lidWrap').classList.remove('open');
    document.getElementById('s2Status').textContent = 'CLOSED';
    document.getElementById('gval17').textContent = '0°';
    document.getElementById('gval27').textContent = 'CLOSED';
    uiLog('[ RECAL ] Both servos → 0° (home)', 'ok');
  } else {
    try {
      await fetch('/recalibrate', {method:'POST'});
      setDialArm(0);
      document.getElementById('s1Angle').textContent = '0°';
      document.getElementById('lidWrap').classList.remove('open');
      document.getElementById('s2Status').textContent = 'CLOSED';
      uiLog('[ RECAL ] Both servos → 0° (home)', 'ok');
    } catch(e) {
      uiLog('[ ERR ] Recalibrate failed — check server', 'warn');
    }
  }
}

function setAlert(type, icon, text) {
  const box = document.getElementById('alertBox');
  box.className = 'alert-box' + (type === 'ok' ? ' ok' : type === 'warn' ? ' warn' : type === 'scanning' ? ' scanning' : '');
  document.getElementById('alertIcon').textContent = icon;
  document.getElementById('alertText').textContent = text;
}

// ════════════════════════════════════════════════════════════
// LOG
// ════════════════════════════════════════════════════════════
const seenLogs = new Set();

function syncLogs(logs) {
  logs.forEach(entry => {
    const key = entry.t + entry.msg;
    if (!seenLogs.has(key)) {
      seenLogs.add(key);
      const lvl = entry.level || 'info';
      appendLog(`[${entry.t}]  ${entry.msg}`, lvl);
    }
  });
}

function uiLog(msg, type='sys') {
  const t = new Date().toLocaleTimeString('en-GB',{hour12:false});
  appendLog(`[${t}]  ${msg}`, type);
}

function appendLog(text, type) {
  const body = document.getElementById('logBody');
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = text;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
  while (body.children.length > 60) body.removeChild(body.firstChild);
}

function clearLog() {
  document.getElementById('logBody').innerHTML =
    '<div class="log-line sys">[ SYS ] Log cleared.</div>';
  seenLogs.clear();
}

// ════════════════════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════════════════════
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
