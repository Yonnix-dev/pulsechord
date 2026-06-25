/* =============================================
   PulseChord — App Logic
   Grilles accords/mélodie, séquenceur, presets,
   recorder, export MP3 via lamejs
============================================= */

// ── Constantes musicales ──────────────────────────────────────────────────────

const SCALES = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues:      [0, 3, 5, 6, 7, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const CHORD_TEMPLATES = {
  major:      [0, 4, 7],
  minor:      [0, 3, 7],
  major7:     [0, 4, 7, 11],
  minor7:     [0, 3, 7, 10],
  dom7:       [0, 4, 7, 10],
  sus2:       [0, 2, 7],
  sus4:       [0, 5, 7],
  dim:        [0, 3, 6],
  aug:        [0, 4, 8],
  add9:       [0, 4, 7, 14],
};

const PRESETS = {
  techno: {
    engine:'lead', waveform:'sawtooth', attack:0.005, release:0.15,
    filter:1200, resonance:18, reverb:0.05, delay:0.3, distortion:200,
    bitcrush:8, volume:0.85, root:'A', scale:'minor', arp:'up', bpm:138
  },
  ambient: {
    engine:'pad', waveform:'sine', attack:0.8, release:3,
    filter:14000, resonance:1, reverb:0.85, delay:0.5, distortion:0,
    bitcrush:16, volume:0.7, root:'C', scale:'lydian', arp:'off', bpm:75
  },
  trap: {
    engine:'bass', waveform:'square', attack:0.01, release:0.25,
    filter:900, resonance:8, reverb:0.1, delay:0.15, distortion:80,
    bitcrush:16, volume:0.9, root:'G#', scale:'minor', arp:'down', bpm:140
  },
  melodic: {
    engine:'keys', waveform:'triangle', attack:0.02, release:0.8,
    filter:16000, resonance:2, reverb:0.4, delay:0.2, distortion:0,
    bitcrush:16, volume:0.75, root:'F', scale:'dorian', arp:'updown', bpm:100
  }
};

// ── État global ───────────────────────────────────────────────────────────────
let state = {
  root: 'C',
  scale: 'minor',
  arp: 'off',
  bpm: 120,
  swing: 0,
  seqSteps: 8,
  seqRunning: false,
  seqStep: 0,
  seqNotes: [],
  seqData: [],
  arpInterval: null,
  activeChordHandle: [],
  recState: 'idle',
  recBlob: null,
  recSeconds: 0,
  recTimer: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function midiToHz(midi) { return Audio.midiToHz(midi); }

function getScaleNotes(root, scaleName, octave = 4, count = 16) {
  const intervals = SCALES[scaleName] || SCALES.minor;
  const rootIdx   = NOTE_NAMES.indexOf(root);
  const notes = [];
  let oct = octave - 1;
  for (let i = 0; notes.length < count; i++) {
    const interval = intervals[i % intervals.length];
    if (i > 0 && i % intervals.length === 0) oct++;
    const midiNote = (rootIdx + interval) + (oct + 1) * 12;
    notes.push(midiToHz(midiNote));
  }
  return notes;
}

function getChordFreqs(root, chordType, octave) {
  const intervals = CHORD_TEMPLATES[chordType] || CHORD_TEMPLATES.minor;
  const rootMidi  = NOTE_NAMES.indexOf(root) + (octave + 1) * 12;
  return intervals.map(i => midiToHz(rootMidi + i));
}

function getDegreeChords(root, scaleName, octave) {
  const intervals = SCALES[scaleName] || SCALES.minor;
  const rootIdx   = NOTE_NAMES.indexOf(root);
  const degrees   = ['I','II','III','IV','V','VI','VII','VIII'];
  return intervals.slice(0, 8).map((interval, i) => {
    const noteIdx  = (rootIdx + interval) % 12;
    const noteName = NOTE_NAMES[noteIdx];
    const third    = intervals[(i + 2) % intervals.length] - interval;
    const quality  = third >= 4 ? 'major' : 'minor';
    const freqs    = getChordFreqs(noteName, quality, octave);
    return { label: `${degrees[i]}\n${noteName}`, freqs, noteName, quality };
  });
}

// ── Grille Accords ────────────────────────────────────────────────────────────
// Touches 1-8 pour les accords
const CHORD_KEYS = ['1','2','3','4','5','6','7','8'];

function buildChordGrid() {
  const grid   = document.getElementById('chord-grid');
  const params = Audio.getParams();
  const chords = getDegreeChords(state.root, state.scale, params.octave);
  grid.innerHTML = '';
  chords.forEach(({ label, freqs, noteName, quality }, i) => {
    const btn = document.createElement('button');
    btn.className = 'chord-btn';
    btn.dataset.chordIndex = i;
    const keyHint = CHORD_KEYS[i] ? `<kbd>${CHORD_KEYS[i]}</kbd>` : '';
    btn.innerHTML = `${keyHint}${label.replace('\n', '<br><small>')}` + '</small>';
    btn.setAttribute('aria-label', `Accord ${noteName} ${quality}`);

    let handle = [];
    const press = () => {
      Audio.ensureContext();
      handle = Audio.playChord(freqs, 4);
      startArpeggio(freqs);
      btn.classList.add('active');
    };
    const release = () => {
      handle.forEach(h => Audio.stopNote(h));
      stopArpeggio();
      btn.classList.remove('active');
      handle = [];
    };
    btn.addEventListener('pointerdown', e => { e.preventDefault(); press(); });
    btn.addEventListener('pointerup',    release);
    btn.addEventListener('pointerleave', release);
    grid.appendChild(btn);
  });
}

// ── Grille Mélodie ────────────────────────────────────────────────────────────
// Rangée principale du clavier AZERTY/QWERTY : A S D F G H J K L ; '
const MELODY_KEYS = ['a','s','d','f','g','h','j','k','l',';',"'"];

function buildMelodyGrid() {
  const grid   = document.getElementById('melody-grid');
  const params = Audio.getParams();
  const notes  = getScaleNotes(state.root, state.scale, params.octave, 24);
  grid.innerHTML = '';

  notes.slice(0, 24).forEach((freq, i) => {
    const btn = document.createElement('button');
    btn.className = 'melody-btn';
    btn.dataset.melodyIndex = i;
    const midi    = Math.round(69 + 12 * Math.log2(freq / 440));
    const name    = NOTE_NAMES[midi % 12];
    const keyHint = MELODY_KEYS[i] ? `<kbd>${MELODY_KEYS[i].toUpperCase()}</kbd>` : '';
    btn.innerHTML = `${keyHint}<span>${name}</span>`;
    btn.title = `${freq.toFixed(1)} Hz`;

    let h = null;
    const press = () => {
      Audio.ensureContext();
      h = Audio.playNote(freq);
      btn.classList.add('active');
    };
    const rel = () => {
      if (h) { Audio.stopNote(h); h = null; }
      btn.classList.remove('active');
    };
    btn.addEventListener('pointerdown', e => { e.preventDefault(); press(); });
    btn.addEventListener('pointerup',    rel);
    btn.addEventListener('pointerleave', rel);
    grid.appendChild(btn);
  });

  state.seqNotes = notes.slice(0, 16);
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
// Garde en mémoire les handles actifs par touche pour stopper proprement
const kbHandles = {};

function initKeyboard() {
  document.addEventListener('keydown', e => {
    // Ne rien faire si on tape dans un input/select
    if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    const key = e.key.toLowerCase();
    if (e.repeat) return; // évite la répétition auto du système

    // ─ Mélodie (rangée A-')
    const melIdx = MELODY_KEYS.indexOf(key);
    if (melIdx !== -1 && !kbHandles['m' + melIdx]) {
      const btn = document.querySelector(`[data-melody-index="${melIdx}"]`);
      if (btn) {
        Audio.ensureContext();
        const notes = getScaleNotes(state.root, state.scale, Audio.getParams().octave, 24);
        const freq  = notes[melIdx];
        kbHandles['m' + melIdx] = Audio.playNote(freq);
        btn.classList.add('active');
      }
      return;
    }

    // ─ Accords (1-8)
    const chordIdx = CHORD_KEYS.indexOf(key);
    if (chordIdx !== -1 && !kbHandles['c' + chordIdx]) {
      const btn = document.querySelector(`[data-chord-index="${chordIdx}"]`);
      if (btn) {
        Audio.ensureContext();
        const params = Audio.getParams();
        const chords = getDegreeChords(state.root, state.scale, params.octave);
        const chord  = chords[chordIdx];
        if (chord) {
          kbHandles['c' + chordIdx] = Audio.playChord(chord.freqs, 4);
          startArpeggio(chord.freqs);
          btn.classList.add('active');
        }
      }
      return;
    }

    // ─ Octave down (Z) / up (X)
    if (key === 'z') {
      const el = document.getElementById('octave');
      if (el && parseInt(el.value) > parseInt(el.min)) {
        el.value = parseInt(el.value) - 1;
        el.dispatchEvent(new Event('input'));
        flashKey('z');
      }
      return;
    }
    if (key === 'x') {
      const el = document.getElementById('octave');
      if (el && parseInt(el.value) < parseInt(el.max)) {
        el.value = parseInt(el.value) + 1;
        el.dispatchEvent(new Event('input'));
        flashKey('x');
      }
      return;
    }

    // ─ REC (R)
    if (key === 'r') {
      if (state.recState === 'idle' || state.recState === 'stopped') startRec();
      else if (state.recState === 'recording') stopRec();
      return;
    }

    // ─ Séquenceur Play/Stop (Espace)
    if (key === ' ') {
      e.preventDefault();
      state.seqRunning ? seqStop() : seqPlay();
      return;
    }
  });

  document.addEventListener('keyup', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    const key = e.key.toLowerCase();

    // Release mélodie
    const melIdx = MELODY_KEYS.indexOf(key);
    if (melIdx !== -1) {
      const h   = kbHandles['m' + melIdx];
      const btn = document.querySelector(`[data-melody-index="${melIdx}"]`);
      if (h) { Audio.stopNote(h); delete kbHandles['m' + melIdx]; }
      if (btn) btn.classList.remove('active');
      return;
    }

    // Release accord
    const chordIdx = CHORD_KEYS.indexOf(key);
    if (chordIdx !== -1) {
      const handles = kbHandles['c' + chordIdx];
      const btn     = document.querySelector(`[data-chord-index="${chordIdx}"]`);
      if (handles) { handles.forEach(h => Audio.stopNote(h)); delete kbHandles['c' + chordIdx]; stopArpeggio(); }
      if (btn) btn.classList.remove('active');
      return;
    }
  });
}

// Flash visuel pour les touches octave Z/X
function flashKey(key) {
  const el = document.querySelector(`[data-kb="${key}"]`);
  if (!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 200);
}

// ── Arpégiateur ──────────────────────────────────────────────────────────────

let arpIndex = 0;
let arpDir   = 1;
let arpFreqs = [];

function startArpeggio(freqs) {
  if (state.arp === 'off') return;
  stopArpeggio();
  arpFreqs = [...freqs];
  arpIndex = 0; arpDir = 1;
  const interval = (60 / state.bpm) * 1000 * 0.5;
  state.arpInterval = setInterval(() => {
    if (!arpFreqs.length) return;
    let idx = arpIndex;
    switch (state.arp) {
      case 'up':     idx = arpIndex % arpFreqs.length; arpIndex++; break;
      case 'down':   idx = arpFreqs.length - 1 - (arpIndex % arpFreqs.length); arpIndex++; break;
      case 'updown':
        idx = Math.abs(arpIndex % (arpFreqs.length * 2 - 2));
        if (idx >= arpFreqs.length) idx = arpFreqs.length * 2 - 2 - idx;
        arpIndex++;
        break;
      case 'random': idx = Math.floor(Math.random() * arpFreqs.length); break;
    }
    Audio.playNote(arpFreqs[Math.min(idx, arpFreqs.length - 1)], 60 / state.bpm * 0.4);
  }, interval);
}

function stopArpeggio() {
  if (state.arpInterval) { clearInterval(state.arpInterval); state.arpInterval = null; }
  arpIndex = 0;
}

// ── Séquenceur ────────────────────────────────────────────────────────────────

function buildSeqGrid() {
  const grid = document.getElementById('seq-grid');
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `repeat(${state.seqSteps}, 1fr)`;
  const rows = 4;
  state.seqData = Array.from({ length: rows }, () => Array(state.seqSteps).fill(false));
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < state.seqSteps; s++) {
      const cell = document.createElement('button');
      cell.className = 'seq-cell';
      cell.dataset.row  = r;
      cell.dataset.step = s;
      cell.setAttribute('aria-label', `Step ${s + 1} row ${r + 1}`);
      cell.addEventListener('click', () => {
        state.seqData[r][s] = !state.seqData[r][s];
        cell.classList.toggle('active', state.seqData[r][s]);
      });
      grid.appendChild(cell);
    }
  }
}

let seqTimeout = null;

function seqTick() {
  if (!state.seqRunning) return;
  const step     = state.seqStep;
  const bpm      = state.bpm;
  const interval = (60 / bpm) * 1000 * (1 + (step % 2 === 1 ? state.swing : 0));
  document.querySelectorAll('.seq-cell').forEach(c =>
    c.classList.toggle('playing', parseInt(c.dataset.step) === step));
  for (let r = 0; r < state.seqData.length; r++) {
    if (state.seqData[r][step]) {
      const freq = state.seqNotes[r * 4] || 440;
      Audio.playNote(freq, 60 / bpm * 0.5);
    }
  }
  state.seqStep = (step + 1) % state.seqSteps;
  seqTimeout = setTimeout(seqTick, interval);
}

function seqPlay() {
  if (state.seqRunning) return;
  Audio.ensureContext();
  state.seqRunning = true;
  state.seqStep    = 0;
  document.getElementById('seq-play').classList.add('active');
  seqTick();
}

function seqStop() {
  state.seqRunning = false;
  clearTimeout(seqTimeout);
  document.querySelectorAll('.seq-cell').forEach(c => c.classList.remove('playing'));
  document.getElementById('seq-play').classList.remove('active');
}

// ── Recorder ─────────────────────────────────────────────────────────────────

function startRec() {
  if (state.recState === 'recording') return;
  Audio.startRecording();
  state.recState = 'recording'; state.recSeconds = 0;
  updateRecBadge();
  document.getElementById('btn-rec').classList.add('recording');
  document.getElementById('btn-stop').disabled   = false;
  document.getElementById('btn-export').disabled = true;
  document.getElementById('rec-info').textContent = 'Enregistrement en cours…';
  document.getElementById('status-badge').textContent = 'REC';
  document.getElementById('status-badge').classList.add('recording');
  state.recTimer = setInterval(() => { state.recSeconds++; updateRecBadge(); }, 1000);
}

async function stopRec() {
  if (state.recState !== 'recording') return;
  clearInterval(state.recTimer);
  state.recState = 'stopped';
  const blob = await Audio.stopRecording();
  state.recBlob = blob;
  document.getElementById('btn-rec').classList.remove('recording');
  document.getElementById('btn-stop').disabled   = true;
  document.getElementById('btn-export').disabled = false;
  document.getElementById('rec-info').textContent = `Prêt à exporter — ${formatTime(state.recSeconds)}`;
  document.getElementById('status-badge').textContent = 'READY';
  document.getElementById('status-badge').classList.remove('recording');
}

function updateRecBadge() {
  document.getElementById('rec-timer').textContent = formatTime(state.recSeconds);
}

function formatTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ── Export MP3 via lamejs ─────────────────────────────────────────────────────

async function exportMP3() {
  if (!state.recBlob) return;
  document.getElementById('rec-info').textContent = 'Conversion MP3…';
  document.getElementById('btn-export').disabled  = true;
  try {
    const arrayBuffer = await state.recBlob.arrayBuffer();
    const tmpCtx      = new AudioContext();
    const decoded     = await tmpCtx.decodeAudioData(arrayBuffer);
    tmpCtx.close();
    const sampleRate = decoded.sampleRate;
    const channels   = decoded.numberOfChannels;
    const left       = decoded.getChannelData(0);
    const right      = channels > 1 ? decoded.getChannelData(1) : left;
    const mp3enc  = new lamejs.Mp3Encoder(2, sampleRate, 320);
    const blockSize = 1152;
    const mp3Data   = [];
    for (let i = 0; i < left.length; i += blockSize) {
      const chunk = mp3enc.encodeBuffer(toInt16(left.subarray(i, i + blockSize)), toInt16(right.subarray(i, i + blockSize)));
      if (chunk.length > 0) mp3Data.push(new Int8Array(chunk));
    }
    const final = mp3enc.flush();
    if (final.length > 0) mp3Data.push(new Int8Array(final));
    const url = URL.createObjectURL(new Blob(mp3Data, { type: 'audio/mp3' }));
    const a   = Object.assign(document.createElement('a'), { href: url, download: `pulsechord_${Date.now()}.mp3` });
    a.click(); URL.revokeObjectURL(url);
    document.getElementById('rec-info').textContent = 'MP3 téléchargé ! ✓';
  } catch (err) {
    console.error('Export MP3 error:', err);
    const url = URL.createObjectURL(state.recBlob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: `pulsechord_${Date.now()}.webm` });
    a.click(); URL.revokeObjectURL(url);
    document.getElementById('rec-info').textContent = 'Exporté en WebM (lamejs non disponible)';
  }
  document.getElementById('btn-export').disabled = false;
}

function toInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return int16;
}

// ── Visualiseur ──────────────────────────────────────────────────────────────

const canvas    = document.getElementById('visualizer');
const canvasCtx = canvas.getContext('2d');

function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);
  const analyser = Audio.getAnalyser();
  if (!analyser) return;
  const bufLen = analyser.frequencyBinCount;
  const data   = new Uint8Array(bufLen);
  analyser.getByteTimeDomainData(data);
  canvasCtx.fillStyle = 'rgba(15,13,26,0.6)';
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
  canvasCtx.lineWidth   = 2;
  canvasCtx.strokeStyle = 'rgba(168,85,247,0.85)';
  canvasCtx.shadowBlur  = 8;
  canvasCtx.shadowColor = '#a855f7';
  canvasCtx.beginPath();
  const sliceW = canvas.width / bufLen;
  let x = 0;
  for (let i = 0; i < bufLen; i++) {
    const v = data[i] / 128;
    const y = (v * canvas.height) / 2;
    i === 0 ? canvasCtx.moveTo(x, y) : canvasCtx.lineTo(x, y);
    x += sliceW;
  }
  canvasCtx.lineTo(canvas.width, canvas.height / 2);
  canvasCtx.stroke();
}
drawVisualizer();

// ── Binding des contrôles ─────────────────────────────────────────────────────

function bindSlider(id, paramKey, display, fmt) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    Audio.setParam(paramKey, v);
    const disp = document.getElementById(display);
    if (disp) disp.textContent = fmt(v);
  });
}

function bindSelect(id, handler) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => handler(el.value));
}

function initControls() {
  bindSlider('attack',     'attack',     'attack-val',  v => `${v.toFixed(3)}s`);
  bindSlider('release',    'release',    'release-val', v => `${v.toFixed(2)}s`);
  bindSlider('detune',     'detune',     'detune-val',  v => `${v} ct`);
  bindSlider('glide',      'glide',      'glide-val',   v => v === 0 ? 'OFF' : `${v.toFixed(2)}s`);
  bindSlider('filter',     'filter',     'filter-val',  v => `${Math.round(v)} Hz`);
  bindSlider('resonance',  'resonance',  'reso-val',    v => v.toFixed(1));
  bindSlider('reverb',     'reverb',     'reverb-val',  v => `${Math.round(v * 100)}%`);
  bindSlider('delay-mix',  'delay',      'delay-val',   v => `${Math.round(v * 100)}%`);
  bindSlider('distortion', 'distortion', 'dist-val',    v => `${Math.round(v)}`);
  bindSlider('volume',     'volume',     'vol-val',     v => `${Math.round(v * 100)}%`);

  document.getElementById('bitcrush').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    Audio.setParam('bitcrush', v);
    document.getElementById('bit-val').textContent = v >= 16 ? 'OFF' : `${v} bit`;
  });

  document.getElementById('octave').addEventListener('input', e => {
    Audio.setParam('octave', parseInt(e.target.value));
    document.getElementById('octave-val').textContent = e.target.value;
    buildChordGrid();
    buildMelodyGrid();
  });

  document.getElementById('bpm').addEventListener('input', e => {
    state.bpm = parseInt(e.target.value);
    document.getElementById('bpm-val').textContent = state.bpm;
  });

  document.getElementById('swing').addEventListener('input', e => {
    state.swing = parseFloat(e.target.value);
    document.getElementById('swing-val').textContent = `${Math.round(state.swing * 100)}%`;
  });

  document.getElementById('seq-steps').addEventListener('input', e => {
    state.seqSteps = parseInt(e.target.value);
    document.getElementById('steps-val').textContent = state.seqSteps;
    buildSeqGrid();
  });

  bindSelect('root-note', v => { state.root = v; buildChordGrid(); buildMelodyGrid(); });
  bindSelect('scale',     v => { state.scale = v; buildChordGrid(); buildMelodyGrid(); });
  bindSelect('arp-mode',  v => { state.arp = v; stopArpeggio(); });

  document.getElementById('engine-select').addEventListener('click', e => {
    const btn = e.target.closest('[data-engine]');
    if (!btn) return;
    document.querySelectorAll('[data-engine]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Audio.setEngine(btn.dataset.engine);
    const p = Audio.getParams();
    syncSlider('attack',  p.attack);
    syncSlider('release', p.release);
    document.getElementById('attack-val').textContent  = `${p.attack.toFixed(3)}s`;
    document.getElementById('release-val').textContent = `${p.release.toFixed(2)}s`;
    document.querySelectorAll('[data-wave]').forEach(b => b.classList.toggle('active', b.dataset.wave === p.waveform));
    document.getElementById('wave-label').textContent = capitalize(p.waveform);
  });

  document.getElementById('wave-select').addEventListener('click', e => {
    const btn = e.target.closest('[data-wave]');
    if (!btn) return;
    document.querySelectorAll('[data-wave]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Audio.setParam('waveform', btn.dataset.wave);
    document.getElementById('wave-label').textContent = capitalize(btn.dataset.wave);
  });

  document.getElementById('seq-play').addEventListener('click', seqPlay);
  document.getElementById('seq-stop').addEventListener('click', seqStop);
  document.getElementById('seq-clear').addEventListener('click', () => {
    state.seqData.forEach(row => row.fill(false));
    document.querySelectorAll('.seq-cell').forEach(c => c.classList.remove('active'));
    seqStop();
  });

  document.getElementById('btn-rec').addEventListener('click', startRec);
  document.getElementById('btn-stop').addEventListener('click', stopRec);
  document.getElementById('btn-export').addEventListener('click', exportMP3);

  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });

  const themeBtn = document.querySelector('[data-theme-toggle]');
  if (themeBtn) {
    let dark = true;
    themeBtn.addEventListener('click', () => {
      dark = !dark;
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    });
  }
}

function syncSlider(id, val) {
  const el = document.getElementById(id); if (el) el.value = val;
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Presets ───────────────────────────────────────────────────────────────────

function applyPreset(name) {
  const p = PRESETS[name]; if (!p) return;
  Audio.setEngine(p.engine);
  ['waveform','attack','release','filter','resonance','reverb','delay','distortion','bitcrush','volume']
    .forEach(k => Audio.setParam(k, p[k]));
  Object.assign(state, { root: p.root, scale: p.scale, arp: p.arp, bpm: p.bpm });
  setSelectVal('root-note', p.root); setSelectVal('scale', p.scale); setSelectVal('arp-mode', p.arp);
  syncSlider('bpm', p.bpm); syncSlider('attack', p.attack); syncSlider('release', p.release);
  syncSlider('filter', p.filter); syncSlider('resonance', p.resonance); syncSlider('reverb', p.reverb);
  syncSlider('delay-mix', p.delay); syncSlider('distortion', p.distortion); syncSlider('bitcrush', p.bitcrush); syncSlider('volume', p.volume);
  document.getElementById('bpm-val').textContent     = p.bpm;
  document.getElementById('attack-val').textContent  = `${p.attack.toFixed(3)}s`;
  document.getElementById('release-val').textContent = `${p.release.toFixed(2)}s`;
  document.getElementById('filter-val').textContent  = `${Math.round(p.filter)} Hz`;
  document.getElementById('reso-val').textContent    = p.resonance.toFixed(1);
  document.getElementById('reverb-val').textContent  = `${Math.round(p.reverb * 100)}%`;
  document.getElementById('delay-val').textContent   = `${Math.round(p.delay * 100)}%`;
  document.getElementById('dist-val').textContent    = `${Math.round(p.distortion)}`;
  document.getElementById('bit-val').textContent     = p.bitcrush >= 16 ? 'OFF' : `${p.bitcrush} bit`;
  document.getElementById('vol-val').textContent     = `${Math.round(p.volume * 100)}%`;
  document.getElementById('wave-label').textContent  = capitalize(p.waveform);
  document.querySelectorAll('[data-engine]').forEach(b => b.classList.toggle('active', b.dataset.engine === p.engine));
  document.querySelectorAll('[data-wave]').forEach(b => b.classList.toggle('active', b.dataset.wave === p.waveform));
  buildChordGrid(); buildMelodyGrid();
  document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
  const a = document.querySelector(`[data-preset="${name}"]`);
  if (a) { a.classList.add('active'); setTimeout(() => a.classList.remove('active'), 1200); }
}

function setSelectVal(id, val) {
  const el = document.getElementById(id); if (!el) return;
  for (const opt of el.options) { if (opt.value === val || opt.textContent === val) { el.value = val; break; } }
}

// ── Init ─────────────────────────────────────────────────────────────────────

function init() {
  buildChordGrid();
  buildMelodyGrid();
  buildSeqGrid();
  initControls();
  initKeyboard();
  injectKeyboardHint();
  if (typeof lamejs === 'undefined') {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@breezystack/lamejs@1.2.7/lame.min.js';
    document.head.appendChild(s);
  }
}

// ── Keyboard hint UI ───────────────────────────────────────────────────────────
// Injecte une barre d’aide discrète sous la grille mélodie
function injectKeyboardHint() {
  const target = document.querySelector('.melody-section');
  if (!target) return;
  const bar = document.createElement('div');
  bar.className = 'kb-hint';
  bar.innerHTML = `
    <span class="kb-group">
      <strong>Mélodie</strong>
      ${MELODY_KEYS.map(k => `<kbd>${k.toUpperCase()}</kbd>`).join('')}
    </span>
    <span class="kb-group">
      <strong>Accords</strong>
      ${CHORD_KEYS.map(k => `<kbd>${k}</kbd>`).join('')}
    </span>
    <span class="kb-group">
      <kbd data-kb="z">Z</kbd> Oct−&nbsp;
      <kbd data-kb="x">X</kbd> Oct+
    </span>
    <span class="kb-group">
      <kbd>R</kbd> Rec&nbsp;
      <kbd>Espace</kbd> Seq
    </span>
  `;
  target.appendChild(bar);
}

document.addEventListener('DOMContentLoaded', init);
