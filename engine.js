const FTMS = { service: 0x1826, indoorBike: 0x2ad2, controlPoint: 0x2ad9, status: 0x2ada };
const STORE = "athleticum-erg-demo-v1";
const defaultFtp = 250;
const presets = {
  vo2: {
    name: "6×3 @ 105% FTP",
    stimulus: "Держать 3 минуты чуть выше порога. Не разгонять первый повтор.",
    steps: [
      { kind: "warmup", min: 8, pct: 55 },
      { kind: "work", min: 3, pct: 105 }, { kind: "rest", min: 3, pct: 50 },
      { kind: "work", min: 3, pct: 105 }, { kind: "rest", min: 3, pct: 50 },
      { kind: "work", min: 3, pct: 105 }, { kind: "rest", min: 3, pct: 50 },
      { kind: "work", min: 3, pct: 105 }, { kind: "rest", min: 3, pct: 50 },
      { kind: "work", min: 3, pct: 105 }, { kind: "rest", min: 3, pct: 50 },
      { kind: "work", min: 3, pct: 105 },
      { kind: "cooldown", min: 8, pct: 45 }
    ]
  },
  tempo: {
    name: "2×12 темп @ 88%",
    stimulus: "Ровная мощность, каденс 85–95.",
    steps: [
      { kind: "warmup", min: 10, pct: 55 },
      { kind: "work", min: 12, pct: 88 }, { kind: "rest", min: 4, pct: 50 },
      { kind: "work", min: 12, pct: 88 },
      { kind: "cooldown", min: 8, pct: 45 }
    ]
  }
};
function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
function save(data) { localStorage.setItem(STORE, JSON.stringify(data)); }
const state = {
  view: "home", role: "self", ftp: defaultFtp, rpe: 5, corridor: 10, allowRpe: true,
  session: structuredClone(presets.vo2), running: false, paused: false, ergOn: true,
  trainer: "sim", deviceName: "", power: 0, cadence: 0, target: 0, stepIndex: 0,
  stepLeft: 0, tick: null, log: [], finished: null, ble: { device: null, control: null },
  safari: /safari/i.test(navigator.userAgent) && !/chrome|chromium|edg/i.test(navigator.userAgent),
  webBt: !!navigator.bluetooth
};
hydrate();
function hydrate() {
  const db = load();
  if (db.ftp) state.ftp = db.ftp;
  if (db.assigned) state.session = db.assigned;
  if (typeof db.allowRpe === "boolean") state.allowRpe = db.allowRpe;
  if (db.corridor) state.corridor = db.corridor;
}
function wattsOf(step) {
  const raw = Math.round(state.ftp * (step.pct / 100));
  if (!state.allowRpe || step.kind === "rest" || step.kind === "warmup" || step.kind === "cooldown") return raw;
  const delta = (state.rpe - 5) / 5;
  const shift = -delta * (state.corridor / 100);
  return Math.max(40, Math.round(raw * (1 + shift)));
}
function kindLabel(k) {
  return { warmup: "разминка", work: "работа", rest: "отдых", cooldown: "заминка" }[k] || k;
}
function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}
function render() {
  document.getElementById("app").innerHTML = '<div class="app"><div class="top"><div class="brand"><i></i> Атлетикум · демо станка</div><div class="tabs"><button class="tab ' + (state.view==="home"?"on":"") + '" data-go="home">Старт</button><button class="tab ' + (state.view==="coach"?"on":"") + '" data-go="coach">Кабинет тренера</button><button class="tab ' + (state.view==="ride"?"on":"") + '" data-go="ride">Кабинет атлета</button></div></div>' + (state.view==="home"?viewHome():"") + (state.view==="coach"?viewCoach():"") + (state.view==="ride"?viewRide():"") + '</div>';
  bind();
}
function viewHome() {
  return '<div class="hero"><h1>Сессия на станке: два режима, один плеер</h1><p class="muted">Тренер собирает отрезки. Атлет едет в приложении или в Chrome.</p><div class="row" style="margin-top:14px"><button class="btn primary" data-go="ride">Я тренируюсь сам</button><button class="btn" data-go="coach">Я тренер, соберу сессию</button></div></div><div class="grid two" style="margin-top:14px"><div class="card"><h2>Как открыть</h2><p class="muted">Симулятор — в любом браузере. Живой станок — Chrome / Edge, HTTPS или localhost. На айфоне в апке станок будет; в Safari — нет.</p><p class="' + (state.webBt && !state.safari ? "ok" : "warn") + '">' + (state.webBt && !state.safari ? "Web Bluetooth доступен." : "Web Bluetooth нет. Симулятор или Chrome на компьютере.") + '</p></div><div class="card"><h2>Что в сборке</h2><p class="muted">Конструктор → плеер ERG → шкала 1–10 → журнал по отрезкам. Без бэкенда.</p></div></div>';
}
function viewCoach() {
  const s = state.session;
  const rows = s.steps.map((st, i) => '<tr><td>' + kindLabel(st.kind) + '</td><td>' + st.min + ' мин</td><td>' + st.pct + '% · ' + Math.round(state.ftp * st.pct / 100) + ' Вт</td><td><button class="btn ghost" data-del="' + i + '">×</button></td></tr>').join("");
  return '<div class="grid two"><div class="card"><h2>Собрать сессию атлету</h2><div class="row"><label>FTP <input type="number" id="ftp" value="' + state.ftp + '" min="80" max="500"></label><label>Коридор % <input type="number" id="corridor" value="' + state.corridor + '" min="0" max="20"></label></div><div class="row" style="margin-top:10px"><label><input type="checkbox" id="allowRpe" ' + (state.allowRpe?"checked":"") + '> можно двигать шкалой 1–10</label></div><p class="muted">Стимул</p><textarea id="stimulus" rows="2" style="width:100%">' + (s.stimulus||"") + '</textarea><p class="muted">Название</p><input type="text" id="sname" value="' + s.name + '" style="width:100%"><div class="row" style="margin-top:10px"><select id="kind"><option value="warmup">разминка</option><option value="work">работа</option><option value="rest">отдых</option><option value="cooldown">заминка</option></select><input type="number" id="min" value="3" min="1" max="40" style="width:80px"> мин <input type="number" id="pct" value="95" min="30" max="150" style="width:80px"> %FTP <button class="btn" id="addStep">Добавить</button></div><div class="row" style="margin-top:10px"><button class="btn ghost" data-preset="vo2">6×3</button><button class="btn ghost" data-preset="tempo">темп</button></div><table style="margin-top:12px"><thead><tr><th>Тип</th><th>Время</th><th>Цель</th><th></th></tr></thead><tbody>' + rows + '</tbody></table><div class="row" style="margin-top:14px"><button class="btn primary" id="assign">Назначить атлету</button></div></div><div class="card"><h2>После заезда</h2>' + finishFromStore() + '</div></div>';
}
function viewRide() {
  const s = state.session;
  const step = s.steps[state.stepIndex] || s.steps[0];
  const planned = Math.round(state.ftp * step.pct / 100);
  const target = wattsOf(step);
  state.target = target;
  const total = s.steps.reduce((a, x) => a + x.min * 60, 0);
  const done = s.steps.slice(0, state.stepIndex).reduce((a, x) => a + x.min * 60, 0) + (step.min * 60 - state.stepLeft);
  const pctBar = state.running ? Math.min(100, Math.round(done / total * 100)) : 0;
  const steps = s.steps.map((st, i) => '<div class="step ' + (i===state.stepIndex && state.running ? "on" : "") + '"><div class="t">' + st.min + ' мин</div><div>' + kindLabel(st.kind) + ' · ' + st.pct + '%</div><span class="badge ' + st.kind + '">' + Math.round(state.ftp * st.pct / 100) + ' Вт</span></div>').join("");
  return '<div class="grid two"><div class="card"><h2>' + s.name + '</h2><p class="muted">' + (s.stimulus||"") + ' · ' + (state.role==="coached" || load().assignedByCoach ? "тренер + атлет" : "сам") + '</p><div class="metrics"><div class="metric"><span>Цель ERG</span><b>' + target + '</b></div><div class="metric"><span>Мощность</span><b>' + state.power + '</b></div><div class="metric"><span>Каденс</span><b>' + state.cadence + '</b></div><div class="metric"><span>Отрезок</span><b>' + (state.running ? fmt(state.stepLeft) : "—") + '</b></div></div><div class="bar" style="margin:12px 0 16px"><i style="width:' + pctBar + '%"></i></div><div class="row"><button class="btn primary" id="start" ' + (state.running?"disabled":"") + '>Старт</button><button class="btn" id="pause" ' + (state.running?"":"disabled") + '>' + (state.paused?"Дальше":"Пауза") + '</button><button class="btn danger" id="stop" ' + (state.running?"":"disabled") + '>Стоп</button><button class="btn" id="erg">' + (state.ergOn?"ERG вкл":"ERG выкл") + '</button><button class="btn" id="connect">' + (state.trainer==="ble" ? (state.deviceName||"Станок") : "Подключить станок") + '</button></div><p class="notice" style="margin-top:10px">Источник: ' + (state.trainer==="ble"?"FTMS":"симулятор") + '.</p>' + (state.allowRpe ? ('<div class="rpe"><div class="row"><b>Как ощущается: ' + state.rpe + '</b><span class="muted">план ' + planned + ' → ' + target + ' Вт</span></div><input type="range" id="rpe" min="1" max="10" value="' + state.rpe + '"><div class="rpe-scale"><span>легко</span><span>норма</span><span>тяжко</span></div></div>') : '<p class="warn">Тренер закрыл шкалу.</p>') + '</div><div class="card"><h2>Отрезки</h2><div class="steps">' + steps + '</div>' + (state.finished ? finishCard() : "") + '</div></div>';
}
function finishFromStore() {
  const f = state.finished || load().lastRide;
  if (!f) return '<p class="muted">Пока пусто. Пусть атлет проедет плеер — в этом же браузере.</p>';
  state.finished = f;
  return finishCard();
}
function finishCard() {
  const f = state.finished;
  if (!f) return "";
  const rows = f.reps.map((r, i) => '<tr><td>' + (i+1) + '</td><td>' + kindLabel(r.kind) + '</td><td>' + r.plan + '</td><td>' + r.avg + '</td><td>' + r.rpe + '</td></tr>').join("");
  return '<p>Факт · RPE ' + f.avgRpe + ' · ERG ' + (f.ergOff?"отключали":"весь заезд") + '</p><table><thead><tr><th>#</th><th>Тип</th><th>План</th><th>Факт</th><th>RPE</th></tr></thead><tbody>' + rows + '</tbody></table>';
}
