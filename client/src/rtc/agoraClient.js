import AgoraRTC from 'agora-rtc-sdk-ng';

export function createRtcClient() {
  const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
  return client;
}

export async function createLocalTracks({ audio = true, video = true, cameraId } = {}) {
  const micConfig = audio ? {} : false;
  const camConfig = video ? (cameraId ? { cameraId } : {}) : false;
  const tracks = await AgoraRTC.createMicrophoneAndCameraTracks(micConfig, camConfig);
  const [microphoneTrack, cameraTrack] = tracks;
  return { microphoneTrack, cameraTrack };
}

export async function switchCamera(cameraTrack, nextDeviceId) {
  if (!cameraTrack) return;
  await cameraTrack.setDevice(nextDeviceId);
}

export async function toggleTrackEnabled(track, enabled) {
  if (!track) return;
  await track.setEnabled(enabled);
}

export async function leaveRtc(client, tracks = []) {
  try {
    tracks.forEach(t => {
      try { t.stop && t.stop(); } catch {}
      try { t.close && t.close(); } catch {}
    });
    if (client) {
      await client.leave();
      client.removeAllListeners();
    }
  } catch {}
}