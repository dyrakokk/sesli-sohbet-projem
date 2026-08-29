import { io } from "socket.io-client";

const username = localStorage.getItem("chat_username") || "Misafir";

const socket = io("http://localhost:3001", {
  auth: {
    username,
  },
});

export default socket;