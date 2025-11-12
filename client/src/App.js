import React, { useState, useRef, useEffect } from "react";

const SIGNALING_SERVER = "wss://webrtc-server-vial.onrender.com/";
const ROOM_ID = "testroom";

function App() {
  const [username, setUsername] = useState("");
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [remoteStreams, setRemoteStreams] = useState({});
  const [activeSpeakers, setActiveSpeakers] = useState({});

  const ws = useRef(null);
  const peers = useRef({});
  const localVideo = useRef(null);
  const localStream = useRef(null);
  const chatBox = useRef(null);
  const typingTimeouts = useRef({});
  const audioAnalyzers = useRef({});
  const candidateBuffer = useRef({});

  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:relay1.expressturn.com:3478",
      username: "efree",
      credential: "free",
    },
  ];

  useEffect(() => {
    if (chatBox.current)
      chatBox.current.scrollTop = chatBox.current.scrollHeight;
  }, [messages]);

  // 🔹 JOIN ROOM
  const joinRoom = async () => {
    try {
      console.log("Requesting camera & mic...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStream.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;

      detectActiveSpeaker("self", stream);
      connectSignaling();
      setJoined(true);
    } catch (err) {
      console.error("Media error:", err);
      alert("Please allow camera and microphone access.");
    }
  };

  // 🔹 CONNECT SIGNALING
  const connectSignaling = () => {
    ws.current = new WebSocket(SIGNALING_SERVER);

    ws.current.onopen = () => {
      console.log("✅ Connected to signaling server");
      ws.current.send(
        JSON.stringify({ type: "join", room: ROOM_ID, username })
      );
    };

    ws.current.onmessage = async (msg) => {
      const data = JSON.parse(msg.data);
      console.log("📩", data);

      switch (data.type) {
        case "ready":
          if (localStream.current && !peers.current[data.from]) createOffer(data.from);
          break;
        case "offer":
          await handleOffer(data.offer, data.from);
          break;
        case "answer":
          await handleAnswer(data.answer, data.from);
          break;
        case "candidate":
          handleCandidate(data.candidate, data.from);
          break;
        case "chat":
          if (data.from !== username)
            setMessages((prev) => [...prev, `${data.from}: ${data.message}`]);
          break;
        case "typing":
          if (data.from !== username) showTyping(data.from);
          break;
        default:
          break;
      }
    };
  };

  // 🔹 SHOW TYPING
  const showTyping = (user) => {
    setTypingUsers((prev) => {
      if (!prev.includes(user)) return [...prev, user];
      return prev;
    });
    if (typingTimeouts.current[user])
      clearTimeout(typingTimeouts.current[user]);
    typingTimeouts.current[user] = setTimeout(() => {
      setTypingUsers((prev) => prev.filter((u) => u !== user));
    }, 1500);
  };

  // 🔹 WEBRTC CORE
  const createPeer = (id) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    localStream.current?.getTracks().forEach((t) => pc.addTrack(t, localStream.current));

    pc.onicecandidate = (ev) => {
      if (ev.candidate)
        ws.current.send(
          JSON.stringify({
            type: "candidate",
            to: id,
            candidate: ev.candidate,
            from: username,
            room: ROOM_ID,
          })
        );
    };

    const remoteStream = new MediaStream();
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => remoteStream.addTrack(track));
      setRemoteStreams((prev) => ({ ...prev, [id]: remoteStream }));
      detectActiveSpeaker(id, remoteStream);
    };

    if (candidateBuffer.current[id]) {
      candidateBuffer.current[id].forEach((c) => {
        pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error);
      });
      delete candidateBuffer.current[id];
    }

    peers.current[id] = pc;
    return pc;
  };

  const createOffer = async (id) => {
    const pc = createPeer(id);
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await pc.setLocalDescription(offer);
    ws.current.send(
      JSON.stringify({ type: "offer", offer, to: id, from: username, room: ROOM_ID })
    );
  };

  const handleOffer = async (offer, from) => {
    const pc = peers.current[from] || createPeer(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.current.send(
      JSON.stringify({ type: "answer", answer, to: from, from: username, room: ROOM_ID })
    );
  };

  const handleAnswer = async (answer, from) => {
    const pc = peers.current[from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
  };

  const handleCandidate = (candidate, from) => {
    const pc = peers.current[from];
    if (pc)
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
    else {
      if (!candidateBuffer.current[from]) candidateBuffer.current[from] = [];
      candidateBuffer.current[from].push(candidate);
    }
  };

  // 🔹 DETECT ACTIVE SPEAKER
  const detectActiveSpeaker = (id, stream) => {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    src.connect(analyser);
    audioAnalyzers.current[id] = { audioCtx, analyser, dataArray };

    const checkVolume = () => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setActiveSpeakers((prev) => ({ ...prev, [id]: avg > 20 }));
      requestAnimationFrame(checkVolume);
    };
    checkVolume();
  };

  // 🔹 CONTROLS
  const toggleMute = () => {
    const track = localStream.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
    }
  };

  const toggleCamera = () => {
    const track = localStream.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCameraOn(track.enabled);
    }
  };

  const shareScreen = async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      setScreenSharing(true);

      for (const id in peers.current) {
        const senders = peers.current[id].getSenders();
        screenStream.getTracks().forEach((track) => {
          const sender = senders.find((s) => s.track?.kind === track.kind);
          if (sender) sender.replaceTrack(track);
        });
      }

      if (localVideo.current) localVideo.current.srcObject = screenStream;

      screenStream.getVideoTracks()[0].onended = endScreenShare;
    } catch (e) {
      console.error("Screen share failed:", e);
    }
  };

  const endScreenShare = () => {
    setScreenSharing(false);
    const camTracks = localStream.current.getTracks();

    for (const id in peers.current) {
      const senders = peers.current[id].getSenders();
      camTracks.forEach((track) => {
        const sender = senders.find((s) => s.track?.kind === track.kind);
        if (sender) sender.replaceTrack(track);
      });
    }

    if (localVideo.current) localVideo.current.srcObject = localStream.current;
  };

  // 🔹 CHAT
  const sendMessage = () => {
    if (!input.trim()) return;
    ws.current?.send(
      JSON.stringify({ type: "chat", message: input, from: username, room: ROOM_ID })
    );
    setMessages((prev) => [...prev, `You: ${input}`]);
    setInput("");
  };

  const handleTyping = (e) => {
    setInput(e.target.value);
    ws.current?.send(JSON.stringify({ type: "typing", from: username, room: ROOM_ID }));
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") sendMessage();
  };

  // ---- UI ----
  if (!joined) {
    return (
      <div
        style={{
          fontFamily: "Poppins, sans-serif",
          textAlign: "center",
          minHeight: "100vh",
          background: "linear-gradient(135deg,#667eea,#764ba2)",
          color: "white",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <h1 style={{ marginBottom: 20 }}>🎥 Join the Conference Room</h1>
        <div
          style={{
            background: "white",
            color: "#333",
            padding: 30,
            borderRadius: 16,
            width: 320,
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          }}
        >
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your name"
            style={{
              width: "100%",
              padding: "10px 14px",
              border: "1px solid #ccc",
              borderRadius: 8,
              marginBottom: 20,
            }}
          />
          <button
            onClick={joinRoom}
            style={{
              width: "100%",
              background: "linear-gradient(90deg,#00c6ff,#0072ff)",
              color: "white",
              border: "none",
              padding: "10px 16px",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Join Room
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "#1a1a1a",
        color: "white",
        fontFamily: "Poppins, sans-serif",
      }}
    >
      {/* Video Grid */}
      <div
        style={{
          flex: 3,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "10px",
          padding: "20px",
        }}
      >
        <VideoTile
          id="self"
          name={`${username} (You)`}
          stream={localStream.current}
          videoRef={localVideo}
          active={!!activeSpeakers["self"]}
        />
        {Object.entries(remoteStreams).map(([id, stream]) => (
          <VideoTile key={id} id={id} name={id} stream={stream} active={!!activeSpeakers[id]} />
        ))}
      </div>

      <ChatSidebar
        messages={messages}
        typingUsers={typingUsers}
        input={input}
        handleTyping={handleTyping}
        handleKeyDown={handleKeyDown}
        sendMessage={sendMessage}
        chatBox={chatBox}
      />

      <ControlBar
        muted={muted}
        cameraOn={cameraOn}
        screenSharing={screenSharing}
        toggleMute={toggleMute}
        toggleCamera={toggleCamera}
        shareScreen={shareScreen}
        endScreenShare={endScreenShare}
      />
    </div>
  );
}

// 🎥 VIDEO TILE COMPONENT
const VideoTile = ({ id, name, stream, videoRef, active }) => (
  <div
    style={{
      position: "relative",
      borderRadius: 12,
      overflow: "hidden",
      border: active ? "4px solid #00e676" : "2px solid #333",
      boxShadow: active ? "0 0 20px #00e67680" : "0 2px 10px rgba(0,0,0,0.3)",
      transition: "all 0.2s ease",
    }}
  >
    <video
      autoPlay
      playsInline
      muted={id === "self"}
      ref={(ref) => {
        if (videoRef && id === "self") videoRef.current = ref;
        if (ref && stream && ref.srcObject !== stream) ref.srcObject = stream;
      }}
      style={{ width: "100%", borderRadius: 12 }}
    />
    <div
      style={{
        position: "absolute",
        bottom: 8,
        left: 8,
        background: "#0008",
        padding: "4px 8px",
        borderRadius: 6,
        fontSize: 13,
      }}
    >
      {name}
    </div>
  </div>
);

// 💬 CHAT SIDEBAR
const ChatSidebar = ({
  messages,
  typingUsers,
  input,
  handleTyping,
  handleKeyDown,
  sendMessage,
  chatBox,
}) => (
  <div
    style={{
      flex: 1,
      background: "#222",
      display: "flex",
      flexDirection: "column",
      borderLeft: "1px solid #333",
    }}
  >
    <h3
      style={{
        padding: "15px",
        borderBottom: "1px solid #333",
        textAlign: "center",
      }}
    >
      💬 Chat
    </h3>
    <div ref={chatBox} style={{ flex: 1, overflowY: "auto", padding: 10 }}>
      {messages.map((m, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          {m}
        </div>
      ))}
      {typingUsers.map((u) => (
        <div key={u} style={{ fontStyle: "italic", color: "gray", fontSize: 12 }}>
          {u} is typing...
        </div>
      ))}
    </div>
    <div style={{ display: "flex", padding: 10 }}>
      <input
        value={input}
        onChange={handleTyping}
        onKeyDown={handleKeyDown}
        placeholder="Type and press Enter"
        style={{
          flex: 1,
          padding: 8,
          borderRadius: 6,
          border: "none",
          marginRight: 8,
        }}
      />
      <button
        onClick={sendMessage}
        style={{
          background: "#007bff",
          color: "#fff",
          border: "none",
          padding: "8px 12px",
          borderRadius: 6,
        }}
      >
        Send
      </button>
    </div>
  </div>
);

// 🎛️ CONTROL BAR
const ControlBar = ({
  muted,
  cameraOn,
  screenSharing,
  toggleMute,
  toggleCamera,
  shareScreen,
  endScreenShare,
}) => (
  <div
    style={{
      position: "fixed",
      bottom: 20,
      left: "50%",
      transform: "translateX(-50%)",
      background: "#222",
      padding: "10px 20px",
      borderRadius: 30,
      display: "flex",
      gap: 15,
      boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
    }}
  >
    <button onClick={toggleMute} style={controlBtnStyle}>
      {muted ? "🔇" : "🎙️"}
    </button>
    <button onClick={toggleCamera} style={controlBtnStyle}>
      {cameraOn ? "📷" : "🚫"}
    </button>
    {!screenSharing ? (
      <button onClick={shareScreen} style={controlBtnStyle}>
        🖥️
      </button>
    ) : (
      <button onClick={endScreenShare} style={controlBtnStyle}>
        ❌
      </button>
    )}
  </div>
);

const controlBtnStyle = {
  fontSize: 18,
  background: "#333",
  color: "#fff",
  border: "none",
  borderRadius: "50%",
  width: 45,
  height: 45,
  cursor: "pointer",
};

export default App;
