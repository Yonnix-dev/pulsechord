/* =============================================
   PulseChord — Audio Engine
   Web Audio API : synthèse + effets + recorder
============================================= */

const Audio = (() => {
  let ctx = null;
  let masterGain, filterNode, distNode, reverbNode, delayNode, delayGain, reverbGain, analyser;
  let mediaDestination;
  let mediaRecorder = null;
  let recordedChunks = [];
  let lastNote = null;

  const params = {
    waveform: 'sawtooth',
    attack: 0.01,
    release: 0.4,
    octave: 4,
    detune: 0,
    glide: 0,
    filter: 8000,
    resonance: 1,
    reverb: 0.2,
    delay: 0,
    distortion: 0,
    bitcrush: 16,
    volume: 0.8,
    engine: 'lead'
  };

  function ensureContext() {
    if (!ctx) init();
  }

  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = ctx.createGain();
    masterGain.gain.value = params.volume;

    // Filtre low-pass
    filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = params.filter;
    filterNode.Q.value = params.resonance;

    // Distorsion (waveshaper)
    distNode = ctx.createWaveShaper();
    distNode.curve = makeDistortionCurve(params.distortion);
    distNode.oversample = '4x';

    // Reverb (convolver avec IR aléatoire)
    reverbNode = ctx.createConvolver();
    reverbNode.buffer = makeReverbBuffer(ctx, 2.5);
    reverbGain = ctx.createGain();
    reverbGain.gain.value = params.reverb;

    // Delay avec feedback
    delayNode = ctx.createDelay(2);
    delayNode.delayTime.value = 0.375;
    delayGain = ctx.createGain();
    delayGain.gain.value = params.delay;

    // Analyser pour le visualiseur
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;

    // Routage signal
    filterNode.connect(distNode);
    distNode.connect(masterGain);
    masterGain.connect(analyser);

    // Send reverb
    masterGain.connect(reverbGain);
    reverbGain.connect(reverbNode);
    reverbNode.connect(analyser);

    // Send delay avec feedback
    masterGain.connect(delayGain);
    delayGain.connect(delayNode);
    delayNode.connect(delayGain);
    delayNode.connect(analyser);

    // Sortie haut-parleurs
    analyser.connect(ctx.destination);

    // Sortie pour enregistrement
    mediaDestination = ctx.createMediaStreamDestination();
    analyser.connect(mediaDestination);
  }

  function makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 0;
    const n = 256;
    const curve = new Float32Array(n);
    if (k === 0) {
      for (let i = 0; i < n; i++) curve[i] = (2 * i) / n - 1;
      return curve;
    }
    for (let i = 0; i < n; i++) {
      const x = (2 * i) / n - 1;
      curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  function makeReverbBuffer(context, duration) {
    const sr  = context.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = context.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
    }
    return buf;
  }

  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  const NOTE_MAP = { C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11 };
  function noteToMidi(name, octave) {
    return (NOTE_MAP[name] || 0) + (octave + 1) * 12;
  }

  const ENGINE_PRESETS = {
    lead:  { waveform: 'sawtooth',  attack: 0.005, release: 0.3  },
    pad:   { waveform: 'sine',      attack: 0.3,   release: 1.5  },
    bass:  { waveform: 'square',    attack: 0.01,  release: 0.2  },
    keys:  { waveform: 'triangle',  attack: 0.01,  release: 0.6  }
  };

  function applyEngine(engine) {
    const p = ENGINE_PRESETS[engine];
    if (!p) return;
    params.waveform = p.waveform;
    params.attack   = p.attack;
    params.release  = p.release;
  }

  function playNote(noteOrHz, durationSec = null) {
    ensureContext();
    if (ctx.state === 'suspended') ctx.resume();

    let freq;
    if (typeof noteOrHz === 'number') {
      freq = noteOrHz;
    } else {
      freq = midiToHz(noteToMidi(noteOrHz, params.octave));
    }
    freq = Math.max(20, Math.min(20000, freq));

    const now    = ctx.currentTime;
    const osc    = ctx.createOscillator();
    const env    = ctx.createGain();

    osc.type = params.waveform;
    osc.detune.setValueAtTime(params.detune, now);

    if (params.glide > 0 && lastNote) {
      osc.frequency.setValueAtTime(lastNote, now);
      osc.frequency.linearRampToValueAtTime(freq, now + params.glide);
    } else {
      osc.frequency.setValueAtTime(freq, now);
    }
    lastNote = freq;

    // Envelope ADSR simplifiée
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(1, now + params.attack);
    env.gain.setValueAtTime(1, now + params.attack + 0.01);

    if (durationSec) {
      const offAt = now + durationSec;
      env.gain.setTargetAtTime(0, offAt, params.release / 4);
      osc.start(now);
      osc.stop(offAt + params.release + 0.6);
    } else {
      osc.start(now);
    }

    osc.connect(env);
    env.connect(filterNode);

    return { osc, env, startTime: now };
  }

  function stopNote(handle) {
    if (!handle) return;
    const { env, osc } = handle;
    const now = ctx.currentTime;
    env.gain.cancelScheduledValues(now);
    env.gain.setTargetAtTime(0, now, params.release / 4);
    try { osc.stop(now + params.release + 0.2); } catch(e) {}
  }

  function playChord(notes, durationSec = 0.8) {
    ensureContext();
    return notes.map(n => playNote(n, durationSec));
  }

  function setParam(key, value) {
    params[key] = value;
    if (!ctx) return;
    switch (key) {
      case 'volume':     masterGain.gain.setTargetAtTime(value, ctx.currentTime, 0.01); break;
      case 'filter':     filterNode.frequency.setTargetAtTime(value, ctx.currentTime, 0.02); break;
      case 'resonance':  filterNode.Q.setTargetAtTime(value, ctx.currentTime, 0.02); break;
      case 'reverb':     reverbGain.gain.setTargetAtTime(value, ctx.currentTime, 0.02); break;
      case 'delay':      delayGain.gain.setTargetAtTime(Math.min(value, 0.7), ctx.currentTime, 0.02); break;
      case 'distortion': distNode.curve = makeDistortionCurve(value); break;
    }
  }

  function setEngine(engine) {
    params.engine = engine;
    applyEngine(engine);
  }

  // Recorder — capture la sortie audio de l'app directement
  function startRecording() {
    ensureContext();
    recordedChunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    mediaRecorder = new MediaRecorder(mediaDestination.stream, {
      mimeType: mime,
      audioBitsPerSecond: 256000
    });
    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.start(100);
  }

  function stopRecording() {
    return new Promise(resolve => {
      if (!mediaRecorder) { resolve(null); return; }
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        resolve(blob);
      };
      mediaRecorder.stop();
    });
  }

  function getAnalyser() {
    ensureContext();
    return analyser;
  }

  function getParams() { return { ...params }; }

  return {
    init, ensureContext, playNote, stopNote, playChord,
    setParam, setEngine, applyEngine,
    startRecording, stopRecording,
    getAnalyser, getParams,
    midiToHz, noteToMidi, ENGINE_PRESETS
  };
})();
