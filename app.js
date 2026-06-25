/* ============================================
   PulseChord — App Logic
   Omnichord-style : accords + mélodie + rec
============================================ */

// ─ Constantes musicales ──────────────────────────────

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const SCALES = {
  major:      [0,2,4,5,7,9,11],
  minor:      [0,2,3,5,7,8,10],
  pentatonic: [0,2,4,7,9],
  blues:      [0,3,5,6,7,10],
  dorian:     [0,2,3,5,7,9,10],
  lydian:     [0,2,4,6,7,9,11],
};

// 4 rangées d'accords comme l'Omnichord
const CHORD_ROWS = [
  { label: 'Maj',  type: 'major',  intervals: [0,4,7],       row: 'row-major' },
  { label: 'min',  type: 'minor',  intervals: [0,3,7],       row: 'row-minor' },
  { label: '7th',  type: 'dom7',   intervals: [0,4,7,10],    row: 'row-7th'   },
  { label: 'dim',  type: 'dim',    intervals: [0,3,6,9],     row: 'row-dim'   },
];

// Touches clavier pour mélodie (rangée home QWERTY)
const MELODY_KEYS = ['a','s','d','f','g','h','j','k','l',';',"'",','];
// Touches pour accords (chiffres 1-8 par colonne)
const CHORD_KEYS  = ['1','2','3','4','5','6','7','8'];

// ─ État ────────────────────────────────────────────────

const state = {
  root:        'C',
  scale:       'minor',
  preset:      'omnicord',
  recState:    'idle',   // idle | recording | stopped
  recBlob:     null,
  recSeconds:  0,
  recTimer:    null,
};

// Handles actifs clavier (pour stopNote au keyup)
const kbHandles = {};

// ─ Utilitaires ──────────────────────────────────────

function midiToHz(midi) { return Audio.midiToHz(midi); }

function getRootMidi(rootName, octave) {
  return NOTE_NAMES.indexOf(rootName) + (octave + 1) * 12;
}

// Retourne les fréquences d'un accord
function chordFreqs(rootName, intervals, octave) {
  const base = getRootMidi(rootName, octave);
  return intervals.map(i => midiToHz(base + i));
}

// Retourne les 12 notes chromatiques… non : notes de la gamme sur N octaves
function scaleFreqs(rootName, scaleName, octave, count) {
  const intervals = SCALES[scaleName] || SCALES.minor;
  const rootIdx   = NOTE_NAMES.indexOf(rootName);
  const notes     = [];
  let oct = octave - 1;
  for (let i = 0; notes.length < count; i++) {
    if (i > 0 && i % intervals.length === 0) oct++;
    const midi = rootIdx + intervals[i % intervals.length] + (oct + 1) * 12;
    notes.push({ freq: midiToHz(midi), name: NOTE_NAMES[midi % 12], isRoot: (midi % 12) === rootIdx });
  }
  return notes;
}

// Notes dérivées de la gamme pour construire les colonnes d'accords
function getDegreeRoots(rootName, scaleName, octave) {
  const intervals = SCALES[scaleName] || SCALES.minor;
  const rootIdx   = NOTE_NAMES.indexOf(rootName);
  return intervals.slice(0, 8).map(iv => {
    const idx = (rootIdx + iv) % 12;
    return { name: NOTE_NAMES[idx], midi: idx + (octave + 1) * 12 };
  });
}

// ─ Construction grille accords ──────────────────────

function buildChordGrid() {
  const grid   = document.getElementById('chord-grid');
  const params = Audio.getParams();
  const degrees = getDegreeRoots(state.root, state.scale, params.octave);
  grid.innerHTML = '';

  CHORD_ROWS.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'chord-row';

    const label = document.createElement('span');
    label.className = 'chord-row-label';
    label.textContent = row.label;
    rowEl.appendChild(label);

    degrees.forEach((deg, colIdx) => {
      const freqs = chordFreqs(deg.name, row.intervals, params.octave);
      const btn   = document.createElement('button');
      btn.className = `chord-btn ${row.row}`;
      btn.dataset.row = row.type;
      btn.dataset.col = colIdx;
      btn.innerHTML = `${deg.name}<small>${row.label}</small>`;
      if (CHORD_KEYS[colIdx] && row.row === 'row-major') {
        btn.innerHTML += `<kbd>${CHORD_KEYS[colIdx]}</kbd>`;
      }

      // Pointer events (souris + tactile)
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        Audio.ensureContext();
        Audio.strumChord(freqs, 'up');
        btn.classList.add('active');
      });
      btn.addEventListener('pointerup',    () => btn.classList.remove('active'));
      btn.addEventListener('pointerleave', () => btn.classList.remove('active'));

      rowEl.appendChild(btn);
    });

    grid.appendChild(rowEl);
  });
}

// ─ Construction surface mélodie ─────────────────────

function buildMelodySurface() {
  const surface = document.getElementById('melody-surface');
  const params  = Audio.getParams();
  const notes   = scaleFreqs(state.root, state.scale, params.octave, MELODY_KEYS.length);
  surface.innerHTML = '';

  notes.forEach((note, i) => {
    const key = document.createElement('div');
    key.className = 'melody-key' + (note.isRoot ? ' is-root' : '');
    key.dataset.idx = i;
    key.innerHTML = `<kbd>${(MELODY_KEYS[i] || '').toUpperCase()}</kbd><span>${note.name}</span>`;
    key.setAttribute('role', 'button');
    key.setAttribute('aria-label', `Note ${note.name}`);

    let handle = null;
    const press = () => {
      if (handle) return;
      Audio.ensureContext();
      handle = Audio.playNote(note.freq);
      key.classList.add('active');
    };
    const release = () => {
      if (handle) { Audio.stopNote(handle); handle = null; }
      key.classList.remove('active');
    };

    key.addEventListener('pointerdown', e => { e.preventDefault(); press(); });
    key.addEventListener('pointerup',    release);
    key.addEventListener('pointerleave', release);

    surface.appendChild(key);
  });
}

// ─ Clavier ordinateur ──────────────────────────────

function initKeyboard() {
  document.addEventListener('keydown', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.repeat) return;
    const key = e.key.toLowerCase();

    // Mélodie : A S D F G H J K L ; ' ,
    const mIdx = MELODY_KEYS.indexOf(key);
    if (mIdx !== -1 && !kbHandles['m' + mIdx]) {
      const params = Audio.getParams();
      const notes  = scaleFreqs(state.root, state.scale, params.octave, MELODY_KEYS.length);
      if (!notes[mIdx]) return;
      Audio.ensureContext();
      kbHandles['m' + mIdx] = Audio.playNote(notes[mIdx].freq);
      const el = document.querySelector(`[data-idx="${mIdx}"]`);
      if (el) el.classList.add('active');
      return;
    }

    // Accords : 1-8 → strum ligne Majeure
    const cIdx = CHORD_KEYS.indexOf(key);
    if (cIdx !== -1 && !kbHandles['c' + cIdx]) {
      const params  = Audio.getParams();
      const degrees = getDegreeRoots(state.root, state.scale, params.octave);
      if (!degrees[cIdx]) return;
      Audio.ensureContext();
      const freqs = chordFreqs(degrees[cIdx].name, CHORD_ROWS[0].intervals, params.octave);
      Audio.strumChord(freqs, 'up');
      kbHandles['c' + cIdx] = true;
      const btn = document.querySelector(`.chord-btn[data-row="major"][data-col="${cIdx}"]`);
      if (btn) { btn.classList.add('active'); setTimeout(() => btn.classList.remove('active'), 300); }
      return;
    }

    // Octave Z / X
    if (key === 'z') { changeOctave(-1); return; }
    if (key === 'x') { changeOctave(+1); return; }

    // R : rec toggle
    if (key === 'r') {
      if (state.recState === 'idle' || state.recState === 'stopped') startRec();
      else if (state.recState === 'recording') stopRec();
      return;
    }

    // Espace : strum accord actif (premier degré par défaut)
    if (key === ' ') {
      e.preventDefault();
      const params  = Audio.getParams();
      const degrees = getDegreeRoots(state.root, state.scale, params.octave);
      Audio.ensureContext();
      Audio.strumChord(chordFreqs(degrees[0].name, CHORD_ROWS[0].intervals, params.octave), 'up');
      return;
    }
  });

  document.addEventListener('keyup', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    const key = e.key.toLowerCase();

    const mIdx = MELODY_KEYS.indexOf(key);
    if (mIdx !== -1) {
      const h = kbHandles['m' + mIdx];
      if (h) { Audio.stopNote(h); delete kbHandles['m' + mIdx]; }
      const el = document.querySelector(`[data-idx="${mIdx}"]`);
      if (el) el.classList.remove('active');
    }

    const cIdx = CHORD_KEYS.indexOf(key);
    if (cIdx !== -1) delete kbHandles['c' + cIdx];
  });
}

function changeOctave(delta) {
  const el  = document.getElementById('ctrl-octave');
  if (!el) return;
  const val = Math.min(7, Math.max(2, parseInt(el.value) + delta));
  el.value  = val;
  document.getElementById('val-octave').textContent = val;
  Audio.setParam('octave', val);
  buildChordGrid();
  buildMelodySurface();
}

// ─ Recorder ─────────────────────────────────────────

function startRec() {
  if (state.recState === 'recording') return;
  Audio.startRecording();
  state.recState   = 'recording';
  state.recSeconds = 0;
  document.getElementById('btn-rec').classList.add('recording');
  document.getElementById('btn-stop').disabled   = false;
  document.getElementById('btn-export').disabled = true;
  document.getElementById('rec-info').textContent = 'Enregistrement…';
  document.getElementById('status-badge').textContent = 'REC';
  document.getElementById('status-badge').classList.add('recording');
  state.recTimer = setInterval(() => {
    state.recSeconds++;
    document.getElementById('rec-timer').textContent = fmtTime(state.recSeconds);
  }, 1000);
}

async function stopRec() {
  if (state.recState !== 'recording') return;
  clearInterval(state.recTimer);
  state.recState = 'stopped';
  state.recBlob  = await Audio.stopRecording();
  document.getElementById('btn-rec').classList.remove('recording');
  document.getElementById('btn-stop').disabled   = true;
  document.getElementById('btn-export').disabled = false;
  document.getElementById('rec-info').textContent = `Prêt — ${fmtTime(state.recSeconds)}`;
  document.getElementById('status-badge').textContent = 'READY';
  document.getElementById('status-badge').classList.remove('recording');
}

function fmtTime(s) {
  return String(Math.floor(s / 60)).padStart(2,'0') + ':' + String(s % 60).padStart(2,'0');
}

// ─ Export MP3 (lamejs) ─────────────────────────────

async function exportMP3() {
  if (!state.recBlob) return;
  document.getElementById('rec-info').textContent = 'Conversion MP3…';
  document.getElementById('btn-export').disabled  = true;
  try {
    const ab      = await state.recBlob.arrayBuffer();
    const tmpCtx  = new AudioContext();
    const decoded = await tmpCtx.decodeAudioData(ab);
    tmpCtx.close();

    const sr    = decoded.sampleRate;
    const ch    = decoded.numberOfChannels;
    const left  = decoded.getChannelData(0);
    const right = ch > 1 ? decoded.getChannelData(1) : left;

    const enc   = new lamejs.Mp3Encoder(2, sr, 320);
    const block = 1152;
    const out   = [];

    for (let i = 0; i < left.length; i += block) {
      const l = toInt16(left.subarray(i, i + block));
      const r = toInt16(right.subarray(i, i + block));
      const c = enc.encodeBuffer(l, r);
      if (c.length > 0) out.push(new Int8Array(c));
    }
    const fin = enc.flush();
    if (fin.length > 0) out.push(new Int8Array(fin));

    const url = URL.createObjectURL(new Blob(out, { type: 'audio/mp3' }));
    const a   = Object.assign(document.createElement('a'), {
      href: url, download: `pulsechord_${Date.now()}.mp3`
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    document.getElementById('rec-info').textContent = 'MP3 téléchargé ✓';
  } catch (err) {
    console.error(err);
    // Fallback : télécharge le webm brut
    const url = URL.createObjectURL(state.recBlob);
    const a   = Object.assign(document.createElement('a'), {
      href: url, download: `pulsechord_${Date.now()}.webm`
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    document.getElementById('rec-info').textContent = 'Exporté en WebM';
  }
  document.getElementById('btn-export').disabled = false;
}

function toInt16(f32) {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i]  = s < 0 ? s * 32768 : s * 32767;
  }
  return i16;
}

// ─ Visualiseur ──────────────────────────────────────

function initVisualizer() {
  const canvas = document.getElementById('visualizer');
  const ctx2d  = canvas.getContext('2d');

  function draw() {
    requestAnimationFrame(draw);
    const analyser = Audio.getAnalyser();
    const W = canvas.width  = canvas.offsetWidth;
    const H = canvas.height = 50;
    ctx2d.clearRect(0, 0, W, H);
    if (!analyser) return;

    const buf  = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buf);

    ctx2d.lineWidth   = 2;
    ctx2d.strokeStyle = 'rgba(168,85,247,0.8)';
    ctx2d.shadowBlur  = 6;
    ctx2d.shadowColor = '#a855f7';
    ctx2d.beginPath();
    const sw = W / buf.length;
    buf.forEach((v, i) => {
      const x = i * sw;
      const y = (v / 128) * H / 2;
      i === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y);
    });
    ctx2d.lineTo(W, H / 2);
    ctx2d.stroke();
  }
  draw();
}

// ─ Binding contrôles ───────────────────────────────

function initControls() {
  // Key / Scale / Preset
  document.getElementById('sel-root').addEventListener('change', e => {
    state.root = e.target.value;
    buildChordGrid();
    buildMelodySurface();
  });
  document.getElementById('sel-scale').addEventListener('change', e => {
    state.scale = e.target.value;
    buildChordGrid();
    buildMelodySurface();
  });
  document.getElementById('sel-preset').addEventListener('change', e => {
    state.preset = e.target.value;
    Audio.setPreset(e.target.value);
    syncPresetControls();
  });

  // Sliders FX
  const sliders = [
    { id: 'ctrl-octave',  val: 'val-octave',  fmt: v => v,                     key: 'octave',  rebuild: true  },
    { id: 'ctrl-filter',  val: 'val-filter',  fmt: v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : `${v}`, key: 'filter'  },
    { id: 'ctrl-reverb',  val: 'val-reverb',  fmt: v => `${Math.round(v*100)}%`, key: 'reverb'  },
    { id: 'ctrl-delay',   val: 'val-delay',   fmt: v => `${Math.round(v*100)}%`, key: 'delay'   },
    { id: 'ctrl-strum',   val: 'val-strum',   fmt: v => `${v}ms`,                key: 'strumMs' },
    { id: 'ctrl-volume',  val: 'val-volume',  fmt: v => `${Math.round(v*100)}%`, key: 'volume'  },
  ];
  sliders.forEach(({ id, val, fmt, key, rebuild }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      document.getElementById(val).textContent = fmt(v);
      Audio.setParam(key, v);
      if (rebuild) { buildChordGrid(); buildMelodySurface(); }
    });
  });

  // Recorder
  document.getElementById('btn-rec').addEventListener('click', startRec);
  document.getElementById('btn-stop').addEventListener('click', stopRec);
  document.getElementById('btn-export').addEventListener('click', exportMP3);
}

// Synchronise les sliders visuels après changement de preset
function syncPresetControls() {
  const pr = Audio.getParams();
  const map = [
    ['ctrl-filter',  'val-filter',  pr.filter,  v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : `${v}`],
    ['ctrl-reverb',  'val-reverb',  pr.reverb,  v => `${Math.round(v*100)}%`],
    ['ctrl-delay',   'val-delay',   pr.delay,   v => `${Math.round(v*100)}%`],
    ['ctrl-strum',   'val-strum',   pr.strumMs, v => `${v}ms`],
    ['ctrl-volume',  'val-volume',  pr.volume,  v => `${Math.round(v*100)}%`],
  ];
  map.forEach(([ctrlId, valId, val, fmt]) => {
    const el = document.getElementById(ctrlId);
    if (el) el.value = val;
    const vl = document.getElementById(valId);
    if (vl) vl.textContent = fmt(val);
  });
}

// ─ Init ───────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  buildChordGrid();
  buildMelodySurface();
  initControls();
  initKeyboard();
  initVisualizer();
});
