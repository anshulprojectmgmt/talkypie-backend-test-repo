import { WebSocketServer } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import dotenv from 'dotenv';
dotenv.config();

const DEEPGRAM_API_KEY =
  process.env.DEEPGRAM_API_KEY ||
  '8db50845e951f4d27e920901a1b20468d51d5407';

const RMS_THRESHOLD = 0.03;
const RMS_WINDOW_MS = 2000;

function calculateRMS(buffer) {
  const int16View = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
  let sumSquares = 0;
  for (let i = 0; i < int16View.length; i++) {
    const sample = int16View[i] / 32768;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / int16View.length);
}

export function attachCustomTranscriberWS(server) {
  const wss = new WebSocketServer({ server, path: '/api/custom-transcriber' });
  const deepgram = createClient(DEEPGRAM_API_KEY);

  wss.on('connection', (ws) => {
    console.log('🟢 WebSocket connection opened from Vapi');
    let dgLive = null;
    /** @type {{ time: number, rms: number }[]} */
    let rmsHistory = [];

    // diarization bookkeeping
    /** @type {number|null} */
    let primarySpeakerId = null;           // who becomes Speaker1 (first heard on ch-0)
    const speakerMap = new Map();          // DG speakerId -> "SpeakerX"
    let nextSpeakerOrdinal = 1;            // assigns Speaker1, Speaker2, ...

    const labelSpeaker = (dgSpeakerId) => {
      if (!speakerMap.has(dgSpeakerId)) {
        const assigned = `Speaker${nextSpeakerOrdinal}`;
        speakerMap.set(dgSpeakerId, assigned);
        nextSpeakerOrdinal++;
      }
      return speakerMap.get(dgSpeakerId);
    };

    function getMaxRMSInWindow() {
      const now = Date.now();
      rmsHistory = rmsHistory.filter((entry) => now - entry.time <= RMS_WINDOW_MS);
      if (rmsHistory.length === 0) return 0;
      return Math.max(...rmsHistory.map((entry) => entry.rms));
    }

    ws.on('message', (msg, isBinary) => {
      if (!isBinary) {
        let obj;
        try {
          obj = JSON.parse(msg.toString());
        } catch (err) {
          console.error('❌ Invalid JSON from client:', err);
          return;
        }

        if (obj.type === 'start') {
          console.log('🚀 Received "start" — initializing Deepgram live transcription');
          dgLive = deepgram.listen.live({
            encoding: obj.encoding || 'linear16',
            sample_rate: obj.sampleRate || 16000,
            channels: obj.channels ?? 2,
            model: 'nova-3',
            language: obj.language || 'en',
            punctuate: true,
            smart_format: true,
            interim_results: true,
            multichannel: true,   // ch-0: customer mic; ch-1: assistant audio if looped
            diarize: true,        // enable speaker diarization
            utterances: true      // better speaker segment boundaries
          });

          dgLive.on(LiveTranscriptionEvents.Open, () =>
            console.log('✅ Deepgram WS connection opened')
          );
          dgLive.on(LiveTranscriptionEvents.Error, (err) =>
            console.error('❌ Deepgram error:', err)
          );
          dgLive.on(LiveTranscriptionEvents.Close, (ev) =>
            console.log('🛑 Deepgram connection closed:', ev)
          );

          dgLive.on(LiveTranscriptionEvents.Transcript, (event) => {
            const alt = event.channel && event.channel.alternatives && event.channel.alternatives[0];
            const transcript = (alt && alt.transcript) || '';
            const confidence = alt && alt.confidence != null ? alt.confidence : null;
            const isFinal = !!event.is_final;
            if (!transcript.trim()) return;

            const channelIndexArr = event.channel_index || [];
            const channelIndex = channelIndexArr[0];
            if (channelIndex === undefined) return;

            // --- get diarized speaker id ---
            let dgSpeakerId = null;

            // prefer utterances if present
            if (Array.isArray(event.utterances) && event.utterances.length) {
              const u = event.utterances.find(
                (u) => (u && (u.transcript || '').trim()) === transcript.trim()
              );
              if (u && typeof u.speaker === 'number') dgSpeakerId = u.speaker;
            }

            // fallback to words[].speaker
            if (dgSpeakerId === null && alt && Array.isArray(alt.words) && alt.words.length > 0) {
              for (let i = alt.words.length - 1; i >= 0; i--) {
                const w = alt.words[i];
                if (w && typeof w.speaker === 'number') {
                  dgSpeakerId = w.speaker;
                  break;
                }
              }
            }

            let speakerLabel = null;
            if (typeof dgSpeakerId === 'number') {
              speakerLabel = labelSpeaker(dgSpeakerId);

              // lock first observed speaker on customer channel as primary Speaker1
              if (channelIndex === 0 && primarySpeakerId === null) {
                primarySpeakerId = dgSpeakerId;
                // ensure primary has label "Speaker1"
                if (speakerMap.get(dgSpeakerId) !== 'Speaker1') {
                  const currentLabel = speakerMap.get(dgSpeakerId);
                  // swap labels so dgSpeakerId -> Speaker1
                  for (const [k, v] of speakerMap.entries()) {
                    if (v === 'Speaker1') speakerMap.set(k, currentLabel);
                  }
                  speakerMap.set(dgSpeakerId, 'Speaker1');
                  speakerLabel = 'Speaker1';
                }
              }
            }

            const who =
              speakerLabel ? speakerLabel :
              channelIndex === 0 ? 'Customer' : 'Assistant';

            if (isFinal) {
              const maxRMS = getMaxRMSInWindow();
              console.log(
                `📤 FINAL ${who}: "${transcript.trim()}" | 🎯 Conf: ${confidence} | 🎙 Max RMS (last ${RMS_WINDOW_MS}ms): ${maxRMS.toFixed(4)}`
              );
            } else {
              console.log(
                `📝 Interim ${who}: "${transcript.trim()}" | 🎯 Conf: ${confidence}`
              );
            }

            // reply only to Speaker1 on channel 0
            if (isFinal && channelIndex === 0) {
              const fromPrimary =
                typeof dgSpeakerId === 'number' &&
                primarySpeakerId !== null &&
                dgSpeakerId === primarySpeakerId;

              if (fromPrimary) {
                let responseText = transcript.trim();
                if (confidence !== null && confidence < 0.8) {
                  responseText = "rephrase i couldn't hear you clearly";
                }
                const maxRMS = getMaxRMSInWindow();
                if (maxRMS < RMS_THRESHOLD) {
                  responseText = "rephrase please come closer or speak loudly your voice was not clear";
                }
                ws.send(JSON.stringify({
                  type: 'transcriber-response',
                  transcription: responseText,
                  channel: 'customer'
                }));
              }
            }
          });

        } else if (obj.type === 'stop') {
          console.log('🛑 Received stop from client');
          if (dgLive && dgLive.close) dgLive.close();
        }
      } else {
        if (dgLive && dgLive.send) {
          dgLive.send(msg);
          const rms = calculateRMS(msg);
          rmsHistory.push({ rms, time: Date.now() });
        } else {
          console.warn('⚠ Audio chunk received before Deepgram stream ready — dropped');
        }
      }
    });

    ws.on('close', () => {
      console.log('❌ WebSocket connection closed by client; closing Deepgram stream');
      if (dgLive && dgLive.close) dgLive.close();
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      if (dgLive && dgLive.close) dgLive.close();
    });
  });
}
