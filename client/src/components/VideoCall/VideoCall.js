import React, { useEffect, useState, useRef, useCallback } from 'react';
import socket from '../../common/socket';
import ModalContainer from '../modal/ModalContainer';
// import Peer from 'simple-peer';
import { useSelector } from 'react-redux';
import useIsMobile from '../../utils/useIsMobile';
import ringtones from '../../config/ringtones.json';

const VideoCall = ({ myId }) => {
    const mySettings = useSelector(state => state.setting);
    const [isVideoCall, setIsVideoCall] = useState(false);
    const [stream, setStream] = useState();
    const [callerName, setCallerName] = useState('');
    const [receivingCall, setReceivingCall] = useState(false);
    const [caller, setCaller] = useState('');
    const [callerSignal, setCallerSignal] = useState();
    const [callAccepted, setCallAccepted] = useState(false);
    const [isMicrophone, setIsMicrophone] = useState(true);
    const [isCameraOn, setIsCameraOn] = useState(true);
    const [isBackCamera, setIsBackCamera] = useState(false);
    const [hasVideoInput, setHasVideoInput] = useState(true);
    const [modalHeight, setModalHeight] = useState('auto');

    const myVideo = useRef();
    const userVideo = useRef();
    const connectionRef = useRef();
    const callEndBtn = useRef();
    const ringtoneAudio = useRef();

    const isMobile = useIsMobile();

    const stopRingtone = () => ringtoneAudio?.current.pause();
    const playRingtone = () => setTimeout(() => ringtoneAudio?.current.play(), 500);

    const closeVideoCall = () => { };

    useEffect(() => {
        if (mySettings.ringtone) {
            const ringtone = ringtones.find(r => r.id == mySettings.ringtone);
            const toneSrc = ringtone?.src || '';
            ringtoneAudio?.current.setAttribute('src', toneSrc);
        }
    }, [mySettings]);

    useEffect(() => {
        socket.on('receive-call', (data) => {
            setIsVideoCall(true);
            setReceivingCall(true);
            setCaller(data.from);
            setCallerSignal(data.signal);
            setCallerName(data.name);
            playRingtone();
        });

        socket.on('videoCallEnd', () => {
            stopRingtone();
            if (callEndBtn.current) {
                callEndBtn.current.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
        });

        return () => {
            socket.off('receive-call');
            socket.off('videoCallEnd');
        };
    }, []);

    const getStream = useCallback(async () => {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            const hasCamera = videoDevices.length > 0;
            setHasVideoInput(hasCamera);

            const backCamera = videoDevices.find(d =>
                d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment')
            );
            const videoDeviceId =
                isBackCamera && backCamera?.deviceId ? backCamera.deviceId : videoDevices[0]?.deviceId;

            const constraints = {
                audio: isMicrophone,
                video: isCameraOn && hasCamera ? { deviceId: videoDeviceId } : false,
            };

            const userStream = await navigator.mediaDevices.getUserMedia(constraints);
            setStream(userStream);
            if (myVideo.current) myVideo.current.srcObject = userStream;
        } catch (err) {
            console.error('Media error:', err);
            setHasVideoInput(false);
        }
    }, [isBackCamera, isCameraOn, isMicrophone]);

    useEffect(() => {
        if (isVideoCall) {
            getStream();
        }
    }, [isVideoCall, getStream, isCameraOn, isMicrophone]);

    useEffect(() => {
        if (isVideoCall) {
            getStream();
        }
    }, [isCameraOn, isBackCamera, getStream, isCameraOn, isMicrophone]);

    const answerCall = useCallback(() => {
        stopRingtone();
        if (!callerSignal) return;

        setCallAccepted(true);
        const peer = new Peer({ initiator: false, trickle: false, stream });

        peer.on('signal', data => socket.emit('answer-call', { signal: data, to: caller }));
        peer.on('stream', remoteStream => {
            if (userVideo.current) userVideo.current.srcObject = remoteStream;
        });

        peer.signal(callerSignal);
        connectionRef.current = peer;
    }, [callerSignal, stream]);

    const endCall = useCallback(() => {
        stopRingtone();
        socket.emit('leaveVideoCall', caller);
        if (stream) stream.getTracks().forEach(track => track.stop());
        if (myVideo.current) myVideo.current.srcObject = null;
        if (userVideo.current) userVideo.current.srcObject = null;
        setStream(null);
        setCallAccepted(false);
        setIsVideoCall(false);
        connectionRef.current?.destroy();
        connectionRef.current = null;
    }, [caller, stream, isVideoCall]);

    const handleMicrophoneClick = useCallback(() => {
        if (stream) {
            stream.getAudioTracks().forEach(track => {
                track.enabled = !track.enabled;
                setIsMicrophone(track.enabled);
            });
        }
    }, [stream]);

    const handleCameraToggle = useCallback(async () => {
        // if (stream) {
        //     stream.getVideoTracks().forEach(track => track.stop());
        // }

        const currentVideoTrack = stream.getVideoTracks()[0];

        if (isCameraOn) {

            if (currentVideoTrack) {
                setIsCameraOn(false);
                currentVideoTrack.enabled = false;
                currentVideoTrack.stop();
                stream.removeTrack(currentVideoTrack);
            }
            if (myVideo.current) myVideo.current.srcObject = stream;

            const sender = connectionRef.current?._pc?.getSenders().find(s => s.track?.kind === 'video');
            if (sender) {
                try {
                    await sender.replaceTrack(null);
                } catch (err) {
                    console.error('Error disabling video:', err);
                }
            }
        } else {

            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: isBackCamera ? { exact: "environment" } : "user" },
                    audio: isMicrophone
                });

                const newVideoTrack = newStream.getVideoTracks()[0];
                // if (!newVideoTrack) throw new Error("No video track available");

                stream.addTrack(newVideoTrack);
                setIsCameraOn(true);

                if (myVideo.current) {
                    myVideo.current.srcObject = stream;
                }

                const sender = connectionRef.current?._pc?.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    await sender.replaceTrack(newVideoTrack);
                } else {
                    connectionRef.current?.addTrack?.(newVideoTrack, stream);
                }
            } catch (err) {
                console.error("Error enabling camera:", err);
            }
        }

        setIsCameraOn(prev => !prev);
    }, [stream, isCameraOn, isMicrophone]);

    const handleSwitchClick = useCallback(() => {
        setIsBackCamera(prev => !prev);
    }, []);

    return (
        <div>
            <ModalContainer
                title="Video Call"
                style={{ width: isMobile ? '95%' : '600px', top: '50%', height: modalHeight }}
                isOpen={isVideoCall}
                onRequestClose={closeVideoCall}
                id="videoCallModal"
            >
                <div className={`${callAccepted ? 'call-accepted' : ''}`} style={{ padding: 0 }}>
                    <h2 className='text-center vc-modal-heading'>Video Call - {callerName}</h2>
                    <p className='fs-4 text-center'>{receivingCall && !callAccepted && `${callerName} Calling you`}</p>

                    <div className={`video-call-container ${isMobile ? 'mobile' : ''}`}>
                        {callAccepted && <video playsInline ref={userVideo} className='receive-friends-video' autoPlay style={{ width: '100%' }} />}
                        {<video playsInline muted ref={myVideo} className='receive-my-video' autoPlay style={{ width: '150px' }} />}
                    </div>

                    <div className='call-buttons'>
                        <button onClick={endCall} ref={callEndBtn} className='call-button-ends call-button bg-danger'>
                            <i className="fa fa-phone"></i>
                        </button>

                        {callAccepted && (
                            <>
                                <button onClick={handleMicrophoneClick} className='call-button-microphone call-button'>
                                    {isMicrophone ? <i className="fa fa-microphone" /> : <i className="fa fa-microphone-slash" />}
                                </button>
                                {hasVideoInput && (
                                    <button onClick={handleCameraToggle} className='call-button-camera call-button'>
                                        {isCameraOn ? <i className="fa fa-video" /> : <i className="fa fa-video-slash" />}
                                    </button>
                                )}
                                <button onClick={handleSwitchClick} className='call-button-switch call-button'>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                                        <path d="M11 7H5a2 2 0 0 0-2 2v4" />
                                        <path d="M13 17h6a2 2 0 0 0 2-2v-4" />
                                        <polyline points="16 3 21 3 21 8" />
                                        <polyline points="8 21 3 21 3 16" />
                                        <path d="M21 3l-6.5 6.5" />
                                        <path d="M3 21l6.5-6.5" />
                                    </svg>
                                </button>
                            </>
                        )}

                        {!callAccepted && (
                            <button onClick={answerCall} className='call-button-receive call-button bg-success'>
                                <i className="fa fa-phone-volume"></i>
                            </button>
                        )}
                    </div>
                </div>
            </ModalContainer>
            <audio ref={ringtoneAudio} loop />
        </div>
    );
};

export default VideoCall;
