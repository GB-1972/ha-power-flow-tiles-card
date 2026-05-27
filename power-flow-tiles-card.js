const PFT_VERSION = '0.1.0';

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
    c.battery = c.battery ?? {};
    c.battery.invert_power = c.battery.invert_power === true;
    c.battery.color = c.battery.color ?? DEFAULT_COLORS.battery_charge;
    c.battery.color_discharge = c.battery.color_discharge ?? DEFAULT_COLORS.battery_discharge;
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

  _signedBattery(raw) {
    if (raw === null) return null;
    return this._config.battery.invert_power ? raw : -raw;
  }

  _signedGrid(raw) {
    if (raw === null) return null;
    return this._config.grid.invert ? -raw : raw;
  }

  _values() {
    const c = this._config;
    const solarP = this._getNum(c.solar.power);
    const solarE = this._getNum(c.solar.energy_today);
    const batP = this._signedBattery(this._getNum(c.battery.power));
    const batSoc = this._getNum(c.battery.soc);
    const batChargeE = this._getNum(c.battery.charge_today);
    const batDischargeE = this._getNum(c.battery.discharge_today);
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
    const ring = document.createElement('div');
    ring.className = 'pft-hub-ring';
    const inner = document.createElement('div');
    inner.className = 'pft-hub-inner';
    const batIc = document.createElement('ha-icon');
    batIc.className = 'pft-hub-bat-ic';
    batIc.setAttribute('icon', 'mdi:battery');
    const socVal = document.createElement('div');
    socVal.className = 'pft-hub-soc';
    const batPow = document.createElement('div');
    batPow.className = 'pft-hub-batpow';
    inner.appendChild(batIc);
    inner.appendChild(socVal);
    inner.appendChild(batPow);
    ring.appendChild(inner);
    hub.appendChild(ring);
    stage.appendChild(hub);
    this._els.hub = { ring, batIc, socVal, batPow };

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
    const main = document.createElement('div');
    main.className = 'pft-tile-main';
    const sub = document.createElement('div');
    sub.className = 'pft-tile-sub';
    t.appendChild(head);
    t.appendChild(main);
    t.appendChild(sub);

    const moreInfo = this._tileEntityFor(key);
    if (moreInfo) {
      t.classList.add('pft-clickable');
      t.addEventListener('click', () => this._fireMoreInfo(moreInfo));
    }
    this._els.tiles[key] = { root: t, ic, main, sub };
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
    this._setTile('battery', {
      mainText: `${batArrow}${fmtPower(batAbs, { decimals: dp })}`,
      subText: batSub,
      active: batCharging || batDischarging,
      color: batCharging ? c.battery.color : (batDischarging ? c.battery.color_discharge : DEFAULT_COLORS.battery_idle),
    });
    const batKey = v.batSoc === null ? 'unknown' : Math.round(v.batSoc / 10) * 10;
    if (this._els.tiles.battery) {
      const icName = v.batSoc === null
        ? 'mdi:battery-unknown'
        : (batKey >= 100 ? 'mdi:battery' : (batKey <= 0 ? 'mdi:battery-outline' : `mdi:battery-${batKey}`));
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
      this._els.hub.ring.style.setProperty('--pft-soc', `${soc}`);
      this._els.hub.ring.style.setProperty('--pft-soc-color',
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
    }

    this._updateFlow('pv', v.solarP, c.solar.color, false);
    this._updateFlow('grid', v.gridP, gridImporting ? c.grid.color_import : c.grid.color_export, gridExporting);
    this._updateFlow('battery', v.batP, batCharging ? c.battery.color : c.battery.color_discharge, batCharging);
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

      .pft-hub {
        position: absolute;
        left: 50%; top: 50%;
        transform: translate(-50%, -50%);
        z-index: 3;
        width: 30%;
        max-width: 130px;
        aspect-ratio: 1;
        pointer-events: none;
      }
      .pft-hub-ring {
        width: 100%; height: 100%;
        border-radius: 50%;
        background:
          conic-gradient(
            var(--pft-soc-color, ${DEFAULT_COLORS.battery_charge}) 0deg calc(var(--pft-soc, 0) * 3.6deg),
            rgba(127,127,127,0.18) calc(var(--pft-soc, 0) * 3.6deg) 360deg
          );
        padding: 5px;
        box-shadow:
          0 4px 18px rgba(0,0,0,0.18),
          0 0 0 1px color-mix(in srgb, var(--pft-soc-color, ${DEFAULT_COLORS.battery_charge}) 35%, transparent),
          inset 0 1px 0 rgba(255,255,255,0.08);
        transition: background 400ms ease, box-shadow 200ms ease;
      }
      .pft-hub-inner {
        width: 100%; height: 100%;
        border-radius: 50%;
        background: var(--ha-card-background, var(--card-background-color));
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 1px;
      }
      .pft-hub-bat-ic {
        --mdc-icon-size: 26px;
        color: var(--pft-soc-color, ${DEFAULT_COLORS.battery_charge});
        filter: drop-shadow(0 0 8px color-mix(in srgb, var(--pft-soc-color, ${DEFAULT_COLORS.battery_charge}) 60%, transparent));
      }
      .pft-hub-soc {
        font-size: 1rem; font-weight: 700;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
      }
      .pft-hub-batpow {
        font-size: 0.7rem; font-weight: 600;
        font-variant-numeric: tabular-nums;
        line-height: 1;
        min-height: 0.7rem;
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
