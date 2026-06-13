// PCM encoding helpers + async generators that adapt a `microphone-stream`
// instance into the AudioStream shape expected by AWS Transcribe Streaming.
import { Buffer } from "buffer";
import MicrophoneStream from "microphone-stream";

type MicStream = AsyncIterable<Buffer | ArrayBufferView> & {
  setStream(stream: MediaStream): void;
  stop(): void;
  destroy(): void;
  stream: MediaStream;
};

export function encodePCMChunk(chunk: Buffer): Buffer {
  // microphone-stream emits Buffer of 32-bit float samples; convert to little-endian PCM16.
  const input = MicrophoneStream.toRaw(chunk) as Float32Array;
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return Buffer.from(buffer);
}

export async function createMicrophoneStream(constraints: MediaStreamConstraints): Promise<MicStream> {
  const micStream = new MicrophoneStream() as unknown as MicStream;
  micStream.setStream(await navigator.mediaDevices.getUserMedia(constraints));
  return micStream;
}

export function wrapMediaStream(stream: MediaStream): MicStream {
  const micStream = new MicrophoneStream() as unknown as MicStream;
  micStream.setStream(stream);
  return micStream;
}

export async function* toAudioEventStream(micStream: MicStream, sampleRate: number) {
  for await (const chunk of micStream) {
    const buf = chunk as Buffer;
    if (buf.length <= sampleRate) {
      yield { AudioEvent: { AudioChunk: encodePCMChunk(buf) } };
    }
  }
}
