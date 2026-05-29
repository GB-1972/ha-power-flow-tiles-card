const PFT_VERSION = '0.5.1';

console.info(
  `%c POWER-FLOW-TILES-CARD %c v${PFT_VERSION} `,
  'color: white; background: #0a84ff; font-weight: 700; padding: 2px 6px; border-radius: 4px 0 0 4px;',
  'color: #0a84ff; background: #111827; font-weight: 700; padding: 2px 6px; border-radius: 0 4px 4px 0;'
);

const DEFAULT_COLORS = {
  solar: '#f5a524',
  grid_import: '#ef4444',
  grid_export: '#fb923c',
  grid_idle: '#9ca3af',
  battery_charge: '#10b981',
  battery_discharge: '#3b82f6',
  battery_idle: '#9ca3af',
  battery2_charge: '#f59e0b',
  battery2_discharge: '#d946ef',
  home: '#a855f7',
  hub_accent: '#0a84ff',
};

const STAGE_VIEW = { w: 200, h: 120 };
const NODE_POS = {
  pv:      { x: 35,  y: 30 },
  grid:    { x: 165, y: 30 },
  battery: { x: 35,  y: 90 },
  home:    { x: 165, y: 90 },
  hub:     { x: 100, y: 60 },
};

function num(v) {
  if (v === null || v === undefined || v === '' || v === 'unknown' || v === 'unavailable') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function fmtPower(watts, opts = {}) {
  const decimals = opts.decimals ?? 2;
  const showSign = opts.signed === true;
  if (watts === null) return '–';
  const abs = Math.abs(watts);
  const sign = watts < 0 ? '−' : (showSign ? '+' : '');
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(decimals)} kW`;
  return `${sign}${abs.toFixed(0)} W`;
}

function fmtEnergy(kwh, decimals = 1) {
  if (kwh === null) return '–';
  return `${kwh.toFixed(decimals)} kWh`;
}

function fmtTemp(c, decimals = 1) {
  if (c === null) return '–';
  return `${c.toFixed(decimals)} °C`;
}

function fmtClock(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '–';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function svgPath(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const cx = from.x + dx * 0.55;
  const cy = from.y + dy * 0.45;
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}

class PowerFlowTilesCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._built = false;
    this._els = {};
  }

  static getStubConfig() {
    return {
      title: 'Energiemanagement',
      solar: { power: 'sensor.solar_power', mppts: [] },
      battery: { power: 'sensor.battery_power', soc: 'sensor.battery_soc', capacity_kwh: 10 },
      grid: { power: 'sensor.grid_power' },
      home: { power: 'sensor.home_power' },
    };
  }

  setConfig(config) {
    if (!config) throw new Error('Configuration missing');
    const c = JSON.parse(JSON.stringify(config));
    c.title = c.title ?? '';
    c.icon = c.icon ?? 'mdi:home-lightning-bolt-outline';
    c.environment = c.environment ?? {};
    c.solar = c.solar ?? {};
    c.solar.mppts = Array.isArray(c.solar.mppts) ? c.solar.mppts : [];
    c.solar.color = c.solar.color ?? DEFAULT_COLORS.solar;
    c.solar.show_sun_arc = c.solar.show_sun_arc !== false;
    c.solar.sun_entity = c.solar.sun_entity ?? 'sun.sun';
    c.battery = c.battery ?? {};
    c.battery.invert_power = c.battery.invert_power === true;
    c.battery.color = c.battery.color ?? DEFAULT_COLORS.battery_charge;
    c.battery.color_discharge = c.battery.color_discharge ?? DEFAULT_COLORS.battery_discharge;
    c.show_battery2 = c.show_battery2 === true;
    c.battery2 = (c.battery2 && typeof c.battery2 === 'object') ? c.battery2 : {};
    c.battery2.invert_power = c.battery2.invert_power === true;
    c.battery2.color = c.battery2.color ?? DEFAULT_COLORS.battery2_charge;
    c.battery2.color_discharge = c.battery2.color_discharge ?? DEFAULT_COLORS.battery2_discharge;
    c._hasBat2 = c.show_battery2 && !!(c.battery2.power || c.battery2.soc);
    c.grid = c.grid ?? {};
    c.grid.invert = c.grid.invert === true;
    c.grid.color_import = c.grid.color_import ?? c.grid.color ?? DEFAULT_COLORS.grid_import;
    c.grid.color_export = c.grid.color_export ?? DEFAULT_COLORS.grid_export;
    c.home = c.home ?? {};
    c.home.color = c.home.color ?? DEFAULT_COLORS.home;
    c.home.loads = Array.isArray(c.home.loads) ? c.home.loads : [];
    c.autarky = c.autarky ?? { mode: 'power' };
    c.decimals_power = c.decimals_power ?? 2;
    c.decimals_energy = c.decimals_energy ?? 1;
    c.flow_threshold = typeof c.flow_threshold === 'number' ? c.flow_threshold : 5;
    this._config = c;
    this._built = false;
    this._build();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    else this._refresh();
  }

  getCardSize() { return 6; }

  _getState(entityId) {
    if (!entityId || !this._hass) return null;
    return this._hass.states?.[entityId] ?? null;
  }

  _getNum(entityId) {
    const s = this._getState(entityId);
    return s ? num(s.state) : null;
  }

  _signedBattery(raw, cfg) {
    if (raw === null) return null;
    const bat = cfg ?? this._config.battery;
    return bat.invert_power ? raw : -raw;
  }

  _signedGrid(raw) {
    if (raw === null) return null;
    return this._config.grid.invert ? -raw : raw;
  }

  _values() {
    const c = this._config;
    const solarP = this._getNum(c.solar.power);
    const solarE = this._getNum(c.solar.energy_today);
    const batP = this._signedBattery(this._getNum(c.battery.power), c.battery);
    const batSoc = this._getNum(c.battery.soc);
    const batChargeE = this._getNum(c.battery.charge_today);
    const batDischargeE = this._getNum(c.battery.discharge_today);
    const batP2 = c._hasBat2 ? this._signedBattery(this._getNum(c.battery2.power), c.battery2) : null;
    const batSoc2 = c._hasBat2 ? this._getNum(c.battery2.soc) : null;
    const batChargeE2 = c._hasBat2 ? this._getNum(c.battery2.charge_today) : null;
    const batDischargeE2 = c._hasBat2 ? this._getNum(c.battery2.discharge_today) : null;
    const gridP = this._signedGrid(this._getNum(c.grid.power));
    const gridImpE = this._getNum(c.grid.import_today);
    const gridExpE = this._getNum(c.grid.export_today);
    const homeP = this._getNum(c.home.power);
    const homeE = this._getNum(c.home.energy_today);
    const temp = this._getNum(c.environment.temperature);

    const mppts = c.solar.mppts.map((m) => ({
      name: m.name ?? '',
      power: this._getNum(m.power),
      max: typeof m.max === 'number' ? m.max : (typeof m.max_power === 'number' ? m.max_power : null),
      icon: m.icon ?? null,
    }));

    const loads = c.home.loads.map((l) => ({
      name: l.name ?? '',
      icon: l.icon ?? 'mdi:flash',
      power: this._getNum(l.power),
    }));

    let autarky = null;
    if (c.autarky.mode === 'energy' && homeE !== null && gridImpE !== null && homeE > 0) {
      autarky = Math.max(0, Math.min(100, ((homeE - gridImpE) / homeE) * 100));
    } else if (homeP !== null && gridP !== null && homeP > 0) {
      const fromGrid = Math.max(0, gridP);
      autarky = Math.max(0, Math.min(100, ((homeP - fromGrid) / homeP) * 100));
    }

    return {
      solarP, solarE,
      batP, batSoc, batChargeE, batDischargeE,
      batP2, batSoc2, batChargeE2, batDischargeE2,
      gridP, gridImpE, gridExpE,
      homeP, homeE, temp,
      mppts, loads, autarky,
    };
  }

  _build() {
    if (!this.shadowRoot || !this._config) return;
    this.shadowRoot.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = this._css();
    this.shadowRoot.appendChild(style);

    const card = document.createElement('ha-card');
    card.className = 'pft-card';

    card.appendChild(this._buildHeader());
    if (this._config.solar.show_sun_arc) {
      const arcEl = this._buildSolarArc();
      if (arcEl) card.appendChild(arcEl);
    }
    card.appendChild(this._buildStage());
    const mpptsEl = this._buildMppts();
    if (mpptsEl) card.appendChild(mpptsEl);
    const loadsEl = this._buildLoads();
    if (loadsEl) card.appendChild(loadsEl);

    this.shadowRoot.appendChild(card);
    this._built = true;
    this._refresh();
  }

  _buildHeader() {
    const h = document.createElement('div');
    h.className = 'pft-header';

    const left = document.createElement('div');
    left.className = 'pft-header-left';
    const ic = document.createElement('ha-icon');
    ic.setAttribute('icon', this._config.icon);
    ic.className = 'pft-header-icon';
    const t = document.createElement('span');
    t.className = 'pft-header-title';
    t.textContent = this._config.title || '';
    left.appendChild(ic);
    left.appendChild(t);

    const right = document.createElement('div');
    right.className = 'pft-header-right';

    if (this._config.environment.temperature) {
      const tempWrap = document.createElement('div');
      tempWrap.className = 'pft-chip';
      const tIc = document.createElement('ha-icon');
      tIc.setAttribute('icon', 'mdi:thermometer');
      const tVal = document.createElement('span');
      tVal.className = 'pft-temp-val';
      tempWrap.appendChild(tIc);
      tempWrap.appendChild(tVal);
      right.appendChild(tempWrap);
      this._els.tempVal = tVal;
    }

    const autWrap = document.createElement('div');
    autWrap.className = 'pft-chip pft-autarky';
    const autLbl = document.createElement('span');
    autLbl.textContent = 'Autarkie';
    autLbl.className = 'pft-chip-lbl';
    const autVal = document.createElement('span');
    autVal.className = 'pft-autarky-val';
    autWrap.appendChild(autLbl);
    autWrap.appendChild(autVal);
    right.appendChild(autWrap);
    this._els.autVal = autVal;

    h.appendChild(left);
    h.appendChild(right);
    return h;
  }

  _buildSolarArc() {
    const wrap = document.createElement('div');
    wrap.className = 'pft-solar-arc';
    wrap.style.setProperty('--pft-solar-color', this._config.solar.color);

    const top = document.createElement('div');
    top.className = 'pft-solar-arc-top';

    const rise = document.createElement('span');
    rise.className = 'pft-solar-arc-rise';
    const riseIc = document.createElement('ha-icon');
    riseIc.setAttribute('icon', 'mdi:weather-sunset-up');
    const riseTxt = document.createElement('span');
    rise.appendChild(riseIc);
    rise.appendChild(riseTxt);

    const progress = document.createElement('span');
    progress.className = 'pft-solar-arc-progress';
    const progressTxt = document.createElement('span');
    progress.appendChild(progressTxt);

    const set = document.createElement('span');
    set.className = 'pft-solar-arc-set';
    const setTxt = document.createElement('span');
    const setIc = document.createElement('ha-icon');
    setIc.setAttribute('icon', 'mdi:weather-sunset-down');
    set.appendChild(setTxt);
    set.appendChild(setIc);

    top.appendChild(rise);
    top.appendChild(progress);
    top.appendChild(set);
    wrap.appendChild(top);

    const dur = document.createElement('div');
    dur.className = 'pft-solar-arc-dur';

    const dayD = document.createElement('span');
    dayD.className = 'pft-solar-arc-day';
    const dayIc = document.createElement('ha-icon');
    dayIc.setAttribute('icon', 'mdi:weather-sunny');
    const dayTxt = document.createElement('span');
    dayD.appendChild(dayIc);
    dayD.appendChild(dayTxt);

    const nightD = document.createElement('span');
    nightD.className = 'pft-solar-arc-night-dur';
    const nightIc = document.createElement('ha-icon');
    nightIc.setAttribute('icon', 'mdi:weather-night');
    const nightTxt = document.createElement('span');
    nightD.appendChild(nightIc);
    nightD.appendChild(nightTxt);

    dur.appendChild(dayD);
    dur.appendChild(nightD);
    wrap.appendChild(dur);

    const stage = document.createElement('div');
    stage.className = 'pft-solar-arc-stage';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'pft-solar-arc-svg');
    svg.setAttribute('viewBox', '0 0 200 70');
    svg.setAttribute('preserveAspectRatio', 'none');

    const shape = document.createElementNS(svgNS, 'path');
    shape.setAttribute('class', 'pft-solar-arc-shape');
    shape.setAttribute('d', 'M 10 60 Q 100 -22 190 60 Q 100 -16 10 60 Z');
    svg.appendChild(shape);

    const ground = document.createElementNS(svgNS, 'line');
    ground.setAttribute('class', 'pft-solar-arc-ground');
    ground.setAttribute('x1', '6');
    ground.setAttribute('y1', '60');
    ground.setAttribute('x2', '194');
    ground.setAttribute('y2', '60');
    svg.appendChild(ground);

    const mkRise = document.createElementNS(svgNS, 'circle');
    mkRise.setAttribute('class', 'pft-solar-arc-marker');
    mkRise.setAttribute('cx', '10');
    mkRise.setAttribute('cy', '60');
    mkRise.setAttribute('r', '2.5');
    svg.appendChild(mkRise);

    const mkNoon = document.createElementNS(svgNS, 'circle');
    mkNoon.setAttribute('class', 'pft-solar-arc-marker pft-solar-arc-marker-noon');
    mkNoon.setAttribute('cx', '100');
    mkNoon.setAttribute('cy', '60');
    mkNoon.setAttribute('r', '1.5');
    svg.appendChild(mkNoon);

    const mkSet = document.createElementNS(svgNS, 'circle');
    mkSet.setAttribute('class', 'pft-solar-arc-marker');
    mkSet.setAttribute('cx', '190');
    mkSet.setAttribute('cy', '60');
    mkSet.setAttribute('r', '2.5');
    svg.appendChild(mkSet);

    const sun = document.createElementNS(svgNS, 'circle');
    sun.setAttribute('class', 'pft-solar-arc-sun');
    sun.setAttribute('r', '4');
    sun.setAttribute('cx', '10');
    sun.setAttribute('cy', '60');
    svg.appendChild(sun);

    stage.appendChild(svg);

    const times = document.createElement('div');
    times.className = 'pft-solar-arc-times';
    const tRise = document.createElement('span');
    tRise.style.left = '5%';
    const tNoon = document.createElement('span');
    tNoon.style.left = '50%';
    tNoon.textContent = '12:00';
    const tSet = document.createElement('span');
    tSet.style.left = '95%';
    times.appendChild(tRise);
    times.appendChild(tNoon);
    times.appendChild(tSet);
    stage.appendChild(times);

    wrap.appendChild(stage);

    this._els.solarArc = {
      wrap,
      riseTxt, setTxt, progressTxt,
      dayTxt, nightTxt,
      svg, sun, shape,
      tRise, tSet,
    };

    return wrap;
  }

  _buildStage() {
    const stage = document.createElement('div');
    stage.className = 'pft-stage';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'pft-svg');
    svg.setAttribute('viewBox', `0 0 ${STAGE_VIEW.w} ${STAGE_VIEW.h}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const flowKeys = ['pv', 'grid', 'battery', 'home'];
    this._els.paths = {};
    this._els.particles = {};

    for (const key of flowKeys) {
      const d = svgPath(NODE_POS[key], NODE_POS.hub);
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('id', `pft-path-${key}`);
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      defs.appendChild(p);

      const visible = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      visible.setAttribute('d', d);
      visible.setAttribute('class', `pft-stroke pft-stroke-${key}`);
      visible.setAttribute('fill', 'none');
      visible.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(visible);
      this._els.paths[key] = visible;
    }
    svg.appendChild(defs);

    for (const key of flowKeys) {
      const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      grp.setAttribute('class', `pft-particles pft-particles-${key}`);
      const count = 3;
      const dur = 2.4;
      for (let i = 0; i < count; i++) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('r', '2');
        c.setAttribute('class', `pft-particle pft-particle-${key}`);
        const motion = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
        motion.setAttribute('dur', `${dur}s`);
        motion.setAttribute('repeatCount', 'indefinite');
        motion.setAttribute('begin', `${(i * dur) / count}s`);
        const mpath = document.createElementNS('http://www.w3.org/2000/svg', 'mpath');
        mpath.setAttribute('href', `#pft-path-${key}`);
        motion.appendChild(mpath);
        c.appendChild(motion);
        grp.appendChild(c);
      }
      svg.appendChild(grp);
      this._els.particles[key] = grp;
    }
    stage.appendChild(svg);

    this._els.tiles = {};
    const tilePv = this._buildTile('pv', 'mdi:solar-power-variant', 'PV');
    const tileGrid = this._buildTile('grid', 'mdi:transmission-tower', 'Netz');
    const tileBat = this._buildTile('battery', 'mdi:battery', 'Akku');
    const tileHome = this._buildTile('home', 'mdi:home-lightning-bolt', 'Haus');
    stage.appendChild(tilePv);
    stage.appendChild(tileGrid);
    stage.appendChild(tileBat);
    stage.appendChild(tileHome);

    const hub = document.createElement('div');
    hub.className = 'pft-hub';
    const ringOuter = document.createElement('div');
    ringOuter.className = 'pft-hub-ring pft-hub-ring-outer';

    let ringInner = null;
    let coreParent = ringOuter;
    if (this._config._hasBat2) {
      ringInner = document.createElement('div');
      ringInner.className = 'pft-hub-ring pft-hub-ring-inner';
      ringOuter.appendChild(ringInner);
      coreParent = ringInner;
    }

    const inner = document.createElement('div');
    inner.className = 'pft-hub-inner';
    if (!this._config._hasBat2) inner.classList.add('pft-hub-single');

    const row1 = document.createElement('div');
    row1.className = 'pft-hub-bat-row pft-hub-bat-row-1';
    const batIc = document.createElement('ha-icon');
    batIc.className = 'pft-hub-bat-ic';
    batIc.setAttribute('icon', 'mdi:battery');
    const socVal = document.createElement('span');
    socVal.className = 'pft-hub-soc';
    const batPow = document.createElement('span');
    batPow.className = 'pft-hub-batpow';
    row1.appendChild(batIc);
    row1.appendChild(socVal);
    row1.appendChild(batPow);
    inner.appendChild(row1);

    let batIc2 = null;
    let socVal2 = null;
    let batPow2 = null;
    if (this._config._hasBat2) {
      const row2 = document.createElement('div');
      row2.className = 'pft-hub-bat-row pft-hub-bat-row-2';
      batIc2 = document.createElement('ha-icon');
      batIc2.className = 'pft-hub-bat-ic';
      batIc2.setAttribute('icon', 'mdi:battery');
      socVal2 = document.createElement('span');
      socVal2.className = 'pft-hub-soc';
      batPow2 = document.createElement('span');
      batPow2.className = 'pft-hub-batpow';
      row2.appendChild(batIc2);
      row2.appendChild(socVal2);
      row2.appendChild(batPow2);
      inner.appendChild(row2);
    }

    coreParent.appendChild(inner);
    hub.appendChild(ringOuter);
    stage.appendChild(hub);
    this._els.hub = {
      ringOuter, ringInner,
      batIc, socVal, batPow,
      batIc2, socVal2, batPow2,
    };

    return stage;
  }

  _buildTile(key, icon, label) {
    const t = document.createElement('div');
    t.className = `pft-tile pft-tile-${key}`;
    const head = document.createElement('div');
    head.className = 'pft-tile-head';
    const ic = document.createElement('ha-icon');
    ic.setAttribute('icon', icon);
    ic.className = 'pft-tile-ic';
    const lbl = document.createElement('span');
    lbl.className = 'pft-tile-lbl';
    lbl.textContent = label;
    head.appendChild(ic);
    head.appendChild(lbl);
    t.appendChild(head);

    const isBatSplit = key === 'battery' && this._config._hasBat2;
    let main;
    let sub;
    let main2 = null;
    let sub2 = null;
    let col1Ic = null;
    let col1Soc = null;
    let col2Ic = null;
    let col2Soc = null;

    if (isBatSplit) {
      t.classList.add('pft-tile-battery-split');
      const cols = document.createElement('div');
      cols.className = 'pft-tile-bat-cols';

      const mkCol = (colClass) => {
        const col = document.createElement('div');
        col.className = `pft-tile-bat-col ${colClass}`;
        const head = document.createElement('div');
        head.className = 'pft-tile-bat-col-head';
        const colIc = document.createElement('ha-icon');
        colIc.className = 'pft-tile-bat-col-ic';
        colIc.setAttribute('icon', 'mdi:battery');
        const colSoc = document.createElement('span');
        colSoc.className = 'pft-tile-bat-col-soc';
        head.appendChild(colIc);
        head.appendChild(colSoc);
        const mainCol = document.createElement('div');
        mainCol.className = 'pft-tile-main';
        const subCol = document.createElement('div');
        subCol.className = 'pft-tile-sub';
        col.appendChild(head);
        col.appendChild(mainCol);
        col.appendChild(subCol);
        return { col, colIc, colSoc, mainCol, subCol };
      };
      const c1 = mkCol('pft-tile-bat-col-1');
      const c2 = mkCol('pft-tile-bat-col-2');
      main = c1.mainCol; sub = c1.subCol; col1Ic = c1.colIc; col1Soc = c1.colSoc;
      main2 = c2.mainCol; sub2 = c2.subCol; col2Ic = c2.colIc; col2Soc = c2.colSoc;
      cols.appendChild(c1.col);
      cols.appendChild(c2.col);
      t.appendChild(cols);
    } else {
      main = document.createElement('div');
      main.className = 'pft-tile-main';
      sub = document.createElement('div');
      sub.className = 'pft-tile-sub';
      t.appendChild(main);
      t.appendChild(sub);
    }

    const moreInfo = this._tileEntityFor(key);
    if (moreInfo) {
      t.classList.add('pft-clickable');
      t.addEventListener('click', () => this._fireMoreInfo(moreInfo));
    }
    this._els.tiles[key] = { root: t, ic, main, sub, main2, sub2, col1Ic, col1Soc, col2Ic, col2Soc };
    return t;
  }

  _tileEntityFor(key) {
    const c = this._config;
    if (key === 'pv') return c.solar.power;
    if (key === 'grid') return c.grid.power;
    if (key === 'battery') return c.battery.soc || c.battery.power;
    if (key === 'home') return c.home.power;
    return null;
  }

  _fireMoreInfo(entityId) {
    const ev = new Event('hass-more-info', { bubbles: true, composed: true });
    ev.detail = { entityId };
    this.dispatchEvent(ev);
  }

  _buildMppts() {
    if (!this._config.solar.mppts.length) return null;
    const wrap = document.createElement('div');
    wrap.className = 'pft-mppts';
    this._els.mppts = [];
    for (const m of this._config.solar.mppts) {
      const row = document.createElement('div');
      row.className = 'pft-mppt';
      const head = document.createElement('div');
      head.className = 'pft-mppt-head';
      const nm = document.createElement('span');
      nm.className = 'pft-mppt-name';
      nm.textContent = m.name ?? '';
      const v = document.createElement('span');
      v.className = 'pft-mppt-val';
      head.appendChild(nm);
      head.appendChild(v);
      const bar = document.createElement('div');
      bar.className = 'pft-mppt-bar';
      const fill = document.createElement('div');
      fill.className = 'pft-mppt-bar-fill';
      bar.appendChild(fill);
      row.appendChild(head);
      row.appendChild(bar);
      wrap.appendChild(row);
      this._els.mppts.push({ row, v, fill });
    }
    return wrap;
  }

  _buildLoads() {
    if (!this._config.home.loads.length) return null;
    const wrap = document.createElement('div');
    wrap.className = 'pft-loads';
    this._els.loads = [];
    for (const l of this._config.home.loads) {
      const t = document.createElement('div');
      t.className = 'pft-load';
      const ic = document.createElement('ha-icon');
      ic.setAttribute('icon', l.icon ?? 'mdi:flash');
      ic.className = 'pft-load-ic';
      const txt = document.createElement('div');
      txt.className = 'pft-load-txt';
      const nm = document.createElement('div');
      nm.className = 'pft-load-name';
      nm.textContent = l.name ?? '';
      const v = document.createElement('div');
      v.className = 'pft-load-val';
      txt.appendChild(nm);
      txt.appendChild(v);
      t.appendChild(ic);
      t.appendChild(txt);
      if (l.power) {
        t.classList.add('pft-clickable');
        t.addEventListener('click', () => this._fireMoreInfo(l.power));
      }
      wrap.appendChild(t);
      this._els.loads.push({ root: t, v });
    }
    return wrap;
  }

  _refresh() {
    if (!this._built || !this._hass) return;
    const v = this._values();
    const c = this._config;

    if (this._els.tempVal) this._els.tempVal.textContent = fmtTemp(v.temp);
    if (this._els.autVal) this._els.autVal.textContent = v.autarky !== null ? `${Math.round(v.autarky)} %` : '–';

    const dp = c.decimals_power;
    const de = c.decimals_energy;

    this._setTile('pv', {
      mainText: fmtPower(v.solarP, { decimals: dp }),
      subText: v.solarE !== null ? `${fmtEnergy(v.solarE, de)} heute` : '',
      active: (v.solarP ?? 0) > c.flow_threshold,
      color: c.solar.color,
    });

    const gridImporting = (v.gridP ?? 0) > c.flow_threshold;
    const gridExporting = (v.gridP ?? 0) < -c.flow_threshold;
    const gridArrow = gridImporting ? '↓ ' : (gridExporting ? '↑ ' : '');
    const gridAbs = v.gridP !== null ? Math.abs(v.gridP) : null;
    let gridSub = '';
    if (v.gridImpE !== null || v.gridExpE !== null) {
      const imp = v.gridImpE !== null ? fmtEnergy(v.gridImpE, de) : '–';
      const exp = v.gridExpE !== null ? fmtEnergy(v.gridExpE, de) : '–';
      gridSub = `↓ ${imp}  ↑ ${exp}`;
    }
    this._setTile('grid', {
      mainText: `${gridArrow}${fmtPower(gridAbs, { decimals: dp })}`,
      subText: gridSub,
      active: gridImporting || gridExporting,
      color: gridImporting ? c.grid.color_import : (gridExporting ? c.grid.color_export : DEFAULT_COLORS.grid_idle),
    });

    const batCharging = (v.batP ?? 0) > c.flow_threshold;
    const batDischarging = (v.batP ?? 0) < -c.flow_threshold;
    const batArrow = batCharging ? '↓ ' : (batDischarging ? '↑ ' : '');
    const batAbs = v.batP !== null ? Math.abs(v.batP) : null;
    let batSub = '';
    if (v.batChargeE !== null || v.batDischargeE !== null) {
      const ch = v.batChargeE !== null ? fmtEnergy(v.batChargeE, de) : '–';
      const dc = v.batDischargeE !== null ? fmtEnergy(v.batDischargeE, de) : '–';
      batSub = `↓ ${ch}  ↑ ${dc}`;
    }

    const batCharging2 = c._hasBat2 && (v.batP2 ?? 0) > c.flow_threshold;
    const batDischarging2 = c._hasBat2 && (v.batP2 ?? 0) < -c.flow_threshold;

    if (c._hasBat2) {
      const batArrow2 = batCharging2 ? '↓ ' : (batDischarging2 ? '↑ ' : '');
      const batAbs2 = v.batP2 !== null ? Math.abs(v.batP2) : null;
      let batSub2 = '';
      if (v.batChargeE2 !== null || v.batDischargeE2 !== null) {
        const ch2 = v.batChargeE2 !== null ? fmtEnergy(v.batChargeE2, de) : '–';
        const dc2 = v.batDischargeE2 !== null ? fmtEnergy(v.batDischargeE2, de) : '–';
        batSub2 = `↓ ${ch2}  ↑ ${dc2}`;
      }
      const els = this._els.tiles.battery;
      if (els) {
        els.main.textContent = `${batArrow}${fmtPower(batAbs, { decimals: dp })}`;
        els.sub.textContent = batSub;
        if (els.main2) els.main2.textContent = `${batArrow2}${fmtPower(batAbs2, { decimals: dp })}`;
        if (els.sub2) els.sub2.textContent = batSub2;
        if (els.col1Soc) els.col1Soc.textContent = v.batSoc !== null ? `${Math.round(v.batSoc)}%` : '–';
        if (els.col2Soc) els.col2Soc.textContent = v.batSoc2 !== null ? `${Math.round(v.batSoc2)}%` : '–';
        if (els.col1Ic) {
          const ic1 = v.batSoc === null
            ? 'mdi:battery-unknown'
            : (v.batSoc >= 95 ? 'mdi:battery' : (v.batSoc <= 5 ? 'mdi:battery-outline' : `mdi:battery-${Math.round(v.batSoc / 10) * 10}`));
          els.col1Ic.setAttribute('icon', ic1);
          els.col1Ic.style.color = batCharging ? c.battery.color : (batDischarging ? c.battery.color_discharge : c.battery.color);
        }
        if (els.col2Ic) {
          const ic2 = v.batSoc2 === null
            ? 'mdi:battery-unknown'
            : (v.batSoc2 >= 95 ? 'mdi:battery' : (v.batSoc2 <= 5 ? 'mdi:battery-outline' : `mdi:battery-${Math.round(v.batSoc2 / 10) * 10}`));
          els.col2Ic.setAttribute('icon', ic2);
          els.col2Ic.style.color = batCharging2 ? c.battery2.color : (batDischarging2 ? c.battery2.color_discharge : c.battery2.color);
        }
        const anyActive = batCharging || batDischarging || batCharging2 || batDischarging2;
        els.root.classList.toggle('pft-tile-active', anyActive);
        const totalP = (v.batP ?? 0) + (v.batP2 ?? 0);
        const sumCharging = totalP > c.flow_threshold;
        const sumDischarging = totalP < -c.flow_threshold;
        const accentColor = sumCharging ? c.battery.color : (sumDischarging ? c.battery.color_discharge : DEFAULT_COLORS.battery_idle);
        els.root.style.setProperty('--pft-tile-accent', accentColor);
      }
    } else {
      this._setTile('battery', {
        mainText: `${batArrow}${fmtPower(batAbs, { decimals: dp })}`,
        subText: batSub,
        active: batCharging || batDischarging,
        color: batCharging ? c.battery.color : (batDischarging ? c.battery.color_discharge : DEFAULT_COLORS.battery_idle),
      });
    }
    if (this._els.tiles.battery) {
      let icName;
      if (c._hasBat2) {
        icName = 'mdi:battery-high';
      } else {
        const batKey = v.batSoc === null ? 'unknown' : Math.round(v.batSoc / 10) * 10;
        icName = v.batSoc === null
          ? 'mdi:battery-unknown'
          : (batKey >= 100 ? 'mdi:battery' : (batKey <= 0 ? 'mdi:battery-outline' : `mdi:battery-${batKey}`));
      }
      this._els.tiles.battery.ic.setAttribute('icon', icName);
    }

    this._setTile('home', {
      mainText: fmtPower(v.homeP, { decimals: dp }),
      subText: v.homeE !== null ? `${fmtEnergy(v.homeE, de)} heute` : '',
      active: (v.homeP ?? 0) > c.flow_threshold,
      color: c.home.color,
    });

    if (this._els.hub) {
      const soc = v.batSoc ?? 0;
      this._els.hub.ringOuter.style.setProperty('--pft-soc', `${soc}`);
      this._els.hub.ringOuter.style.setProperty('--pft-soc-color',
        batCharging ? c.battery.color : (batDischarging ? c.battery.color_discharge : c.battery.color));
      this._els.hub.socVal.textContent = v.batSoc !== null ? `${Math.round(v.batSoc)}%` : '–';
      const icName = v.batSoc === null
        ? 'mdi:battery-unknown'
        : (soc >= 95 ? 'mdi:battery' : (soc <= 5 ? 'mdi:battery-outline' : `mdi:battery-${Math.round(soc / 10) * 10}`));
      this._els.hub.batIc.setAttribute('icon', icName);
      if (v.batP !== null && Math.abs(v.batP) > c.flow_threshold) {
        const arrow = batCharging ? '↓' : '↑';
        this._els.hub.batPow.textContent = `${arrow} ${fmtPower(Math.abs(v.batP), { decimals: dp })}`;
        this._els.hub.batPow.style.color = batCharging ? c.battery.color : c.battery.color_discharge;
      } else {
        this._els.hub.batPow.textContent = '';
      }

      if (c._hasBat2 && this._els.hub.ringInner) {
        const soc2 = v.batSoc2 ?? 0;
        this._els.hub.ringInner.style.setProperty('--pft-soc2', `${soc2}`);
        this._els.hub.ringInner.style.setProperty('--pft-soc-color2',
          batCharging2 ? c.battery2.color : (batDischarging2 ? c.battery2.color_discharge : c.battery2.color));
        if (this._els.hub.socVal2) {
          this._els.hub.socVal2.textContent = v.batSoc2 !== null ? `${Math.round(v.batSoc2)}%` : '–';
        }
        if (this._els.hub.batIc2) {
          const icName2 = v.batSoc2 === null
            ? 'mdi:battery-unknown'
            : (soc2 >= 95 ? 'mdi:battery' : (soc2 <= 5 ? 'mdi:battery-outline' : `mdi:battery-${Math.round(soc2 / 10) * 10}`));
          this._els.hub.batIc2.setAttribute('icon', icName2);
        }
        if (this._els.hub.batPow2) {
          if (v.batP2 !== null && Math.abs(v.batP2) > c.flow_threshold) {
            const arrow2 = batCharging2 ? '↓' : '↑';
            this._els.hub.batPow2.textContent = `${arrow2} ${fmtPower(Math.abs(v.batP2), { decimals: dp })}`;
            this._els.hub.batPow2.style.color = batCharging2 ? c.battery2.color : c.battery2.color_discharge;
          } else {
            this._els.hub.batPow2.textContent = '';
          }
        }
      }
    }

    const totalBatP = (v.batP ?? 0) + (v.batP2 ?? 0);
    const totalCharging = totalBatP > c.flow_threshold;
    const totalDischarging = totalBatP < -c.flow_threshold;
    const flowBatColor = totalCharging
      ? c.battery.color
      : (totalDischarging ? c.battery.color_discharge : c.battery.color);
    this._updateFlow('pv', v.solarP, c.solar.color, false);
    this._updateFlow('grid', v.gridP, gridImporting ? c.grid.color_import : c.grid.color_export, gridExporting);
    this._updateFlow('battery', totalBatP, flowBatColor, totalCharging);
    this._updateFlow('home', v.homeP !== null ? -Math.abs(v.homeP) : null, c.home.color, true);

    if (this._els.mppts) {
      for (let i = 0; i < this._els.mppts.length; i++) {
        const m = v.mppts[i];
        const els = this._els.mppts[i];
        const p = m.power;
        els.v.textContent = p !== null ? `${Math.round(p)} W` : '–';
        const pct = (p !== null && m.max) ? Math.max(0, Math.min(100, (p / m.max) * 100)) : 0;
        els.fill.style.width = `${pct}%`;
        els.fill.style.background = c.solar.color;
        els.row.classList.toggle('pft-mppt-active', p !== null && p > c.flow_threshold);
      }
    }

    if (this._els.loads) {
      for (let i = 0; i < this._els.loads.length; i++) {
        const l = v.loads[i];
        const els = this._els.loads[i];
        els.v.textContent = fmtPower(l.power, { decimals: dp });
        els.root.classList.toggle('pft-load-active', (l.power ?? 0) > c.flow_threshold);
      }
    }

    this._updateSunArc();
  }

  _updateSunArc() {
    const els = this._els.solarArc;
    if (!els) return;
    const entityId = this._config.solar.sun_entity || 'sun.sun';
    const sunState = this._hass?.states?.[entityId];
    const attr = sunState?.attributes;

    let todayRise = null;
    let todaySet = null;
    let isDaytime = false;
    let t = null;

    if (attr && attr.next_rising && attr.next_setting) {
      const nextRise = new Date(attr.next_rising).getTime();
      const nextSet = new Date(attr.next_setting).getTime();
      const now = Date.now();
      if (nextSet < nextRise) {
        todaySet = nextSet;
        todayRise = nextRise - 86400000;
      } else {
        todayRise = nextRise;
        todaySet = nextSet - 86400000;
      }
      if (todaySet > todayRise) {
        if (now >= todayRise && now <= todaySet) {
          isDaytime = true;
          t = (now - todayRise) / (todaySet - todayRise);
        }
      }
    }

    els.riseTxt.textContent = todayRise !== null ? ` ${fmtClock(new Date(todayRise))} Aufgang` : ' – Aufgang';
    els.setTxt.textContent = todaySet !== null ? `Untergang ${fmtClock(new Date(todaySet))} ` : 'Untergang – ';
    els.tRise.textContent = todayRise !== null ? fmtClock(new Date(todayRise)) : '';
    els.tSet.textContent = todaySet !== null ? fmtClock(new Date(todaySet)) : '';

    const dayMs = (todayRise !== null && todaySet !== null) ? (todaySet - todayRise) : null;
    const nightMs = dayMs !== null ? (86400000 - dayMs) : null;
    els.dayTxt.textContent = dayMs !== null ? ` Tag: ${fmtDuration(dayMs)}` : ' Tag: –';
    els.nightTxt.textContent = nightMs !== null ? ` Nacht: ${fmtDuration(nightMs)}` : ' Nacht: –';

    if (t !== null) {
      els.progressTxt.innerHTML = `<strong>${Math.round(t * 100)}%</strong> des Tages`;
    } else {
      els.progressTxt.textContent = isDaytime ? '' : 'Nacht';
    }

    if (isDaytime && t !== null) {
      els.svg.classList.remove('pft-solar-arc-night');
      const tc = Math.max(0, Math.min(1, t));
      const u = 1 - tc;
      const bx = u * u * 10 + 2 * u * tc * 100 + tc * tc * 190;
      const by = u * u * 60 + 2 * u * tc * (-22) + tc * tc * 60;
      els.sun.setAttribute('cx', bx.toFixed(2));
      els.sun.setAttribute('cy', by.toFixed(2));
      els.sun.style.opacity = '1';
    } else {
      els.svg.classList.add('pft-solar-arc-night');
      els.sun.style.opacity = '0';
    }
  }

  _setTile(key, opts) {
    const els = this._els.tiles?.[key];
    if (!els) return;
    els.main.textContent = opts.mainText;
    els.sub.textContent = opts.subText ?? '';
    els.root.classList.toggle('pft-tile-active', !!opts.active);
    if (opts.color) {
      els.root.style.setProperty('--pft-tile-accent', opts.color);
    }
  }

  _updateFlow(key, power, color, reverse) {
    const path = this._els.paths?.[key];
    const particles = this._els.particles?.[key];
    if (!path || !particles) return;
    const abs = power === null ? 0 : Math.abs(power);
    const active = abs > this._config.flow_threshold;
    path.style.stroke = active ? color : 'rgba(127,127,127,0.18)';
    path.style.opacity = active ? '0.55' : '0.4';
    particles.style.display = active ? '' : 'none';
    const motions = particles.querySelectorAll('animateMotion');
    const dur = active ? Math.max(0.8, 3.5 - Math.min(3, abs / 1500)) : 3;
    motions.forEach((m) => {
      m.setAttribute('dur', `${dur.toFixed(2)}s`);
      m.setAttribute('keyPoints', reverse ? '1;0' : '0;1');
      m.setAttribute('keyTimes', '0;1');
    });
    particles.querySelectorAll('circle').forEach((c) => {
      c.style.fill = color;
      c.style.filter = `drop-shadow(0 0 4px ${color})`;
    });
  }

  _css() {
    return `
      :host { display: block; }
      .pft-card {
        padding: 14px 14px 12px;
        background:
          radial-gradient(120% 80% at 50% 0%,
            color-mix(in srgb, ${DEFAULT_COLORS.hub_accent} 6%, transparent) 0%,
            transparent 60%),
          var(--ha-card-background, var(--card-background-color));
        border-radius: var(--ha-card-border-radius, 14px);
      }
      .pft-header {
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px; margin-bottom: 10px;
      }
      .pft-header-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .pft-header-icon {
        color: ${DEFAULT_COLORS.hub_accent};
        --mdc-icon-size: 22px;
        filter: drop-shadow(0 0 6px color-mix(in srgb, ${DEFAULT_COLORS.hub_accent} 55%, transparent));
      }
      .pft-header-title {
        font-size: 1.05rem; font-weight: 600;
        color: var(--primary-text-color);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .pft-header-right { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
      .pft-chip {
        display: inline-flex; align-items: center; gap: 5px;
        background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 12%, transparent);
        padding: 3px 9px;
        border-radius: 999px;
        font-size: 0.78rem; font-weight: 600;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
      }
      .pft-chip ha-icon { --mdc-icon-size: 14px; color: var(--secondary-text-color); }
      .pft-chip-lbl { color: var(--secondary-text-color); font-weight: 500; font-size: 0.74rem; }
      .pft-autarky {
        background: color-mix(in srgb, ${DEFAULT_COLORS.hub_accent} 12%, transparent);
        border-color: color-mix(in srgb, ${DEFAULT_COLORS.hub_accent} 28%, transparent);
      }
      .pft-autarky-val { color: ${DEFAULT_COLORS.hub_accent}; }

      .pft-stage {
        position: relative;
        aspect-ratio: ${STAGE_VIEW.w} / ${STAGE_VIEW.h};
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 1fr 1fr;
        gap: 8px;
        padding: 8px;
      }
      .pft-svg {
        position: absolute; inset: 0;
        width: 100%; height: 100%;
        pointer-events: none;
        z-index: 0;
      }
      .pft-stroke {
        stroke-width: 2.5;
        stroke-linecap: round;
        stroke: rgba(127,127,127,0.22);
        transition: stroke 200ms ease, opacity 200ms ease;
      }
      .pft-particle {
        transition: fill 200ms ease;
      }

      .pft-tile {
        position: relative;
        z-index: 1;
        display: flex; flex-direction: column;
        justify-content: center;
        gap: 2px;
        padding: 8px 12px;
        border-radius: 14px;
        background:
          linear-gradient(180deg,
            color-mix(in srgb, var(--pft-tile-accent, #888) 10%, var(--ha-card-background, var(--card-background-color))) 0%,
            var(--ha-card-background, var(--card-background-color)) 100%);
        border: 1px solid color-mix(in srgb, var(--pft-tile-accent, #888) 18%, transparent);
        box-shadow:
          0 1px 2px rgba(0,0,0,0.05),
          inset 0 1px 0 rgba(255,255,255,0.05);
        transition: border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease;
        cursor: default;
      }
      .pft-tile.pft-clickable { cursor: pointer; }
      .pft-tile.pft-clickable:hover {
        transform: translateY(-1px);
        border-color: color-mix(in srgb, var(--pft-tile-accent, #888) 40%, transparent);
      }
      .pft-tile.pft-tile-active {
        border-color: color-mix(in srgb, var(--pft-tile-accent, #888) 50%, transparent);
        box-shadow:
          0 0 0 2px color-mix(in srgb, var(--pft-tile-accent, #888) 22%, transparent),
          0 4px 14px color-mix(in srgb, var(--pft-tile-accent, #888) 22%, transparent);
      }
      .pft-tile-pv { grid-column: 1; grid-row: 1; align-items: flex-start; text-align: left; }
      .pft-tile-grid { grid-column: 2; grid-row: 1; align-items: flex-end; text-align: right; }
      .pft-tile-battery { grid-column: 1; grid-row: 2; align-items: flex-start; text-align: left; }
      .pft-tile-home { grid-column: 2; grid-row: 2; align-items: flex-end; text-align: right; }
      .pft-tile-grid .pft-tile-head, .pft-tile-home .pft-tile-head { flex-direction: row-reverse; }

      .pft-tile-head {
        display: flex; align-items: center; gap: 6px;
        color: var(--secondary-text-color);
        font-size: 0.78rem; font-weight: 600;
        letter-spacing: 0.01em;
      }
      .pft-tile-ic {
        --mdc-icon-size: 18px;
        color: var(--pft-tile-accent, var(--secondary-text-color));
        filter: drop-shadow(0 0 4px color-mix(in srgb, var(--pft-tile-accent, transparent) 50%, transparent));
      }
      .pft-tile-main {
        font-size: 1.25rem; font-weight: 700;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.01em;
        line-height: 1.1;
      }
      .pft-tile-sub {
        font-size: 0.72rem;
        color: var(--secondary-text-color);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .pft-solar-arc {
        margin-bottom: 10px;
        padding: 8px 10px 6px;
        border-radius: 14px;
        background:
          radial-gradient(120% 100% at 50% 0%,
            color-mix(in srgb, ${DEFAULT_COLORS.solar} 18%, transparent) 0%,
            transparent 65%),
          color-mix(in srgb, var(--primary-text-color) 4%, transparent);
        border: 1px solid color-mix(in srgb, ${DEFAULT_COLORS.solar} 18%, rgba(127,127,127,0.18));
      }
      .pft-solar-arc-top {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px;
        font-size: 0.78rem;
        color: var(--secondary-text-color);
      }
      .pft-solar-arc-top strong {
        color: var(--primary-text-color);
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .pft-solar-arc-rise, .pft-solar-arc-set, .pft-solar-arc-progress {
        display: inline-flex; align-items: center; gap: 4px;
        white-space: nowrap;
      }
      .pft-solar-arc-rise ha-icon, .pft-solar-arc-set ha-icon {
        --mdc-icon-size: 14px;
        color: var(--pft-solar-color, ${DEFAULT_COLORS.solar});
      }
      .pft-solar-arc-progress {
        color: var(--pft-solar-color, ${DEFAULT_COLORS.solar});
        font-weight: 600;
      }
      .pft-solar-arc-progress strong { color: var(--pft-solar-color, ${DEFAULT_COLORS.solar}); }
      .pft-solar-arc-dur {
        display: flex; justify-content: space-between;
        gap: 8px;
        margin-top: 4px;
      }
      .pft-solar-arc-day, .pft-solar-arc-night-dur {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 3px 10px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--primary-text-color) 7%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent);
        font-size: 0.74rem; font-weight: 600;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
      }
      .pft-solar-arc-day ha-icon, .pft-solar-arc-night-dur ha-icon {
        --mdc-icon-size: 14px;
      }
      .pft-solar-arc-day ha-icon { color: var(--pft-solar-color, ${DEFAULT_COLORS.solar}); }
      .pft-solar-arc-night-dur ha-icon { color: color-mix(in srgb, var(--secondary-text-color) 80%, transparent); }
      .pft-solar-arc-stage {
        position: relative;
        height: 100px;
        margin-top: 8px;
        margin-bottom: 18px;
      }
      .pft-solar-arc-svg {
        position: absolute;
        inset: 0;
        width: 100%; height: 100%;
        overflow: visible;
      }
      .pft-solar-arc-shape {
        fill: #ff4d6a;
        opacity: 0.88;
        filter:
          drop-shadow(0 0 5px #ff4d6a)
          drop-shadow(0 0 12px color-mix(in srgb, #ff4d6a 40%, transparent));
        transition: opacity 400ms ease;
      }
      .pft-solar-arc-night .pft-solar-arc-shape {
        opacity: 0.22;
        filter: none;
      }
      .pft-solar-arc-ground {
        stroke: color-mix(in srgb, var(--primary-text-color) 30%, transparent);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }
      .pft-solar-arc-marker {
        fill: color-mix(in srgb, var(--pft-solar-color, ${DEFAULT_COLORS.solar}) 75%, var(--primary-text-color));
      }
      .pft-solar-arc-marker-noon {
        fill: color-mix(in srgb, var(--primary-text-color) 35%, transparent);
      }
      .pft-solar-arc-sun {
        fill: #ffd60a;
        stroke: #ffb300;
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
        filter:
          drop-shadow(0 0 4px #ffd60a)
          drop-shadow(0 0 10px color-mix(in srgb, #ffd60a 60%, transparent));
        transition: cx 1.2s ease-out, cy 1.2s ease-out, opacity 400ms ease;
      }
      .pft-solar-arc-times {
        position: absolute;
        left: 0; right: 0;
        top: calc(100% + 2px);
        font-size: 0.66rem;
        color: var(--secondary-text-color);
        font-variant-numeric: tabular-nums;
        pointer-events: none;
        height: 14px;
      }
      .pft-solar-arc-times span {
        position: absolute;
        transform: translateX(-50%);
      }

      .pft-hub {
        position: absolute;
        left: 50%; top: 50%;
        transform: translate(-50%, -50%);
        z-index: 3;
        width: 36%;
        max-width: 165px;
        aspect-ratio: 1;
        pointer-events: none;
      }
      .pft-hub-ring {
        width: 100%; height: 100%;
        border-radius: 50%;
        box-sizing: border-box;
      }
      .pft-hub-ring-outer {
        background:
          conic-gradient(
            var(--pft-soc-color, ${DEFAULT_COLORS.battery_charge}) 0deg calc(var(--pft-soc, 0) * 3.6deg),
            rgba(127,127,127,0.18) calc(var(--pft-soc, 0) * 3.6deg) 360deg
          );
        padding: 8px;
        box-shadow:
          0 4px 18px rgba(0,0,0,0.18),
          0 0 0 1px color-mix(in srgb, var(--pft-soc-color, ${DEFAULT_COLORS.battery_charge}) 35%, transparent),
          inset 0 1px 0 rgba(255,255,255,0.08);
        transition: background 400ms ease, box-shadow 200ms ease;
      }
      .pft-hub-ring-inner {
        background:
          conic-gradient(
            var(--pft-soc-color2, ${DEFAULT_COLORS.battery2_charge}) 0deg calc(var(--pft-soc2, 0) * 3.6deg),
            rgba(127,127,127,0.22) calc(var(--pft-soc2, 0) * 3.6deg) 360deg
          );
        padding: 7px;
        box-shadow:
          inset 0 0 0 1px color-mix(in srgb, var(--pft-soc-color2, ${DEFAULT_COLORS.battery2_charge}) 35%, transparent);
        transition: background 400ms ease;
      }
      .pft-hub-inner {
        width: 100%; height: 100%;
        border-radius: 50%;
        background: var(--ha-card-background, var(--card-background-color));
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 3px;
        padding: 6px;
        box-sizing: border-box;
      }
      .pft-hub-bat-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        line-height: 1.05;
        font-variant-numeric: tabular-nums;
      }
      .pft-hub-bat-row .pft-hub-soc {
        font-size: 0.95rem;
        font-weight: 700;
        color: var(--primary-text-color);
      }
      .pft-hub-bat-row .pft-hub-batpow {
        font-size: 0.74rem;
        font-weight: 600;
        white-space: nowrap;
      }
      .pft-hub-bat-row .pft-hub-bat-ic {
        --mdc-icon-size: 20px;
        filter: drop-shadow(0 0 5px color-mix(in srgb, currentColor 60%, transparent));
        flex-shrink: 0;
      }
      .pft-hub-bat-row-1 .pft-hub-bat-ic { color: var(--pft-soc-color, ${DEFAULT_COLORS.battery_charge}); }
      .pft-hub-bat-row-2 .pft-hub-bat-ic { color: var(--pft-soc-color2, ${DEFAULT_COLORS.battery2_charge}); }
      .pft-hub-single .pft-hub-bat-row {
        flex-direction: column;
        gap: 1px;
      }
      .pft-hub-single .pft-hub-bat-row .pft-hub-bat-ic { --mdc-icon-size: 32px; }
      .pft-hub-single .pft-hub-bat-row .pft-hub-soc { font-size: 1.2rem; }
      .pft-hub-single .pft-hub-bat-row .pft-hub-batpow {
        font-size: 0.8rem;
        min-height: 0.8rem;
      }

      .pft-tile-battery-split .pft-tile-bat-cols {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        width: 100%;
      }
      .pft-tile-battery-split .pft-tile-bat-col {
        display: flex; flex-direction: column;
        align-items: flex-start;
        min-width: 0;
        gap: 1px;
      }
      .pft-tile-battery-split .pft-tile-bat-col-head {
        display: flex; align-items: center;
        gap: 4px;
        font-size: 0.7rem;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--primary-text-color);
      }
      .pft-tile-battery-split .pft-tile-bat-col-ic {
        --mdc-icon-size: 14px;
        flex-shrink: 0;
        filter: drop-shadow(0 0 3px color-mix(in srgb, currentColor 55%, transparent));
      }
      .pft-tile-battery-split .pft-tile-bat-col-soc {
        font-weight: 700;
        letter-spacing: 0.01em;
      }
      .pft-tile-battery-split .pft-tile-main {
        font-size: 0.92rem;
        margin-top: 1px;
      }
      .pft-tile-battery-split .pft-tile-sub {
        font-size: 0.62rem;
      }

      .pft-mppts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
        gap: 6px 10px;
        margin-top: 10px;
        padding: 8px 6px 4px;
        border-top: 1px solid color-mix(in srgb, var(--primary-text-color) 8%, transparent);
      }
      .pft-mppt { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .pft-mppt-head {
        display: flex; justify-content: space-between; align-items: baseline;
        gap: 6px; min-width: 0;
      }
      .pft-mppt-name {
        font-size: 0.72rem; font-weight: 500;
        color: var(--secondary-text-color);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        min-width: 0;
      }
      .pft-mppt-val {
        font-size: 0.78rem; font-weight: 700;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .pft-mppt-bar {
        height: 4px;
        border-radius: 2px;
        background: rgba(127,127,127,0.15);
        overflow: hidden;
      }
      .pft-mppt-bar-fill {
        height: 100%;
        width: 0%;
        background: ${DEFAULT_COLORS.solar};
        border-radius: 2px;
        transition: width 300ms ease;
      }
      .pft-mppt-active .pft-mppt-bar-fill {
        box-shadow: 0 0 8px ${DEFAULT_COLORS.solar};
      }

      .pft-loads {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 8px;
        margin-top: 8px;
      }
      .pft-load {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 10px;
        border-radius: 12px;
        background: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
        border: 1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent);
        transition: background 150ms ease, border-color 150ms ease, transform 150ms ease;
      }
      .pft-load.pft-clickable { cursor: pointer; }
      .pft-load.pft-clickable:hover { transform: translateY(-1px); }
      .pft-load.pft-load-active {
        border-color: color-mix(in srgb, ${DEFAULT_COLORS.home} 40%, transparent);
        background: color-mix(in srgb, ${DEFAULT_COLORS.home} 10%, transparent);
      }
      .pft-load-ic {
        --mdc-icon-size: 22px;
        color: ${DEFAULT_COLORS.home};
        filter: drop-shadow(0 0 4px color-mix(in srgb, ${DEFAULT_COLORS.home} 40%, transparent));
        flex-shrink: 0;
      }
      .pft-load-txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      .pft-load-name {
        font-size: 0.74rem; font-weight: 500;
        color: var(--secondary-text-color);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .pft-load-val {
        font-size: 0.92rem; font-weight: 700;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
      }

      @media (max-width: 500px) {
        .pft-card { padding: 10px 10px 8px; }
        .pft-tile { padding: 6px 8px; }
        .pft-tile-main { font-size: 1.05rem; }
        .pft-tile-sub { font-size: 0.66rem; }
        .pft-hub-bat-ic { --mdc-icon-size: 20px; }
        .pft-hub-soc { font-size: 0.85rem; }
      }
    `;
  }
}

PowerFlowTilesCard.getConfigElement = function () {
  return document.createElement('power-flow-tiles-card-editor');
};

const EDITOR_LABELS = {
  title: 'Titel',
  icon: 'Icon',
  temperature: 'Außentemperatur',
  power: 'Power-Sensor (W)',
  energy_today: 'Tagesertrag (kWh)',
  energy_today_home: 'Tagesverbrauch (kWh)',
  color: 'Farbe',
  soc: 'SOC-Sensor (%)',
  capacity_kwh: 'Kapazität (kWh)',
  invert_power: 'Vorzeichen invertieren (+ = Laden)',
  charge_today: 'Tagesladung (kWh)',
  discharge_today: 'Tagesentladung (kWh)',
  color_discharge: 'Farbe Entladen',
  invert: 'Vorzeichen invertieren (+ = Einspeisung)',
  import_today: 'Netzbezug heute (kWh)',
  export_today: 'Einspeisung heute (kWh)',
  color_import: 'Farbe Bezug',
  color_export: 'Farbe Einspeisung',
  mode: 'Modus',
  decimals_power: 'Nachkommastellen kW',
  decimals_energy: 'Nachkommastellen kWh',
  flow_threshold: 'Flow-Schwelle (W)',
  name: 'Name',
  max: 'Max (W)',
  show_sun_arc: 'Sonnenverlauf-Bereich anzeigen',
  sun_entity: 'Sonne-Entity',
  show_battery2: 'Zweiten Akku anzeigen',
};

const SENSOR_FILTER = { entity: { filter: { domain: 'sensor' } } };
const TEMP_FILTER = { entity: { filter: { device_class: 'temperature' } } };
const SUN_FILTER = { entity: { filter: { domain: 'sun' } } };

const EDITOR_SCHEMA = [
  {
    type: 'grid',
    name: '',
    schema: [
      { name: 'title', selector: { text: {} } },
      { name: 'icon', selector: { icon: {} } },
    ],
  },
  {
    name: 'environment',
    type: 'expandable',
    title: 'Umgebung',
    icon: 'mdi:thermometer',
    schema: [
      { name: 'temperature', selector: TEMP_FILTER },
    ],
  },
  {
    name: 'solar',
    type: 'expandable',
    title: 'Solar',
    icon: 'mdi:solar-power-variant',
    expanded: true,
    schema: [
      { name: 'power', selector: SENSOR_FILTER },
      { name: 'energy_today', selector: SENSOR_FILTER },
      { name: 'color', selector: { text: {} } },
    ],
  },
  {
    name: '_sun_arc',
    type: 'expandable',
    title: 'Sonnenverlauf',
    icon: 'mdi:weather-sunny',
    schema: [
      { name: 'show_sun_arc', selector: { boolean: {} } },
      { name: 'sun_entity', selector: SUN_FILTER },
    ],
  },
  {
    name: 'battery',
    type: 'expandable',
    title: 'Akku',
    icon: 'mdi:battery',
    schema: [
      { name: 'power', selector: SENSOR_FILTER },
      { name: 'soc', selector: SENSOR_FILTER },
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'capacity_kwh', selector: { number: { min: 0, step: 0.1, mode: 'box', unit_of_measurement: 'kWh' } } },
          { name: 'invert_power', selector: { boolean: {} } },
        ],
      },
      { name: 'charge_today', selector: SENSOR_FILTER },
      { name: 'discharge_today', selector: SENSOR_FILTER },
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'color', selector: { text: {} } },
          { name: 'color_discharge', selector: { text: {} } },
        ],
      },
    ],
  },
  {
    name: 'battery2',
    type: 'expandable',
    title: 'Akku 2',
    icon: 'mdi:battery-medium',
    schema: [
      { name: 'show_battery2', selector: { boolean: {} } },
      { name: 'power', selector: SENSOR_FILTER },
      { name: 'soc', selector: SENSOR_FILTER },
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'capacity_kwh', selector: { number: { min: 0, step: 0.1, mode: 'box', unit_of_measurement: 'kWh' } } },
          { name: 'invert_power', selector: { boolean: {} } },
        ],
      },
      { name: 'charge_today', selector: SENSOR_FILTER },
      { name: 'discharge_today', selector: SENSOR_FILTER },
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'color', selector: { text: {} } },
          { name: 'color_discharge', selector: { text: {} } },
        ],
      },
    ],
  },
  {
    name: 'grid',
    type: 'expandable',
    title: 'Netz',
    icon: 'mdi:transmission-tower',
    schema: [
      { name: 'power', selector: SENSOR_FILTER },
      { name: 'invert', selector: { boolean: {} } },
      { name: 'import_today', selector: SENSOR_FILTER },
      { name: 'export_today', selector: SENSOR_FILTER },
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'color_import', selector: { text: {} } },
          { name: 'color_export', selector: { text: {} } },
        ],
      },
    ],
  },
  {
    name: 'home',
    type: 'expandable',
    title: 'Haus',
    icon: 'mdi:home-lightning-bolt',
    schema: [
      { name: 'power', selector: SENSOR_FILTER },
      { name: 'energy_today', selector: SENSOR_FILTER },
      { name: 'color', selector: { text: {} } },
    ],
  },
  {
    name: 'autarky',
    type: 'expandable',
    title: 'Autarkie',
    icon: 'mdi:home-percent',
    schema: [
      {
        name: 'mode',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              { value: 'power', label: 'Live (aktuelle Leistung)' },
              { value: 'energy', label: 'Heute (Tagessummen)' },
            ],
          },
        },
      },
    ],
  },
  {
    name: '_advanced',
    type: 'expandable',
    title: 'Erweitert',
    icon: 'mdi:tune',
    schema: [
      {
        type: 'grid',
        name: '',
        schema: [
          { name: 'decimals_power', selector: { number: { min: 0, max: 3, step: 1, mode: 'box' } } },
          { name: 'decimals_energy', selector: { number: { min: 0, max: 3, step: 1, mode: 'box' } } },
          { name: 'flow_threshold', selector: { number: { min: 0, max: 1000, step: 1, mode: 'box', unit_of_measurement: 'W' } } },
        ],
      },
    ],
  },
];

const MPPT_SCHEMA = [
  {
    type: 'grid',
    name: '',
    schema: [
      { name: 'name', selector: { text: {} } },
      { name: 'max', selector: { number: { min: 0, step: 10, mode: 'box', unit_of_measurement: 'W' } } },
    ],
  },
  { name: 'power', selector: SENSOR_FILTER },
];

const LOAD_SCHEMA = [
  {
    type: 'grid',
    name: '',
    schema: [
      { name: 'name', selector: { text: {} } },
      { name: 'icon', selector: { icon: {} } },
    ],
  },
  { name: 'power', selector: SENSOR_FILTER },
];

const SUB_LABELS = {
  name: 'Name',
  max: 'Max (W)',
  power: 'Power-Sensor',
  icon: 'Icon',
};

class PowerFlowTilesCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._mpptForms = [];
    this._loadForms = [];
    this._lastMpptCount = -1;
    this._lastLoadCount = -1;
  }

  setConfig(config) {
    this._config = config ?? {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _formData() {
    const c = this._config;
    return {
      title: c.title ?? '',
      icon: c.icon ?? 'mdi:home-lightning-bolt-outline',
      environment: { temperature: c.environment?.temperature ?? '' },
      solar: {
        power: c.solar?.power ?? '',
        energy_today: c.solar?.energy_today ?? '',
        color: c.solar?.color ?? '',
      },
      _sun_arc: {
        show_sun_arc: c.solar?.show_sun_arc !== false,
        sun_entity: c.solar?.sun_entity || 'sun.sun',
      },
      battery: {
        power: c.battery?.power ?? '',
        soc: c.battery?.soc ?? '',
        capacity_kwh: typeof c.battery?.capacity_kwh === 'number' ? c.battery.capacity_kwh : null,
        invert_power: c.battery?.invert_power === true,
        charge_today: c.battery?.charge_today ?? '',
        discharge_today: c.battery?.discharge_today ?? '',
        color: c.battery?.color ?? '',
        color_discharge: c.battery?.color_discharge ?? '',
      },
      battery2: {
        show_battery2: c.show_battery2 === true,
        power: c.battery2?.power ?? '',
        soc: c.battery2?.soc ?? '',
        capacity_kwh: typeof c.battery2?.capacity_kwh === 'number' ? c.battery2.capacity_kwh : null,
        invert_power: c.battery2?.invert_power === true,
        charge_today: c.battery2?.charge_today ?? '',
        discharge_today: c.battery2?.discharge_today ?? '',
        color: c.battery2?.color ?? '',
        color_discharge: c.battery2?.color_discharge ?? '',
      },
      grid: {
        power: c.grid?.power ?? '',
        invert: c.grid?.invert === true,
        import_today: c.grid?.import_today ?? '',
        export_today: c.grid?.export_today ?? '',
        color_import: c.grid?.color_import ?? '',
        color_export: c.grid?.color_export ?? '',
      },
      home: {
        power: c.home?.power ?? '',
        energy_today: c.home?.energy_today ?? '',
        color: c.home?.color ?? '',
      },
      autarky: {
        mode: c.autarky?.mode ?? 'power',
      },
      _advanced: {
        decimals_power: typeof c.decimals_power === 'number' ? c.decimals_power : 2,
        decimals_energy: typeof c.decimals_energy === 'number' ? c.decimals_energy : 1,
        flow_threshold: typeof c.flow_threshold === 'number' ? c.flow_threshold : 5,
      },
    };
  }

  _render() {
    if (!this.shadowRoot) return;
    if (!this._wrap) this._build();
    this._mainForm.hass = this._hass;
    this._mainForm.schema = EDITOR_SCHEMA;
    this._mainForm.data = this._formData();
    this._mainForm.computeLabel = (s) => EDITOR_LABELS[s.name] ?? s.name;
    this._renderMppts();
    this._renderLoads();
  }

  _build() {
    const style = document.createElement('style');
    style.textContent = `
      :host { display: block; }
      .pft-edit { padding: 8px 4px 4px; display: flex; flex-direction: column; gap: 12px; }
      .pft-edit-section { display: flex; flex-direction: column; gap: 6px; }
      .pft-edit-h {
        font-size: 0.9rem; font-weight: 600;
        color: var(--primary-text-color);
        display: flex; align-items: center; gap: 6px;
        padding: 4px 2px 0;
      }
      .pft-edit-h ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
      .pft-edit-sub {
        font-size: 0.78rem;
        color: var(--secondary-text-color);
        padding: 0 2px 4px;
      }
      .pft-edit-item {
        position: relative;
        padding: 10px 12px 8px;
        border: 1px solid var(--divider-color, rgba(127,127,127,0.25));
        border-radius: 8px;
        background: color-mix(in srgb, var(--primary-text-color) 3%, transparent);
      }
      .pft-edit-item ha-form { display: block; }
      .pft-edit-rm {
        position: absolute; top: 4px; right: 4px;
        appearance: none; border: none; background: transparent;
        color: var(--secondary-text-color);
        font-size: 1.4rem; line-height: 1;
        width: 28px; height: 28px;
        border-radius: 50%;
        cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
      }
      .pft-edit-rm:hover { background: rgba(239,68,68,0.15); color: #ef4444; }
      .pft-edit-add {
        appearance: none;
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, transparent);
        border: 1px dashed color-mix(in srgb, var(--primary-color, #03a9f4) 40%, transparent);
        color: var(--primary-color, #03a9f4);
        font: inherit; font-weight: 600;
        padding: 8px 12px;
        border-radius: 8px;
        cursor: pointer;
        text-align: center;
        transition: background 120ms ease, border-color 120ms ease;
      }
      .pft-edit-add:hover {
        background: color-mix(in srgb, var(--primary-color, #03a9f4) 22%, transparent);
        border-style: solid;
      }
      .pft-edit-hint {
        margin-top: 4px;
        padding: 8px 10px;
        font-size: 0.78rem;
        color: var(--secondary-text-color);
        background: rgba(127,127,127,0.08);
        border-left: 3px solid var(--primary-color, #03a9f4);
        border-radius: 4px;
      }
      .pft-edit-hint code {
        background: rgba(127,127,127,0.18);
        padding: 1px 5px;
        border-radius: 3px;
        font-size: 0.76rem;
      }
    `;
    const wrap = document.createElement('div');
    wrap.className = 'pft-edit';

    this._mainForm = document.createElement('ha-form');
    this._mainForm.addEventListener('value-changed', (ev) => this._onMainChange(ev));
    wrap.appendChild(this._mainForm);

    const mpptSection = document.createElement('div');
    mpptSection.className = 'pft-edit-section';
    const mpptH = document.createElement('div');
    mpptH.className = 'pft-edit-h';
    const mpptHIc = document.createElement('ha-icon');
    mpptHIc.setAttribute('icon', 'mdi:solar-panel');
    const mpptHTxt = document.createElement('span');
    mpptHTxt.textContent = 'PV-Strings (MPPTs)';
    mpptH.appendChild(mpptHIc);
    mpptH.appendChild(mpptHTxt);
    const mpptSub = document.createElement('div');
    mpptSub.className = 'pft-edit-sub';
    mpptSub.textContent = 'Pro String: Name, Maximalleistung und Power-Sensor. Beliebig viele.';
    this._mpptsList = document.createElement('div');
    this._mpptsList.className = 'pft-edit-section';
    this._mpptsAdd = document.createElement('button');
    this._mpptsAdd.type = 'button';
    this._mpptsAdd.className = 'pft-edit-add';
    this._mpptsAdd.textContent = '+ String hinzufügen';
    this._mpptsAdd.addEventListener('click', () => this._addMppt());
    mpptSection.appendChild(mpptH);
    mpptSection.appendChild(mpptSub);
    mpptSection.appendChild(this._mpptsList);
    mpptSection.appendChild(this._mpptsAdd);
    wrap.appendChild(mpptSection);

    const loadSection = document.createElement('div');
    loadSection.className = 'pft-edit-section';
    const loadH = document.createElement('div');
    loadH.className = 'pft-edit-h';
    const loadHIc = document.createElement('ha-icon');
    loadHIc.setAttribute('icon', 'mdi:flash');
    const loadHTxt = document.createElement('span');
    loadHTxt.textContent = 'Zusatz-Verbraucher (Loads)';
    loadH.appendChild(loadHIc);
    loadH.appendChild(loadHTxt);
    const loadSub = document.createElement('div');
    loadSub.className = 'pft-edit-sub';
    loadSub.textContent = 'Mini-Tiles unter dem Haus (Wallbox, Wärmepumpe etc.). Pro Eintrag: Name, Icon, Sensor.';
    this._loadsList = document.createElement('div');
    this._loadsList.className = 'pft-edit-section';
    this._loadsAdd = document.createElement('button');
    this._loadsAdd.type = 'button';
    this._loadsAdd.className = 'pft-edit-add';
    this._loadsAdd.textContent = '+ Verbraucher hinzufügen';
    this._loadsAdd.addEventListener('click', () => this._addLoad());
    loadSection.appendChild(loadH);
    loadSection.appendChild(loadSub);
    loadSection.appendChild(this._loadsList);
    loadSection.appendChild(this._loadsAdd);
    wrap.appendChild(loadSection);

    const hint = document.createElement('div');
    hint.className = 'pft-edit-hint';
    hint.innerHTML =
      'Tipp: Wenn die Flow-Animation falsch herum läuft (z.&nbsp;B. „Akku entlädt obwohl er lädt"), den jeweiligen ' +
      '<code>Vorzeichen invertieren</code>-Schalter umlegen.';
    wrap.appendChild(hint);

    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(wrap);
    this._wrap = wrap;
  }

  _renderMppts() {
    const mppts = this._config.solar?.mppts ?? [];
    const computeLabel = (s) => SUB_LABELS[s.name] ?? s.name;
    if (mppts.length !== this._lastMpptCount) {
      this._lastMpptCount = mppts.length;
      this._mpptsList.innerHTML = '';
      this._mpptForms = [];
      mppts.forEach((m, idx) => {
        const item = document.createElement('div');
        item.className = 'pft-edit-item';
        const form = document.createElement('ha-form');
        form.computeLabel = computeLabel;
        form.addEventListener('value-changed', (ev) => this._onMpptChange(idx, ev));
        item.appendChild(form);
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'pft-edit-rm';
        rm.title = 'Entfernen';
        rm.innerHTML = '&times;';
        rm.addEventListener('click', () => this._removeMppt(idx));
        item.appendChild(rm);
        this._mpptsList.appendChild(item);
        this._mpptForms.push(form);
      });
    }
    mppts.forEach((m, idx) => {
      const form = this._mpptForms[idx];
      if (!form) return;
      form.hass = this._hass;
      form.schema = MPPT_SCHEMA;
      const data = {
        name: m.name ?? '',
        max: typeof m.max === 'number' ? m.max : (typeof m.max_power === 'number' ? m.max_power : null),
        power: m.power ?? '',
      };
      if (JSON.stringify(form.data) !== JSON.stringify(data)) {
        form.data = data;
      }
    });
  }

  _renderLoads() {
    const loads = this._config.home?.loads ?? [];
    const computeLabel = (s) => SUB_LABELS[s.name] ?? s.name;
    if (loads.length !== this._lastLoadCount) {
      this._lastLoadCount = loads.length;
      this._loadsList.innerHTML = '';
      this._loadForms = [];
      loads.forEach((l, idx) => {
        const item = document.createElement('div');
        item.className = 'pft-edit-item';
        const form = document.createElement('ha-form');
        form.computeLabel = computeLabel;
        form.addEventListener('value-changed', (ev) => this._onLoadChange(idx, ev));
        item.appendChild(form);
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'pft-edit-rm';
        rm.title = 'Entfernen';
        rm.innerHTML = '&times;';
        rm.addEventListener('click', () => this._removeLoad(idx));
        item.appendChild(rm);
        this._loadsList.appendChild(item);
        this._loadForms.push(form);
      });
    }
    loads.forEach((l, idx) => {
      const form = this._loadForms[idx];
      if (!form) return;
      form.hass = this._hass;
      form.schema = LOAD_SCHEMA;
      const data = {
        name: l.name ?? '',
        icon: l.icon ?? '',
        power: l.power ?? '',
      };
      if (JSON.stringify(form.data) !== JSON.stringify(data)) {
        form.data = data;
      }
    });
  }

  _addMppt() {
    const solar = { ...(this._config.solar ?? {}) };
    solar.mppts = [...(solar.mppts ?? []), { name: '', power: '', max: 420 }];
    this._config = { ...this._config, solar };
    this._dispatchChange();
    this._render();
  }

  _removeMppt(idx) {
    const solar = { ...(this._config.solar ?? {}) };
    solar.mppts = (solar.mppts ?? []).filter((_, i) => i !== idx);
    if (!solar.mppts.length) delete solar.mppts;
    this._config = { ...this._config, solar };
    if (!Object.keys(this._config.solar ?? {}).length) {
      const next = { ...this._config };
      delete next.solar;
      this._config = next;
    }
    this._dispatchChange();
    this._render();
  }

  _onMpptChange(idx, ev) {
    ev.stopPropagation();
    const v = ev.detail?.value ?? {};
    const solar = { ...(this._config.solar ?? {}) };
    const mppts = [...(solar.mppts ?? [])];
    const entry = { ...(mppts[idx] ?? {}) };
    if (v.name) entry.name = v.name; else delete entry.name;
    if (v.power) entry.power = v.power; else delete entry.power;
    if (typeof v.max === 'number' && v.max > 0) entry.max = v.max; else delete entry.max;
    delete entry.max_power;
    mppts[idx] = entry;
    solar.mppts = mppts;
    this._config = { ...this._config, solar };
    this._dispatchChange();
  }

  _addLoad() {
    const home = { ...(this._config.home ?? {}) };
    home.loads = [...(home.loads ?? []), { name: '', icon: 'mdi:flash', power: '' }];
    this._config = { ...this._config, home };
    this._dispatchChange();
    this._render();
  }

  _removeLoad(idx) {
    const home = { ...(this._config.home ?? {}) };
    home.loads = (home.loads ?? []).filter((_, i) => i !== idx);
    if (!home.loads.length) delete home.loads;
    this._config = { ...this._config, home };
    if (!Object.keys(this._config.home ?? {}).length) {
      const next = { ...this._config };
      delete next.home;
      this._config = next;
    }
    this._dispatchChange();
    this._render();
  }

  _onLoadChange(idx, ev) {
    ev.stopPropagation();
    const v = ev.detail?.value ?? {};
    const home = { ...(this._config.home ?? {}) };
    const loads = [...(home.loads ?? [])];
    const entry = { ...(loads[idx] ?? {}) };
    if (v.name) entry.name = v.name; else delete entry.name;
    if (v.icon) entry.icon = v.icon; else delete entry.icon;
    if (v.power) entry.power = v.power; else delete entry.power;
    loads[idx] = entry;
    home.loads = loads;
    this._config = { ...this._config, home };
    this._dispatchChange();
  }

  _onMainChange(ev) {
    ev.stopPropagation();
    const v = ev.detail?.value ?? {};
    const next = { ...this._config };

    if (v.title) next.title = v.title; else delete next.title;
    if (v.icon && v.icon !== 'mdi:home-lightning-bolt-outline') next.icon = v.icon; else delete next.icon;

    const envTemp = v.environment?.temperature;
    if (envTemp) next.environment = { temperature: envTemp };
    else delete next.environment;

    const solar = { ...(next.solar ?? {}) };
    const vs = v.solar ?? {};
    ['power', 'energy_today', 'color'].forEach((k) => {
      if (vs[k]) solar[k] = vs[k]; else delete solar[k];
    });
    const vsa = v._sun_arc ?? {};
    if (vsa.show_sun_arc === false) solar.show_sun_arc = false;
    else delete solar.show_sun_arc;
    if (vsa.sun_entity && vsa.sun_entity !== 'sun.sun') solar.sun_entity = vsa.sun_entity;
    else delete solar.sun_entity;
    const solarKeysToKeep = Object.keys(solar).filter((k) => k !== 'mppts');
    if (solarKeysToKeep.length || (solar.mppts && solar.mppts.length)) next.solar = solar;
    else delete next.solar;

    const battery = {};
    const vb = v.battery ?? {};
    ['power', 'soc', 'charge_today', 'discharge_today', 'color', 'color_discharge'].forEach((k) => {
      if (vb[k]) battery[k] = vb[k];
    });
    if (typeof vb.capacity_kwh === 'number' && vb.capacity_kwh > 0) battery.capacity_kwh = vb.capacity_kwh;
    if (vb.invert_power === true) battery.invert_power = true;
    if (Object.keys(battery).length) next.battery = battery; else delete next.battery;

    const battery2 = {};
    const vb2 = v.battery2 ?? {};
    ['power', 'soc', 'charge_today', 'discharge_today', 'color', 'color_discharge'].forEach((k) => {
      if (vb2[k]) battery2[k] = vb2[k];
    });
    if (typeof vb2.capacity_kwh === 'number' && vb2.capacity_kwh > 0) battery2.capacity_kwh = vb2.capacity_kwh;
    if (vb2.invert_power === true) battery2.invert_power = true;
    if (Object.keys(battery2).length) next.battery2 = battery2; else delete next.battery2;
    if (vb2.show_battery2 === true) next.show_battery2 = true; else delete next.show_battery2;

    const grid = {};
    const vg = v.grid ?? {};
    ['power', 'import_today', 'export_today', 'color_import', 'color_export'].forEach((k) => {
      if (vg[k]) grid[k] = vg[k];
    });
    if (vg.invert === true) grid.invert = true;
    if (Object.keys(grid).length) next.grid = grid; else delete next.grid;

    const home = { ...(next.home ?? {}) };
    const vh = v.home ?? {};
    ['power', 'energy_today', 'color'].forEach((k) => {
      if (vh[k]) home[k] = vh[k]; else delete home[k];
    });
    if (Object.keys(home).filter((k) => k !== 'loads').length || (home.loads && home.loads.length)) {
      next.home = home;
    } else {
      delete next.home;
    }

    if (v.autarky?.mode && v.autarky.mode !== 'power') next.autarky = { mode: v.autarky.mode };
    else delete next.autarky;

    const adv = v._advanced ?? {};
    if (typeof adv.decimals_power === 'number' && adv.decimals_power !== 2) next.decimals_power = adv.decimals_power;
    else delete next.decimals_power;
    if (typeof adv.decimals_energy === 'number' && adv.decimals_energy !== 1) next.decimals_energy = adv.decimals_energy;
    else delete next.decimals_energy;
    if (typeof adv.flow_threshold === 'number' && adv.flow_threshold !== 5) next.flow_threshold = adv.flow_threshold;
    else delete next.flow_threshold;

    this._config = next;
    this._dispatchChange();
  }

  _dispatchChange() {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    }));
  }
}

if (!customElements.get('power-flow-tiles-card-editor')) {
  customElements.define('power-flow-tiles-card-editor', PowerFlowTilesCardEditor);
}

if (!customElements.get('power-flow-tiles-card')) {
  customElements.define('power-flow-tiles-card', PowerFlowTilesCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'power-flow-tiles-card')) {
  window.customCards.push({
    type: 'power-flow-tiles-card',
    name: 'Power Flow Tiles',
    description: 'Moderne PV-/Speicher-/Netz-/Haus-Flow-Karte mit animierten Stromflüssen.',
    preview: false,
  });
}
