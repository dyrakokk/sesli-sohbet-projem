import { useState, useEffect } from "react";
import socket from "./socket";
import TextChannel from "./components/TextChannel";
import VoiceChannel from "./components/VoiceChannel";

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [selectedVoiceRoom, setSelectedVoiceRoom] = useState(null);

  const voiceRooms = [
    "FuhrerBunker 1",
    "FuhrerBunker 2",
    "FuhrerBunker 3",
    "FuhrerBunker 4",
  ];

  useEffect(() => {
    function onConnect() {
      console.log("Backend'e baglanildi");
      setIsConnected(true);
    }

    function onDisconnect() {
      console.log("Baglanti koptu");
      setIsConnected(false);
    }

    setIsConnected(socket.connected);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  function selectVoiceRoom(room) {
    if (selectedVoiceRoom === room) {
      return;
    }

    setSelectedVoiceRoom(room);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#1e1f22",
        color: "#f2f3f5",
        display: "flex",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <aside
        style={{
          width: "240px",
          backgroundColor: "#2b2d31",
          padding: "20px 15px",
          boxSizing: "border-box",
        }}
      >
        <h1
          style={{
            fontSize: "22px",
            margin: "0 0 25px 5px",
          }}
        >
          Chat n Chat
        </h1>

        <div style={{ marginBottom: "25px" }}>
          <div
            style={{
              fontSize: "12px",
              fontWeight: "bold",
              color: "#949ba4",
              textTransform: "uppercase",
              marginBottom: "8px",
              paddingLeft: "5px",
            }}
          >
            Genel
          </div>

          <div
            onClick={() => setSelectedVoiceRoom(null)}
            style={{
              backgroundColor:
                selectedVoiceRoom === null
                  ? "#404249"
                  : "transparent",
              padding: "9px 10px",
              borderRadius: "5px",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            #&nbsp; Sohbet
          </div>
        </div>

        <div>
          <div
            style={{
              fontSize: "12px",
              fontWeight: "bold",
              color: "#949ba4",
              textTransform: "uppercase",
              marginBottom: "8px",
              paddingLeft: "5px",
            }}
          >
            Bunkers
          </div>

          {voiceRooms.map((room) => {
            const isSelected =
              selectedVoiceRoom === room;

            return (
              <div
                key={room}
                onClick={() => selectVoiceRoom(room)}
                style={{
                  padding: "8px 10px",
                  color: isSelected
                    ? "#fff"
                    : "#b5bac1",
                  backgroundColor: isSelected
                    ? "#404249"
                    : "transparent",
                  borderRadius: "5px",
                  marginBottom: "3px",
                  cursor: "pointer",
                }}
              >
                🔊 {room}
              </div>
            );
          })}
        </div>
      </aside>

      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <header
          style={{
            height: "55px",
            borderBottom: "1px solid #18191c",
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            boxSizing: "border-box",
          }}
        >
          <span
            style={{
              fontSize: "18px",
              fontWeight: "bold",
            }}
          >
            {selectedVoiceRoom
              ? `🔊 ${selectedVoiceRoom}`
              : "# Sohbet"}
          </span>

          <span
            style={{
              marginLeft: "20px",
              fontSize: "13px",
              color: isConnected
                ? "#23a559"
                : "#ed4245",
            }}
          >
            {isConnected
              ? "Sunucu bağlı"
              : "Sunucu bağlantısı yok"}
          </span>
        </header>

        <div
          style={{
            flex: 1,
            padding: "20px",
            boxSizing: "border-box",
          }}
        >
          {selectedVoiceRoom ? (
            <VoiceChannel
              key={selectedVoiceRoom}
              roomName={selectedVoiceRoom}
            />
          ) : (
            <TextChannel />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;