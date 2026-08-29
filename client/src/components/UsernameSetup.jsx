import { useState } from "react";

function UsernameSetup({ onComplete }) {
  const [username, setUsername] = useState("");

  function handleSubmit(event) {
    event.preventDefault();

    const trimmedUsername = username.trim();

    if (trimmedUsername === "") {
      return;
    }

    localStorage.setItem("chat_username", trimmedUsername);
    onComplete(trimmedUsername);
  }

  return (
    <div>
      <h2>Chat n Chat</h2>

      <p>Devam etmek için bir kullanıcı adı seç.</p>

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Kullanıcı adın"
          maxLength={20}
          autoFocus
        />

        <button type="submit">
          Devam
        </button>
      </form>
    </div>
  );
}

export default UsernameSetup;