const input = document.querySelector('#fileInput');
const dropZone = document.querySelector('#dropZone');
const emptyState = document.querySelector('#emptyState');
const editor = document.querySelector('#editor');
const audio = document.querySelector('#audio');
const canvas = document.querySelector('#waveform');
const ctx = canvas.getContext('2d');
let buffer, objectUrl, start = 0, end = 0, dragging = null;

const $ = s => document.querySelector(s);
const format = seconds => { const m = Math.floor(seconds / 60); return `${m}:${(seconds % 60).toFixed(1).padStart(4, '0')}`; };
const setStatus = text => $('#status').textContent = text;

function updateUI() {
  const duration = buffer.duration;
  const left = (start / duration) * 100, right = (end / duration) * 100;
  $('#selection').style.left = `${left}%`; $('#selection').style.width = `${right - left}%`;
  $('#startHandle').style.left = `${left}%`; $('#endHandle').style.left = `${right}%`;
  $('#startReadout').textContent = $('#startTime').textContent = format(start);
  $('#endReadout').textContent = $('#durationTime').textContent = format(end);
  $('#clipLength').textContent = format(end - start);
}
function drawWave() {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr; ctx.scale(dpr, dpr); ctx.clearRect(0,0,w,h);
  const data = buffer.getChannelData(0), step = Math.max(1, Math.floor(data.length / w));
  ctx.fillStyle = '#55736e';
  for (let x=0; x<w; x++) { let min=1,max=-1; for(let j=0;j<step;j++){ const v=data[(x*step)+j] || 0; if(v<min)min=v;if(v>max)max=v; } const y=(1+min)*h/2, height=Math.max(1,(max-min)*h/2); ctx.fillRect(x,y,1,height); }
}
async function loadFile(file) {
  if (!file || (!file.type.startsWith('audio/') && !/\.mp3$/i.test(file.name))) { setStatus('Please choose an audio file.'); return; }
  if (file.size > 100 * 1024 * 1024) { setStatus('Please choose a file smaller than 100 MB.'); return; }
  setStatus('Reading your audio…');
  try {
    const data = await file.arrayBuffer(); const audioCtx = new AudioContext();
    buffer = await audioCtx.decodeAudioData(data); await audioCtx.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = URL.createObjectURL(file); audio.src = objectUrl;
    start = 0; end = buffer.duration; $('#fileName').textContent = file.name; $('#outputName').value = file.name.replace(/\.[^/.]+$/, '') + '-cut'; $('#fileMeta').textContent = `${(file.size / 1048576).toFixed(1)} MB · ${format(end)}`;
    emptyState.classList.add('hidden'); editor.classList.remove('hidden'); requestAnimationFrame(() => { drawWave(); updateUI(); });
    setStatus('Drag the white handles to choose the part you want to keep.');
  } catch { setStatus('That file could not be read. Try another MP3.'); }
}
input.addEventListener('change', e => loadFile(e.target.files[0]));
$('#replaceBtn').addEventListener('click', () => input.click());
['dragenter','dragover'].forEach(e => dropZone.addEventListener(e, ev => {ev.preventDefault(); dropZone.classList.add('dragging');}));
['dragleave','drop'].forEach(e => dropZone.addEventListener(e, ev => {ev.preventDefault(); dropZone.classList.remove('dragging');}));
dropZone.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));
function moveHandle(event) { if (!dragging || !buffer) return; const r=$('#waveTrack').getBoundingClientRect(); const t=Math.max(0,Math.min(buffer.duration,((event.clientX-r.left)/r.width)*buffer.duration)); if(dragging==='start') start=Math.min(t,end-.05); else end=Math.max(t,start+.05); updateUI(); }
['start','end'].forEach(which => { const el=$(`#${which}Handle`); el.addEventListener('pointerdown', e => { dragging=which; el.setPointerCapture(e.pointerId); }); });
window.addEventListener('pointermove',moveHandle); window.addEventListener('pointerup',()=>dragging=null);
$('#rewindBtn').addEventListener('click',()=> { audio.pause(); audio.currentTime=start; $('#playBtn').textContent='▶'; $('#playhead').style.display='none'; });
$('#playBtn').addEventListener('click',()=> { if(audio.paused){ audio.currentTime=Math.max(start, Math.min(audio.currentTime,end)); audio.play(); $('#playBtn').textContent='❚❚'; $('#playhead').style.display='block'; } else audio.pause(); });
audio.addEventListener('pause',()=> $('#playBtn').textContent='▶');
audio.addEventListener('timeupdate',()=> { const p=(audio.currentTime/buffer.duration)*100; $('#playhead').style.left=`${p}%`; if(audio.currentTime>=end){ audio.pause(); audio.currentTime=start; $('#playhead').style.display='none'; } });
['fadeIn', 'fadeOut', 'volume'].forEach(id => {
  $(`#${id}`).addEventListener('input', e => {
    const value = Number(e.target.value);
    $(`#${id}Value`).textContent = id === 'volume' ? `${value}%` : `${value.toFixed(1)}s`;
    if (id === 'volume') audio.volume = Math.min(value / 100, 1);
  });
});
function floatTo16BitPCM(input) { const out=new Int16Array(input.length); for(let i=0;i<input.length;i++){const s=Math.max(-1,Math.min(1,input[i]));out[i]=s<0?s*32768:s*32767;} return out; }
$('#exportBtn').addEventListener('click', () => {
  if (!window.lamejs) { setStatus('MP3 encoder is still loading — please try again in a moment.'); return; }
  setStatus('Encoding your MP3…'); $('#exportBtn').disabled=true;
  setTimeout(() => { try { const rate=buffer.sampleRate, from=Math.floor(start*rate), to=Math.floor(end*rate), length=to-from; const sourceL=buffer.getChannelData(0), sourceR=buffer.numberOfChannels>1?buffer.getChannelData(1):sourceL; const fadeIn=Math.min(Number($('#fadeIn').value), length/rate), fadeOut=Math.min(Number($('#fadeOut').value), length/rate), volume=Number($('#volume').value)/100; const l=new Float32Array(length), r=new Float32Array(length); for(let i=0;i<length;i++){ let gain=volume; const t=i/rate, remaining=(length-i)/rate; if(fadeIn>0 && t<fadeIn) gain*=t/fadeIn; if(fadeOut>0 && remaining<fadeOut) gain*=remaining/fadeOut; l[i]=sourceL[from+i]*gain; r[i]=sourceR[from+i]*gain; } const encoder=new lamejs.Mp3Encoder(2,rate,Number($('#quality').value)); const left=floatTo16BitPCM(l), right=floatTo16BitPCM(r), chunks=[]; for(let i=0;i<left.length;i+=1152){ const mp3=encoder.encodeBuffer(left.subarray(i,i+1152),right.subarray(i,i+1152)); if(mp3.length)chunks.push(new Int8Array(mp3)); } const last=encoder.flush(); if(last.length)chunks.push(new Int8Array(last)); const blob=new Blob(chunks,{type:'audio/mpeg'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); const safeName=$('#outputName').value.trim().replace(/[\\/:*?"<>|]/g,'-') || 'audio-cut'; a.download=`${safeName}.mp3`; a.click(); URL.revokeObjectURL(a.href); setStatus('Your cut is ready — download started.'); } catch(err) { console.error(err); setStatus('Could not export this clip. Please try a shorter selection.'); } finally { $('#exportBtn').disabled=false; } }, 30);
});
window.addEventListener('resize',()=>buffer&&drawWave());
