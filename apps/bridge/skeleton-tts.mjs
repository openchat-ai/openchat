// TTS adapter: v0 uses espeak (Linux) / say (macOS) / PowerShell SAPI (Windows)
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const SR = 24000;

async function tts(text) {
  const isWindows = process.platform === 'win32';
  const tmpWav = join(tmpdir(), `skeleton-tts-${Date.now()}.wav`);
  const tmpPcm = join(tmpdir(), `skeleton-tts-${Date.now()}.pcm`);

  try {
    if (isWindows) {
      const ps = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Speech; $tts = New-Object System.Speech.Synthesis.SpeechSynthesizer; $tts.Rate = 0; $tts.Volume = 100; $tts.Speak('${text.replace(/'/g, "''")}') | Out-Null; $tts.SaveToFile('${tmpWav.replace(/\\/g, '\\\\')}', [System.Speech.Synthesis.SaveFormat]::Wave); $tts.Dispose()`;
      execSync(`powershell -Command "${ps}"`, { stdio: 'ignore' });
    } else {
      execSync(`espeak -w "${tmpWav}" "${text}" 2>/dev/null`, { stdio: 'ignore' });
      if (!existsSync(tmpWav)) {
        execSync(`say "${text}" -o "${tmpWav}" 2>/dev/null`, { stdio: 'ignore' });
      }
    }

    if (!existsSync(tmpWav)) {
      console.warn(`[skeleton-tts] no TTS tool available, returning silence`);
      return makeSilence(0.5);
    }

    execSync(`ffmpeg -y -i "${tmpWav}" -ar ${SR} -ac 1 -f s16le "${tmpPcm}" 2>/dev/null`, { stdio: 'ignore' });
    const pcmBuf = existsSync(tmpPcm) ? readFileSync(tmpPcm) : makeSilence(0.5);
    return pcmBuf;
  } finally {
    try { if (existsSync(tmpWav)) unlinkSync(tmpWav); } catch {}
    try { if (existsSync(tmpPcm)) unlinkSync(tmpPcm); } catch {}
  }
}

function makeSilence(durationSec) {
  const samples = Math.floor(SR * durationSec);
  return Buffer.alloc(samples * 2);
}

export { tts };
