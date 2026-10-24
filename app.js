const input = document.querySelector('#fileInput');
const dropZone = document.querySelector('#dropZone');
const emptyState = document.querySelector('#emptyState');
const editor = document.querySelector('#editor');
const audio = document.querySelector('#audio');
const canvas = document.querySelector('#waveform');
const waveTrack = document.querySelector('#waveTrack');
const ctx = canvas.getContext('2d');
let buffer, objectUrl, start = 0, end = 0, dragging = null;

const $ = selector => document.querySelector(selector);
const format = seconds => { const minutes = Math.floor(seconds / 60); return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, '0')}`; };
const setStatus = text => $('#status').textContent = text;

function updateUI() {
  const duration = buffer.duration;
  const left = (start / duration) * 100, right = (end / duration) * 100;
  $('#selection').style.left = `${left}%`;
  $('#selection').style.width = `${right - left}%`;
  $('#startHandle').style.left = `${left}%`;
  $('#endHandle').style.left = `${right}%`;
  $('#startReadout').textContent = $('#startTime').textContent = format(start);
  $('#endReadout').textContent = $('#durationTime').textContent = format(end);
  updatePreviewReadout();
}
function updatePreviewReadout() { $('#previewTime').textContent = format(audio.currentTime || 0); }
function drawWave() {
  const dpr = devicePixelRatio || 1, width = canvas.clientWidth, height = canvas.clientHeight;
  canvas.width = width * dpr; canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  const data = buffer.getChannelData(0), step = Math.max(1, Math.floor(data.length / width));
  ctx.fillStyle = '#9ac27e';
  for (let x = 0; x < width; x++) {
    let min = 1, max = -1;
    for (let sample = 0; sample < step; sample++) { const value = data[x * step + sample] || 0; min = Math.min(min, value); max = Math.max(max, value); }
    const y = (1 + min) * height / 2, barHeight = Math.max(1, (max - min) * height / 2);
    ctx.fillRect(x, y, 1, barHeight);
  }
}
async function loadFile(file) {
  if (!file || (!file.type.startsWith('audio/') && !/\.mp3$/i.test(file.name))) { setStatus('Please choose an audio file.'); return; }
  if (file.size > 100 * 1024 * 1024) { setStatus('Please choose a file smaller than 100 MB.'); return; }
  setStatus('Reading your audio…');
  try {
    const data = await file.arrayBuffer(), audioContext = new AudioContext();
    buffer = await audioContext.decodeAudioData(data); await audioContext.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file); audio.src = objectUrl;
    start = 0; end = buffer.duration; audio.currentTime = 0;
    $('#fileName').textContent = file.name;
    $('#fileMeta').textContent = `${(file.size / 1048576).toFixed(1)} MB · ${format(end)}`;
    emptyState.classList.add('hidden'); editor.classList.remove('hidden');
    requestAnimationFrame(() => { drawWave(); updateUI(); });
    setStatus('Click anywhere on the waveform to preview from that point. Drag handles to choose what you export.');
  } catch { setStatus('That file could not be read. Try another MP3.'); }
}
input.addEventListener('change', event => loadFile(event.target.files[0]));
$('#replaceBtn').addEventListener('click', () => input.click());
['dragenter', 'dragover'].forEach(eventName => dropZone.addEventListener(eventName, event => { event.preventDefault(); dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, event => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', event => loadFile(event.dataTransfer.files[0]));

function timeAtPointer(event) { const rect = waveTrack.getBoundingClientRect(); return Math.max(0, Math.min(buffer.duration, ((event.clientX - rect.left) / rect.width) * buffer.duration)); }
function moveHandle(event) { if (!dragging || !buffer) return; const time = timeAtPointer(event); if (dragging === 'start') start = Math.min(time, end - .05); else end = Math.max(time, start + .05); updateUI(); }
['start', 'end'].forEach(which => { const handle = $(`#${which}Handle`); handle.addEventListener('pointerdown', event => { dragging = which; handle.setPointerCapture(event.pointerId); event.stopPropagation(); }); });
window.addEventListener('pointermove', moveHandle); window.addEventListener('pointerup', () => { dragging = null; });
waveTrack.addEventListener('click', event => { if (!buffer || dragging || event.target.classList.contains('handle')) return; audio.currentTime = timeAtPointer(event); $('#playhead').style.left = `${audio.currentTime / buffer.duration * 100}%`; $('#playhead').style.display = 'block'; updatePreviewReadout(); });

function togglePreview() {
  if (!buffer) return;
  if (audio.paused) { audio.play().catch(() => setStatus('Your browser blocked playback. Click the play button once more.')); }
  else audio.pause();
}
$('#playBtn').addEventListener('click', togglePreview);
$('#rewindBtn').addEventListener('click', () => { audio.pause(); audio.currentTime = 0; $('#playhead').style.left = '0%'; $('#playhead').style.display = 'block'; updatePreviewReadout(); });
audio.addEventListener('play', () => { $('#playBtn').textContent = '❚❚'; $('#playhead').style.display = 'block'; });
audio.addEventListener('pause', () => { $('#playBtn').textContent = '▶'; updatePreviewReadout(); });
audio.addEventListener('ended', () => { $('#playBtn').textContent = '▶'; updatePreviewReadout(); });
audio.addEventListener('timeupdate', () => { if (!buffer) return; $('#playhead').style.left = `${audio.currentTime / buffer.duration * 100}%`; updatePreviewReadout(); });
window.addEventListener('keydown', event => { if (event.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName)) { event.preventDefault(); togglePreview(); } });

function floatTo16BitPCM(values) { const output = new Int16Array(values.length); for (let index = 0; index < values.length; index++) { const value = Math.max(-1, Math.min(1, values[index])); output[index] = value < 0 ? value * 32768 : value * 32767; } return output; }
$('#exportBtn').addEventListener('click', () => {
  if (!buffer) return;
  if (!window.lamejs) { setStatus('MP3 encoder is still loading — please try again in a moment.'); return; }
  setStatus('Encoding your MP3…'); $('#exportBtn').disabled = true;
  setTimeout(() => {
    try {
      const rate = buffer.sampleRate, from = Math.floor(start * rate), to = Math.floor(end * rate);
      const left = floatTo16BitPCM(buffer.getChannelData(0).slice(from, to));
      const right = buffer.numberOfChannels > 1 ? floatTo16BitPCM(buffer.getChannelData(1).slice(from, to)) : left;
      const encoder = new lamejs.Mp3Encoder(2, rate, 192), chunks = [];
      for (let offset = 0; offset < left.length; offset += 1152) { const mp3 = encoder.encodeBuffer(left.subarray(offset, offset + 1152), right.subarray(offset, offset + 1152)); if (mp3.length) chunks.push(new Int8Array(mp3)); }
      const final = encoder.flush(); if (final.length) chunks.push(new Int8Array(final));
      const href = URL.createObjectURL(new Blob(chunks, { type: 'audio/mpeg' })), link = document.createElement('a');
      link.href = href; link.download = `${$('#fileName').textContent.replace(/\.[^/.]+$/, '')}-cut.mp3`; link.click();
      setTimeout(() => URL.revokeObjectURL(href), 1000); setStatus('Your cut is ready — download started.');
    } catch (error) { console.error(error); setStatus('Could not export this clip. Please try a shorter selection.'); }
    finally { $('#exportBtn').disabled = false; }
  }, 30);
});
window.addEventListener('resize', () => buffer && drawWave());
