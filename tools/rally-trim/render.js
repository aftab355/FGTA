/* Producing the file, rather than a script that would.

   v1 handed over a bash script that extracted 154 clips one at a time and
   concatenated them: 154 decodes, 154 encodes, all on the CPU. This does it
   in one pass with a `select` filter, and on whatever encoder the machine
   actually has.

   The hardware encoders are worth the trouble here specifically because the
   output is long. A tennis cut is half an hour of 1080p; libx264 at
   veryfast is several minutes of that, and nvenc or videotoolbox is closer to
   one. Quality per byte is worse — which is why the bitrate is set generously
   rather than matching x264's CRF, and why --x264 exists. */
'use strict';
const { spawn } = require('child_process');

/* Ordered by how much they usually help. The probe in decode.js reports which
   of these the binary was built with; being built with one is not proof the
   machine can run it, so a failure falls back rather than giving up. */
const HW = {
  h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '21', '-b:v', '0'],
  h264_videotoolbox: ['-c:v', 'h264_videotoolbox', '-q:v', '55'],
  h264_qsv: ['-c:v', 'h264_qsv', '-global_quality', '23'],
  h264_amf: ['-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '22', '-qp_p', '24'],
  h264_vaapi: ['-c:v', 'h264_vaapi', '-qp', '23']
};
const SW = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'];
const AUDIO = ['-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000'];

function pickEncoder(caps, opt) {
  if (opt && opt.x264) return { name: 'libx264', args: SW, hw: false };
  const list = (caps && caps.encoders) || [];
  for (const k of Object.keys(HW)) {
    if (list.indexOf(k) < 0) continue;
    /* vaapi needs a device set up; without one it fails at run time and the
       fallback handles it, but do not prefer it over a software encode that
       is certain to work. */
    if (k === 'h264_vaapi' && !(opt && opt.vaapiDevice)) continue;
    return { name: k, args: HW[k], hw: true };
  }
  return { name: 'libx264', args: SW, hw: false };
}

function selectExpr(segments) {
  return segments.map(s =>
    `between(t,${s.start.toFixed(3)},${(s.start + s.dur).toFixed(3)})`).join('+');
}

/* One decode, one encode, no join points for the audio to drift across.
   `select` keeps the ranges and `setpts` restamps what survives. */
function buildArgs(src, out, segments, enc, opt) {
  const terms = selectExpr(segments);
  const a = ['-nostdin', '-y'];
  if (opt && opt.hwaccel) a.push('-hwaccel', opt.hwaccel);
  a.push('-i', src,
    '-vf', `select='${terms}',setpts=N/FRAME_RATE/TB`,
    '-af', `aselect='${terms}',asetpts=N/SR/TB`);
  a.push.apply(a, enc.args);
  if (!enc.hw) { /* pix_fmt already in SW */ } else a.push('-pix_fmt', 'yuv420p');
  a.push.apply(a, AUDIO);
  a.push('-movflags', '+faststart', out);
  return a;
}

function runFfmpeg(ffmpeg, args, onLine) {
  return new Promise(resolve => {
    const p = spawn(ffmpeg || 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', b => {
      const s = b.toString();
      err += s;
      if (onLine) for (const l of s.split(/[\r\n]+/)) if (/time=/.test(l)) onLine(l.trim());
    });
    p.on('error', e => resolve({ ok: false, err: e.message }));
    p.on('close', c => resolve({ ok: c === 0, code: c, err }));
  });
}

/* Try the fast encoder, fall back to the certain one. A machine whose ffmpeg
   lists h264_nvenc but has no usable GPU is common enough that failing the
   whole run over it would be silly. */
async function render(src, out, segments, caps, opt, say) {
  opt = opt || {};
  const log = say || (() => {});
  if (!segments.length) return { ok: false, err: 'nothing to render' };
  let enc = pickEncoder(caps, opt);
  log(`encoder        ${enc.name}${enc.hw ? ' (hardware)' : ''}`);
  const t0 = Date.now();
  let r = await runFfmpeg(opt.ffmpeg, buildArgs(src, out, segments, enc, opt), opt.onProgress);
  if (!r.ok && enc.hw) {
    log(`               ${enc.name} failed, falling back to libx264`);
    enc = { name: 'libx264', args: SW, hw: false };
    r = await runFfmpeg(opt.ffmpeg, buildArgs(src, out, segments, enc, opt), opt.onProgress);
  }
  return Object.assign({ encoder: enc.name, seconds: (Date.now() - t0) / 1000 }, r);
}

/* A couple of seconds around every clip's opening, back to back. Still the
   fastest way to check the whole cut: if one opens after the ball is struck
   you hear it immediately. */
async function proof(src, out, segments, caps, opt, say) {
  opt = opt || {};
  const b = opt.before == null ? 0.8 : opt.before, a = opt.after == null ? 1.2 : opt.after;
  const wins = segments.map(s => ({ start: Math.max(0, s.start - b), dur: b + a }));
  return render(src, out, wins, caps, opt, say);
}

module.exports = { render, proof, pickEncoder, selectExpr, buildArgs, HW, SW, AUDIO };
