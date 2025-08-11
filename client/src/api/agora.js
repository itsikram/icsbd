import api from './api';

export async function fetchAgoraToken(channelName, uid, role = 'publisher') {
  const { data } = await api.post('agora/token', { channelName, uid, role });
  return data; // { appId, token, channelName, uid, expireAt }
}