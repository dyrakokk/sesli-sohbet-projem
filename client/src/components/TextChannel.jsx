import { useState, useEffect, useRef } from "react";
import socket from "../socket";

function TextChannel() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    function onChatHistory(history) {
      const mappedMessages = history.map((msg) => ({
        id: msg.id,
        username: msg.username,
        type: msg.type,
        text:
          msg.type === "text"
            ? msg.content
            : null,
        imageUrl:
          msg.type === "image"
            ? msg.content
            : null,
        timestamp: msg.timestamp,
      }));

      setMessages(mappedMessages);
      setHistoryLoaded(true);
    }

    function onChatMessage(message) {
      setMessages((prev) => [
        ...prev,
        message,
      ]);
    }

    socket.on(
      "chat:history",
      onChatHistory
    );

    socket.on(
      "chat:message",
      onChatMessage
    );

    if (socket.connected) {
      socket.emit(
        "chat:request-history"
      );
    }

    return () => {
      socket.off(
        "chat:history",
        onChatHistory
      );

      socket.off(
        "chat:message",
        onChatMessage
      );
    };
  }, []);

  useEffect(() => {
    if (!historyLoaded) {
      return;
    }

    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, historyLoaded]);

  function handleSend() {
    const trimmed =
      inputValue.trim();

    if (!trimmed) {
      return;
    }

    socket.emit(
      "chat:message",
      {
        text: trimmed,
      }
    );

    setInputValue("");
  }

  function handleKeyDown(event) {
    if (event.key === "Enter") {
      handleSend();
    }
  }

  async function handleImageSelect(event) {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert(
        "Lütfen bir görsel dosyası seçin."
      );

      event.target.value = "";
      return;
    }

    if (
      file.size >
      10 * 1024 * 1024
    ) {
      alert(
        "Görsel en fazla 10 MB olabilir."
      );

      event.target.value = "";
      return;
    }

    try {
      setUploading(true);

      const formData =
        new FormData();

      formData.append(
        "image",
        file
      );

      const response =
        await fetch(
          "http://localhost:3001/upload",
          {
            method: "POST",
            body: formData,
          }
        );

      if (!response.ok) {
        throw new Error(
          "Görsel yüklenemedi."
        );
      }

      const data =
        await response.json();

      if (
        !data.success ||
        !data.url
      ) {
        throw new Error(
          "Sunucudan geçersiz cevap geldi."
        );
      }

      socket.emit(
        "chat:image",
        {
          url: data.url,
        }
      );
    } catch (error) {
      console.error(
        "Görsel yükleme hatası:",
        error
      );

      alert(
        "Görsel yüklenirken bir hata oluştu."
      );
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "500px",
        width: "500px",
        border: "1px solid #ccc",
      }}
    >
      <div
        style={{
          padding: "10px",
          borderBottom:
            "1px solid #ccc",
          fontWeight: "bold",
        }}
      >
        # Genel
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px",
        }}
      >
        {!historyLoaded && (
          <div>
            Mesajlar yükleniyor...
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              marginBottom: "12px",
            }}
          >
            <strong>
              {msg.username}
            </strong>

            {msg.type === "image" ? (
              <div
                style={{
                  marginTop: "5px",
                }}
              >
                <img
                  src={`http://localhost:3001${msg.imageUrl}`}
                  alt="Gönderilen görsel"
                  style={{
                    maxWidth: "300px",
                    maxHeight: "300px",
                    borderRadius: "8px",
                    display: "block",
                  }}
                />
              </div>
            ) : (
              <span>
                : {msg.text}
              </span>
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px",
          borderTop:
            "1px solid #ccc",
          gap: "8px",
        }}
      >
        <button
          onClick={() =>
            fileInputRef.current?.click()
          }
          disabled={uploading}
          title="Görsel gönder"
        >
          {uploading
            ? "Yükleniyor..."
            : "🖼️"}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={
            handleImageSelect
          }
          style={{
            display: "none",
          }}
        />

        <input
          type="text"
          value={inputValue}
          onChange={(event) =>
            setInputValue(
              event.target.value
            )
          }
          onKeyDown={
            handleKeyDown
          }
          placeholder="Mesaj yaz..."
          style={{
            flex: 1,
            padding: "8px",
          }}
        />

        <button
          onClick={handleSend}
        >
          Gönder
        </button>
      </div>
    </div>
  );
}

export default TextChannel;