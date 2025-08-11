import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
// import Peer from "simple-peer";

const socket = io("http://localhost:5000");

const VideoCallPage = () => {
  const [stream, setStream] = useState(null);
  const [peer, setPeer] = useState(null);
  const [myID, setMyID] = useState("");
  const [otherID, setOtherID] = useState("");
  const [devices, setDevices] = useState([]);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [hasCamera, setHasCamera] = useState(true);

  console.log('vc')

  // return(<></>)

  const myVideo = useRef();
  const userVideo = useRef();

  useEffect(() => {
    socket.on("connect", () => {
      setMyID(socket.id);
    });

    // Detect available media devices
    navigator.mediaDevices.enumerateDevices().then((devs) => {
      const videoInputs = devs.filter((d) => d.kind === "videoinput");
      setDevices(videoInputs);
      setHasCamera(videoInputs.length > 0);

      // Initialize stream: fallback to audio only if no camera
      getStream(videoInputs.length > 0);
    });

    socket.on("receive-call", ({ signal, from }) => {
      // agora based flow now, ignore here
    });

    socket.on("call-answered", ({ signal }) => {
      // agora based flow now, ignore here
    });

    return () => socket.disconnect();
  }, [stream]);

  const getStream = async (withVideo = true) => {
    try {
      const userStream = await navigator.mediaDevices.getUserMedia({
        video: withVideo,
        audio: true,
      });
      setStream(userStream);
      if (myVideo.current) myVideo.current.srcObject = userStream;
    } catch (err) {
      console.error("Failed to get media stream:", err);
    }
  };

  const callUser = () => {
    // Agora flow handled in Chat UI
  };

  const toggleVideo = () => {
    const videoTrack = stream?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setVideoEnabled(videoTrack.enabled);
    }
  };

  const toggleAudio = () => {
    const audioTrack = stream?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setAudioEnabled(audioTrack.enabled);
    }
  };

  return (
    <div>
      <h3>My ID: {myID}</h3>
      <input
        type="text"
        placeholder="Enter ID to call"
        value={otherID}
        onChange={(e) => setOtherID(e.target.value)}
      />
      <button onClick={callUser}>Call</button>
      <div>
        <video ref={myVideo} autoPlay muted playsInline style={{ width: 300 }} />
        <video ref={userVideo} autoPlay playsInline style={{ width: 300 }} />
      </div>
      <div>
        <button onClick={toggleAudio}>
          {audioEnabled ? "Mute Mic" : "Unmute Mic"}
        </button>
        {hasCamera && (
          <button onClick={toggleVideo}>
            {videoEnabled ? "Turn Off Camera" : "Turn On Camera"}
          </button>
        )}
        {!hasCamera && <p>Camera not available. Audio-only mode enabled.</p>}
      </div>
    </div>
  );
};

export default VideoCallPage;
