/** Frame-by-frame video encoder: WebCodecs + mp4-muxer, falling back to real-time MediaRecorder. */
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

export interface FrameEncoder {
  addFrame(canvas: HTMLCanvasElement, index: number): Promise<void>;
  finish(): Promise<Blob>;
}

export async function createEncoder(width: number, height: number, fps: number): Promise<FrameEncoder> {
  if (typeof VideoEncoder !== 'undefined') {
    for (const [codec, muxCodec] of [
      ['avc1.4d0029', 'avc'],
      ['avc1.42001f', 'avc'],
      ['vp09.00.10.08', 'vp9'],
    ] as const) {
      const config: VideoEncoderConfig = { codec, width, height, bitrate: 3_000_000, framerate: fps };
      const support = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
      if (support.supported) return webCodecsEncoder(config, muxCodec, fps);
    }
  }
  return mediaRecorderEncoder(width, height, fps);
}

function webCodecsEncoder(config: VideoEncoderConfig, muxCodec: 'avc' | 'vp9', fps: number): FrameEncoder {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: muxCodec, width: config.width, height: config.height, frameRate: fps },
    fastStart: 'in-memory',
  });
  let error: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (error = e),
  });
  encoder.configure(config);
  return {
    async addFrame(canvas, index) {
      if (error) throw error;
      const frame = new VideoFrame(canvas, { timestamp: Math.round((index * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
      frame.close();
      if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
    },
    async finish() {
      await encoder.flush();
      encoder.close();
      if (error) throw error;
      muxer.finalize();
      return new Blob([muxer.target.buffer], { type: 'video/mp4' });
    },
  };
}

function mediaRecorderEncoder(width: number, height: number, fps: number): FrameEncoder {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    async addFrame(src) {
      ctx.drawImage(src, 0, 0);
      track.requestFrame();
      await new Promise((r) => setTimeout(r, 1000 / fps)); // real-time pacing
    },
    finish() {
      return new Promise((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
        rec.stop();
      });
    },
  };
}
