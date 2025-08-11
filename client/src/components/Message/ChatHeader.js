import React, { useState, useEffect, useCallback, useRef } from 'react';
import socket from '../../common/socket';
import UserPP from '../UserPP';
import { useSelector } from 'react-redux';
import * as faceapi from "face-api.js";
import { useParams, useLocation, Link, useNavigate } from 'react-router-dom';
// import Peer from 'simple-peer';
import ModalContainer from '../modal/ModalContainer';
import useIsMobile from '../../utils/useIsMobile';
import api from '../../api/api';
import checkImgLoading from '../../utils/checkImgLoading';
import isValidUrl from '../../utils/isValiUrl';
import AgoraRTC from 'agora-rtc-sdk-ng';
import { fetchAgoraToken } from '../../api/agora';

const ChatHeader = ({ friendProfile, isActive, room, lastSeen, friendProfilePic }) => {
    const [emotion, setEmotion] = useState(false);
    const [myEmotion, setMyEmotion] = useState(false);
    const [friendId, setFriendId] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isPpLoaded, setIsPpLoaded] = useState(false);
    const [friendPP, setFriendPP] = useState(friendProfilePic);
    const [isMicrophone, setIsMicrophone] = useState(true);
    const [isBackCamera, setIsBackCamera] = useState(false);
    const [isCameraOn, setIsCameraOn] = useState(true);
    const [hasVideoInput, setHasVideoInput] = useState(true);
    const [callAccepted, setCallAccepted] = useState(false);
    const [me, setMe] = useState('');
    const [isChatOptionMenu, setIsChatOptionMenu] = useState(false);
    const [receiverId, setReceiverId] = useState();
    const [isVideoCalling, setIsVideoCalling] = useState(false);
    const [modalHeight, setModalHeight] = useState('auto');

    const cameraVideoRef = useRef(null);
    const location = useLocation();
    const myVideo = useRef();
    const userVideo = useRef();
    const callEndBtn = useRef();
    const callingBeepAudio = useRef();
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const settings = useSelector(state => state.setting);
    const profile = useSelector(state => state.profile);
    const profileId = profile._id;

    // Agora state
    const rtcClientRef = useRef(null);
    const localAudioTrackRef = useRef(null);
    const localVideoTrackRef = useRef(null);
    const localJoinedRef = useRef(false);
    const remoteUserRef = useRef(null);

    const handleMicrophoneClick = useCallback(async () => {
        setIsMicrophone(prev => {
            const next = !prev;
            if (localAudioTrackRef.current) localAudioTrackRef.current.setEnabled(next);
            return next;
        });
    }, []);

    const handleCameraToggle = useCallback(async () => {
        if (!localVideoTrackRef.current) return;
        const next = !isCameraOn;
        await localVideoTrackRef.current.setEnabled(next);
        setIsCameraOn(next);
    }, [isCameraOn]);

    const closeVideoCall = () => { };

    const playCallingBeep = () => {
        callingBeepAudio?.current.play();
    };

    const stopCallingBeep = () => {
        callingBeepAudio?.current.pause();
    };

    // Agora helpers
    const ensureRtcClient = useCallback(() => {
        if (!rtcClientRef.current) {
            rtcClientRef.current = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        }
        return rtcClientRef.current;
    }, []);

    const getPreferredCameraId = async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        const backCamera = videoDevices.find(d => /back|environment/i.test(d.label));
        return isBackCamera && backCamera?.deviceId || videoDevices[0]?.deviceId;
    };

    const startLocalTracks = useCallback(async () => {
        try {
            const deviceId = await getPreferredCameraId();
            const tracks = await AgoraRTC.createMicrophoneAndCameraTracks(
                isMicrophone ? {} : false,
                isCameraOn ? (deviceId ? { cameraId: deviceId } : {}) : false
            );
            const [mic, cam] = tracks;
            localAudioTrackRef.current = mic || null;
            localVideoTrackRef.current = cam || null;
            if (myVideo.current && cam) cam.play(myVideo.current);
        } catch (err) {
            console.error('Media error:', err);
            setHasVideoInput(false);
        }
    }, [isBackCamera, isCameraOn, isMicrophone]);

    const cleanupAgora = useCallback(async () => {
        try {
            if (localVideoTrackRef.current) {
                localVideoTrackRef.current.stop();
                localVideoTrackRef.current.close();
            }
            if (localAudioTrackRef.current) {
                localAudioTrackRef.current.stop();
                localAudioTrackRef.current.close();
            }
            localVideoTrackRef.current = null;
            localAudioTrackRef.current = null;
            if (rtcClientRef.current && localJoinedRef.current) {
                await rtcClientRef.current.leave();
            }
            if (rtcClientRef.current) rtcClientRef.current.removeAllListeners();
            localJoinedRef.current = false;
        } catch (e) { }
        if (myVideo.current) myVideo.current.srcObject = null;
        if (userVideo.current) userVideo.current.srcObject = null;
    }, []);

    const subscribeRemote = useCallback(async (user) => {
        const client = ensureRtcClient();
        await client.subscribe(user, 'video').catch(() => {});
        await client.subscribe(user, 'audio').catch(() => {});
        if (userVideo.current && user.videoTrack) {
            user.videoTrack.play(userVideo.current);
        }
        if (user.audioTrack) user.audioTrack.play();
        remoteUserRef.current = user;
    }, [ensureRtcClient]);

    const joinAgoraChannel = useCallback(async (channelName) => {
        const client = ensureRtcClient();
        const myUid = profileId || String(Date.now());
        const { appId, token } = await fetchAgoraToken(channelName, myUid, 'publisher');

        client.on('user-published', async (user) => {
            await subscribeRemote(user);
        });
        client.on('user-unpublished', () => { /* no-op */ });

        await startLocalTracks();
        const uid = await client.join(appId, channelName, token || null, myUid);
        localJoinedRef.current = true;

        if (localAudioTrackRef.current) await client.publish(localAudioTrackRef.current);
        if (localVideoTrackRef.current) await client.publish(localVideoTrackRef.current);
    }, [ensureRtcClient, profileId, startLocalTracks, subscribeRemote]);

    const leaveAgoraChannel = useCallback(async () => {
        await cleanupAgora();
    }, [cleanupAgora]);

    // Socket event handlers bridging to Agora
    const callUser = (id) => {
        const channelName = [me, id].sort().join('_');
        socket.emit('call-user', {
            userToCall: id,
            signalData: { channelName },
            from: me,
            name: profile.fullName || '',
            isVideo: true
        });
        // caller also joins channel and waits for remote publish
        joinAgoraChannel(channelName).catch(console.error);
    };

    const answerCall = useCallback(async (data) => {
        setCallAccepted(true);
        stopCallingBeep();
        const channelName = data?.signal?.channelName || [data.from, me].sort().join('_');
        await joinAgoraChannel(channelName);
    }, [joinAgoraChannel, me]);

    useEffect(() => {
        socket.on('call-accepted', async (signal) => {
            // no extra action needed for Agora once both join
            setCallAccepted(true);
            stopCallingBeep();
        });

        socket.on('receive-call', async (data) => {
            setReceiverId(data.from);
            setIsVideoCalling(true);
            playCallingBeep();
            await answerCall(data);
        });

        socket.on('videoCallEnd', async () => {
            callEndBtn.current?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: false }));
        });

        callingBeepAudio?.current.setAttribute('src', 'https://programmerikram.com/wp-content/uploads/2025/05/calling-beep.mp3');

        return () => {
            socket.off('call-accepted');
            socket.off('receive-call');
            socket.off('videoCallEnd');
        };
    }, [answerCall]);

    useEffect(() => {
        if (isVideoCalling && !localJoinedRef.current) {
            // local preview setup happens in joinAgoraChannel
        }
    }, [isVideoCalling]);

    const handleVideoCallBtn = useCallback(e => {
        const id = e.currentTarget.dataset.id;
        setReceiverId(id);
        setIsVideoCalling(true);
        playCallingBeep();
        callUser(id);
    }, [me]);

    const handleLeaveCall = useCallback(async () => {
        stopCallingBeep();
        socket.emit('leaveVideoCall', friendId);
        await leaveAgoraChannel();
        setCallAccepted(false);
        setIsVideoCalling(false);
    }, [friendId, leaveAgoraChannel]);

    const startVideo = () => {
        if (!cameraVideoRef.current) return;
        navigator.mediaDevices.enumerateDevices().then(devices => {
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            const backCamera = videoDevices.find(d => /back|environment/i.test(d.label));
            const deviceId = isBackCamera && backCamera?.deviceId || videoDevices[0]?.deviceId;
            navigator.mediaDevices.getUserMedia({ video: { deviceId }, audio: isMicrophone })
                .then(stream => { cameraVideoRef.current.srcObject = stream; });
        });
    };

    const stopCamera = () => {
        if (!cameraVideoRef.current) return
        const stream = cameraVideoRef.current?.srcObject;
        stream?.getTracks().forEach(track => track.stop());
        cameraVideoRef.current.srcObject = null;
    };

    const detectEmotions = () => {
        setTimeout(() => {
            setInterval(async () => {
                if (cameraVideoRef?.current) {
                    const detections = await faceapi.detectAllFaces(cameraVideoRef.current, new faceapi.TinyFaceDetectorOptions()).withFaceExpressions();
                    if (detections.length > 0) {
                        const emotions = detections[0].expressions;
                        const maxEmotion = Object.entries(emotions).reduce((a, b) => a[1] > b[1] ? a : b)[0];
                        if (room && myEmotion !== maxEmotion) setMyEmotion(maxEmotion);
                    }
                }
            }, 100);
        }, 3000);
    };

    const loadModels = async () => {
        await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
        await faceapi.nets.faceExpressionNet.loadFromUri("/models");
        detectEmotions();
    };

    useEffect(() => { setMe(profile._id); }, [profile]);

    const handleBumpBtnClick = useCallback(() => {
        socket.emit('bump', friendProfile, profile);
    }, [friendProfile, profile]);

    useEffect(() => {
        if (room && settings.isShareEmotion) {
            startVideo();
            loadModels();
        }
    }, [room, settings]);

    useEffect(() => { stopCamera(); }, [location]);

    useEffect(() => {
        setFriendId(friendProfile._id);
        setIsLoaded(!!friendProfile._id);
        setFriendPP(friendProfile.profilePic);
        socket.emit('last_emotion', { friendId: friendProfile._id, profileId });
    }, [friendProfile]);

    useEffect(() => {
        if (isValidUrl(friendPP)) checkImgLoading(friendPP, setIsPpLoaded);
        else setFriendPP('');
    }, [friendPP]);

    useEffect(() => {
        if (myEmotion && friendId) {
            socket.emit('emotion_change', { profileId, emotion: myEmotion, friendId });
        }
    }, [myEmotion, friendId]);

    useEffect(() => {
        const handleEmotion = (emotion) => setEmotion(emotion);
        const handleLastEmotion = (data) => setEmotion(data.lastEmotion && ` L: ${data.lastEmotion}`);
        socket.on('emotion_change', handleEmotion);
        socket.on('last_emotion', handleLastEmotion);
        return () => {
            socket.off('emotion_change', handleEmotion);
            socket.off('last_emotion', handleLastEmotion);
        };
    }, []);

    const handleSwitchClick = useCallback(async () => {
        setIsBackCamera(prev => !prev);
        // switch camera device at runtime
        try {
            const deviceId = await getPreferredCameraId();
            if (localVideoTrackRef.current && deviceId) {
                await localVideoTrackRef.current.setDevice(deviceId);
            }
        } catch (e) { }
    }, []);

    const chatOptionMenu = useRef(null);
    useEffect(() => {
        const handleClickOutside = e => {
            if (chatOptionMenu.current && !chatOptionMenu.current.contains(e.target)) {
                setIsChatOptionMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleChatOptionClick = useCallback(() => setIsChatOptionMenu(prev => !prev), []);
    const handleBlockUser = useCallback(async () => {
        const res = await api.post('friend/block', { friendId });
        if (res.status === 200) alert('User Blocked');
    }, [friendId]);

    const handleUnBlockUser = useCallback(async () => {
        const res = await api.post('friend/unblock', { friendId });
        if (res.status === 200) alert('User unblocked');
    }, [friendId]);

    const handleViewProfile = useCallback(() => navigate(`/${friendId}`), [navigate, friendId]);
    return (
        <>

            <div className={`chat-header-user ${'skleton-card'}`}>
                <div className='chat-header-profilePic'>

                    {

                        !isLoaded ? <div className="skeleton-header">
                            <div className="skeleton-avatar" />

                        </div>
                            : <UserPP profilePic={`${friendPP}`} hasStory={false} profile={friendProfile._id} active={isActive ? true : false}></UserPP>
                    }
                </div>

                {
                    isLoaded == true ?
                        <>
                            <div className='chat-header-user-info'>
                                <h4 className='chat-header-username'> {`${friendProfile == true ? (friendProfile?.fullName || '') : friendProfile.user && friendProfile.user.firstName + ' ' + friendProfile.user.surname}`}</h4>

                                {

                                    isMobile ?
                                        <>

                                            {
                                                emotion ? (<span className='chat-header-active-status text-capitalized'>{emotion}</span>)



                                                    :

                                                    (<>
                                                        {lastSeen && <span className='chat-header-active-status text-capitalized'>Last Seen: {lastSeen}</span>}

                                                    </>)


                                            }


                                        </>


                                        : (
                                            <>

                                                {
                                                    emotion && (<span className='chat-header-active-status text-capitalized'>{emotion} |</span>)}

                                                {lastSeen && <span className='chat-header-active-status text-capitalized'> Last Seen: {lastSeen}</span>}


                                            </>
                                        )

                                } </div>
                        </>
                        :
                        <>
                            <div className='chat-header-user-info'>
                                <div className="skeleton-lines">
                                    <div className="skeleton-line short" />
                                    <div className="skeleton-line medium" />
                                </div>

                            </div>
                        </>
                }

            </div>

            <div className='chat-header-action'>
                <div className='chat-header-action-btn-container'>
                    <div onClick={handleBumpBtnClick} className='bump-button action-button' title='bump'>
                        <i className="fas fa-record-vinyl"></i>
                    </div>
                    <div className='call-button action-button'>
                        <i className="fas fa-phone-alt"></i>
                    </div>
                    <div onClick={handleVideoCallBtn} data-id={friendId} className='video-call-button action-button'>
                        <i className="fas fa-video"></i>
                    </div>
                    <div onClick={handleChatOptionClick.bind(this)} className='info-button action-button'>
                        <i className="fas fa-info-circle"></i>
                    </div>

                    {isChatOptionMenu && (
                        <div className="chat-option-menu" ref={chatOptionMenu} >
                            <ul>
                                <li onClick={handleViewProfile.bind(this)}>View Profile</li>
                                {
                                    profile?.blockedUsers.includes(friendId) ? <><li onClick={handleUnBlockUser.bind(this)}>Unblock {friendProfile.user.firstName}</li></> : <><li onClick={handleBlockUser.bind(this)}>Block {friendProfile.user.firstName}</li></>
                                }

                                <li>Report {friendProfile.user.firstName}</li>
                            </ul>
                        </div>
                    )}
                </div>

                <ModalContainer
                    title="Video Call"
                    style={{ width: isMobile ? '95%' : "600px", top: "50%", borderRadius: '10px', height: modalHeight }}
                    isOpen={isVideoCalling || callAccepted}
                    onRequestClose={closeVideoCall}
                    id="videoCallModal"
                >
                    <div className={`${callAccepted ? 'call-accepted' : ''}`} style={{ padding: 0 }}>
                        {<h2 className='text-center vc-modal-heading'>Video Call - {friendProfile && friendProfile.fullName}</h2>}
                        <p className='fs-3 text-center'>
                            {!callAccepted && <>Calling {friendProfile && friendProfile.fullName}</>}
                        </p>
                        <div className={`video-call-container ${isMobile ? 'mobile' : ''}`}>
                            {<video playsInline ref={userVideo} className='friends-video' autoPlay style={{ width: '100%', display: callAccepted ? 'block' : 'none' }} />}
                            {/* Use a div for Agora local video track playback */}
                            <div className='my-video' style={{ width: '150px' }} ref={myVideo} />
                        </div>
                        <div className='call-buttons'>

                            <button onClick={handleLeaveCall.bind(this)} ref={callEndBtn} className='call-button-ends call-button bg-danger'>
                                <i className="fa fa-phone"></i>
                            </button>
                            {
                                callAccepted && <>
                                    <button onClick={handleMicrophoneClick} className='call-button-microphone call-button'>
                                        {
                                            isMicrophone ? <i className="fa fa-microphone"></i> : <i className="fa fa-microphone-slash"></i>
                                        }
                                    </button>
                                    {hasVideoInput && (
                                        <button onClick={handleCameraToggle} className='call-button-camera call-button'>
                                            {isCameraOn ? <i className="fa fa-video" /> : <i className="fa fa-video-slash" />}
                                        </button>
                                    )}
                                    <button onClick={handleSwitchClick} className='call-button-switch call-button'>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"
                                            stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                                            <path d="M11 7H5a2 2 0 0 0-2 2v4" />
                                            <path d="M13 17h6a2 2 0 0 0 2-2v-4" />
                                            <polyline points="16 3 21 3 21 8" />
                                            <polyline points="8 21 3 21 3 16" />
                                            <path d="M21 3l-6.5 6.5" />
                                            <path d="M3 21l6.5-6.5" />
                                        </svg>

                                    </button>


                                </>
                            }

                        </div>

                    </div>
                </ModalContainer >



            </div >
            {
                settings.isShareEmotion === true && (
                    <video style={{ display: 'none' }} ref={cameraVideoRef} autoPlay muted width="600" height="400" />
                )
            }

            <audio ref={callingBeepAudio} src='' loop />

        </>
    );
}

export default ChatHeader;
