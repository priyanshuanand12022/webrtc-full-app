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
  const [handRaised, setHandRaised] = useState({});
  const [showReactions, setShowReactions] = useState(false);

  const ws = useRef(null);
  const peers = useRef({});
  const localVideo = useRef(null);
  const localStream = useRef(null);
  const chatBox = useRef(null);

  // GLOBAL CSS
  useEffect(() => {
    const css = document.createElement("style");
    css.innerHTML = `
      .reaction-emoji {
        position: fixed;
        bottom: 120px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 48px;
        animation: floatUp 1.4s ease-out forwards;
        pointer-events: none;
        z-index: 999999;
      }
      @keyframes floatUp {
        0% { transform: translate(-50%, 0); opacity: 1; }
        100% { transform: translate(-50%, -150px); opacity: 0; }
      }
      .hand-badge {
        position: absolute;
        top: 10px;
        right: 10px;
        background: #ffeb3b;
        padding: 4px 10px;
        border-radius: 8px;
        font-weight: bold;
        color: #000;
        font-size: 14px;
      }
      .video-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 12px;
        padding: 20px;
      }
    `;
    document.head.appendChild(css);
  }, []);

  useEffect(() => {
    if (chatBox.current)
      chatBox.current.scrollTop = chatBox.current.scrollHeight;
  }, [messages]);

  // ===== Floating Reactions =====
  const showFloatingEmoji = (emoji) => {
    const el = document.createElement("div");
    el.className = "reaction-emoji";
    el.innerText = emoji;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  };

  const sendReaction = (emoji) => {
    showFloatingEmoji(emoji);
    ws.current?.send(
      JSON.stringify({ type: "reaction", emoji, from: username, room: ROOM_ID })
    );
  };

  // ===== Raise Hand =====
  const raiseHandToggle = () => {
    const newState = !handRaised[username];
    setHandRaised((prev) => ({ ...prev, [username]: newState }));

    ws.current?.send(
      JSON.stringify({
        type: "raise",
        raised: newState,
        from: username,
        room: ROOM_ID,
      })
    );
  };

  // ===== Typing =====
  const handleTyping = (e) => {
    setInput(e.target.value);

    ws.current?.send(
      JSON.stringify({ type: "typing", from: username, room: ROOM_ID })
    );
  };

  // ===== Leave Call =====
  const leaveCall = () => {
    // notify others
    try {
      ws.current?.send(
        JSON.stringify({
          type: "leave",
          from: username,
          room: ROOM_ID,
        })
      );
    } catch {}

    Object.values(peers.current).forEach((pc) => pc.close());
    peers.current = {};
    localStream.current?.getTracks().forEach((t) => t.stop());
    ws.current?.close();

    window.location.reload();
  };

  // ===== Mute Mic =====
  const toggleMute = () => {
    const track = localStream.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
    }
  };

  // ===== Toggle Camera =====
  const toggleCamera = () => {
    const track = localStream.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCameraOn(track.enabled);
    }
  };

  // ===== Screen Share =====
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

      localVideo.current.srcObject = screenStream;

      screenStream.getVideoTracks()[0].onended = endScreenShare;
    } catch (e) {
      console.error("Screen share failed:", e);
    }
  };

  const endScreenShare = () => {
    setScreenSharing(false);

    const tracks = localStream.current.getTracks();
    for (const id in peers.current) {
      const senders = peers.current[id].getSenders();
      tracks.forEach((track) => {
        const sender = senders.find((s) => s.track?.kind === track.kind);
        if (sender) sender.replaceTrack(track);
      });
    }

    localVideo.current.srcObject = localStream.current;
  };

  // ===== JOIN ROOM =====
  const joinRoom = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      localStream.current = stream;

      if (localVideo.current) localVideo.current.srcObject = stream;

      detectActiveSpeaker("self", stream);
      connectSignaling();
      setJoined(true);
    } catch (err) {
      console.error("MEDIA ERROR:", err);
      alert("Allow camera & mic to join");
    }
  };

  // ===== SIGNALING =====
  const connectSignaling = () => {
    ws.current = new WebSocket(SIGNALING_SERVER);

    ws.current.onopen = () => {
      ws.current.send(
        JSON.stringify({ type: "join", username, room: ROOM_ID })
      );
    };

    ws.current.onmessage = async (msg) => {
      const data = JSON.parse(msg.data);

      switch (data.type) {
        case "ready":
          if (!peers.current[data.from]) createOffer(data.from);
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

        case "reaction":
          if (data.from !== username) showFloatingEmoji(data.emoji);
          break;

        case "raise":
          setHandRaised((prev) => ({ ...prev, [data.from]: data.raised }));
          break;

        // ⭐⭐⭐ DYNAMIC TILE REMOVAL FIX ⭐⭐⭐
        case "leave":
          // remove tile from UI
          setRemoteStreams((prev) => {
            const copy = { ...prev };
            delete copy[data.from];
            return copy;
          });

          // close peer
          if (peers.current[data.from]) {
            peers.current[data.from].close();
            delete peers.current[data.from];
          }

          // remove hand raise
          setHandRaised((prev) => {
            const copy = { ...prev };
            delete copy[data.from];
            return copy;
          });

          // remove speaker highlight
          setActiveSpeakers((prev) => {
            const copy = { ...prev };
            delete copy[data.from];
            return copy;
          });

          break;

        default:
          break;
      }
    };
  };

  // ===== WEBRTC CORE =====
  const createPeer = (id) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:relay1.expressturn.com:3478",
          username: "efree",
          credential: "free",
        },
      ],
    });

    localStream.current.getTracks().forEach((t) =>
      pc.addTrack(t, localStream.current)
    );

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        ws.current.send(
          JSON.stringify({
            type: "candidate",
            candidate: e.candidate,
            from: username,
            to: id,
            room: ROOM_ID,
          })
        );
      }
    };

    const remoteStream = new MediaStream();

    pc.ontrack = (event) => {
      event.streams[0]
        .getTracks()
        .forEach((t) => remoteStream.addTrack(t));

      setRemoteStreams((prev) => ({
        ...prev,
        [id]: remoteStream,
      }));

      detectActiveSpeaker(id, remoteStream);
    };

    peers.current[id] = pc;
    return pc;
  };

  const createOffer = async (id) => {
    const pc = createPeer(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.current.send(
      JSON.stringify({
        type: "offer",
        offer,
        to: id,
        from: username,
        room: ROOM_ID,
      })
    );
  };

  const handleOffer = async (offer, from) => {
    const pc = peers.current[from] || createPeer(from);
    await pc.setRemoteDescription(offer);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    ws.current.send(
      JSON.stringify({
        type: "answer",
        answer,
        to: from,
        from: username,
        room: ROOM_ID,
      })
    );
  };

  const handleAnswer = async (answer, from) => {
    await peers.current[from]?.setRemoteDescription(answer);
  };

  const handleCandidate = (candidate, from) => {
    peers.current[from]?.addIceCandidate(
      new RTCIceCandidate(candidate)
    );
  };

  // ===== ACTIVE SPEAKER =====
  const detectActiveSpeaker = (id, stream) => {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    const data = new Uint8Array(analyser.frequencyBinCount);

    src.connect(analyser);

    const loop = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setActiveSpeakers((prev) => ({ ...prev, [id]: avg > 22 }));
      requestAnimationFrame(loop);
    };
    loop();
  };

  // ===== JOIN SCREEN =====
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
        <h1 style={{ marginBottom: 20 }}>
          🎥 Join the Conference Room
        </h1>

        <div
          style={{
            background: "white",
            padding: 30,
            width: 320,
            borderRadius: 16,
            color: "#333",
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
          }}
        >
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your name"
            style={{
              width: "100%",
              padding: 10,
              border: "1px solid #ccc",
              borderRadius: 8,
              marginBottom: 20,
            }}
          />

          <button
            onClick={joinRoom}
            style={{
              width: "100%",
              background:
                "linear-gradient(90deg,#00c6ff,#0072ff)",
              color: "white",
              border: "none",
              padding: 10,
              borderRadius: 8,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Join Room
          </button>
        </div>
      </div>
    );
  }

  // ===== MAIN LAYOUT =====
  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: "#111",
      }}
    >
      <div className="video-grid" style={{ flex: 3 }}>
        <VideoTile
          id="self"
          name={`${username} (You)`}
          stream={localStream.current}
          videoRef={localVideo}
          handRaised={handRaised[username]}
          active={activeSpeakers["self"]}
        />

        {Object.entries(remoteStreams).map(([id, stream]) => (
          <VideoTile
            key={id}
            id={id}
            name={id}
            stream={stream}
            handRaised={handRaised[id]}
            active={activeSpeakers[id]}
          />
        ))}
      </div>

      <ChatSidebar
        messages={messages}
        typingUsers={typingUsers}
        input={input}
        setInput={setInput}
        handleTyping={handleTyping}
        chatBox={chatBox}
        sendMessage={() => {
          ws.current.send(
            JSON.stringify({
              type: "chat",
              message: input,
              from: username,
              room: ROOM_ID,
            })
          );
          setMessages((prev) => [...prev, `You: ${input}`]);
          setInput("");
        }}
      />

      <ControlBar
        muted={muted}
        cameraOn={cameraOn}
        screenSharing={screenSharing}
        toggleMute={toggleMute}
        toggleCamera={toggleCamera}
        shareScreen={shareScreen}
        endScreenShare={endScreenShare}
        sendReaction={sendReaction}
        raiseHandToggle={raiseHandToggle}
        leaveCall={leaveCall}
        showReactions={showReactions}
        setShowReactions={setShowReactions}
      />
    </div>
  );
}

// ===== VIDEO TILE =====
const VideoTile = ({ id, name, stream, videoRef, active, handRaised }) => (
  <div
    style={{
      position: "relative",
      borderRadius: 12,
      overflow: "hidden",
      border: active
        ? "4px solid #00e676"
        : "2px solid #333",
      transition: "0.2s",
    }}
  >
    <video
      ref={(ref) => {
        if (videoRef && id === "self") videoRef.current = ref;
        if (ref && stream && ref.srcObject !== stream)
          ref.srcObject = stream;
      }}
      autoPlay
      playsInline
      muted={id === "self"}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />

    <div
      style={{
        position: "absolute",
        bottom: 8,
        left: 8,
        background: "#0008",
        padding: "4px 10px",
        borderRadius: 6,
      }}
    >
      {name}
    </div>

    {handRaised && <div className="hand-badge">✋</div>}
  </div>
);

// ===== CHAT SIDEBAR =====
const ChatSidebar = ({
  messages,
  typingUsers,
  input,
  setInput,
  handleTyping,
  sendMessage,
  chatBox,
}) => (
  <div
    style={{
      flex: 1,
      background: "#222",
      color: "white",
      display: "flex",
      flexDirection: "column",
      borderLeft: "1px solid #333",
    }}
  >
    <h3 style={{ padding: 10, textAlign: "center" }}>
      Chat
    </h3>

    <div
      ref={chatBox}
      style={{ flex: 1, overflowY: "auto", padding: 10 }}
    >
      {messages.map((m, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          {m}
        </div>
      ))}

      {typingUsers.map((u) => (
        <div
          key={u}
          style={{ color: "gray", fontSize: 12 }}
        >
          {u} is typing...
        </div>
      ))}
    </div>

    <div style={{ display: "flex", padding: 10 }}>
      <input
        value={input}
        onChange={handleTyping}
        onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        placeholder="Type a message…"
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
          color: "white",
          padding: "8px 14px",
          borderRadius: 6,
        }}
      >
        Send
      </button>
    </div>
  </div>
);

// ===== CONTROL BAR =====
const ControlBar = ({
  muted,
  cameraOn,
  screenSharing,
  toggleMute,
  toggleCamera,
  shareScreen,
  endScreenShare,
  sendReaction,
  raiseHandToggle,
  leaveCall,
  showReactions,
  setShowReactions,
}) => (
  <div
    style={{
      position: "fixed",
      bottom: 20,
      left: "50%",
      transform: "translateX(-50%)",
      background: "#222",
      padding: "14px 26px",
      borderRadius: 40,
      display: "flex",
      gap: 14,
      boxShadow: "0 5px 18px rgba(0,0,0,0.4)",
    }}
  >
    <button onClick={toggleMute} style={btn}>
      {muted ? "🔇" : "🎙️"}
    </button>

    <button onClick={toggleCamera} style={btn}>
      {cameraOn ? "📷" : "🚫"}
    </button>

    {!screenSharing ? (
      <button onClick={shareScreen} style={btn}>
        🖥️
      </button>
    ) : (
      <button onClick={endScreenShare} style={btn}>
        ❌
      </button>
    )}

    {/* Reaction Menu */}
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setShowReactions((v) => !v)}
        style={btn}
      >
        😊
      </button>

      {showReactions && (
        <div
          style={{
            position: "absolute",
            bottom: 55,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#333",
            padding: "8px 12px",
            borderRadius: 12,
            display: "flex",
            gap: 10,
            boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
          }}
        >
          {["👍", "❤️", "😂", "🔥"].map((e) => (
            <div
              key={e}
              onClick={() => {
                sendReaction(e);
                setShowReactions(false);
              }}
              style={{ fontSize: 26, cursor: "pointer" }}
            >
              {e}
            </div>
          ))}
        </div>
      )}
    </div>

    <button onClick={raiseHandToggle} style={btn}>
      ✋
    </button>

    <button
      onClick={leaveCall}
      style={{
        ...btn,
        background: "#ff4d4f",
        padding: "0 18px",
        width: "auto",
        borderRadius: 20,
        fontWeight: "bold",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      🚪 Leave
    </button>
  </div>
);

const btn = {
  background: "#333",
  color: "#fff",
  border: "none",
  width: 46,
  height: 46,
  fontSize: 20,
  borderRadius: "50%",
  cursor: "pointer",
};

export default App;
