/* ─────────────────────────────────────────────
   WatchParty – Client App (Redesigned)
   WebRTC Screen Share + Mic + Socket.IO Chat
   ───────────────────────────────────────────── */

const socket = io();

// ── State ──
let myUsername = '';
let myRoomCode = '';
let localStream = null;        // mic stream
let screenStream = null;       // screen share stream
let isMicOn = false;
let isScreenSharing = false;
let isChatVisible = true;
let peers = {};                // { peerId: RTCPeerConnection }
let participants = [];
let hostId = null;

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// ── DOM Elements ──
const landing = document.getElementById('landing');
const modalOverlay = document.getElementById('modalOverlay');
const appEl = document.getElementById('app');
const inputUsername = document.getElementById('inputUsername');
const inputRoomCode = document.getElementById('inputRoomCode');
const errorChoose = document.getElementById('errorChoose');
const errorJoin = document.getElementById('errorJoin');
const createdRoomCodeEl = document.getElementById('createdRoomCode');
const createdUsernameEl = document.getElementById('createdUsername');
const joinUsernameEl = document.getElementById('joinUsername');
const displayRoomCode = document.getElementById('displayRoomCode');
const videoEl = document.getElementById('sharedVideo');
const videoPlaceholder = document.getElementById('videoPlaceholder');
const screenShareLabel = document.getElementById('screenShareLabel');
const sharerName = document.getElementById('sharerName');
const participantsList = document.getElementById('participantsList');
const participantCount = document.getElementById('participantCount');
const participantCountTop = document.getElementById('participantCountTop');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatPanel = document.getElementById('chatPanel');
const sidebar = document.getElementById('sidebar');
const btnMic = document.getElementById('btnMic');
const btnScreen = document.getElementById('btnScreen');
const btnChatToggle = document.getElementById('btnChatToggle');

// ══════════════════════════════════
// MODAL NAVIGATION
// ══════════════════════════════════

function showStep(stepId) {
  document.querySelectorAll('.modal-step').forEach(s => s.classList.remove('active'));
  document.getElementById(stepId).classList.add('active');
}

function showChooseStep() {
  showStep('stepChoose');
}

function showJoinStep() {
  const name = inputUsername.value.trim();
  if (!name) {
    showError('errorChoose', 'Please enter your name first!');
    inputUsername.focus();
    return;
  }
  // Sync username to join modal
  joinUsernameEl.value = name;
  showStep('stepJoin');
  setTimeout(() => inputRoomCode.focus(), 100);
}

function closeModal() {
  // Only close if we're in the room
  if (myRoomCode && appEl.classList.contains('active')) {
    modalOverlay.classList.add('hidden');
  }
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 4000);
}

// ══════════════════════════════════
// ROOM ACTIONS
// ══════════════════════════════════

function createRoom() {
  const name = inputUsername.value.trim();
  if (!name) {
    showError('errorChoose', 'Please enter your name first!');
    inputUsername.focus();
    return;
  }
  myUsername = name;

  socket.emit('create-room', { username: myUsername }, (res) => {
    if (res.success) {
      myRoomCode = res.roomCode;
      hostId = socket.id;
      createdRoomCodeEl.textContent = myRoomCode;
      createdUsernameEl.value = myUsername;
      showStep('stepCreated');
    } else {
      showError('errorChoose', res.error || 'Failed to create room.');
    }
  });
}

function joinRoom() {
  const code = inputRoomCode.value.trim().toUpperCase();
  if (!code || code.length < 4) {
    showError('errorJoin', 'Please enter a valid room code.');
    return;
  }
  myUsername = inputUsername.value.trim();
  myRoomCode = code;

  socket.emit('join-room', { roomCode: myRoomCode, username: myUsername }, (res) => {
    if (res.success) {
      enterRoom();
    } else {
      showError('errorJoin', res.error || 'Could not join room.');
    }
  });
}

function enterRoom() {
  landing.style.display = 'none';
  modalOverlay.classList.add('hidden');
  appEl.classList.add('active');
  displayRoomCode.textContent = myRoomCode;
  showToast(`Joined room ${myRoomCode}`);
}

function copyRoomCode() {
  navigator.clipboard.writeText(myRoomCode).then(() => {
    showToast('Room code copied!');
  });
}

function leaveRoom() {
  // Cleanup streams
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  // Close all peer connections
  Object.values(peers).forEach(pc => pc.close());
  peers = {};

  // Reload to reset everything
  window.location.reload();
}

// ══════════════════════════════════
// CHAT TOGGLE
// ══════════════════════════════════

function toggleChat() {
  isChatVisible = !isChatVisible;
  if (isChatVisible) {
    chatPanel.style.display = 'flex';
    btnChatToggle.classList.add('active');
  } else {
    chatPanel.style.display = 'none';
    btnChatToggle.classList.remove('active');
  }
}

// ══════════════════════════════════
// PARTICIPANTS
// ══════════════════════════════════

const AVATAR_COLORS = ['avatar-0','avatar-1','avatar-2','avatar-3','avatar-4','avatar-5'];

socket.on('participants-updated', (list) => {
  participants = list;
  // First participant is always the host
  if (list.length > 0 && !hostId) {
    hostId = list[0].id;
  }
  renderParticipants();
});

function renderParticipants() {
  participantsList.innerHTML = '';
  participantCount.textContent = participants.length;
  participantCountTop.textContent = `${participants.length} people`;

  participants.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'participant-row';

    const isMe = p.id === socket.id;
    const isHost = p.id === hostId;

    row.innerHTML = `
      <div class="participant-avatar ${AVATAR_COLORS[i % AVATAR_COLORS.length]}">${escapeHtml(p.username.charAt(0))}</div>
      <div class="participant-name">
        ${escapeHtml(p.username)}${isHost ? ' <span class="host-badge">👑</span>' : ''}${isMe ? ' <span class="you-tag">(You)</span>' : ''}
      </div>
      <div class="participant-status">
        <span class="status-dot"></span>
        <svg class="participant-mic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      </div>
    `;

    participantsList.appendChild(row);
  });
}

// ══════════════════════════════════
// CHAT
// ══════════════════════════════════

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', text);
  chatInput.value = '';
  chatInput.focus();
}

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

socket.on('chat-message', ({ username, text, timestamp }) => {
  const msgDiv = document.createElement('div');
  const isOwn = username === myUsername;
  msgDiv.className = 'chat-msg' + (isOwn ? ' is-own' : '');

  const time = new Date(timestamp);
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  msgDiv.innerHTML = `
    <div class="msg-header">
      <span class="msg-username">${escapeHtml(username)}</span>
      <span class="msg-time">${timeStr}</span>
    </div>
    <div class="msg-text">${escapeHtml(text)}</div>
  `;

  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

socket.on('user-joined', ({ username }) => {
  addSystemMessage(`${username} joined the room`);
  showToast(`${username} joined 🎉`);
});

socket.on('user-left', ({ username }) => {
  addSystemMessage(`${username} left the room`);
});

function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'chat-msg-system';
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ══════════════════════════════════
// MICROPHONE
// ══════════════════════════════════

async function toggleMic() {
  if (isMicOn) {
    // Turn off mic
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    isMicOn = false;
    btnMic.classList.add('muted');
    btnMic.querySelector('.pill-label').textContent = 'Mic Off';

    // Remove audio track from all peer connections
    Object.values(peers).forEach(pc => {
      const senders = pc.getSenders();
      senders.forEach(sender => {
        if (sender.track && sender.track.kind === 'audio') {
          pc.removeTrack(sender);
        }
      });
    });
  } else {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      isMicOn = true;
      btnMic.classList.remove('muted');
      btnMic.querySelector('.pill-label').textContent = 'Mic On';

      // Add audio track to all peer connections
      const audioTrack = localStream.getAudioTracks()[0];
      Object.values(peers).forEach(pc => {
        pc.addTrack(audioTrack, localStream);
      });
    } catch (err) {
      showToast('Mic access denied');
      console.error('Mic error:', err);
    }
  }
}

// ══════════════════════════════════
// SCREEN SHARE
// ══════════════════════════════════

async function toggleScreenShare() {
  if (isScreenSharing) {
    stopScreenShare();
  } else {
    await startScreenShare();
  }
}

async function startScreenShare() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: true  // system audio if supported
    });

    isScreenSharing = true;
    btnScreen.classList.add('active');
    document.getElementById('screenLabel').textContent = 'Stop Sharing';

    // Show local preview
    videoEl.srcObject = screenStream;
    videoEl.style.display = 'block';
    videoPlaceholder.style.display = 'none';
    screenShareLabel.classList.add('show');
    sharerName.textContent = 'You are';

    // Handle stream ending (user clicks "Stop sharing" in browser)
    screenStream.getVideoTracks()[0].addEventListener('ended', () => {
      stopScreenShare();
    });

    // Send screen to all peers
    Object.entries(peers).forEach(([peerId, pc]) => {
      screenStream.getTracks().forEach(track => {
        pc.addTrack(track, screenStream);
      });
      // Renegotiate
      createAndSendOffer(peerId, pc);
    });

    showToast('Screen sharing started');
  } catch (err) {
    console.error('Screen share error:', err);
    if (err.name !== 'NotAllowedError') {
      showToast('Failed to share screen');
    }
  }
}

function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  isScreenSharing = false;
  btnScreen.classList.remove('active');
  document.getElementById('screenLabel').textContent = 'Share Screen';

  videoEl.srcObject = null;
  videoEl.style.display = 'none';
  videoPlaceholder.style.display = '';
  screenShareLabel.classList.remove('show');

  // Remove screen tracks from peers
  Object.entries(peers).forEach(([peerId, pc]) => {
    const senders = pc.getSenders();
    senders.forEach(sender => {
      if (sender.track && sender.track.kind === 'video') {
        pc.removeTrack(sender);
      }
    });
    createAndSendOffer(peerId, pc);
  });

  showToast('Screen sharing stopped');
}

// ══════════════════════════════════
// WebRTC PEER CONNECTIONS
// ══════════════════════════════════

function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  peers[peerId] = pc;

  // Send ICE candidates to the remote peer
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { to: peerId, candidate: event.candidate });
    }
  };

  // Handle incoming tracks (screen share or audio from remote)
  pc.ontrack = (event) => {
    const stream = event.streams[0];
    if (!stream) return;

    // Check if it has video → screen share
    if (event.track.kind === 'video') {
      videoEl.srcObject = stream;
      videoEl.style.display = 'block';
      videoPlaceholder.style.display = 'none';
      screenShareLabel.classList.add('show');

      // Find who is sharing
      const sharer = participants.find(p => p.id === peerId);
      sharerName.textContent = sharer ? sharer.username : 'Someone';

      // Handle remote screen share ending
      event.track.addEventListener('ended', () => {
        videoEl.srcObject = null;
        videoEl.style.display = 'none';
        videoPlaceholder.style.display = '';
        screenShareLabel.classList.remove('show');
      });
    }

    if (event.track.kind === 'audio') {
      // Play remote audio
      let audioEl = document.getElementById('audio-' + peerId);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = 'audio-' + peerId;
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = stream;
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      pc.close();
      delete peers[peerId];
      // Clean up remote audio
      const audioEl = document.getElementById('audio-' + peerId);
      if (audioEl) audioEl.remove();
    }
  };

  // Add existing local tracks (mic + screen) to the new connection
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }
  if (screenStream) {
    screenStream.getTracks().forEach(track => {
      pc.addTrack(track, screenStream);
    });
  }

  return pc;
}

async function createAndSendOffer(peerId, pc) {
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { to: peerId, offer });
  } catch (err) {
    console.error('Offer error:', err);
  }
}

// ── Signaling handlers ──

// When a new user joins, existing users initiate the connection
socket.on('user-joined', async ({ id: peerId }) => {
  const pc = createPeerConnection(peerId);
  await createAndSendOffer(peerId, pc);
});

// When receiving an offer from a peer
socket.on('offer', async ({ from, offer }) => {
  let pc = peers[from];
  if (!pc) {
    pc = createPeerConnection(from);
  }

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { to: from, answer });
  } catch (err) {
    console.error('Answer error:', err);
  }
});

// When receiving an answer
socket.on('answer', async ({ from, answer }) => {
  const pc = peers[from];
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error('Set answer error:', err);
    }
  }
});

// When receiving an ICE candidate
socket.on('ice-candidate', async ({ from, candidate }) => {
  const pc = peers[from];
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('ICE error:', err);
    }
  }
});

// Cleanup when a peer leaves
socket.on('user-left', ({ id: peerId }) => {
  const pc = peers[peerId];
  if (pc) {
    pc.close();
    delete peers[peerId];
  }
  const audioEl = document.getElementById('audio-' + peerId);
  if (audioEl) audioEl.remove();

  // If they were sharing screen, hide video
  if (videoEl.srcObject) {
    const tracks = videoEl.srcObject.getTracks();
    const allEnded = tracks.every(t => t.readyState === 'ended');
    if (allEnded) {
      videoEl.srcObject = null;
      videoEl.style.display = 'none';
      videoPlaceholder.style.display = '';
      screenShareLabel.classList.remove('show');
    }
  }
});

// ══════════════════════════════════
// UTILITIES
// ══════════════════════════════════

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Keyboard shortcut: Enter on username input ──
inputUsername.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('btnCreateRoom').click();
  }
});

inputRoomCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});

// Auto-focus username input
inputUsername.focus();
