const socket = io();

// DOM Elements
const els = {
  loginModal: document.getElementById('loginModal'),
  chatApp: document.getElementById('chatApp'),
  usernameInput: document.getElementById('usernameInput'),
  joinBtn: document.getElementById('joinBtn'),
  avatarPreview: document.getElementById('avatarPreview'),
  messagesContainer: document.getElementById('messagesContainer'),
  messageInput: document.getElementById('messageInput'),
  sendBtn: document.getElementById('sendBtn'),
  imageBtn: document.getElementById('imageBtn'),
  imageInput: document.getElementById('imageInput'),
  userList: document.getElementById('userList'),
  userCount: document.getElementById('userCount'),
  onlineCount: document.getElementById('onlineCount'),
  currentUser: document.getElementById('currentUser'),
  typingIndicator: document.getElementById('typingIndicator'),
  typingText: document.getElementById('typingText'),
  charCount: document.getElementById('charCount'),
  sidebar: document.querySelector('.sidebar'),
  sidebarToggle: document.getElementById('sidebarToggle'),
  imageModal: document.getElementById('imageModal'),
  previewImage: document.getElementById('previewImage'),
  closeImageModal: document.getElementById('closeImageModal'),
  toast: document.getElementById('toast')
};

let username = '';
let typingTimeout = null;
let currentUsers = [];

// Generate avatar using canvas - no external dependencies
function generateAvatar(seed, size = 80) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Generate color from seed
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash % 360);
  const s = 60 + Math.abs(hash % 20);
  const l = 45 + Math.abs(hash % 15);
  const color = `hsl(${h}, ${s}%, ${l}%)`;

  // Draw circle
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Draw initial
  const initial = seed.charAt(0).toUpperCase();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${size * 0.45}px -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initial, size / 2, size / 2 + size * 0.05);

  return canvas.toDataURL('image/png');
}

// Show toast
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 3000);
}

// Format time
function formatTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  if (isToday) return `${hours}:${minutes}`;
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Login
function joinChat() {
  username = els.usernameInput.value.trim();
  if (!username) {
    username = `用户${Math.random().toString(36).substr(2, 6)}`;
  }

  socket.emit('join', username);
  els.loginModal.classList.add('hidden');
  els.chatApp.classList.remove('hidden');

  // Set current user display
  els.currentUser.innerHTML = `
    <img src="${generateAvatar(username, 32)}" class="avatar" alt="">
    <span>${escapeHtml(username)}</span>
  `;
}

els.joinBtn.addEventListener('click', joinChat);
els.usernameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinChat();
});

// Update avatar preview
els.usernameInput.addEventListener('input', () => {
  const val = els.usernameInput.value.trim() || '?';
  els.avatarPreview.innerHTML = `<img src="${generateAvatar(val, 80)}" alt="">`;
});

// Create message element
function createMessageElement(msg) {
  const isOwn = msg.username === username;
  const isSystem = msg.type === 'system';

  const div = document.createElement('div');
  div.className = `message ${isOwn ? 'own' : ''} ${isSystem ? 'system' : ''}`;
  div.dataset.messageId = msg.id;

  if (isSystem) {
    div.innerHTML = `<div class="message-content"><div class="message-body">${escapeHtml(msg.content)}</div></div>`;
    return div;
  }

  const avatar = generateAvatar(msg.username, 36);
  let contentHtml = '';

  if (msg.type === 'text') {
    contentHtml = `<div class="message-body">${escapeHtml(msg.content)}</div>`;
  } else if (msg.type === 'image') {
    contentHtml = `<img src="${msg.imageData}" class="message-image" alt="图片" onclick="openImageModal('${msg.imageData}')">`;
  }

  div.innerHTML = `
    <img src="${avatar}" class="message-avatar" alt="">
    <div class="message-content">
      <div class="message-header">
        <span class="message-author">${escapeHtml(msg.username)}</span>
        <span class="message-time">${formatTime(msg.timestamp)}</span>
      </div>
      ${contentHtml}
    </div>
  `;

  return div;
}

// Add message to chat
function addMessage(msg) {
  const welcome = els.messagesContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  const msgEl = createMessageElement(msg);
  els.messagesContainer.appendChild(msgEl);
  scrollToBottom();
}

// Scroll to bottom
function scrollToBottom() {
  els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
}

// Send text message
function sendMessage() {
  const content = els.messageInput.value.trim();
  if (!content) return;

  socket.emit('sendMessage', { content });
  els.messageInput.value = '';
  els.charCount.textContent = '0/500';
  socket.emit('typing', false);
}

els.sendBtn.addEventListener('click', sendMessage);
els.messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Character count + typing indicator
els.messageInput.addEventListener('input', () => {
  const len = els.messageInput.value.length;
  els.charCount.textContent = `${len}/500`;

  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing', false);
  }, 2000);
});

// Image upload
els.imageBtn.addEventListener('click', () => els.imageInput.click());

els.imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件');
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    showToast('图片大小不能超过5MB');
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    socket.emit('sendImage', { imageData: event.target.result });
    els.imageInput.value = '';
  };
  reader.readAsDataURL(file);
});

// Drag and drop
els.messagesContainer.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.messagesContainer.style.background = '#e0f2fe';
});
els.messagesContainer.addEventListener('dragleave', () => {
  els.messagesContainer.style.background = '';
});
els.messagesContainer.addEventListener('drop', (e) => {
  e.preventDefault();
  els.messagesContainer.style.background = '';

  for (const file of e.dataTransfer.files) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        socket.emit('sendImage', { imageData: event.target.result });
      };
      reader.readAsDataURL(file);
    }
  }
});

// Image modal
window.openImageModal = function(src) {
  els.previewImage.src = src;
  els.imageModal.classList.remove('hidden');
};

els.closeImageModal.addEventListener('click', () => {
  els.imageModal.classList.add('hidden');
});
els.imageModal.addEventListener('click', (e) => {
  if (e.target === els.imageModal) {
    els.imageModal.classList.add('hidden');
  }
});

// Update user list
function updateUserList(users) {
  currentUsers = users;
  els.userList.innerHTML = '';

  users.forEach(user => {
    const div = document.createElement('div');
    div.className = 'user-item';
    div.innerHTML = `
      <img src="${generateAvatar(user.username, 36)}" class="avatar" alt="">
      <div class="user-info">
        <div class="user-name">${escapeHtml(user.username)}</div>
        <div class="user-status">在线</div>
      </div>
      <div class="online-dot"></div>
    `;
    els.userList.appendChild(div);
  });

  els.userCount.textContent = users.length;
  els.onlineCount.textContent = `${users.length} 人在线`;
}

// Sidebar toggle (mobile)
els.sidebarToggle.addEventListener('click', () => {
  els.sidebar.classList.toggle('open');
});

document.addEventListener('click', (e) => {
  if (window.innerWidth <= 768) {
    if (!els.sidebar.contains(e.target) && !els.sidebarToggle.contains(e.target)) {
      els.sidebar.classList.remove('open');
    }
  }
});

// Socket events
socket.on('messageHistory', (history) => {
  if (history.length > 0) {
    const welcome = els.messagesContainer.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    history.forEach(msg => {
      els.messagesContainer.appendChild(createMessageElement(msg));
    });
    scrollToBottom();
  }
});

socket.on('newMessage', (msg) => {
  addMessage(msg);
});

socket.on('userJoined', (data) => {
  showToast(`${data.username} 加入聊天室`);
  addMessage({
    id: Date.now(),
    type: 'system',
    content: `${data.username} 加入聊天室`,
    timestamp: new Date().toISOString()
  });
});

socket.on('userLeft', (data) => {
  showToast(`${data.username} 离开聊天室`);
  addMessage({
    id: Date.now(),
    type: 'system',
    content: `${data.username} 离开聊天室`,
    timestamp: new Date().toISOString()
  });
});

socket.on('userList', (users) => {
  updateUserList(users);
});

socket.on('userTyping', (data) => {
  if (data.isTyping) {
    els.typingIndicator.classList.remove('hidden');
    els.typingText.textContent = `${data.username} 正在输入`;
  } else {
    els.typingIndicator.classList.add('hidden');
  }
});

// Paste image support
document.addEventListener('paste', (e) => {
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      const reader = new FileReader();
      reader.onload = (event) => {
        socket.emit('sendImage', { imageData: event.target.result });
      };
      reader.readAsDataURL(blob);
    }
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    els.imageModal.classList.add('hidden');
    els.sidebar.classList.remove('open');
  }
});

// Reconnect handling
socket.on('connect', () => {
  if (username) {
    socket.emit('join', username);
  }
});

socket.on('disconnect', () => {
  showToast('连接已断开，正在重连...');
});

socket.on('reconnect', () => {
  showToast('已重新连接');
});

// Initialize
els.avatarPreview.innerHTML = `<img src="${generateAvatar('?', 80)}" alt="">`;
