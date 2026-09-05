const COLORS = { background: '#0d0e11', white: '#f3f3f5', red: '#ff454f', green: '#5bea9c', yellow: '#f6d36a' };
export const ACHIEVEMENTS = [
  { name: 'First Blood', score: 10, icon: 'target', description: 'Every legend starts somewhere.' },
  { name: 'Getting Started', score: 50, icon: 'bolt', description: 'You have found your rhythm.' },
  { name: 'Danger Zone', score: 100, icon: 'shield', description: 'Keep your cool. Keep moving.' },
  { name: 'Untouchable', score: 250, icon: 'trophy', description: 'Make the impossible look easy.' },
  { name: 'Legend', score: 500, icon: 'crown', description: 'A run worth remembering.' }
];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const formatScore = (n) => String(n).padStart(2, '0');

export class GameStorage {
  constructor(storage) {
    this.storage = storage;
    this.available = Boolean(storage);
    this.data = { best: 0, achievements: [], muted: false };
    try {
      const saved = JSON.parse(storage?.getItem('dont-touch-red:v1') || 'null');
      if (saved && typeof saved === 'object') {
        if (Number.isSafeInteger(saved.best) && saved.best >= 0) this.data.best = saved.best;
        this.data.muted = saved.muted === true;
        this.data.achievements = ACHIEVEMENTS.filter(a => this.data.best >= a.score).map(a => a.name);
      }
    } catch { this.available = false; }
  }
  save() {
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      this.storage.setItem('dont-touch-red:v1', JSON.stringify(this.data));
    } catch { this.available = false; }
  }
  record(score) {
    const fresh = ACHIEVEMENTS.filter(a => score >= a.score && !this.data.achievements.includes(a.name));
    if (score > this.data.best || fresh.length) {
      this.data.best = Math.max(score, this.data.best);
      this.data.achievements.push(...fresh.map(a => a.name));
      this.save();
    }
    return fresh;
  }
}

export class GameAudio {
  constructor(muted = false) { this.muted = muted; this.context = null; }
  unlock() {
    if (this.muted) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context ||= new AudioContext();
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch { /* Audio may be disabled by browser or embedding policy. */ }
  }
  play(kind) {
    if (this.muted || !this.context || this.context.state !== 'running') return;
    const sequences = {
      collect: [[740, 0, .07], [1100, .045, .10]],
      bonus: [[523, 0, .12], [659, .07, .12], [1046, .14, .20]],
      level: [[392, 0, .10], [523, .09, .10], [784, .18, .18]],
      warning: [[170, 0, .07]],
      over: [[180, 0, .18], [90, .10, .27]],
      record: [[523, 0, .12], [659, .10, .12], [784, .20, .12], [1046, .32, .30]]
    };
    for (const [frequency, offset, duration] of sequences[kind] || []) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const start = this.context.currentTime + offset;
      oscillator.type = kind === 'over' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      if (kind === 'over') oscillator.frequency.exponentialRampToValueAtTime(frequency * .45, start + duration);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(kind === 'warning' ? .025 : .09, start + .008);
      gain.gain.exponentialRampToValueAtTime(.001, start + duration);
      oscillator.connect(gain); gain.connect(this.context.destination);
      oscillator.start(start); oscillator.stop(start + duration + .02);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
  }
  suspend() { this.context?.suspend().catch(() => {}); }
  dispose() { this.context?.close().catch(() => {}); }
}

export class ScoreSystem {
  constructor() { this.reset(); }
  reset() { this.time = 0; this.points = 0; this.multiplier = 1; this.bonusRemaining = 0; }
  get total() { return Math.floor(this.time + 1e-8) + this.points; }
  tick(dt) {
    this.time += dt;
    this.bonusRemaining = Math.max(0, this.bonusRemaining - dt);
    if (!this.bonusRemaining) this.multiplier = 1;
  }
  collect() { const amount = 10 * this.multiplier; this.points += amount; return amount; }
  bonus(multiplier) { this.multiplier = multiplier; this.bonusRemaining = 8; }
}

export class DifficultySystem {
  static get(score, width, height) {
    const level = Math.min(15, 1 + Math.floor(score / 50));
    const densityLimit = Math.max(5, Math.floor(width * height / 19000));
    return {
      level,
      speed: 36 + Math.min(level - 1, 10) * 7,
      obstacles: Math.min(3 + level, densityLimit, 16),
      movingChance: level === 1 ? 0 : Math.min(.9, .25 + level * .1),
      homingChance: level >= 6 ? .22 : 0,
      telegraph: level >= 6 ? 1.1 : 1.4,
      spawnEvery: Math.max(.8, 2.4 - level * .13)
    };
  }
}

export class Player {
  constructor(x, y) { this.x = x; this.y = y; this.px = x; this.py = y; this.r = 7; this.vx = 22; this.vy = -17; this.trail = []; }
  update(dt, input, width, height, level) {
    this.px = this.x; this.py = this.y;
    const speed = 290 + Math.min(level, 10) * 9;
    let dx = 0, dy = 0;
    if (input.keys.size) {
      dx = Number(input.keys.has('d') || input.keys.has('arrowright')) - Number(input.keys.has('a') || input.keys.has('arrowleft'));
      dy = Number(input.keys.has('s') || input.keys.has('arrowdown')) - Number(input.keys.has('w') || input.keys.has('arrowup'));
    }
    if (dx || dy) {
      const size = Math.hypot(dx, dy); dx /= size; dy /= size;
      this.x += dx * speed * dt; this.y += dy * speed * dt;
      this.vx = dx * 28; this.vy = dy * 28;
      input.target = null;
    } else if (input.target && Math.hypot(input.target.x - this.x, input.target.y - this.y) > 2) {
      const tx = input.target.x - this.x, ty = input.target.y - this.y;
      const length = Math.hypot(tx, ty), step = Math.min(length, speed * 1.65 * dt);
      this.x += tx / length * step; this.y += ty / length * step;
      this.vx = tx / length * 27; this.vy = ty / length * 27;
    } else {
      input.target = null;
      const drift = 1 + (level - 1) * .07;
      this.x += this.vx * dt * drift; this.y += this.vy * dt * drift;
    }
    const edge = this.r + 3;
    if (this.x < edge || this.x > width - edge) this.vx *= -1;
    if (this.y < 47 || this.y > height - 26) this.vy *= -1;
    this.x = clamp(this.x, edge, width - edge); this.y = clamp(this.y, 47, height - 26);
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 18) this.trail.shift();
  }
}

export class CollisionDetection {
  static sweptCircles(a, b, radius = a.r + b.r) {
    const rx = (a.px ?? a.x) - (b.px ?? b.x), ry = (a.py ?? a.y) - (b.py ?? b.y);
    const dx = a.x - b.x - rx, dy = a.y - b.y - ry;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? clamp(-(rx * dx + ry * dy) / lengthSquared, 0, 1) : 0;
    return (rx + t * dx) ** 2 + (ry + t * dy) ** 2 <= radius ** 2;
  }
  static obstacle(player, obstacle) {
    if (obstacle.shape !== 'square') return this.sweptCircles(player, obstacle);
    const cos = Math.cos(-obstacle.angle), sin = Math.sin(-obstacle.angle);
    const ox = player.x - obstacle.x, oy = player.y - obstacle.y;
    const x = ox * cos - oy * sin, y = ox * sin + oy * cos;
    const half = obstacle.r * .84;
    const cx = clamp(x, -half, half), cy = clamp(y, -half, half);
    return (x - cx) ** 2 + (y - cy) ** 2 <= player.r ** 2;
  }
}

export class ParticleSystem {
  constructor(random = Math.random) { this.items = []; this.random = random; }
  burst(x, y, color, count = 10) {
    for (let i = 0; i < count && this.items.length < 100; i++) {
      const angle = this.random() * Math.PI * 2, speed = 25 + this.random() * 110;
      this.items.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, color, life: .4 + this.random() * .35, max: .75, r: 1 + this.random() * 2 });
    }
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i]; p.life -= dt;
      if (p.life <= 0) { this.items.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .975; p.vy *= .975;
    }
  }
  draw(ctx) {
    for (const p of this.items) {
      ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.r, p.r);
    }
    ctx.globalAlpha = 1;
  }
}

export class ObstacleSystem {
  constructor(random = Math.random) { this.random = random; this.items = []; this.timer = 0; }
  spawn(engine, initial = false) {
    const { width, height, player, difficulty } = engine;
    if (this.items.length >= difficulty.obstacles) return false;
    const r = 12 + this.random() * Math.min(10, width / 40);
    let position;
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = { x: 28 + this.random() * (width - 56), y: 65 + this.random() * (height - 109) };
      if (distance(candidate, player) < Math.min(165, width * .4) + r) continue;
      if (this.items.some(o => distance(o, candidate) < o.r + r + 44)) continue;
      if (engine.collectibles.items.some(c => distance(c, candidate) < c.r + r + 30)) continue;
      position = candidate; break;
    }
    if (!position) return false;
    const moving = this.random() < difficulty.movingChance;
    const angle = this.random() * Math.PI * 2;
    this.items.push({ ...position, px: position.x, py: position.y, r,
      vx: moving ? Math.cos(angle) * difficulty.speed : 0,
      vy: moving ? Math.sin(angle) * difficulty.speed : 0,
      homing: moving && this.random() < difficulty.homingChance,
      shape: this.random() > .48 ? 'square' : 'circle', angle,
      active: initial, warning: initial ? 0 : difficulty.telegraph, age: 0, lifespan: 14 + this.random() * 12
    });
    return true;
  }
  update(dt, engine) {
    this.timer -= dt;
    if (this.timer <= 0) { this.spawn(engine); this.timer = engine.difficulty.spawnEvery; }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const o = this.items[i]; o.px = o.x; o.py = o.y; o.age += dt;
      if (o.age > o.lifespan) { this.items.splice(i, 1); continue; }
      if (!o.active) {
        o.warning -= dt;
        // A telegraphed obstacle never activates on top of a player who moved into it.
        if (o.warning <= 0 && distance(o, engine.player) > o.r + engine.player.r + 90) o.active = true;
        continue;
      }
      if (o.homing) {
        const dx = engine.player.x - o.x, dy = engine.player.y - o.y, d = Math.hypot(dx, dy) || 1;
        const turning = Math.min(dt * .45, 1), speed = engine.difficulty.speed * .65;
        o.vx += (dx / d * speed - o.vx) * turning; o.vy += (dy / d * speed - o.vy) * turning;
      }
      o.x += o.vx * dt; o.y += o.vy * dt;
      if (o.x < o.r + 3 || o.x > engine.width - o.r - 3) o.vx *= -1;
      if (o.y < o.r + 44 || o.y > engine.height - o.r - 24) o.vy *= -1;
      o.x = clamp(o.x, o.r + 3, engine.width - o.r - 3);
      o.y = clamp(o.y, o.r + 44, engine.height - o.r - 24);
    }
  }
}

export class CollectibleSystem {
  constructor(random = Math.random) { this.random = random; this.items = []; this.greenTimer = 0; this.bonusTimer = 9 + random() * 8; }
  spawn(engine, bonus = false) {
    let position;
    for (let attempt = 0; attempt < 45; attempt++) {
      const candidate = { x: 25 + this.random() * (engine.width - 50), y: 66 + this.random() * (engine.height - 107) };
      if (engine.obstacles.items.some(o => distance(o, candidate) < o.r + 38)) continue;
      if (this.items.some(c => distance(c, candidate) < 38)) continue;
      if (distance(candidate, engine.player) < 28) continue;
      position = candidate; break;
    }
    if (!position) return false;
    this.items.push({ ...position, r: bonus ? 9 : 6, bonus, multiplier: bonus ? (this.random() < .2 ? 5 : 2) : 1, age: 0, lifespan: bonus ? 10 : 18 });
    return true;
  }
  update(dt, engine) {
    this.greenTimer -= dt; this.bonusTimer -= dt;
    if (this.greenTimer <= 0) {
      if (this.items.filter(c => !c.bonus).length < 4) this.spawn(engine);
      this.greenTimer = 1.8;
    }
    if (this.bonusTimer <= 0) {
      if (!this.items.some(c => c.bonus)) this.spawn(engine, true);
      this.bonusTimer = 12 + this.random() * 12;
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const c = this.items[i]; c.age += dt;
      if (c.age > c.lifespan) { this.items.splice(i, 1); continue; }
      if (CollisionDetection.sweptCircles(engine.player, c)) {
        this.items.splice(i, 1);
        if (c.bonus) { engine.score.bonus(c.multiplier); engine.emit('bonus', { ...c }); }
        else { const amount = engine.score.collect(); engine.emit('collect', { ...c, amount }); }
        engine.particles.burst(c.x, c.y, c.bonus ? COLORS.yellow : COLORS.green, c.bonus ? 20 : 10);
      }
    }
  }
}

export class GameEngine {
  constructor({ width = 740, height = 450, random = Math.random, onEvent = () => {} } = {}) {
    this.width = width; this.height = height; this.random = random; this.onEvent = onEvent;
    this.state = 'menu'; this.score = new ScoreSystem(); this.particles = new ParticleSystem(random);
    this.input = { keys: new Set(), target: null }; this.warningCooldown = 0; this.near = false;
    this.player = new Player(width * .5, height * .64);
    this.obstacles = new ObstacleSystem(random); this.collectibles = new CollectibleSystem(random);
  }
  get difficulty() { return DifficultySystem.get(this.score.total, this.width, this.height); }
  emit(type, payload = {}) { this.onEvent(type, payload); }
  start() {
    this.score.reset(); this.particles.items.length = 0;
    this.player = new Player(this.width * .5, this.height * .64);
    this.obstacles = new ObstacleSystem(this.random); this.collectibles = new CollectibleSystem(this.random);
    this.input.keys.clear(); this.input.target = null; this.warningCooldown = 0; this.near = false;
    this.state = 'playing'; this.lastLevel = 1;
    for (let i = 0; i < 3; i++) this.obstacles.spawn(this, true);
    for (let i = 0; i < 3; i++) this.collectibles.spawn(this);
    this.obstacles.timer = 3; this.emit('start');
  }
  pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.input.keys.clear(); this.input.target = null; this.emit('pause'); }
  resume() { if (this.state !== 'paused') return; this.state = 'playing'; this.input.keys.clear(); this.emit('resume'); }
  menu() { this.state = 'menu'; this.input.keys.clear(); this.input.target = null; this.score.reset(); this.emit('menu'); }
  die() {
    if (this.state !== 'playing') return;
    this.state = 'over'; this.input.keys.clear(); this.input.target = null;
    this.particles.burst(this.player.x, this.player.y, COLORS.red, 35);
    this.emit('over', { score: this.score.total });
  }
  resize(width, height) {
    if (width === this.width && height === this.height) return;
    if (this.state === 'playing') this.pause();
    const sx = width / this.width, sy = height / this.height;
    for (const item of [this.player, ...this.obstacles.items, ...this.collectibles.items]) {
      item.x *= sx; item.y *= sy; item.px = item.x; item.py = item.y;
    }
    this.player.trail.length = 0; this.input.target = null; this.width = width; this.height = height;
    // Resizing changes free space; re-telegraph nearby hazards before resuming.
    for (const o of this.obstacles.items) {
      if (distance(o, this.player) < o.r + this.player.r + 90) { o.active = false; o.warning = 1.2; }
    }
  }
  tick(dt) {
    if (this.state !== 'paused' && this.state !== 'menu') this.particles.update(dt);
    if (this.state !== 'playing') return;
    this.score.tick(dt);
    const level = this.difficulty.level;
    if (level !== this.lastLevel) { this.lastLevel = level; this.emit('level', { level }); }
    this.player.update(dt, this.input, this.width, this.height, level);
    this.obstacles.update(dt, this);
    this.near = false; this.warningCooldown = Math.max(0, this.warningCooldown - dt);
    for (const obstacle of this.obstacles.items) {
      if (!obstacle.active) continue;
      if (CollisionDetection.obstacle(this.player, obstacle)) { this.die(); return; }
      if (distance(this.player, obstacle) < this.player.r + obstacle.r + 19) this.near = true;
    }
    if (this.near && !this.warningCooldown) { this.emit('warning'); this.warningCooldown = 1.3; }
    this.collectibles.update(dt, this);
  }
}

class CanvasRenderer {
  constructor(canvas, engine) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false }); this.engine = engine;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr); this.canvas.height = Math.round(rect.height * this.dpr);
    this.engine.resize(rect.width, rect.height);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  circle(x, y, r, color, glow = 0) {
    const ctx = this.ctx; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = glow;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  }
  obstacle(o, time, demo = false) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.angle || 0);
    ctx.fillStyle = COLORS.red; ctx.strokeStyle = COLORS.red;
    if (!o.active && !demo) {
      ctx.globalAlpha = .2 + (Math.sin(time * 8) + 1) * .16;
      ctx.setLineDash([3, 5]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, o.r + 9, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = .15;
    } else { ctx.globalAlpha = demo ? .85 : 1; ctx.shadowColor = COLORS.red; ctx.shadowBlur = 12; }
    if (o.shape === 'square') { const h = o.r * .84; ctx.beginPath(); ctx.roundRect(-h, -h, h * 2, h * 2, 4); ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(0, 0, o.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  collectible(c, time) {
    const ctx = this.ctx; const color = c.bonus ? COLORS.yellow : COLORS.green;
    ctx.save(); ctx.translate(c.x, c.y);
    ctx.globalAlpha = c.age > c.lifespan - 2 ? .4 + Math.abs(Math.sin(time * 5)) * .6 : 1;
    ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.globalAlpha *= .16; ctx.beginPath(); ctx.arc(0, 0, c.r + 6, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha *= 6.25;
    if (c.bonus) {
      ctx.rotate(Math.PI / 4); ctx.fillStyle = color; ctx.shadowBlur = 14; ctx.shadowColor = color;
      ctx.beginPath(); ctx.roundRect(-6, -6, 12, 12, 2); ctx.fill();
    } else this.circle(0, 0, c.r, color, 12);
    ctx.restore();
  }
  demo(time) {
    const { width: w, height: h } = this.engine;
    const t = this.reducedMotion ? 0 : time;
    const objects = [
      [.15,.21,18,'square',-.22], [.8,.17,14,'circle',0], [.90,.49,17,'square',.4],
      [.12,.75,13,'circle',0], [.74,.82,18,'square',-.28], [.30,.87,10,'square',.45]
    ];
    for (let i = 0; i < objects.length; i++) {
      const [x,y,r,shape,angle] = objects[i];
      this.obstacle({ x:x*w + Math.sin(t*.25+i)*6, y:y*h + Math.cos(t*.3+i)*8, r, shape, angle:angle + Math.sin(t*.2)*.06, active:true }, t, true);
    }
    for (const [x,y,bonus] of [[.11,.43,false],[.77,.4,false],[.86,.73,false],[.32,.16,true],[.29,.68,false]]) {
      this.collectible({ x:x*w, y:y*h, r:bonus?8:5, bonus, age:0, lifespan:10 },t);
    }
    const px = w*.43 + Math.sin(t*.5)*w*.11, py = h*.86 + Math.cos(t*.7)*8;
    for (let i = 16; i > 0; i--) {
      this.ctx.globalAlpha = (1-i/17)*.2;
      this.circle(px-i*2,py+Math.sin(i*.15)*3,4*(1-i/20),COLORS.white);
    }
    this.ctx.globalAlpha = 1; this.circle(px,py,6,COLORS.white,15);
  }
  draw(time) {
    const ctx = this.ctx, e = this.engine, w = e.width, h = e.height;
    ctx.globalAlpha = 1; ctx.fillStyle = COLORS.background; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = COLORS.white; ctx.globalAlpha = .075;
    for (let x = 16; x < w; x += 24) for (let y = 16; y < h; y += 24) ctx.fillRect(x, y, 1, 1);
    ctx.globalAlpha = 1;
    if (e.state === 'menu') { this.demo(time); return; }
    for (const o of e.obstacles.items) this.obstacle(o, time);
    for (const c of e.collectibles.items) this.collectible(c, time);
    if (e.state !== 'over') {
      const p = e.player;
      if (!this.reducedMotion) {
        for (let i = 0; i < p.trail.length; i++) {
          ctx.globalAlpha = i / p.trail.length * .25;
          this.circle(p.trail[i].x,p.trail[i].y,p.r * i / p.trail.length * .8,COLORS.white);
        }
      }
      ctx.globalAlpha = 1;
      if (e.near) { ctx.globalAlpha = .25; ctx.strokeStyle = COLORS.red; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x,p.y,p.r+10,0,Math.PI*2); ctx.stroke(); ctx.globalAlpha = 1; }
      this.circle(p.x,p.y,p.r,COLORS.white,14);
      ctx.globalAlpha = .1; ctx.strokeStyle = COLORS.white; ctx.beginPath(); ctx.arc(p.x,p.y,p.r+6,0,Math.PI*2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    e.particles.draw(ctx);
  }
}

class GameUI {
  constructor() {
    this.$ = id => document.getElementById(id);
    let local; try { local = window.localStorage; } catch { /* Private browsing can block storage access. */ }
    this.storage = new GameStorage(local); this.audio = new GameAudio(this.storage.data.muted);
    this.engine = new GameEngine({ onEvent: (type,payload) => this.onEvent(type,payload) });
    this.canvas = this.$('game-canvas'); this.renderer = new CanvasRenderer(this.canvas,this.engine);
    this.lastFrame = 0; this.accumulator = 0; this.lastHud = -1; this.lastDraw = 0; this.frameId = 0; this.bestAtStart = 0;
    this.pointer = null; this.lastPointer = null; this.toastTimer = 0; this.messageTimer = 0; this.overTimer = 0;
    this.handlers = new AbortController(); this.disposed = false;
    this.resizeObserver = new ResizeObserver(() => this.renderer.resize()); this.resizeObserver.observe(this.canvas);
    this.bind(); this.updateAchievements(); this.updateSound(); this.updateHud();
    this.frame = this.frame.bind(this); this.wake();
  }
  listen(target,type,handler,options = {}) { target.addEventListener(type,handler,{...options,signal:this.handlers.signal}); }
  start() {
    clearTimeout(this.overTimer); this.bestAtStart = this.storage.data.best;
    this.audio.unlock(); this.engine.start(); this.canvas.focus({preventScroll:true});
    if (!this.storage.available) this.toast('Local saving is unavailable. Scores will last for this visit only.');
  }
  bind() {
    this.listen(this.$('play-button'),'click',() => this.start());
    this.listen(this.$('retry-button'),'click',() => this.start());
    this.listen(this.$('resume-button'),'click',() => this.togglePause());
    this.listen(this.$('pause-button'),'click',() => this.togglePause());
    this.listen(this.$('sound-button'),'click',() => {
      this.audio.muted = !this.audio.muted; this.storage.data.muted = this.audio.muted; this.storage.save();
      if (this.audio.muted) this.audio.suspend(); else { this.audio.unlock(); this.audio.play('collect'); }
      this.updateSound();
    });
    for (const button of document.querySelectorAll('[data-menu]')) this.listen(button,'click',() => { clearTimeout(this.overTimer); this.engine.menu(); });
    this.listen(this.$('help-button'),'click',() => this.openDialog('help-dialog'));
    this.listen(this.$('achievements-button'),'click',() => this.openDialog('achievements-dialog'));
    for (const button of document.querySelectorAll('[data-close]')) this.listen(button,'click',() => button.closest('dialog').close());
    for (const dialog of document.querySelectorAll('dialog')) this.listen(dialog,'click',event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    this.listen(this.$('share-button'),'click',() => this.share());
    this.listen(window,'keydown',event => {
      if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]')) return;
      const key = event.key.toLowerCase();
      if (event.target instanceof HTMLElement && event.target.closest('button,a,input,textarea,select')) return;
      if (['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes(key)) {
        if (this.engine.state === 'playing') { event.preventDefault(); this.engine.input.keys.add(key); }
      } else if (!event.repeat && (key === 'p' || key === 'escape')) { event.preventDefault(); this.togglePause(); }
      else if (!event.repeat && (key === ' ' || key === 'enter')) {
        event.preventDefault();
        if (this.engine.state === 'menu' || this.engine.state === 'over') this.start();
        else this.togglePause();
      }
    });
    this.listen(window,'keyup',event => this.engine.input.keys.delete(event.key.toLowerCase()));
    this.listen(this.canvas,'pointerdown',event => {
      if (this.engine.state !== 'playing' || this.pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
      event.preventDefault(); this.audio.unlock(); this.canvas.focus({preventScroll:true});
      this.pointer = event.pointerId; this.lastPointer = this.point(event); this.canvas.setPointerCapture(event.pointerId);
      if (event.pointerType === 'mouse') this.engine.input.target = this.lastPointer;
    });
    this.listen(this.canvas,'pointermove',event => {
      if (this.engine.state !== 'playing') return;
      if (event.pointerType === 'mouse') { this.engine.input.target = this.point(event); return; }
      if (event.pointerId !== this.pointer || !this.lastPointer) return;
      event.preventDefault(); const point = this.point(event), p = this.engine.player;
      const base = this.engine.input.target || p;
      this.engine.input.target = { x:clamp(base.x + point.x - this.lastPointer.x,10,this.engine.width-10), y:clamp(base.y + point.y - this.lastPointer.y,47,this.engine.height-26) };
      this.lastPointer = point;
    },{passive:false});
    const release = event => { if (event.pointerId === this.pointer) { this.pointer = null; this.lastPointer = null; } };
    this.listen(this.canvas,'pointerup',release); this.listen(this.canvas,'pointercancel',release); this.listen(this.canvas,'lostpointercapture',release);
    this.listen(this.canvas,'contextmenu',event => event.preventDefault());
    this.listen(window,'blur',() => { this.engine.pause(); this.pointer = null; });
    this.listen(document,'visibilitychange',() => {
      if (document.hidden) { this.engine.pause(); this.storage.record(this.engine.score.total); this.audio.suspend(); cancelAnimationFrame(this.frameId); this.frameId = 0; }
      else this.wake();
    });
    this.listen(window,'pagehide',event => { this.storage.record(this.engine.score.total); if (!event.persisted) this.dispose(); else { this.engine.pause(); cancelAnimationFrame(this.frameId); this.frameId = 0; } });
    this.listen(window,'pageshow',event => { if (event.persisted) this.wake(); });
  }
  point(event) { const r = this.canvas.getBoundingClientRect(); return {x:(event.clientX-r.left)*this.engine.width/r.width,y:(event.clientY-r.top)*this.engine.height/r.height}; }
  openDialog(id) { this.engine.pause(); this.$(id).showModal(); }
  togglePause() { if (this.engine.state === 'playing') this.engine.pause(); else if (this.engine.state === 'paused') { this.audio.unlock(); this.engine.resume(); this.canvas.focus({preventScroll:true}); } }
  updateSound() {
    const button = this.$('sound-button'); button.setAttribute('aria-label',this.audio.muted ? 'Enable sound' : 'Mute sound'); button.setAttribute('aria-pressed',String(this.audio.muted));
    button.querySelector('use').setAttribute('href',this.audio.muted ? '#i-mute' : '#i-sound');
  }
  overlays(state) {
    for (const key of ['menu','pause','over']) this.$(`${key}-overlay`).hidden = key !== state;
    this.$('arena').classList.toggle('is-playing',state === 'playing');
    this.$('pause-button').disabled = state !== 'playing';
    this.$('arena-status').textContent = {menu:'READY WHEN YOU ARE',playing:'STAY IN THE GAME',pause:'TAKE YOUR TIME',over:'ONE MORE RUN?'}[state] || '';
    if (state === 'menu') this.$('play-button').focus({preventScroll:true});
    if (state === 'pause') this.$('resume-button').focus({preventScroll:true});
    if (state === 'over') this.$('retry-button').focus({preventScroll:true});
  }
  onEvent(type,payload) {
    if (type === 'start') { this.overlays('playing'); this.$('arena').classList.remove('collision'); this.message('AVOID RED. COLLECT GREEN.',1800); }
    if (type === 'pause') { this.overlays('pause'); this.audio.suspend(); }
    if (type === 'resume') this.overlays('playing');
    if (type === 'menu') { this.overlays('menu'); this.clearMessage(); this.lastHud = -1; this.$('arena').classList.remove('collision'); }
    if (type === 'collect') { this.audio.play('collect'); this.message(`+${payload.amount}`,550); }
    if (type === 'bonus') { this.audio.play('bonus'); this.message(`×${payload.multiplier} MULTIPLIER · 8 SECONDS`,1600); this.$('arena').classList.add('bonus-flash'); clearTimeout(this.flashTimer); this.flashTimer = setTimeout(() => this.$('arena').classList.remove('bonus-flash'),350); }
    if (type === 'level') { this.audio.play('level'); this.message(`LEVEL ${payload.level} · KEEP MOVING`,1700); }
    if (type === 'warning') this.audio.play('warning');
    if (type === 'over') {
      this.clearMessage(); this.$('pause-button').disabled = true;
      this.audio.play('over'); this.$('arena').classList.add('collision');
      const isRecord = payload.score > this.bestAtStart; this.persistScore();
      this.$('final-score').textContent = payload.score; this.$('final-best').textContent = this.storage.data.best;
      this.$('record-label').hidden = !isRecord;
      this.$('end-eyebrow').textContent = isRecord ? 'THAT WAS YOUR BEST RUN YET.' : 'SO CLOSE. ONE MORE?';
      this.overTimer = setTimeout(() => {
        if (this.engine.state !== 'over') return;
        this.overlays('over');
        if (isRecord) { this.audio.play('record'); this.engine.particles.burst(this.engine.width*.5,this.engine.height*.35,COLORS.yellow,32); }
      },180);
    }
    this.updateHud();
  }
  persistScore() {
    const fresh = this.storage.record(this.engine.score.total);
    if (fresh.length) { this.toast(`Achievement unlocked: ${fresh.map(a => a.name).join(' · ')}`); this.updateAchievements(); }
  }
  updateHud() {
    const s = this.engine.score, d = this.engine.difficulty;
    this.$('score').textContent = formatScore(s.total);
    this.$('best').textContent = formatScore(Math.max(s.total,this.storage.data.best));
    this.$('multiplier').textContent = `×${s.multiplier}`;
    this.$('multiplier-progress').style.width = `${s.bonusRemaining/8*100}%`;
    this.$('level').textContent = `LEVEL ${String(d.level).padStart(2,'0')}`;
    this.$('level-name').textContent = d.level === 1 ? 'THE WARM-UP' : d.level < 4 ? 'FIND YOUR FLOW' : d.level < 6 ? 'HEATING UP' : 'DANGER ZONE';
    this.$('level-progress').style.width = `${d.level === 15 ? 100 : (s.total%50)/50*100}%`;
    this.$('level-hint').textContent = d.level === 1 ? "LET'S TAKE IT EASY" : d.level < 6 ? 'KEEP YOUR COOL' : 'STAY SHARP';
    if (s.total !== this.lastHud) {
      this.lastHud = s.total;
      if (this.engine.state === 'playing') this.persistScore();
      this.updateMilestone();
    }
  }
  updateMilestone() {
    const best = this.storage.data.best, next = ACHIEVEMENTS.find(a => a.score > best);
    const milestone = next || ACHIEVEMENTS.at(-1);
    this.$('milestone-name').textContent = next ? milestone.name : 'Certified Legend';
    this.$('milestone-description').textContent = next ? milestone.description : 'All milestones unlocked. Keep going.';
    this.$('milestone-target').textContent = `${milestone.score} PTS`;
    this.$('milestone-icon').setAttribute('href',`#i-${milestone.icon}`);
    this.$('milestone-progress').style.width = `${Math.min(100,best/milestone.score*100)}%`;
    this.$('milestone-score').textContent = `${Math.min(best,milestone.score)} / ${milestone.score} points`;
  }
  updateAchievements() {
    const saved = this.storage.data.achievements;
    this.$('achievement-count').textContent = `${saved.length} / 5`;
    this.$('achievement-icons').replaceChildren(); this.$('achievements-list').replaceChildren();
    for (const a of ACHIEVEMENTS) {
      const earned = saved.includes(a.name);
      const button = document.createElement('button'); button.className = `achievement-badge${earned?' unlocked':''}`;
      button.setAttribute('aria-label',`${a.name}: ${a.score} points${earned?', unlocked':', locked'}`); button.title = button.getAttribute('aria-label');
      button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${a.icon}"/></svg>`;
      button.onclick = () => this.openDialog('achievements-dialog'); this.$('achievement-icons').append(button);
      const row = document.createElement('div'); row.className = `achievement-row${earned?' earned':''}`;
      row.innerHTML = `<span class="achievement-badge${earned?' unlocked':''}"><svg class="icon" aria-hidden="true"><use href="#i-${a.icon}"/></svg></span><div><h3>${a.name}</h3><p>Reach ${a.score} points</p></div><span>${earned?'UNLOCKED':'LOCKED'}</span>`;
      this.$('achievements-list').append(row);
    }
    this.updateMilestone();
  }
  message(text,duration) { this.$('arena-message').textContent = text; this.$('arena-message').classList.add('visible'); clearTimeout(this.messageTimer); this.messageTimer = setTimeout(() => this.clearMessage(),duration); }
  clearMessage() { clearTimeout(this.messageTimer); this.$('arena-message').classList.remove('visible'); }
  toast(text) { this.$('toast').textContent = text; this.$('toast').classList.add('visible'); clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => this.$('toast').classList.remove('visible'),3500); }
  async share() {
    const text = `I scored ${this.engine.score.total} in DON'T TOUCH RED 🔴 Can you beat me?`;
    const url = new URL('.',window.location.href).href;
    try {
      if (navigator.share) {
        try { await navigator.share({title:"DON'T TOUCH RED",text,url}); return; }
        catch (error) { if (error.name === 'AbortError') return; }
      }
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(`${text}\n${url}`); this.toast('Score copied. Challenge someone!'); }
      else this.copyFallback(`${text}\n${url}`);
    } catch { this.copyFallback(`${text}\n${url}`); }
  }
  copyFallback(text) {
    const field = document.createElement('textarea'); field.value = text; field.setAttribute('readonly','');
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.append(field); field.select();
    try { if (!document.execCommand('copy')) throw new Error('Copy unavailable'); this.toast('Score copied. Challenge someone!'); }
    catch { window.prompt('Copy your score to share:',text); }
    finally { field.remove(); }
  }
  wake() { if (this.frameId || this.disposed || document.hidden) return; this.lastFrame = 0; this.accumulator = 0; this.frameId = requestAnimationFrame(this.frame); }
  frame(now) {
    this.frameId = 0;
    if (this.disposed || document.hidden) return;
    const dt = this.lastFrame ? Math.min((now-this.lastFrame)/1000,.05) : 0; this.lastFrame = now;
    this.accumulator += dt;
    // Fixed steps keep movement and collision behavior independent of display refresh rate.
    while (this.accumulator >= 1/120) { this.engine.tick(1/120); this.accumulator -= 1/120; }
    const interval = this.engine.state === 'playing' || (this.engine.state === 'over' && this.engine.particles.items.length) ? 0 : 1000/30;
    if (now-this.lastDraw >= interval) { this.renderer.draw(now/1000); this.lastDraw = now; }
    if (!this.hudTime || now-this.hudTime >= 100) { this.updateHud(); this.hudTime = now; }
    this.frameId = requestAnimationFrame(this.frame);
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frameId); this.handlers.abort(); this.resizeObserver.disconnect(); this.audio.dispose();
    for (const timer of [this.toastTimer,this.messageTimer,this.overTimer,this.flashTimer]) clearTimeout(timer);
  }
}

if (typeof document !== 'undefined') {
  const game = new GameUI();
  if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
}
