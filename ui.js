function bind() {
  document.querySelectorAll("[data-go]").forEach((el) => el.onclick = () => {
    state.view = el.dataset.go;
    if (state.view === "ride") {
      const db = load();
      if (db.assigned) {
        state.session = db.assigned;
        state.allowRpe = db.allowRpe;
        state.corridor = db.corridor;
        state.ftp = db.ftp || state.ftp;
        state.role = "coached";
      }
    }
    render();
  });
  const ftp = document.getElementById("ftp");
  if (ftp) ftp.onchange = () => { state.ftp = +ftp.value; render(); };
  const cor = document.getElementById("corridor");
  if (cor) cor.onchange = () => { state.corridor = +cor.value; };
  const allow = document.getElementById("allowRpe");
  if (allow) allow.onchange = () => { state.allowRpe = allow.checked; };
  const add = document.getElementById("addStep");
  if (add) add.onclick = () => {
    state.session.steps.push({
      kind: document.getElementById("kind").value,
      min: +document.getElementById("min").value,
      pct: +document.getElementById("pct").value,
    });
    render();
  };
  document.querySelectorAll("[data-del]").forEach((el) => el.onclick = () => {
    state.session.steps.splice(+el.dataset.del, 1);
    render();
  });
  document.querySelectorAll("[data-preset]").forEach((el) => el.onclick = () => {
    state.session = structuredClone(presets[el.dataset.preset]);
    render();
  });
  const assign = document.getElementById("assign");
  if (assign) assign.onclick = () => {
    state.session.name = document.getElementById("sname").value;
    state.session.stimulus = document.getElementById("stimulus").value;
    const db = load();
    db.assigned = state.session;
    db.assignedByCoach = true;
    db.allowRpe = state.allowRpe;
    db.corridor = state.corridor;
    db.ftp = state.ftp;
    save(db);
    alert("Сессия стоит у атлета. Откройте кабинет атлета — в этом же браузере.");
  };
  const rpe = document.getElementById("rpe");
  if (rpe) rpe.oninput = () => {
    state.rpe = +rpe.value;
    pushTarget();
    render();
  };
  const start = document.getElementById("start");
  if (start) start.onclick = startRide;
  const pause = document.getElementById("pause");
  if (pause) pause.onclick = () => { state.paused = !state.paused; render(); };
  const stop = document.getElementById("stop");
  if (stop) stop.onclick = () => finish(true);
  const erg = document.getElementById("erg");
  if (erg) erg.onclick = () => { state.ergOn = !state.ergOn; pushTarget(); render(); };
  const connect = document.getElementById("connect");
  if (connect) connect.onclick = connectTrainer;
}

async function connectTrainer() {
  if (!navigator.bluetooth) {
    alert("Web Bluetooth нет. Откройте Chrome на компьютере или оставайтесь на симуляторе.");
    return;
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS.service] }],
      optionalServices: [FTMS.service],
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(FTMS.service);
    const control = await service.getCharacteristic(FTMS.controlPoint);
    try {
      const bike = await service.getCharacteristic(FTMS.indoorBike);
      await bike.startNotifications();
      bike.addEventListener("characteristicvaluechanged", onBikeData);
    } catch (_) {}
    await control.writeValue(Uint8Array.of(0x00));
    await control.writeValue(Uint8Array.of(0x01));
    state.ble = { device, control };
    state.trainer = "ble";
    state.deviceName = device.name || "FTMS";
    pushTarget();
    render();
  } catch (err) {
    alert("Станок не взялся: " + err.message);
  }
}

function onBikeData(ev) {
  const v = ev.target.value;
  const flags = v.getUint16(0, true);
  let o = 2;
  if (flags & 0x01) o += 2;
  if (flags & 0x02) { state.cadence = Math.round(v.getUint16(o, true) / 2); o += 2; }
  if (flags & 0x04) o += 3;
  if (flags & 0x40) { state.power = v.getInt16(o, true); }
}

function pushTarget() {
  if (!state.ergOn) return;
  const step = state.session.steps[state.stepIndex];
  if (!step) return;
  const w = wattsOf(step);
  state.target = w;
  if (state.trainer === "ble" && state.ble.control) {
    const buf = new ArrayBuffer(3);
    const d = new DataView(buf);
    d.setUint8(0, 0x05);
    d.setInt16(1, w, true);
    state.ble.control.writeValue(buf).catch(() => {});
  }
}

function startRide() {
  state.running = true;
  state.paused = false;
  state.finished = null;
  state.log = [];
  state.stepIndex = 0;
  state.stepLeft = state.session.steps[0].min * 60;
  state.role = load().assignedByCoach ? "coached" : "self";
  pushTarget();
  if (state.tick) clearInterval(state.tick);
  state.tick = setInterval(tick, 1000);
  render();
}

function tick() {
  if (!state.running || state.paused) return;
  const step = state.session.steps[state.stepIndex];
  if (state.trainer === "sim") {
    const drift = Math.round((Math.random() - 0.5) * 8);
    state.power = Math.max(40, state.ergOn ? state.target + drift : Math.round(state.target * 0.85 + drift));
    state.cadence = 88 + Math.round((Math.random() - 0.5) * 6);
  }
  state.log.push({ i: state.stepIndex, kind: step.kind, plan: Math.round(state.ftp * step.pct / 100), watts: state.power, rpe: state.rpe });
  state.stepLeft -= 1;
  if (state.stepLeft <= 0) {
    state.stepIndex += 1;
    if (state.stepIndex >= state.session.steps.length) {
      finish(false);
      return;
    }
    state.stepLeft = state.session.steps[state.stepIndex].min * 60;
    pushTarget();
  }
  render();
}

function finish(manual) {
  state.running = false;
  state.paused = false;
  if (state.tick) clearInterval(state.tick);
  const groups = [];
  for (const row of state.log) {
    let g = groups[row.i];
    if (!g) {
      g = { kind: row.kind, plan: row.plan, watts: [], rpe: [] };
      groups[row.i] = g;
    }
    g.watts.push(row.watts);
    g.rpe.push(row.rpe);
  }
  const reps = groups.filter(Boolean).map((g) => ({
    kind: g.kind,
    plan: g.plan,
    avg: Math.round(g.watts.reduce((a, b) => a + b, 0) / g.watts.length),
    rpe: Math.round(g.rpe.reduce((a, b) => a + b, 0) / g.rpe.length),
  }));
  const avgRpe = reps.length ? Math.round(reps.reduce((a, b) => a + b.rpe, 0) / reps.length) : state.rpe;
  state.finished = { reps, avgRpe, ergOff: !state.ergOn, manual };
  const db = load();
  db.lastRide = state.finished;
  save(db);
  render();
}

render();
