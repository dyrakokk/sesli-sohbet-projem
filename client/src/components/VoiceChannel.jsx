import { useEffect, useRef, useState } from "react";
import socket from "../socket";

function VoiceChannel({ roomName }) {
  const [isInRoom, setIsInRoom] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [users, setUsers] = useState([]);
  const [isJoining, setIsJoining] = useState(false);

  const localStreamRef = useRef(null);
  const peersRef = useRef({});
  const audioElementsRef = useRef({});
  const joinedRoomRef = useRef(null);

  // Erken gelen ICE candidate'ları bekletiyoruz
  const pendingCandidatesRef = useRef({});

  // Component gerçekten aktif mi?
  const mountedRef = useRef(true);

  // ------------------------------------
  // JBL CİHAZINI BUL
  // ------------------------------------

  async function findJblDevices() {
    try {
      const devices =
        await navigator.mediaDevices.enumerateDevices();

      const jblInput = devices.find((device) => {
        const label = device.label.toLowerCase();

        return (
          device.kind === "audioinput" &&
          (
            label.includes("jbl") ||
            label.includes("t520") ||
            label.includes("hands-free")
          )
        );
      });

      const jblOutput = devices.find((device) => {
        const label = device.label.toLowerCase();

        return (
          device.kind === "audiooutput" &&
          (
            label.includes("jbl") ||
            label.includes("t520") ||
            label.includes("hands-free")
          )
        );
      });

      console.log(
        "[voice] JBL mikrofon:",
        jblInput
          ? jblInput.label
          : "Bulunamadı"
      );

      console.log(
        "[voice] JBL ses çıkışı:",
        jblOutput
          ? jblOutput.label
          : "Bulunamadı"
      );

      return {
        input: jblInput,
        output: jblOutput,
      };
    } catch (error) {
      console.error(
        "[voice] Cihazlar bulunamadı:",
        error
      );

      return {
        input: null,
        output: null,
      };
    }
  }

  // ------------------------------------
  // UZAK SESİ OYNAT
  // ------------------------------------

  async function playRemoteAudio(
    userId,
    stream
  ) {
    let audio =
      audioElementsRef.current[userId];

    if (!audio) {
      audio =
        document.createElement("audio");

      audio.autoplay = true;
      audio.playsInline = true;
      audio.controls = false;
      audio.volume = 1;

      audioElementsRef.current[userId] =
        audio;

      document.body.appendChild(audio);
    }

    audio.srcObject = stream;

    // JBL çıkışını bul ve mümkünse ona yönlendir
    try {
      if (
        typeof audio.setSinkId ===
        "function"
      ) {
        const devices =
          await navigator.mediaDevices.enumerateDevices();

        const jblOutput =
          devices.find((device) => {
            const label =
              device.label.toLowerCase();

            return (
              device.kind ===
                "audiooutput" &&
              (
                label.includes("jbl") ||
                label.includes("t520") ||
                label.includes(
                  "hands-free"
                )
              )
            );
          });

        if (jblOutput) {
          await audio.setSinkId(
            jblOutput.deviceId
          );

          console.log(
            `[voice] Ses JBL çıkışına yönlendirildi: ${jblOutput.label}`
          );
        }
      }
    } catch (error) {
      console.warn(
        "[voice] JBL ses çıkışı seçilemedi:",
        error
      );
    }

    try {
      await audio.play();

      console.log(
        `[voice] ${userId} sesi oynatılıyor`
      );
    } catch (error) {
      console.warn(
        `[voice] ${userId} sesi otomatik başlatılamadı:`,
        error
      );
    }
  }

  // ------------------------------------
  // PEER TEMİZLE
  // ------------------------------------

  function removePeer(userId) {
    const peer =
      peersRef.current[userId];

    if (peer) {
      try {
        peer.ontrack = null;
        peer.onicecandidate = null;
        peer.onconnectionstatechange =
          null;

        peer.close();
      } catch {}

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

    delete pendingCandidatesRef.current[
      userId
    ];
  }

  // ------------------------------------
  // TÜM PEER'LARI TEMİZLE
  // ------------------------------------

  function removeAllPeers() {
    Object.keys(
      peersRef.current
    ).forEach((userId) => {
      removePeer(userId);
    });

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

      delete audioElementsRef.current[
        userId
      ];
    });

    pendingCandidatesRef.current = {};
  }

  // ------------------------------------
  // PEER OLUŞTUR
  // ------------------------------------

  function createPeer(
    userId,
    initiator
  ) {
    if (!localStreamRef.current) {
      return null;
    }

    if (peersRef.current[userId]) {
      return peersRef.current[userId];
    }

    console.log(
      `[voice] Peer oluşturuluyor: ${userId}, initiator=${initiator}`
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

    // --------------------------------
    // MİKROFON TRACK
    // --------------------------------

    const tracks =
      localStreamRef.current.getTracks();

    tracks.forEach((track) => {
      peer.addTrack(
        track,
        localStreamRef.current
      );
    });

    // --------------------------------
    // UZAK SES
    // --------------------------------

    peer.ontrack = (event) => {
      console.log(
        `[voice] ${userId} tarafından ses track'i geldi`
      );

      let remoteStream =
        event.streams?.[0];

      // Bazı tarayıcılarda event.streams boş olabilir
      if (!remoteStream) {
        remoteStream =
          new MediaStream();

        if (event.track) {
          remoteStream.addTrack(
            event.track
          );
        }
      }

      if (!remoteStream) {
        console.warn(
          "[voice] Remote stream bulunamadı"
        );

        return;
      }

      playRemoteAudio(
        userId,
        remoteStream
      );
    };

    // --------------------------------
    // ICE
    // --------------------------------

    peer.onicecandidate = (event) => {
      if (
        !event.candidate ||
        !joinedRoomRef.current
      ) {
        return;
      }

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

    // --------------------------------
    // CONNECTION STATE
    // --------------------------------

    peer.onconnectionstatechange =
      () => {
        console.log(
          `[voice] ${userId} bağlantı durumu: ${peer.connectionState}`
        );

        if (
          peer.connectionState ===
            "failed" ||
          peer.connectionState ===
            "closed"
        ) {
          removePeer(userId);
        }
      };

    // --------------------------------
    // OFFER
    // --------------------------------

    if (initiator) {
      createOffer(
        userId,
        peer
      );
    }

    return peer;
  }

  // ------------------------------------
  // OFFER OLUŞTUR
  // ------------------------------------

  async function createOffer(
    userId,
    peer
  ) {
    try {
      const offer =
        await peer.createOffer({
          offerToReceiveAudio: true,
        });

      // Peer kapanmışsa devam etme
      if (
        peer.signalingState ===
        "closed"
      ) {
        return;
      }

      await peer.setLocalDescription(
        offer
      );

      if (
        !joinedRoomRef.current
      ) {
        return;
      }

      socket.emit(
        "voice:signal",
        {
          target: userId,
          type: "offer",
          sdp: peer.localDescription,
        }
      );

      console.log(
        `[voice] Offer gönderildi: ${userId}`
      );
    } catch (error) {
      console.error(
        `[voice] Offer hatası (${userId}):`,
        error
      );
    }
  }

  // ------------------------------------
  // OFFER AL
  // ------------------------------------

  async function handleOffer(
    sender,
    sdp
  ) {
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
      // Yanlış state'te answer üretme
      if (
        peer.signalingState !==
        "stable"
      ) {
        console.warn(
          `[voice] Offer atlandı (${sender}), state=${peer.signalingState}`
        );

        return;
      }

      await peer.setRemoteDescription(
        new RTCSessionDescription(sdp)
      );

      // Bekleyen ICE'ları uygula
      await flushPendingCandidates(
        sender,
        peer
      );

      const answer =
        await peer.createAnswer();

      await peer.setLocalDescription(
        answer
      );

      if (
        !joinedRoomRef.current
      ) {
        return;
      }

      socket.emit(
        "voice:signal",
        {
          target: sender,
          type: "answer",
          sdp: peer.localDescription,
        }
      );

      console.log(
        `[voice] Answer gönderildi: ${sender}`
      );
    } catch (error) {
      console.error(
        `[voice] Answer hatası (${sender}):`,
        error
      );
    }
  }

  // ------------------------------------
  // ANSWER AL
  // ------------------------------------

  async function handleAnswer(
    sender,
    sdp
  ) {
    const peer =
      peersRef.current[sender];

    if (!peer) {
      return;
    }

    try {
      if (
        peer.signalingState !==
        "have-local-offer"
      ) {
        console.warn(
          `[voice] Answer atlandı (${sender}), state=${peer.signalingState}`
        );

        return;
      }

      await peer.setRemoteDescription(
        new RTCSessionDescription(sdp)
      );

      await flushPendingCandidates(
        sender,
        peer
      );

      console.log(
        `[voice] Answer işlendi: ${sender}`
      );
    } catch (error) {
      console.error(
        `[voice] Answer işleme hatası (${sender}):`,
        error
      );
    }
  }

  // ------------------------------------
  // ICE CANDIDATE
  // ------------------------------------

  async function handleCandidate(
    sender,
    candidate
  ) {
    if (!candidate) {
      return;
    }

    const peer =
      peersRef.current[sender];

    if (!peer) {
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
        `[voice] ICE beklemeye alındı: ${sender}`
      );

      return;
    }

    if (
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
        `[voice] ICE remote description bekliyor: ${sender}`
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
        `[voice] ICE işlendi: ${sender}`
      );
    } catch (error) {
      console.error(
        `[voice] ICE candidate hatası (${sender}):`,
        error
      );
    }
  }

  // ------------------------------------
  // BEKLEYEN ICE'LARI UYGULA
  // ------------------------------------

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
      `[voice] ${candidates.length} bekleyen ICE uygulanıyor: ${userId}`
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
          `[voice] Bekleyen ICE uygulanamadı (${userId}):`,
          error
        );
      }
    }

    delete pendingCandidatesRef.current[
      userId
    ];
  }

  // ------------------------------------
  // ODAYA GİR
  // ------------------------------------

  async function joinRoom() {
    if (
      joinedRoomRef.current ||
      isJoining
    ) {
      return;
    }

    setIsJoining(true);

    console.log(
      `[voice] Mikrofon hazırlanıyor: ${roomName}`
    );

    try {
      // Önce mevcut cihazları kontrol et
      let devices =
        await findJblDevices();

      let audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      };

      // JBL mikrofon zaten görünüyorsa doğrudan onu seç
      if (devices.input) {
        audioConstraints.deviceId = {
          exact:
            devices.input.deviceId,
        };

        console.log(
          `[voice] JBL mikrofon kullanılacak: ${devices.input.label}`
        );
      } else {
        console.log(
          "[voice] JBL mikrofon henüz bulunamadı, varsayılan mikrofon istenecek."
        );
      }

      let stream =
        await navigator.mediaDevices.getUserMedia(
          {
            audio: audioConstraints,
          }
        );

      // İzin alındıktan sonra cihazları tekrar tara
      devices =
        await findJblDevices();

      // İlk aşamada JBL bulunmadıysa,
      // izin sonrası bulunan JBL mikrofonuna geç
      if (
        devices.input &&
        !audioConstraints.deviceId
      ) {
        const currentTrack =
          stream.getAudioTracks()[0];

        const currentSettings =
          currentTrack?.getSettings?.();

        if (
          currentSettings?.deviceId !==
          devices.input.deviceId
        ) {
          console.log(
            `[voice] JBL mikrofonuna geçiliyor: ${devices.input.label}`
          );

          stream
            .getTracks()
            .forEach((track) =>
              track.stop()
            );

          stream =
            await navigator.mediaDevices.getUserMedia(
              {
                audio: {
                  deviceId: {
                    exact:
                      devices.input.deviceId,
                  },
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                  channelCount: 1,
                },
              }
            );
        }
      }

      if (
        !mountedRef.current
      ) {
        stream
          .getTracks()
          .forEach((track) =>
            track.stop()
          );

        return;
      }

      localStreamRef.current =
        stream;

      const selectedTrack =
        stream.getAudioTracks()[0];

      if (selectedTrack) {
        console.log(
          "[voice] Kullanılan mikrofon:",
          selectedTrack.label
        );

        console.log(
          "[voice] Mikrofon ayarları:",
          selectedTrack.getSettings()
        );
      }

      joinedRoomRef.current =
        roomName;

      socket.emit(
        "voice:join",
        {
          room: roomName,
          username: "Misafir",
        }
      );

      if (
        mountedRef.current
      ) {
        setIsInRoom(true);
        setIsJoining(false);
      }

      console.log(
        `[voice] ${roomName} odasına girildi`
      );
    } catch (error) {
      console.error(
        "[voice] Mikrofon hatası:",
        error
      );

      if (
        localStreamRef.current
      ) {
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

      if (
        mountedRef.current
      ) {
        setIsInRoom(false);
        setIsJoining(false);
      }

      if (
        error.name ===
        "NotAllowedError"
      ) {
        alert(
          "Mikrofon izni verilmedi. Tarayıcıdan mikrofon iznini aç."
        );
      } else if (
        error.name ===
        "NotFoundError"
      ) {
        alert(
          "Mikrofon bulunamadı. JBL T520BT'nin bağlı olduğundan emin ol."
        );
      } else {
        alert(
          "Mikrofon bağlantısı kurulamadı."
        );
      }
    }
  }

  // ------------------------------------
  // ODADAN ÇIK
  // ------------------------------------

  function leaveRoom() {
    const room =
      joinedRoomRef.current;

    if (!room) {
      setIsInRoom(false);
      setIsJoining(false);
      return;
    }

    console.log(
      `[voice] ${room} odasından çıkılıyor`
    );

    // Önce backend'e bildir
    socket.emit(
      "voice:leave",
      {
        room,
      }
    );

    // Peer'ları kapat
    removeAllPeers();

    // Mikrofonu kapat
    if (
      localStreamRef.current
    ) {
      localStreamRef.current
        .getTracks()
        .forEach((track) => {
          track.stop();
        });

      localStreamRef.current =
        null;
    }

    joinedRoomRef.current =
      null;

    setIsInRoom(false);
    setIsJoining(false);
    setIsMuted(false);
    setUsers([]);

    console.log(
      `[voice] ${room} odasından çıkıldı`
    );
  }

  // ------------------------------------
  // SOCKET EVENTLERİ
  // ------------------------------------

  useEffect(() => {
    function onExistingUsers(
      existingUsers
    ) {
      if (
        !joinedRoomRef.current ||
        !localStreamRef.current
      ) {
        return;
      }

      console.log(
        "[voice] Mevcut kullanıcılar:",
        existingUsers
      );

      existingUsers.forEach(
        (user) => {
          if (
            user.id === socket.id
          ) {
            return;
          }

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

      console.log(
        `[voice] Signal alındı: ${type} <- ${sender}`
      );

      if (
        type === "offer"
      ) {
        await handleOffer(
          sender,
          sdp
        );

        return;
      }

      if (
        type === "answer"
      ) {
        await handleAnswer(
          sender,
          sdp
        );

        return;
      }

      if (
        type === "candidate"
      ) {
        await handleCandidate(
          sender,
          candidate
        );
      }
    }

    function onUserLeft({
      id,
    }) {
      console.log(
        `[voice] Kullanıcı ayrıldı: ${id}`
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
      if (
        !joinedRoomRef.current
      ) {
        return;
      }

      console.log(
        "[voice] Odadaki kullanıcılar:",
        userList
      );

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

  // ------------------------------------
  // ROOM DEĞİŞİNCE
  // ------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    joinRoom();

    return () => {
      mountedRef.current = false;

      leaveRoom();
    };
  }, [roomName]);

  // ------------------------------------
  // MİKROFON AÇ / KAPAT
  // ------------------------------------

  function toggleMute() {
    if (
      !localStreamRef.current
    ) {
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
      `[voice] Mikrofon ${
        track.enabled
          ? "açıldı"
          : "kapatıldı"
      }`
    );
  }

  // ------------------------------------
  // RENDER
  // ------------------------------------

  // ODAYA GİRİŞ YAPILIYOR
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

  // ODAYA GİRMEMİŞSE
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

  // ------------------------------------
  // ODAYA GİRMİŞSE
  // ------------------------------------

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

              {user.id === socket.id
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
          🚪 Odadan Ayrıl
        </button>
      </div>
    </div>
  );
}

export default VoiceChannel;