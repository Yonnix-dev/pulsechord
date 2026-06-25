/* ============================================
   PulseChord — Audio Engine
   Omnichord-style : harp strum + sustain
   Web Audio API only, no dependencies
============================================ */

const Audio = (() => {

  // ─ Contexte & nœuds ──────────────────────────────
  let ctx = null;
  let masterGain, filterNode, reverbGain, reverbNode,
      delayNode, delayFeedback, delayGainNode, analyser,
      mediaDestination;
  let mediaRecorder = null;
  let recordedChunks = [];

  // ─ Paramètres ───────────────────────────────────
  const p = {
    preset:    'omnicord',
    octave:    4,
    filter:    8000,
    reverb:    0.2,
    delay:     0,
    volume:    0.8,
    strumMs:   60,    // délai entre chaque note du strum (ms)
    sustain:   2.0,   // durée de sustain des cordes (s)
    attack:    0.005,
    release:   1.2,
  };

  // ─ Presets ────────────────────────────────────
  const PRESETS = {
    omnicord: {
      waveform: 'sine',
      attack: 0.005, sustain: 2.0, release: 1.5,
      filter: 9000,  reverb: 0.3,  delay: 0,
      strumMs: 55,   volume: 0.8,
      // Léger détune pour le chorus naturel de l'Omnichord
      detune: 0, chorus: true,
    },
    electric: {
      waveform: 'sawtooth',
      attack: 0.008, sustain: 1.2, release: 0.8,
      filter: 4000,  reverb: 0.15, delay: 0.25,
      strumMs: 40,   volume: 0.85,
      detune: 5, chorus: false,
    },
    ambient: {
      waveform: 'sine',
      attack: 0.4,   sustain: 4.0, release: 3.0,
      filter: 14000, reverb: 0.75, delay: 0.4,
      strumMs: 90,   volume: 0.7,
      detune: 0, chorus: true,
    },
    bass: {
      waveform: 'square',
      attack: 0.01,  sustain: 0.8, release: 0.5,
      filter: 900,   reverb: 0.08, delay: 0.1,
      strumMs: 30,   volume: 0.9,
      detune: -2400, chorus: false, // octave -2
    },
    bells: {
      waveform: 'triangle',
      attack: 0.001, sustain: 3.0, release: 2.5,
      filter: 16000, reverb: 0.5,  delay: 0.2,
      strumMs: 80,   volume: 0.75,
      detune: 1200,  chorus: false, // octave +1
    },
  };

  // ─ Init contexte ──────────────────────────────
  function ensureContext() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = ctx.createGain();
    masterGain.gain.value = p.volume;

    filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = p.filter;
    filterNode.Q.value = 0.8;

    // Reverb (impulse response aléatoire)
    reverbNode = ctx.createConvolver();
    reverbNode.buffer = makeIR(2.8);
    reverbGain = ctx.createGain();
    reverbGain.gain.value = p.reverb;

    // Delay
    delayNode = ctx.createDelay(2.0);
    delayNode.delayTime.value = 0.36;
    delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.38;
    delayGainNode = ctx.createGain();
    delayGainNode.gain.value = p.delay;

    // Analyser
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.82;

    // Routage
    filterNode.connect(masterGain);

    masterGain.connect(analyser);
    analyser.connect(ctx.destination);

    // Reverb send
    masterGain.connect(reverbGain);
    reverbGain.connect(reverbNode);
    reverbNode.connect(analyser);

    // Delay send avec feedback
    masterGain.connect(delayGainNode);
    delayGainNode.connect(delayNode);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(analyser);

    // Sortie enregistrement
    mediaDestination = ctx.createMediaStreamDestination();
    analyser.connect(mediaDestination);
  }

  // ─ Impulse Response (reverb) ───────────────────
  function makeIR(duration) {
    ensureContext();
    const sr  = ctx.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++)
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    return buf;
  }

  // ─ Utilitaires ────────────────────────────────
  function midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

  const NOTE_IDX = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };
  function noteToMidi(name, octave) { return (NOTE_IDX[name] || 0) + (octave + 1) * 12; }

  // ─ Jouer une note (une seule corde) ─────────────
  function playString(freq, startTime, preset) {
    const pr = PRESETS[preset] || PRESETS.omnicord;
    const now = startTime;

    const osc  = ctx.createOscillator();
    const env  = ctx.createGain();

    osc.type = pr.waveform;
    // Détune de base du preset
    osc.detune.value = pr.detune || 0;

    // Chorus naturel : léger détune aléatoire par corde
    if (pr.chorus) osc.detune.value += (Math.random() - 0.5) * 6;

    osc.frequency.setValueAtTime(freq, now);

    // Envelope : attack rapide, sustain, release longue
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.18, now + pr.attack);
    env.gain.setValueAtTime(0.18, now + pr.attack + pr.sustain * 0.2);
    env.gain.exponentialRampToValueAtTime(0.001, now + pr.attack + pr.sustain + pr.release);

    osc.start(now);
    osc.stop(now + pr.attack + pr.sustain + pr.release + 0.1);

    osc.connect(env);
    env.connect(filterNode);

    return { osc, env };
  }

  // ─ Strum d'accord (Omnichord-style) ────────────
  // freqs : tableau de fréquences (toutes les cordes de l'accord)
  // direction : 'up' | 'down' | 'both'
  function strumChord(freqs, direction = 'up') {
    ensureContext();
    if (ctx.state === 'suspended') ctx.resume();
    const pr   = PRESETS[p.preset] || PRESETS.omnicord;
    const step = (p.strumMs / 1000);
    const now  = ctx.currentTime;
    const handles = [];

    let ordered = [...freqs];
    if (direction === 'down') ordered = ordered.reverse();

    ordered.forEach((freq, i) => {
      const h = playString(freq, now + i * step, p.preset);
      handles.push(h);
    });
    return handles;
  }

  // ─ Note mélodie (sustain tant que touché) ────────
  function playNote(freq) {
    ensureContext();
    if (ctx.state === 'suspended') ctx.resume();
    const pr  = PRESETS[p.preset] || PRESETS.omnicord;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = pr.waveform;
    osc.detune.value = (pr.detune || 0) + (pr.chorus ? (Math.random() - 0.5) * 4 : 0);
    osc.frequency.setValueAtTime(freq, now);

    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.22, now + pr.attack);

    osc.start(now);
    osc.connect(env);
    env.connect(filterNode);

    return { osc, env };
  }

  // Arrêter une note mélodie (release douce)
  function stopNote(handle) {
    if (!handle || !ctx) return;
    const { env, osc } = handle;
    const now = ctx.currentTime;
    const pr  = PRESETS[p.preset] || PRESETS.omnicord;
    env.gain.cancelScheduledValues(now);
    env.gain.setTargetAtTime(0, now, pr.release / 5);
    try { osc.stop(now + pr.release + 0.3); } catch(e) {}
  }

  // ─ Appliquer un preset ──────────────────────────
  function setPreset(name) {
    const pr = PRESETS[name];
    if (!pr) return;
    p.preset  = name;
    p.filter  = pr.filter;
    p.reverb  = pr.reverb;
    p.delay   = pr.delay;
    p.sustain = pr.sustain;
    p.strumMs = pr.strumMs;
    p.volume  = pr.volume;
    if (!ctx) return;
    filterNode.frequency.setTargetAtTime(pr.filter, ctx.currentTime, 0.05);
    reverbGain.gain.setTargetAtTime(pr.reverb, ctx.currentTime, 0.05);
    delayGainNode.gain.setTargetAtTime(pr.delay, ctx.currentTime, 0.05);
    masterGain.gain.setTargetAtTime(pr.volume, ctx.currentTime, 0.05);
  }

  // ─ Setters paramètres individuels ────────────────
  function setParam(key, value) {
    p[key] = value;
    if (!ctx) return;
    switch (key) {
      case 'volume':  masterGain.gain.setTargetAtTime(value, ctx.currentTime, 0.02); break;
      case 'filter':  filterNode.frequency.setTargetAtTime(value, ctx.currentTime, 0.03); break;
      case 'reverb':  reverbGain.gain.setTargetAtTime(value, ctx.currentTime, 0.03); break;
      case 'delay':   delayGainNode.gain.setTargetAtTime(Math.min(value, 0.75), ctx.currentTime, 0.03); break;
    }
  }

  // ─ Recorder ───────────────────────────────────
  function startRecording() {
    ensureContext();
    recordedChunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    mediaRecorder = new MediaRecorder(mediaDestination.stream, {
      mimeType: mime, audioBitsPerSecond: 256000
    });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.start(100);
  }

  function stopRecording() {
    return new Promise(resolve => {
      if (!mediaRecorder) { resolve(null); return; }
      mediaRecorder.onstop = () => resolve(new Blob(recordedChunks, { type: 'audio/webm' }));
      mediaRecorder.stop();
    });
  }

  // ─ Getters ────────────────────────────────────
  function getAnalyser() { ensureContext(); return analyser; }
  function getParams()   { return { ...p }; }
  function getPresets()  { return Object.keys(PRESETS); }

  return {
    ensureContext,
    playNote, stopNote,
    strumChord,
    setPreset, setParam,
    startRecording, stopRecording,
    getAnalyser, getParams, getPresets,
    midiToHz, noteToMidi,
  };
})();
