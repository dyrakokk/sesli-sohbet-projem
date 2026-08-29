import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import {
  insertMessage,
  getMessages,
} from "./db.js";

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());

// ====================================
// GÖRSEL YÜKLEME
// ====================================

const uploadsDir =
  path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, {
    recursive: true,
  });
}

app.use(
  "/uploads",
  express.static(uploadsDir)
);

const storage =
  multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },

    filename: (req, file, cb) => {
      const extension =
        path
          .extname(file.originalname)
          .toLowerCase();

      const uniqueName =
        `${Date.now()}-${Math.round(
          Math.random() * 1e9
        )}${extension}`;

      cb(null, uniqueName);
    },
  });

const upload = multer({
  storage,

  limits: {
    fileSize:
      10 * 1024 * 1024,
  },

  fileFilter: (
    req,
    file,
    cb
  ) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ];

    if (
      allowedTypes.includes(
        file.mimetype
      )
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Sadece görsel dosyaları yüklenebilir."
        )
      );
    }
  },
});

app.post(
  "/upload",
  upload.single("image"),
  (req, res) => {
    if (!req.file) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Görsel bulunamadı.",
        });
    }

    const imageUrl =
      `/uploads/${req.file.filename}`;

    res.json({
      success: true,
      url: imageUrl,
    });
  }
);

// ====================================
// HTTP
// ====================================

const httpServer =
  createServer(app);

// ====================================
// SOCKET.IO
// ====================================

const io = new Server(
  httpServer,
  {
    cors: {
      origin:
        "http://localhost:5173",
      methods: [
        "GET",
        "POST",
      ],
    },
  }
);

app.get("/", (req, res) => {
  res.send(
    "Chat n Chat backend calisiyor"
  );
});

// ====================================
// SES ODALARI
// ====================================

const voiceRooms = {
  "FuhrerBunker 1": new Map(),
  "FuhrerBunker 2": new Map(),
  "FuhrerBunker 3": new Map(),
  "FuhrerBunker 4": new Map(),
};

// ====================================
// SOCKET CONNECTION
// ====================================

io.on(
  "connection",
  (socket) => {
    console.log(
      `[socket.io] Yeni baglanti: ${socket.id}`
    );

    // ==================================
    // CHAT
    // ==================================

    function sendHistory() {
      const history =
        getMessages(100);

      socket.emit(
        "chat:history",
        history
      );
    }

    sendHistory();

    socket.on(
      "chat:request-history",
      () => {
        sendHistory();
      }
    );

    socket.on(
      "ping",
      () => {
        socket.emit("pong");
      }
    );

    socket.on(
      "chat:message",
      (data) => {
        const username =
          data.username ||
          "Misafir";

        const text =
          typeof data.text ===
          "string"
            ? data.text.trim()
            : "";

        if (!text) {
          return;
        }

        const timestamp =
          Date.now();

        const insertedId =
          insertMessage({
            username,
            type: "text",
            content: text,
            timestamp,
          });

        const message = {
          id: insertedId,
          username,
          type: "text",
          text,
          timestamp,
        };

        console.log(
          `[chat] ${username}: ${text}`
        );

        io.emit(
          "chat:message",
          message
        );
      }
    );

    socket.on(
      "chat:image",
      (data) => {
        const username =
          data.username ||
          "Misafir";

        const imageUrl =
          typeof data.url ===
          "string"
            ? data.url
            : "";

        if (!imageUrl) {
          return;
        }

        const timestamp =
          Date.now();

        const insertedId =
          insertMessage({
            username,
            type: "image",
            content: imageUrl,
            timestamp,
          });

        const message = {
          id: insertedId,
          username,
          type: "image",
          imageUrl,
          timestamp,
        };

        console.log(
          `[chat] ${username}: ${imageUrl}`
        );

        io.emit(
          "chat:message",
          message
        );
      }
    );

    // ==================================
    // SES ODASINA GİR
    // ==================================

    socket.on(
      "voice:join",
      ({
        room,
        username,
      }) => {
        if (!voiceRooms[room]) {
          console.log(
            `[voice] Geçersiz oda: ${room}`
          );

          return;
        }

        // Önce kullanıcının
        // bulunduğu tüm odaları temizle
        for (
          const roomName of Object.keys(
            voiceRooms
          )
        ) {
          if (
            voiceRooms[
              roomName
            ].has(socket.id)
          ) {
            voiceRooms[
              roomName
            ].delete(socket.id);

            socket.leave(roomName);

            io.to(roomName).emit(
              "voice:user-left",
              {
                id: socket.id,
              }
            );

            io.to(roomName).emit(
              "voice:users",
              Array.from(
                voiceRooms[
                  roomName
                ].values()
              )
            );
          }
        }

        // Odaya girmeden önce
        // mevcut kullanıcıları al
        const existingUsers =
          Array.from(
            voiceRooms[
              room
            ].values()
          );

        socket.join(room);

        voiceRooms[
          room
        ].set(
          socket.id,
          {
            id: socket.id,
            username:
              username ||
              "Misafir",
          }
        );

        console.log(
          `[voice] ${
            username ||
            "Misafir"
          } -> ${room}`
        );

        // Sadece yeni kullanıcıya
        // mevcut kullanıcıları gönder
        socket.emit(
          "voice:existing-users",
          existingUsers
        );

        // Odanın güncel listesini gönder
        io.to(room).emit(
          "voice:users",
          Array.from(
            voiceRooms[
              room
            ].values()
          )
        );
      }
    );

    // ==================================
    // WEBRTC SIGNAL
    // ==================================

    socket.on(
      "voice:signal",
      ({
        target,
        type,
        sdp,
        candidate,
      }) => {
        if (!target || !type) {
          return;
        }

        const targetSocket =
          io.sockets.sockets.get(
            target
          );

        if (!targetSocket) {
          return;
        }

        targetSocket.emit(
          "voice:signal",
          {
            sender: socket.id,
            type,
            sdp,
            candidate,
          }
        );
      }
    );

    // ==================================
    // SES ODASINDAN ÇIK
    // ==================================

    socket.on(
      "voice:leave",
      ({ room }) => {
        if (!voiceRooms[room]) {
          return;
        }

        if (
          !voiceRooms[
            room
          ].has(socket.id)
        ) {
          return;
        }

        voiceRooms[
          room
        ].delete(socket.id);

        socket.leave(room);

        io.to(room).emit(
          "voice:user-left",
          {
            id: socket.id,
          }
        );

        io.to(room).emit(
          "voice:users",
          Array.from(
            voiceRooms[
              room
            ].values()
          )
        );

        console.log(
          `[voice] ${socket.id} -> ${room} ayrildi`
        );
      }
    );

    // ==================================
    // DISCONNECT
    // ==================================

    socket.on(
      "disconnect",
      () => {
        for (
          const roomName of Object.keys(
            voiceRooms
          )
        ) {
          if (
            voiceRooms[
              roomName
            ].has(socket.id)
          ) {
            voiceRooms[
              roomName
            ].delete(socket.id);

            io.to(
              roomName
            ).emit(
              "voice:user-left",
              {
                id: socket.id,
              }
            );

            io.to(
              roomName
            ).emit(
              "voice:users",
              Array.from(
                voiceRooms[
                  roomName
                ].values()
              )
            );

            console.log(
              `[voice] ${socket.id} -> ${roomName} otomatik ayrildi`
            );
          }
        }

        console.log(
          `[socket.io] Baglanti koptu: ${socket.id}`
        );
      }
    );
  }
);

// ====================================
// SERVER
// ====================================

const PORT = 3001;

httpServer.listen(
  PORT,
  () => {
    console.log(
      `Sunucu ${PORT} portunda calisiyor`
    );
  }
);