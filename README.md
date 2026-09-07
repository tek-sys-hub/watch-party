# 🎬 WatchParty

Watch movies with friends in real-time. Share your screen, talk over mic, and chat together. No accounts needed, just create a room and share the code.

## ✨ Features

- **🖥️ Screen Sharing** — Share your screen with system audio so everyone watches together
- **🎤 Voice Chat** — Toggle your mic for real-time peer-to-peer audio
- **💬 Text Chat** — Built-in chat room for sending messages
- **🔗 Room Codes** — Create a room, get a 6-character code, share it with friends
- **👥 Up to 6 Participants** — Lightweight rooms with a participant strip
- **🔒 Peer-to-Peer** — Video and audio stream directly between users via WebRTC
- **📱 Responsive** — Works on desktop and tablet browsers

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML, CSS, JavaScript |
| Backend | Node.js, Express |
| Real-time | Socket.IO |
| Streaming | WebRTC (peer-to-peer) |
| Signaling | Socket.IO (offers, answers, ICE candidates) |

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or higher
- npm (comes with Node.js)

### Run Locally

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/watchparty.git
cd watchparty

# Install dependencies
npm install

# Start the server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Development Mode

```bash
npm run dev
```

Uses [nodemon](https://nodemon.io/) for auto-restart on file changes.

## 📖 How It Works

1. **Create a Room** — Enter your name and click "Create Room" to get a unique 6-character code
2. **Share the Code** — Send the room code to your friends
3. **Join** — Friends enter the code to join your room
4. **Share Screen** — Click the screen share button to broadcast your screen (with system audio)
5. **Chat & Talk** — Use the mic toggle and text chat to communicate

## 🏗️ Project Structure

```
watchparty/
├── server.js              # Express + Socket.IO server
├── package.json
├── public/
│   ├── index.html         # Main HTML page
│   ├── index.css          # Styles (glassmorphism UI)
│   └── app.js             # Client-side logic (WebRTC, Socket.IO, UI)
└── README.md
```

## 🌐 Deployment

Deploy to any platform that supports **Node.js + WebSockets**:

| Platform | Deploy |
|----------|--------|
| [Render](https://render.com) | Connect GitHub repo → New Web Service → auto-deploys |
| [Railway](https://railway.app) | Connect GitHub repo → deploys instantly |
| [Fly.io](https://fly.io) | `fly launch` → `fly deploy` |
| [Glitch](https://glitch.com) | Import from GitHub |

> **Note:** Static hosts like GitHub Pages, Netlify, or Vercel won't work. This app requires a Node.js server for WebSocket connections.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |

## ⚙️ Architecture

```
┌─────────┐    Socket.IO     ┌──────────┐    Socket.IO     ┌─────────┐
│ User A  │ ◄──────────────► │  Server  │ ◄──────────────► │ User B  │
│(Browser)│                  │ (Node.js)│                  │(Browser)│
└────┬────┘                  └──────────┘                  └────┬────┘
     │                                                          │
     │              WebRTC (Peer-to-Peer)                       │
     │◄────────────────────────────────────────────────────────►│
     │         Screen Video + System Audio + Mic Audio          │
```

The **Socket.IO Server** handles room management, chat relay, and WebRTC signaling (offers/answers/ICE candidates). **WebRTC** handles the actual media streams directly between browsers so no media goes through the server.

## 📝 License

MIT
