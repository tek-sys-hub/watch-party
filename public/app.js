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
let isStreamMutedOnMySide = false;
let isChatVisible = true;
let peers = {};                // { peerId: RTCPeerConnection }
let participants = [];
let peerMicStates = {};        // { socketId: boolean }
let hostId = null;

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
      urls: 'turn:global.relay.metered.ca:80',
      username: '719bcdb45e5a7fd9814798f4',
      credential: 'lAOa/TEg/Q7TcTBK',
    },
    {
      urls: 'turn:global.relay.metered.ca:80?transport=tcp',
      username: '719bcdb45e5a7fd9814798f4',
      credential: 'lAOa/TEg/Q7TcTBK',
    },
    {
      urls: 'turn:global.relay.metered.ca:443',
      username: '719bcdb45e5a7fd9814798f4',
      credential: 'lAOa/TEg/Q7TcTBK',
    },
    {
      urls: 'turns:global.relay.metered.ca:443?transport=tcp',
      username: '719bcdb45e5a7fd9814798f4',
      credential: 'lAOa/TEg/Q7TcTBK',
    },
  ]
};

// Queue ICE candidates arriving before remote description is set
const iceCandidateQueues = {};

async function drainIceCandidateQueue(peerId, pc) {
  const queue = iceCandidateQueues[peerId];
  if (!queue || queue.length === 0) return;
  while (queue.length > 0) {
    const candidate = queue.shift();
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.warn(`[WebRTC ${peerId}] Error adding queued ICE candidate:`, err);
    }
  }
}

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
const btnStreamAudio = document.getElementById('btnStreamAudio');
const videoAudioBadge = document.getElementById('videoAudioBadge');

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
// STREAM AUDIO (MUTE STREAM ON YOUR SIDE)
// ══════════════════════════════════

function toggleStreamAudio() {
  if (isScreenSharing) {
    showToast('You are sharing: your tab audio is already playing on your PC');
    return;
  }

  isStreamMutedOnMySide = !isStreamMutedOnMySide;
  videoEl.muted = isStreamMutedOnMySide;
  updateStreamAudioUI();

  if (isStreamMutedOnMySide) {
    showToast('Stream sound muted on your side 🔇');
  } else {
    showToast('Stream sound unmuted 🔊');
  }
}

function updateStreamAudioUI() {
  const badge = document.getElementById('videoAudioBadge');
  const badgeOn = document.getElementById('badgeSoundOn');
  const badgeOff = document.getElementById('badgeSoundOff');
  const badgeText = document.getElementById('badgeSoundText');

  const btn = document.getElementById('btnStreamAudio');
  const tbOn = document.getElementById('toolbarSoundOn');
  const tbOff = document.getElementById('toolbarSoundOff');
  const tbText = document.getElementById('toolbarSoundText');

  if (isScreenSharing) {
    if (badge) {
      badge.style.display = 'flex';
      badge.classList.remove('muted');
    }
    if (badgeOn) badgeOn.style.display = 'block';
    if (badgeOff) badgeOff.style.display = 'none';
    if (badgeText) badgeText.textContent = 'Playing on your PC';

    if (btn) {
      btn.style.display = 'inline-flex';
      btn.classList.remove('muted');
    }
    if (tbOn) tbOn.style.display = 'block';
    if (tbOff) tbOff.style.display = 'none';
    if (tbText) tbText.textContent = 'Local Audio';
    return;
  }

  if (isStreamMutedOnMySide) {
    if (badge) {
      badge.style.display = 'flex';
      badge.classList.add('muted');
    }
    if (badgeOn) badgeOn.style.display = 'none';
    if (badgeOff) badgeOff.style.display = 'block';
    if (badgeText) badgeText.textContent = 'Muted (Your side)';

    if (btn) {
      btn.style.display = 'inline-flex';
      btn.classList.add('muted');
    }
    if (tbOn) tbOn.style.display = 'none';
    if (tbOff) tbOff.style.display = 'block';
    if (tbText) tbText.textContent = 'Unmute Stream';
  } else {
    if (badge) {
      badge.style.display = 'flex';
      badge.classList.remove('muted');
    }
    if (badgeOn) badgeOn.style.display = 'block';
    if (badgeOff) badgeOff.style.display = 'none';
    if (badgeText) badgeText.textContent = 'Stream Sound';

    if (btn) {
      btn.style.display = 'inline-flex';
      btn.classList.remove('muted');
    }
    if (tbOn) tbOn.style.display = 'block';
    if (tbOff) tbOff.style.display = 'none';
    if (tbText) tbText.textContent = 'Mute Stream';
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

socket.on('user-mic-changed', ({ id, isMicOn: status }) => {
  peerMicStates[id] = status;
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
    const peerMicOn = isMe ? isMicOn : !!peerMicStates[p.id];

    row.innerHTML = `
      <div class="participant-avatar ${AVATAR_COLORS[i % AVATAR_COLORS.length]}">${escapeHtml(p.username.charAt(0))}</div>
      <div class="participant-name">
        ${escapeHtml(p.username)}${isHost ? ' <span class="host-badge">👑</span>' : ''}${isMe ? ' <span class="you-tag">(You)</span>' : ''}
      </div>
      <div class="participant-status">
        <span class="status-dot" style="${peerMicOn ? '' : 'background: var(--text-muted); opacity: 0.4;'}"></span>
        <svg class="participant-mic-icon" style="${peerMicOn ? 'color: var(--green);' : 'color: var(--text-muted); opacity: 0.4;'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          ${peerMicOn 
            ? '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'
            : '<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>'
          }
        </svg>
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
    // Mute mic: silence track without breaking WebRTC connection
    isMicOn = false;
    if (localStream) {
      localStream.getAudioTracks().forEach(t => {
        t.enabled = false;
      });
    }
    updateMicUI();
    renderParticipants();
    socket.emit('user-mic-toggle', { isMicOn: false });
    showToast('Microphone muted 🔇');
  } else {
    // Turn on / unmute mic
    try {
      if (!localStream || !localStream.getAudioTracks().length || localStream.getAudioTracks()[0].readyState === 'ended') {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        const audioTrack = localStream.getAudioTracks()[0];
        audioTrack.enabled = true;

        // Attach audio track to all peer connections and renegotiate if needed
        Object.entries(peers).forEach(([peerId, pc]) => {
          const senders = pc.getSenders();
          const screenAudioTrack = screenStream ? screenStream.getAudioTracks()[0] : null;
          const existingSender = senders.find(s => s.track && s.track.kind === 'audio' && s.track !== screenAudioTrack);

          if (existingSender) {
            existingSender.replaceTrack(audioTrack).catch(err => console.error('replaceTrack error:', err));
          } else {
            pc.addTrack(audioTrack, localStream);
            createAndSendOffer(peerId, pc);
          }
        });
      } else {
        localStream.getAudioTracks().forEach(t => {
          t.enabled = true;
        });
      }

      isMicOn = true;
      updateMicUI();
      renderParticipants();
      socket.emit('user-mic-toggle', { isMicOn: true });
      showToast('Microphone on 🎤');
    } catch (err) {
      console.error('Mic access error:', err);
      showToast('Microphone access denied');
    }
  }
}

function updateMicUI() {
  if (!btnMic) return;
  const label = btnMic.querySelector('.pill-label');
  const iconOn = document.getElementById('iconMicOn');
  const iconOff = document.getElementById('iconMicOff');

  if (isMicOn) {
    btnMic.classList.remove('muted');
    if (label) label.textContent = 'Mic On';
    if (iconOn) iconOn.style.display = 'block';
    if (iconOff) iconOff.style.display = 'none';
  } else {
    btnMic.classList.add('muted');
    if (label) label.textContent = 'Mic Off';
    if (iconOn) iconOn.style.display = 'none';
    if (iconOff) iconOff.style.display = 'block';
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
    videoEl.muted = true; // Local preview must be muted to avoid audio feedback
    videoEl.style.display = 'block';
    videoPlaceholder.style.display = 'none';
    screenShareLabel.classList.add('show');
    sharerName.textContent = 'You are';
    videoEl.play().catch(e => console.warn('Local play warning:', e));
    updateStreamAudioUI();

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
  if (videoAudioBadge) videoAudioBadge.style.display = 'none';
  if (btnStreamAudio) btnStreamAudio.style.display = 'none';

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
    console.log(`[WebRTC ${peerId}] Track received:`, event.track.kind);
    let stream = event.streams && event.streams[0];
    if (!stream) {
      stream = new MediaStream([event.track]);
    }

    // Check if it has video → screen share
    if (event.track.kind === 'video') {
      videoEl.srcObject = stream;
      videoEl.style.display = 'block';
      videoPlaceholder.style.display = 'none';
      screenShareLabel.classList.add('show');

      const sharer = participants.find(p => p.id === peerId);
      sharerName.textContent = sharer ? sharer.username : 'Someone';

      // Apply viewer's local mute preference to stream audio
      videoEl.muted = isStreamMutedOnMySide;
      updateStreamAudioUI();

      // Start playing and handle browser autoplay restrictions gracefully
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          console.warn('Autoplay prevented, muting video to play:', err);
          videoEl.muted = true;
          videoEl.play().catch(e => console.error('Play error after muting:', e));
        });
      }

      // Handle remote screen share ending
      event.track.addEventListener('ended', () => {
        videoEl.srcObject = null;
        videoEl.style.display = 'none';
        videoPlaceholder.style.display = '';
        screenShareLabel.classList.remove('show');
        if (videoAudioBadge) videoAudioBadge.style.display = 'none';
        if (btnStreamAudio) btnStreamAudio.style.display = 'none';
      });
    }

    if (event.track.kind === 'audio') {
      // PREVENT DOUBLE AUDIO:
      // If this audio track is already part of the screen share stream,
      // videoEl is already playing it. Do NOT route it to audioEl.
      const isScreenAudio = (videoEl.srcObject && (
        videoEl.srcObject.id === stream.id || 
        videoEl.srcObject.getAudioTracks().some(t => t.id === event.track.id)
      ));

      if (isScreenAudio) {
        console.log(`[WebRTC ${peerId}] Screen audio track handled by video player (no double audio).`);
        return;
      }

      // Play remote voice chat audio (mic)
      let audioEl = document.getElementById('audio-' + peerId);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = 'audio-' + peerId;
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = stream;
      audioEl.play().catch(e => console.warn('Remote audio autoplay error:', e));
    }
  };

  pc.onconnectionstatechange = () => {
    console.log(`[WebRTC ${peerId}] Connection State:`, pc.connectionState);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      pc.close();
      delete peers[peerId];
      delete iceCandidateQueues[peerId];
      // Clean up remote audio
      const audioEl = document.getElementById('audio-' + peerId);
      if (audioEl) audioEl.remove();
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log(`[WebRTC ${peerId}] ICE State:`, pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') {
      if (pc.restartIce) {
        console.warn(`[WebRTC ${peerId}] Restarting ICE...`);
        pc.restartIce();
      }
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
    if (pc.signalingState !== 'stable') {
      console.warn(`[WebRTC ${peerId}] signalingState is ${pc.signalingState}, waiting for stable...`);
      await new Promise(resolve => {
        const handler = () => {
          if (pc.signalingState === 'stable' || !peers[peerId]) {
            pc.removeEventListener('signalingstatechange', handler);
            resolve();
          }
        };
        pc.addEventListener('signalingstatechange', handler);
        setTimeout(() => {
          pc.removeEventListener('signalingstatechange', handler);
          resolve();
        }, 1500);
      });
      if (pc.signalingState !== 'stable') {
        console.warn(`[WebRTC ${peerId}] Rolling back from ${pc.signalingState} to create fresh offer`);
        await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
      }
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log(`[WebRTC ${peerId}] Sending offer to peer.`);
    socket.emit('offer', { to: peerId, offer });
  } catch (err) {
    console.error(`[WebRTC ${peerId}] Offer error:`, err);
  }
}

// ── Signaling handlers ──

// When a new user joins, existing users prepare the connection
socket.on('user-joined', async ({ id: peerId }) => {
  console.log(`[WebRTC] Peer ${peerId} joined room.`);
  const pc = createPeerConnection(peerId);
  // Only initiate an offer if we have media (screen or mic) to send
  if (localStream || screenStream) {
    await createAndSendOffer(peerId, pc);
  }
});

// When receiving an offer from a peer
socket.on('offer', async ({ from, offer }) => {
  console.log(`[WebRTC ${from}] Received offer from peer.`);
  let pc = peers[from];
  if (!pc) {
    pc = createPeerConnection(from);
  }

  try {
    if (pc.signalingState !== 'stable') {
      console.warn(`[WebRTC ${from}] Rolling back from ${pc.signalingState} to accept incoming offer`);
      await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
    }
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await drainIceCandidateQueue(from, pc);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.log(`[WebRTC ${from}] Sending answer to peer.`);
    socket.emit('answer', { to: from, answer });
  } catch (err) {
    console.error(`[WebRTC ${from}] Answer error:`, err);
  }
});

// When receiving an answer
socket.on('answer', async ({ from, answer }) => {
  console.log(`[WebRTC ${from}] Received answer from peer.`);
  const pc = peers[from];
  if (pc) {
    try {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await drainIceCandidateQueue(from, pc);
        console.log(`[WebRTC ${from}] Remote description set, connection negotiated.`);
      }
    } catch (err) {
      console.error(`[WebRTC ${from}] Set answer error:`, err);
    }
  }
});

// When receiving an ICE candidate
socket.on('ice-candidate', async ({ from, candidate }) => {
  const pc = peers[from];
  if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
    if (!iceCandidateQueues[from]) iceCandidateQueues[from] = [];
    iceCandidateQueues[from].push(new RTCIceCandidate(candidate));
    return;
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error('ICE error:', err);
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
      if (videoAudioBadge) videoAudioBadge.style.display = 'none';
      if (btnStreamAudio) btnStreamAudio.style.display = 'none';
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
