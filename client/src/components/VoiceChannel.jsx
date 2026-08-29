import { useEffect, useRef, useState } from "react";
import socket from "../socket";

const MIC_DEVICE_STORAGE_KEY = "voice_selected_mic_device_id";

function VoiceChannel({ roomName }) {
  const [isInRoom, setIsInRoom] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [users, setUsers] = useState([]);
  const [isJoining, setIsJoining] = useState(false);

  const [availableMics, setAvailableMics] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState("");

  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const audioElementsRef = useRef({});
  const joinedRoomRef = useRef(null);
  const pendingCandidatesRef = useRef({});
  const mountedRef = useRef(true);

  // =========================================================
  // MİKROFONLARI GETİR
  // =========================================================

  async function refreshMicList(stream = null) {
    try {
      const devices =
        await navigator.mediaDevices.enumerateDevices();

      const microphones = devices.filter(
        (device) => device.kind === "audioinput"
      );

      setAvailableMics(microphones);

      if (stream) {
        const track = stream.getAudioTracks()[0];

        if (track) {
          const settings = track.getSettings();

          if (settings.deviceId) {
            setSelectedMicId(settings.deviceId);

            localStorage.setItem(
              MIC_DEVICE_STORAGE_KEY,
              settings.deviceId
            );
          }
        }
      }
    } catch (error) {
      console.error(
        "[voice] Mikrofon listesi alınamadı:",
        error
      );
    }
  }

  // =========================================================
  // UZAK SESİ OYNAT
  // =========================================================

  async function playRemoteAudio(userId, stream) {
    let audio =
      audioElementsRef.current[userId];

    if (!audio) {
      audio = document.createElement("audio");

      audio.autoplay = true;
      audio.playsInline = true;
      audio.controls = false;
      audio.volume = 1;
      audio.muted = false;

      audioElementsRef.current[userId] = audio;

      document.body.appendChild(audio);
    }

    audio.srcObject = stream;

    try {
      await audio.play();

      console.log(
        `[voice-debug] Uzak ses oynatılıyor: ${userId}`
      );
    } catch (error) {
      console.warn(
        `[voice-debug] Uzak ses oynatılamadı: ${userId}`,
        error
      );
    }
  }

  // =========================================================
  // PEER SİL
  // =========================================================

  function removePeer(userId) {
    console.log(
      `[voice-debug] PEER SİLİNİYOR: ${userId}`
    );

    const peer =
      peersRef.current[userId];

    if (peer) {
      try {
        peer.ontrack = null;
        peer.onicecandidate = null;
        peer.onconnectionstatechange = null;
        peer.oniceconnectionstatechange = null;
        peer.onsignalingstatechange = null;
        peer.onicegatheringstatechange = null;
        peer.close();
      } catch (error) {
        console.warn(
          "[voice-debug] Peer kapatılırken hata:",
          error
        );
      }

      delete peersRef.current[userId];
    }

    const audio =
      audioElementsRef.current[userId];

    if (audio) {
      try {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      } catch {}
      
      delete audioElementsRef.current[userId];
    }

    delete pendingCandidatesRef.current[userId];
  }

  // =========================================================
  // TÜM PEER'LARI SİL
  // =========================================================

  function removeAllPeers() {
    console.log(
      "[voice-debug] TÜM PEER'LAR SİLİNİYOR"
    );

    Object.keys(peersRef.current).forEach(
      (userId) => {
        removePeer(userId);
      }
    );

    Object.keys(
      audioElementsRef.current
    ).forEach((userId) => {
      const audio =
        audioElementsRef.current[userId];

      try {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      } catch {}
    });

    peersRef.current = {};
    audioElementsRef.current = {};
    pendingCandidatesRef.current = {};
  }

  // =========================================================
  // OPUS / AUDIO AYARLARI
  // =========================================================

  async function configureAudioSender(peer) {
    try {
      const sender = peer
        .getSenders()
        .find(
          (item) =>
            item.track &&
            item.track.kind === "audio"
        );

      if (!sender) {
        console.warn(
          "[voice-debug] Audio sender bulunamadı."
        );

        return;
      }

      const parameters =
        sender.getParameters();

      if (!parameters.encodings) {
        parameters.encodings = [{}];
      }

      parameters.encodings =
        parameters.encodings.map(
          (encoding) => ({
            ...encoding,
            maxBitrate: 128000,
            maxFramerate: undefined,
          })
        );

      await sender.setParameters(
        parameters
      );

      console.log(
        "[voice-debug] Audio sender bitrate: 128kbps"
      );
    } catch (error) {
      console.warn(
        "[voice-debug] Audio sender ayarlanamadı:",
        error
      );
    }
  }

  // =========================================================
  // PEER OLUŞTUR
  // =========================================================

  function createPeer(userId, initiator) {
    if (!localStreamRef.current) {
      console.warn(
        `[voice-debug] ${userId} için peer oluşturulamadı: local stream yok`
      );

      return null;
    }

    if (peersRef.current[userId]) {
      console.log(
        `[voice-debug] ${userId} için mevcut peer kullanılıyor`
      );

      return peersRef.current[userId];
    }

    console.log(
      `[voice-debug] PEER OLUŞTURULUYOR: ${userId}`,
      {
        initiator,
        socketId: socket.id,
      }
    );

    const peer =
      new RTCPeerConnection({
        iceServers: [
          {
            urls:
              "stun:stun.l.google.com:19302",
          },
          {
            urls:
              "stun:stun1.l.google.com:19302",
          },
        ],
      });

    peersRef.current[userId] =
      peer;

    // =======================================================
    // WEBRTC DEBUG
    // =======================================================

    peer.oniceconnectionstatechange = () => {
      console.log(
        `[voice-debug] ICE ${userId}:`,
        peer.iceConnectionState
      );
    };

    peer.onsignalingstatechange = () => {
      console.log(
        `[voice-debug] SIGNALING ${userId}:`,
        peer.signalingState
      );
    };

    peer.onconnectionstatechange = () => {
      console.log(
        `[voice-debug] CONNECTION ${userId}:`,
        peer.connectionState
      );

      /*
       * ÖNEMLİ:
       * Burada artık failed olduğunda peer'ı otomatik silmiyoruz.
       *
       * Önce gerçek sorunu tespit edeceğiz.
       */

      if (
        peer.connectionState ===
        "failed"
      ) {
        console.error(
          `[voice-debug] ❌ WEBRTC BAĞLANTISI FAILED: ${userId}`
        );
      }

      if (
        peer.connectionState ===
        "disconnected"
      ) {
        console.warn(
          `[voice-debug] ⚠️ WEBRTC BAĞLANTISI DISCONNECTED: ${userId}`
        );
      }

      if (
        peer.connectionState ===
        "connected"
      ) {
        console.log(
          `[voice-debug] ✅ WEBRTC BAĞLANTISI CONNECTED: ${userId}`
        );
      }
    };

    peer.onicegatheringstatechange = () => {
      console.log(
        `[voice-debug] ICE GATHERING ${userId}:`,
        peer.iceGatheringState
      );
    };

    // =======================================================
    // MİKROFON TRACK
    // =======================================================

    const tracks =
      localStreamRef.current.getTracks();

    tracks.forEach((track) => {
      console.log(
        `[voice-debug] Track ekleniyor ${userId}:`,
        {
          kind: track.kind,
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState,
        }
      );

      peer.addTrack(
        track,
        localStreamRef.current
      );
    });

    configureAudioSender(peer);

    // =======================================================
    // UZAK SES
    // =======================================================

    peer.ontrack = (event) => {
      console.log(
        `[voice-debug] UZAK TRACK GELDİ: ${userId}`,
        {
          kind: event.track?.kind,
          label: event.track?.label,
          readyState: event.track?.readyState,
          streams: event.streams?.length,
        }
      );

      let stream =
        event.streams?.[0];

      if (!stream) {
        stream = new MediaStream();

        if (event.track) {
          stream.addTrack(
            event.track
          );
        }
      }

      playRemoteAudio(
        userId,
        stream
      );
    };

    // =======================================================
    // ICE
    // =======================================================

    peer.onicecandidate = (event) => {
      if (!event.candidate) {
        console.log(
          `[voice-debug] ICE candidate gathering tamamlandı: ${userId}`
        );

        return;
      }

      if (!joinedRoomRef.current) {
        console.warn(
          `[voice-debug] ICE candidate gönderilmedi: odada değiliz`
        );

        return;
      }

      console.log(
        `[voice-debug] ICE candidate gönderiliyor: ${userId}`,
        event.candidate.candidate
      );

      socket.emit(
        "voice:signal",
        {
          target: userId,
          type: "candidate",
          candidate:
            event.candidate,
        }
      );
    };

    // =======================================================
    // OFFER
    // =======================================================

    if (initiator) {
      createOffer(
        userId,
        peer
      );
    }

    return peer;
  }

  // =========================================================
  // OFFER OLUŞTUR
  // =========================================================

  async function createOffer(
    userId,
    peer
  ) {
    try {
      console.log(
        `[voice-debug] OFFER oluşturuluyor: ${userId}`
      );

      const offer =
        await peer.createOffer({
          offerToReceiveAudio: true,
        });

      if (
        peer.signalingState ===
        "closed"
      ) {
        console.warn(
          `[voice-debug] Offer gönderilemedi, peer kapalı: ${userId}`
        );

        return;
      }

      await peer.setLocalDescription(
        offer
      );

      if (!joinedRoomRef.current) {
        console.warn(
          "[voice-debug] Offer gönderilmedi: odada değiliz."
        );

        return;
      }

      console.log(
        `[voice-debug] OFFER gönderiliyor: ${userId}`
      );

      socket.emit(
        "voice:signal",
        {
          target: userId,
          type: "offer",
          sdp: peer.localDescription,
        }
      );
    } catch (error) {
      console.error(
        `[voice-debug] ❌ OFFER HATASI ${userId}:`,
        error
      );
    }
  }

  // =========================================================
  // OFFER AL
  // =========================================================

  async function handleOffer(
    sender,
    sdp
  ) {
    console.log(
      `[voice-debug] OFFER ALINDI: ${sender}`
    );

    let peer =
      peersRef.current[sender];

    if (!peer) {
      peer = createPeer(
        sender,
        false
      );
    }

    if (!peer) {
      return;
    }

    try {
      if (
        peer.signalingState !==
        "stable"
      ) {
        console.warn(
          `[voice-debug] Offer reddedildi. Signaling state: ${peer.signalingState}`
        );

        return;
      }

      await peer.setRemoteDescription(
        new RTCSessionDescription(sdp)
      );

      console.log(
        `[voice-debug] Remote description ayarlandı: ${sender}`
      );

      await flushPendingCandidates(
        sender,
        peer
      );

      const answer =
        await peer.createAnswer();

      await peer.setLocalDescription(
        answer
      );

      if (!joinedRoomRef.current) {
        return;
      }

      console.log(
        `[voice-debug] ANSWER gönderiliyor: ${sender}`
      );

      socket.emit(
        "voice:signal",
        {
          target: sender,
          type: "answer",
          sdp: peer.localDescription,
        }
      );
    } catch (error) {
      console.error(
        `[voice-debug] ❌ ANSWER OLUŞTURMA HATASI ${sender}:`,
        error
      );
    }
  }

  // =========================================================
  // ANSWER AL
  // =========================================================

  async function handleAnswer(
    sender,
    sdp
  ) {
    console.log(
      `[voice-debug] ANSWER ALINDI: ${sender}`
    );

    const peer =
      peersRef.current[sender];

    if (!peer) {
      console.warn(
        `[voice-debug] Answer geldi fakat peer bulunamadı: ${sender}`
      );

      return;
    }

    try {
      if (
        peer.signalingState !==
        "have-local-offer"
      ) {
        console.warn(
          `[voice-debug] Answer işlenmedi. Signaling state: ${peer.signalingState}`
        );

        return;
      }

      await peer.setRemoteDescription(
        new RTCSessionDescription(sdp)
      );

      console.log(
        `[voice-debug] Remote answer ayarlandı: ${sender}`
      );

      await flushPendingCandidates(
        sender,
        peer
      );
    } catch (error) {
      console.error(
        `[voice-debug] ❌ ANSWER İŞLEME HATASI ${sender}:`,
        error
      );
    }
  }

  // =========================================================
  // ICE CANDIDATE
  // =========================================================

  async function handleCandidate(
    sender,
    candidate
  ) {
    if (!candidate) {
      return;
    }

    console.log(
      `[voice-debug] ICE candidate ALINDI: ${sender}`
    );

    const peer =
      peersRef.current[sender];

    if (
      !peer ||
      !peer.remoteDescription
    ) {
      if (
        !pendingCandidatesRef.current[
          sender
        ]
      ) {
        pendingCandidatesRef.current[
          sender
        ] = [];
      }

      pendingCandidatesRef.current[
        sender
      ].push(candidate);

      console.log(
        `[voice-debug] ICE candidate beklemeye alındı: ${sender}`
      );

      return;
    }

    try {
      await peer.addIceCandidate(
        new RTCIceCandidate(
          candidate
        )
      );

      console.log(
        `[voice-debug] ICE candidate eklendi: ${sender}`
      );
    } catch (error) {
      console.warn(
        `[voice-debug] ICE candidate hatası ${sender}:`,
        error
      );
    }
  }

  // =========================================================
  // BEKLEYEN ICE
  // =========================================================

  async function flushPendingCandidates(
    userId,
    peer
  ) {
    const candidates =
      pendingCandidatesRef.current[
        userId
      ];

    if (
      !candidates ||
      candidates.length === 0
    ) {
      return;
    }

    console.log(
      `[voice-debug] ${candidates.length} bekleyen ICE candidate ekleniyor: ${userId}`
    );

    for (
      const candidate of candidates
    ) {
      try {
        await peer.addIceCandidate(
          new RTCIceCandidate(
            candidate
          )
        );
      } catch (error) {
        console.warn(
          `[voice-debug] Bekleyen ICE hatası ${userId}:`,
          error
        );
      }
    }

    delete pendingCandidatesRef.current[
      userId
    ];
  }

  // =========================================================
  // MİKROFON DEĞİŞTİR
  // =========================================================

  async function handleMicChange(
    deviceId
  ) {
    if (
      !deviceId ||
      deviceId === selectedMicId
    ) {
      return;
    }

    try {
      const newStream =
        await navigator.mediaDevices.getUserMedia(
          {
            audio: {
              deviceId: {
                exact: deviceId,
              },

              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,

              channelCount: 1,
              sampleRate: 48000,
              sampleSize: 16,
            },
          }
        );

      const newTrack =
        newStream.getAudioTracks()[0];

      if (!newTrack) {
        newStream
          .getTracks()
          .forEach((track) =>
            track.stop()
          );

        return;
      }

      newTrack.enabled =
        !isMuted;

      const peers =
        Object.values(
          peersRef.current
        );

      for (const peer of peers) {
        const sender =
          peer
            .getSenders()
            .find(
              (item) =>
                item.track &&
                item.track.kind ===
                  "audio"
            );

        if (sender) {
          try {
            await sender.replaceTrack(
              newTrack
            );

            await configureAudioSender(
              peer
            );
          } catch (error) {
            console.warn(
              "[voice] Track değiştirilemedi:",
              error
            );
          }
        }
      }

      if (localStreamRef.current) {
        localStreamRef.current
          .getTracks()
          .forEach((track) =>
            track.stop()
          );
      }

      localStreamRef.current =
        newStream;

      setSelectedMicId(deviceId);

      localStorage.setItem(
        MIC_DEVICE_STORAGE_KEY,
        deviceId
      );

      await refreshMicList(
        newStream
      );

      console.log(
        "[voice] Mikrofon değiştirildi:",
        newTrack.label,
        newTrack.getSettings()
      );
    } catch (error) {
      console.error(
        "[voice] Mikrofon değiştirilemedi:",
        error
      );

      alert(
        "Seçilen mikrofona geçilemedi."
      );
    }
  }

  // =========================================================
  // ODAYA GİR
  // =========================================================

  async function joinRoom() {
    if (
      joinedRoomRef.current ||
      isJoining
    ) {
      return;
    }

    setIsJoining(true);

    console.log(
      "[voice-debug] ODAYA GİRİŞ BAŞLADI:",
      roomName
    );

    const savedDeviceId =
      localStorage.getItem(
        MIC_DEVICE_STORAGE_KEY
      );

    try {
      let stream = null;

      const audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,

        channelCount: 1,
        sampleRate: 48000,
        sampleSize: 16,
      };

      if (savedDeviceId) {
        try {
          stream =
            await navigator.mediaDevices.getUserMedia(
              {
                audio: {
                  ...audioConstraints,
                  deviceId: {
                    exact: savedDeviceId,
                  },
                },
              }
            );
        } catch (error) {
          console.warn(
            "[voice] Kayıtlı mikrofon kullanılamadı, varsayılan deneniyor."
          );

          localStorage.removeItem(
            MIC_DEVICE_STORAGE_KEY
          );
        }
      }

      if (!stream) {
        stream =
          await navigator.mediaDevices.getUserMedia(
            {
              audio:
                audioConstraints,
            }
          );
      }

      if (!mountedRef.current) {
        stream
          .getTracks()
          .forEach((track) =>
            track.stop()
          );

        return;
      }

      localStreamRef.current =
        stream;

      const track =
        stream.getAudioTracks()[0];

      if (track) {
        console.log(
          "[voice-debug] MİKROFON:",
          track.label
        );

        console.log(
          "[voice-debug] MİKROFON AYARLARI:",
          track.getSettings()
        );

        console.log(
          "[voice-debug] MİKROFON TRACK:",
          {
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
          }
        );
      }

      await refreshMicList(
        stream
      );

      joinedRoomRef.current =
        roomName;

      console.log(
        "[voice-debug] SOCKET voice:join gönderiliyor:",
        {
          room: roomName,
          socketId: socket.id,
        }
      );

      socket.emit(
        "voice:join",
        {
          room: roomName,
          username: "Misafir",
        }
      );

      if (mountedRef.current) {
        setIsInRoom(true);
        setIsJoining(false);
      }

      console.log(
        "[voice-debug] ODAYA GİRİŞ TAMAMLANDI:",
        roomName
      );
    } catch (error) {
      console.error(
        "[voice] Mikrofon hatası:",
        error
      );

      if (localStreamRef.current) {
        localStreamRef.current
          .getTracks()
          .forEach((track) =>
            track.stop()
          );

        localStreamRef.current =
          null;
      }

      joinedRoomRef.current =
        null;

      if (mountedRef.current) {
        setIsInRoom(false);
        setIsJoining(false);
      }

      if (
        error.name ===
        "NotAllowedError"
      ) {
        alert(
          "Mikrofon izni verilmedi."
        );
      } else if (
        error.name ===
        "NotFoundError"
      ) {
        alert(
          "Mikrofon bulunamadı."
        );
      } else {
        alert(
          "Mikrofon bağlantısı kurulamadı."
        );
      }
    }
  }

  // =========================================================
  // ODADAN ÇIK
  // =========================================================

  function leaveRoom() {
    const room =
      joinedRoomRef.current;

    console.log(
      "[voice-debug] LEAVE ROOM ÇAĞRILDI:",
      {
        room,
        socketId: socket.id,
      }
    );

    if (room) {
      socket.emit(
        "voice:leave",
        {
          room,
        }
      );
    }

    removeAllPeers();

    if (localStreamRef.current) {
      localStreamRef.current
        .getTracks()
        .forEach((track) =>
          track.stop()
        );

      localStreamRef.current =
        null;
    }

    joinedRoomRef.current =
      null;

    setIsInRoom(false);
    setIsJoining(false);
    setIsMuted(false);
    setUsers([]);
  }

  // =========================================================
  // SOCKET EVENTLERİ
  // =========================================================

  useEffect(() => {
    function onExistingUsers(
      existingUsers
    ) {
      console.log(
        "[voice-debug] EXISTING USERS:",
        existingUsers
      );

      if (
        !joinedRoomRef.current ||
        !localStreamRef.current
      ) {
        console.warn(
          "[voice-debug] Existing users geldi ama local stream/room yok."
        );

        return;
      }

      existingUsers.forEach(
        (user) => {
          if (
            user.id === socket.id
          ) {
            return;
          }

          console.log(
            `[voice-debug] Mevcut kullanıcıya peer oluşturuluyor: ${user.id}`
          );

          createPeer(
            user.id,
            true
          );
        }
      );
    }

    async function onVoiceSignal(
      data
    ) {
      console.log(
        "[voice-debug] SIGNAL ALINDI:",
        data?.type,
        data?.sender
      );

      if (
        !joinedRoomRef.current ||
        !data
      ) {
        return;
      }

      const {
        sender,
        type,
        sdp,
        candidate,
      } = data;

      if (!sender) {
        return;
      }

      if (type === "offer") {
        await handleOffer(
          sender,
          sdp
        );

        return;
      }

      if (type === "answer") {
        await handleAnswer(
          sender,
          sdp
        );

        return;
      }

      if (type === "candidate") {
        await handleCandidate(
          sender,
          candidate
        );
      }
    }

    function onUserLeft({
      id,
    }) {
      console.warn(
        `[voice-debug] SERVER user-left gönderdi: ${id}`
      );

      removePeer(id);

      setUsers((current) =>
        current.filter(
          (user) =>
            user.id !== id
        )
      );
    }

    function onVoiceUsers(
      userList
    ) {
      console.log(
        "[voice-debug] VOICE USERS:",
        userList
      );

      if (
        !joinedRoomRef.current
      ) {
        return;
      }

      setUsers(userList);
    }

    socket.on(
      "voice:existing-users",
      onExistingUsers
    );

    socket.on(
      "voice:signal",
      onVoiceSignal
    );

    socket.on(
      "voice:user-left",
      onUserLeft
    );

    socket.on(
      "voice:users",
      onVoiceUsers
    );

    return () => {
      socket.off(
        "voice:existing-users",
        onExistingUsers
      );

      socket.off(
        "voice:signal",
        onVoiceSignal
      );

      socket.off(
        "voice:user-left",
        onUserLeft
      );

      socket.off(
        "voice:users",
        onVoiceUsers
      );
    };
  }, []);

  // =========================================================
  // CİHAZ DEĞİŞİKLİĞİ
  // =========================================================

  useEffect(() => {
    function onDeviceChange() {
      if (localStreamRef.current) {
        refreshMicList(
          localStreamRef.current
        );
      } else {
        refreshMicList();
      }
    }

    navigator.mediaDevices?.addEventListener?.(
      "devicechange",
      onDeviceChange
    );

    return () => {
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        onDeviceChange
      );
    };
  }, []);

  // =========================================================
  // ROOM DEĞİŞİKLİĞİ
  // =========================================================

  useEffect(() => {
    mountedRef.current = true;

    joinRoom();

    return () => {
      console.log(
        "[voice-debug] VoiceChannel cleanup çalıştı."
      );

      mountedRef.current = false;

      leaveRoom();
    };
  }, [roomName]);

  // =========================================================
  // MUTE
  // =========================================================

  function toggleMute() {
    if (!localStreamRef.current) {
      return;
    }

    const track =
      localStreamRef.current
        .getAudioTracks()[0];

    if (!track) {
      return;
    }

    track.enabled =
      !track.enabled;

    setIsMuted(
      !track.enabled
    );

    console.log(
      "[voice-debug] MUTE:",
      !track.enabled
    );
  }

  // =========================================================
  // YÜKLENİYOR
  // =========================================================

  if (isJoining) {
    return (
      <div
        style={{
          height: "100%",
          minHeight: "300px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            textAlign: "center",
            color: "#b5bac1",
          }}
        >
          <div
            style={{
              fontSize: "32px",
              marginBottom: "12px",
            }}
          >
            🎙️
          </div>

          <div
            style={{
              fontSize: "16px",
              fontWeight: "600",
              color: "#f2f3f5",
            }}
          >
            Ses odasına bağlanılıyor
          </div>

          <div
            style={{
              fontSize: "13px",
              marginTop: "6px",
            }}
          >
            Mikrofon hazırlanıyor...
          </div>
        </div>
      </div>
    );
  }

  // =========================================================
  // ODAYA GİRMEDİ
  // =========================================================

  if (!isInRoom) {
    return (
      <div
        style={{
          height: "100%",
          minHeight: "300px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "360px",
            backgroundColor: "#2b2d31",
            borderRadius: "12px",
            padding: "28px",
            textAlign: "center",
            boxShadow:
              "0 8px 30px rgba(0,0,0,0.25)",
          }}
        >
          <div
            style={{
              fontSize: "42px",
              marginBottom: "12px",
            }}
          >
            🔊
          </div>

          <h2
            style={{
              margin: "0 0 8px",
              color: "#f2f3f5",
            }}
          >
            {roomName}
          </h2>

          <p
            style={{
              color: "#b5bac1",
              fontSize: "14px",
              marginBottom: "20px",
            }}
          >
            Ses odasına katılmak için
            aşağıdaki butona bas.
          </p>

          <button
            onClick={joinRoom}
            style={{
              width: "100%",
              padding: "11px",
              border: "none",
              borderRadius: "6px",
              backgroundColor: "#23a559",
              color: "#fff",
              fontWeight: "bold",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            🎙️ Tekrar Katıl
          </button>
        </div>
      </div>
    );
  }

  // =========================================================
  // ODA
  // =========================================================

  return (
    <div
      style={{
        padding: "20px",
        backgroundColor: "#2b2d31",
        borderRadius: "10px",
        maxWidth: "600px",
      }}
    >
      <h2
        style={{
          marginTop: 0,
        }}
      >
        🔊 {roomName}
      </h2>

      <p
        style={{
          color: "#23a559",
          fontWeight: "bold",
        }}
      >
        🟢 Ses odasındasın
      </p>

      <div
        style={{
          marginBottom: "20px",
        }}
      >
        <label
          style={{
            display: "block",
            fontSize: "12px",
            fontWeight: "bold",
            color: "#949ba4",
            textTransform: "uppercase",
            marginBottom: "6px",
          }}
        >
          🎤 Mikrofon
        </label>

        <select
          value={selectedMicId || ""}
          onChange={(e) =>
            handleMicChange(
              e.target.value
            )
          }
          style={{
            width: "100%",
            padding: "9px 10px",
            borderRadius: "6px",
            border:
              "1px solid #1e1f22",
            backgroundColor:
              "#1e1f22",
            color: "#f2f3f5",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          {availableMics.length ===
            0 && (
            <option value="">
              Mikrofon bulunamadı
            </option>
          )}

          {availableMics.map(
            (mic, index) => (
              <option
                key={
                  mic.deviceId ||
                  index
                }
                value={
                  mic.deviceId
                }
              >
                {mic.label ||
                  `Mikrofon ${
                    index + 1
                  }`}
              </option>
            )
          )}
        </select>
      </div>

      <div
        style={{
          marginBottom: "20px",
        }}
      >
        <strong>
          Odadaki kullanıcılar:
        </strong>

        {users.length === 0 ? (
          <p
            style={{
              color: "#949ba4",
            }}
          >
            Bağlantı bekleniyor...
          </p>
        ) : (
          users.map((user) => (
            <div
              key={user.id}
              style={{
                marginTop: "7px",
              }}
            >
              🟢 {user.username}

              {user.id ===
              socket.id
                ? " (Sen)"
                : ""}
            </div>
          ))
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: "10px",
        }}
      >
        <button
          onClick={toggleMute}
        >
          {isMuted
            ? "🎙️ Mikrofonu Aç"
            : "🔇 Mikrofonu Kapat"}
        </button>

        <button
          onClick={leaveRoom}
        >
          🚪 Odadan Ayr
        </button>
      </div>
    </div>
  );
}

export default VoiceChannel;