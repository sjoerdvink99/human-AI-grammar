// human specify: records the spoken editing command (speech_1) and converts it to 16 kHz mono PCM
// for the ASR model on the server.
export class SpeechRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;

  get recording() { return this.rec?.state === 'recording'; }

  async start() {
    this.stream ??= await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start();
  }

  async stop(): Promise<Float32Array> {
    const rec = this.rec;
    if (!rec) throw new Error('not recording');
    await new Promise<void>((resolve) => { rec.onstop = () => resolve(); rec.stop(); });
    const blob = new Blob(this.chunks, { type: rec.mimeType });
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    await ctx.close();
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    return out.getChannelData(0);
  }
}
