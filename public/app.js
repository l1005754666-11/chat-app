const socket = io({ reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 1000 });

// ========== User Store ==========
const userStore = {
  get() {
    try { return JSON.parse(localStorage.getItem('chat_user')); } catch { return null; }
  },
  set(data) { localStorage.setItem('chat_user', JSON.stringify(data)); },
  clear() { localStorage.removeItem('chat_user'); }
};

function generateGuestId() {
  return 'guest_' + Math.random().toString(36).substr(2, 10) + Date.now().toString(36).substr(-4);
}

function generateClientId() {
  return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
}

function getOrCreateUser() {
  let user = userStore.get();
  if (!user) {
    user = {
      userId: generateGuestId(),
      userName: '',
      avatarColor: null,
      createdAt: Date.now()
    };
    userStore.set(user);
  }
  if (!user.userId) {
    user.userId = generateGuestId();
    userStore.set(user);
  }
  return user;
}

function updateUser(updates) {
  const user = { ...getOrCreateUser(), ...updates };
  userStore.set(user);
  return user;
}

// ========== DOM ==========
const $ = id => document.getElementById(id);

const els = {
  loginModal: $('loginModal'), loginAvatar: $('loginAvatar'),
  usernameInput: $('usernameInput'), joinBtn: $('joinBtn'),
  chatApp: $('chatApp'), sidebar: $('sidebar'), sidebarToggle: $('sidebarToggle'),
  myAvatar: $('myAvatar'), myName: $('myName'), editNameBtn: $('editNameBtn'),
  onlineCount: $('onlineCount'), userList: $('userList'),
  connectionStatus: $('connectionStatus'),
  messagesContainer: $('messagesContainer'), typingIndicator: $('typingIndicator'),
  typingText: $('typingText'), messageInput: $('messageInput'),
  sendBtn: $('sendBtn'), charCount: $('charCount'),
  fileBtn: $('fileBtn'), imageBtn: $('imageBtn'), fileInput: $('fileInput'),
  filePreview: $('filePreview'), filePreviewName: $('filePreviewName'),
  filePreviewSize: $('filePreviewSize'), filePreviewRemove: $('filePreviewRemove'),
  imageModal: $('imageModal'), previewImage: $('previewImage'), closeImageModal: $('closeImageModal'),
  editNameModal: $('editNameModal'), editNameInput: $('editNameInput'),
  saveNameBtn: $('saveNameBtn'), closeEditModal: $('closeEditModal'),
  toast: $('toast')
};

// ========== State ==========
let user = getOrCreateUser();
let pendingFile = null;
let isSending = false;
let oldestMessageId = null;
let hasMoreHistory = true;
let typingTimeout = null;
let heartbeatInterval = null;

// ========== Avatar Color ==========
function getAvatarColor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const hues = [220, 260, 200, 170, 30, 350, 190, 280];
  return `hsl(${hues[Math.abs(hash) % hues.length]}, 72%, 52%)`;
}

function getInitial(name) {
  if (!name) return '?';
  const c = name.trim().charAt(0);
  return /[一-龥]/.test(c) ? c : c.toUpperCase();
}

function renderAvatar(el, name, size = 40) {
  const color = getAvatarColor(name || '?');
  el.style.background = color;
  el.textContent = getInitial(name);
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.borderRadius = '50%';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.color = 'white';
  el.style.fontWeight = '600';
  el.style.fontSize = (size * 0.42) + 'px';
  el.style.flexShrink = '0';
}

// ========== Toast ==========
function showToast(message, type = '') {
  els.toast.textContent = message;
  els.toast.className = 'toast' + (type ? ' ' + type : '');
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 3000);
}

// ========== Format ==========
function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  if (isToday) return `${h}:${m}`;
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${mo}-${day} ${h}:${m}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ========== Connection Status ==========
function updateConnectionStatus(status) {
  const dot = els.connectionStatus.querySelector('.status-dot');
  const text = els.connectionStatus.querySelector('.status-text');
  dot.className = 'status-dot ' + status;
  const labels = { connected: '已连接', connecting: '连接中...', disconnected: '已断开' };
  text.textContent = labels[status] || status;
}

// ========== Heartbeat ==========
function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (socket.connected) {
      socket.emit('ping');
    }
  }, 25000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ========== Login ==========
function showLogin() {
  els.loginModal.classList.remove('hidden');
  els.chatApp.classList.add('hidden');
  renderAvatar(els.loginAvatar, user.userName || '?', 72);
}

function enterChat() {
  const name = els.usernameInput.value.trim();
  if (!name) {
    showToast('请输入昵称');
    return;
  }
  user = updateUser({ userName: name });
  els.loginModal.classList.add('hidden');
  els.chatApp.classList.remove('hidden');
  initChat();
}

els.joinBtn.addEventListener('click', enterChat);
els.usernameInput.addEventListener('keypress', e => { if (e.key === 'Enter') enterChat(); });
els.usernameInput.addEventListener('input', () => {
  renderAvatar(els.loginAvatar, els.usernameInput.value || '?', 72);
});

// ========== Edit Name ==========
els.editNameBtn.addEventListener('click', () => {
  els.editNameInput.value = user.userName;
  els.editNameModal.classList.remove('hidden');
  els.editNameInput.focus();
});

function closeEdit() { els.editNameModal.classList.add('hidden'); }
els.closeEditModal.addEventListener('click', closeEdit);
els.editNameModal.addEventListener('click', e => { if (e.target === els.editNameModal) closeEdit(); });

function saveName() {
  const name = els.editNameInput.value.trim();
  if (!name) { showToast('昵称不能为空'); return; }
  user = updateUser({ userName: name });
  renderAvatar(els.myAvatar, user.userName, 40);
  els.myName.textContent = user.userName;
  closeEdit();
  showToast('昵称已更新');
  if (socket.connected) {
    socket.emit('join', { userId: user.userId, userName: user.userName });
  }
}
els.saveNameBtn.addEventListener('click', saveName);
els.editNameInput.addEventListener('keypress', e => { if (e.key === 'Enter') saveName(); });

// ========== Init Chat ==========
function initChat() {
  renderAvatar(els.myAvatar, user.userName, 40);
  els.myName.textContent = user.userName;

  if (socket.connected) {
    socket.emit('join', { userId: user.userId, userName: user.userName });
  }

  loadHistory();
  startHeartbeat();
  els.messageInput.focus();
}

async function loadHistory(before = null) {
  try {
    const url = '/api/messages?limit=50' + (before ? `&before=${before}` : '');
    const res = await fetch(url);
    const data = await res.json();
    if (!data.success) return;

    const msgs = data.messages;
    if (msgs.length === 0) {
      hasMoreHistory = false;
      return;
    }

    if (before) {
      const scrollHeight = els.messagesContainer.scrollHeight;
      msgs.forEach(msg => {
        if (msg.id && els.messagesContainer.querySelector(`[data-msg-id="${msg.id}"]`)) return;
        const el = createMessageElement(msg);
        els.messagesContainer.insertBefore(el, els.messagesContainer.firstChild);
      });
      const newScrollHeight = els.messagesContainer.scrollHeight;
      els.messagesContainer.scrollTop = newScrollHeight - scrollHeight;
    } else {
      const welcome = els.messagesContainer.querySelector('.welcome-message');
      if (welcome) welcome.remove();
      msgs.forEach(msg => {
        if (msg.id && els.messagesContainer.querySelector(`[data-msg-id="${msg.id}"]`)) return;
        els.messagesContainer.appendChild(createMessageElement(msg));
      });
      scrollToBottom();
    }

    oldestMessageId = msgs[0].id;
  } catch (err) {
    console.error('Load history error:', err);
  }
}

// ========== Scroll ==========
function scrollToBottom() {
  els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
}

els.messagesContainer.addEventListener('scroll', () => {
  if (els.messagesContainer.scrollTop < 50 && hasMoreHistory && oldestMessageId) {
    loadHistory(oldestMessageId);
  }
});

// ========== Create Message Element ==========
function createMessageElement(msg, opts = {}) {
  const isOwn = msg.userId === user.userId;
  const isSystem = msg.type === 'system';

  const group = document.createElement('div');
  group.className = `message-group ${isOwn ? 'own' : ''} ${isSystem ? 'system' : ''}`;
  if (opts.tempId) group.dataset.tempId = opts.tempId;
  if (msg.id) group.dataset.msgId = msg.id;
  if (msg.clientId) group.dataset.clientId = msg.clientId;

  if (isSystem) {
    group.innerHTML = `<div class="msg-bubble">${escapeHtml(msg.content || '')}</div>`;
    return group;
  }

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  renderAvatar(avatar, msg.userName, 34);

  const body = document.createElement('div');
  body.className = 'msg-body';

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.innerHTML = `<span class="msg-author">${escapeHtml(msg.userName)}</span><span class="msg-time">${formatTime(msg.createdAt)}</span>`;
  body.appendChild(meta);

  if (msg.type === 'text') {
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = msg.content || '';
    body.appendChild(bubble);
  } else if (msg.type === 'image') {
    const img = document.createElement('img');
    img.className = 'msg-image';
    img.src = msg.fileUrl;
    img.alt = msg.fileName || '图片';
    img.onclick = () => openImageModal(msg.fileUrl);
    body.appendChild(img);
  } else if (msg.type === 'file') {
    const card = document.createElement('div');
    card.className = 'file-card';
    card.innerHTML = `
      <div class="file-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
      </div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(msg.fileName || '文件')}</div>
        <div class="file-size">${formatFileSize(msg.fileSize || 0)}</div>
      </div>
      <a class="file-download" href="${msg.fileUrl}" target="_blank" download title="下载">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
      </a>
    `;
    body.appendChild(card);
  }

  if (isOwn && opts.status) {
    const statusEl = document.createElement('div');
    statusEl.className = 'msg-status ' + opts.status;
    if (opts.status === 'sending') {
      statusEl.textContent = '发送中...';
    } else if (opts.status === 'failed') {
      statusEl.innerHTML = '<span>发送失败</span><button class="retry-btn">重试</button>';
      statusEl.querySelector('.retry-btn').onclick = () => retryMessage(group, msg);
    }
    body.appendChild(statusEl);
  }

  group.appendChild(avatar);
  group.appendChild(body);
  return group;
}

function escapeHtml(text) {
  if (!text) return '';
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// ========== Send Message ==========
async function sendMessage() {
  if (isSending) return;

  const content = els.messageInput.value.trim();
  if (!content && !pendingFile) return;

  isSending = true;
  els.sendBtn.disabled = true;

  const clientId = generateClientId();
  let fileData = null;

  if (pendingFile) {
    try {
      const formData = new FormData();
      formData.append('file', pendingFile);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '上传失败');
      fileData = data;
    } catch (err) {
      showToast('文件上传失败: ' + err.message, 'error');
      isSending = false;
      els.sendBtn.disabled = false;
      return;
    }
  }

  const msgData = {
    userId: user.userId,
    userName: user.userName,
    type: fileData ? (fileData.isImage ? 'image' : 'file') : 'text',
    content: content || '',
    fileUrl: fileData ? fileData.fileUrl : null,
    fileName: fileData ? fileData.fileName : null,
    fileSize: fileData ? fileData.fileSize : null,
    mimeType: fileData ? fileData.mimeType : null,
    clientId
  };

  const welcome = els.messagesContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  const tempMsg = { ...msgData, id: null, createdAt: new Date().toISOString() };
  const tempEl = createMessageElement(tempMsg, { tempId: clientId, status: 'sending' });
  els.messagesContainer.appendChild(tempEl);
  scrollToBottom();

  els.messageInput.value = '';
  els.charCount.textContent = '0/500';
  autoResizeTextarea();
  clearFilePreview();

  socket.emit('sendMessage', msgData, (ack) => {
    isSending = false;
    els.sendBtn.disabled = false;

    if (ack && ack.error) {
      const statusEl = tempEl.querySelector('.msg-status');
      if (statusEl) {
        statusEl.className = 'msg-status failed';
        statusEl.innerHTML = '<span>发送失败</span><button class="retry-btn">重试</button>';
        statusEl.querySelector('.retry-btn').onclick = () => retryMessage(tempEl, msgData);
      }
      showToast('发送失败: ' + ack.error, 'error');
    }
  });
}

function retryMessage(el, msgData) {
  el.remove();
  isSending = false;
  els.sendBtn.disabled = false;

  const newClientId = generateClientId();
  const welcome = els.messagesContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  const tempMsg = { ...msgData, clientId: newClientId, id: null, createdAt: new Date().toISOString() };
  const tempEl = createMessageElement(tempMsg, { tempId: newClientId, status: 'sending' });
  els.messagesContainer.appendChild(tempEl);
  scrollToBottom();

  socket.emit('sendMessage', { ...msgData, clientId: newClientId }, (ack) => {
    isSending = false;
    els.sendBtn.disabled = false;
    if (ack && ack.error) {
      const statusEl = tempEl.querySelector('.msg-status');
      if (statusEl) {
        statusEl.className = 'msg-status failed';
        statusEl.innerHTML = '<span>发送失败</span><button class="retry-btn">重试</button>';
        statusEl.querySelector('.retry-btn').onclick = () => retryMessage(tempEl, { ...msgData, clientId: newClientId });
      }
    }
  });
}

els.sendBtn.addEventListener('click', sendMessage);

// ========== Textarea ==========
function autoResizeTextarea() {
  const ta = els.messageInput;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

els.messageInput.addEventListener('input', () => {
  autoResizeTextarea();
  const len = els.messageInput.value.length;
  els.charCount.textContent = `${len}/500`;

  socket.emit('typing', { userId: user.userId, isTyping: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing', { userId: user.userId, isTyping: false });
  }, 2000);
});

els.messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ========== File Upload ==========
function showFilePreview(file) {
  pendingFile = file;
  els.filePreviewName.textContent = file.name;
  els.filePreviewSize.textContent = formatFileSize(file.size);
  els.filePreview.classList.remove('hidden');
}

function clearFilePreview() {
  pendingFile = null;
  els.filePreview.classList.add('hidden');
  els.fileInput.value = '';
}

els.filePreviewRemove.addEventListener('click', clearFilePreview);

function handleFileSelect(file, acceptImages = false) {
  if (!file) return;

  const maxSize = 20 * 1024 * 1024;
  if (file.size > maxSize) {
    showToast(`文件大小超过 ${formatFileSize(maxSize)} 限制`, 'error');
    return;
  }

  const blockedExts = ['.exe', '.bat', '.cmd', '.sh', '.php', '.jsp', '.asp', '.dll', '.scr', '.com', '.vbs'];
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (blockedExts.includes(ext)) {
    showToast('不安全的文件类型', 'error');
    return;
  }

  if (acceptImages && !file.type.startsWith('image/')) {
    showToast('请选择图片文件', 'error');
    return;
  }

  showFilePreview(file);
}

els.fileBtn.addEventListener('click', () => {
  els.fileInput.accept = '*';
  els.fileInput.click();
});

els.imageBtn.addEventListener('click', () => {
  els.fileInput.accept = 'image/*';
  els.fileInput.click();
});

els.fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleFileSelect(file, els.fileInput.accept === 'image/*');
});

// Drag & drop
els.messagesContainer.addEventListener('dragover', e => {
  e.preventDefault();
  els.messagesContainer.style.background = '#eef1fe';
});
els.messagesContainer.addEventListener('dragleave', () => {
  els.messagesContainer.style.background = '';
});
els.messagesContainer.addEventListener('drop', e => {
  e.preventDefault();
  els.messagesContainer.style.background = '';
  for (const file of e.dataTransfer.files) {
    handleFileSelect(file);
    break;
  }
});

// Paste (images only)
els.messageInput.addEventListener('paste', e => {
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      if (blob) {
        const file = new File([blob], 'pasted-image.png', { type: blob.type });
        handleFileSelect(file, true);
      }
    }
  }
});

// ========== Image Modal ==========
function openImageModal(src) {
  els.previewImage.src = src;
  els.imageModal.classList.remove('hidden');
}

els.closeImageModal.addEventListener('click', () => {
  els.imageModal.classList.add('hidden');
});
els.imageModal.addEventListener('click', e => {
  if (e.target === els.imageModal) els.imageModal.classList.add('hidden');
});
window.openImageModal = openImageModal;

// ========== Sidebar Toggle ==========
els.sidebarToggle.addEventListener('click', () => {
  els.sidebar.classList.toggle('open');
});

document.addEventListener('click', e => {
  if (window.innerWidth <= 768) {
    if (!els.sidebar.contains(e.target) && !els.sidebarToggle.contains(e.target)) {
      els.sidebar.classList.remove('open');
    }
  }
});

// ========== Keyboard ==========
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    els.imageModal.classList.add('hidden');
    els.editNameModal.classList.add('hidden');
    els.sidebar.classList.remove('open');
  }
});

// ========== Socket Events ==========
socket.on('connect', () => {
  updateConnectionStatus('connected');
  if (user.userName) {
    socket.emit('join', { userId: user.userId, userName: user.userName });
  }
  startHeartbeat();
});

socket.on('connecting', () => {
  updateConnectionStatus('connecting');
});

socket.on('disconnect', () => {
  updateConnectionStatus('disconnected');
  stopHeartbeat();
});

socket.on('reconnect', () => {
  updateConnectionStatus('connected');
  showToast('已重新连接');
  loadHistory();
  startHeartbeat();
});

socket.on('messageHistory', (history) => {
  if (history.length > 0) {
    const welcome = els.messagesContainer.querySelector('.welcome-message');
    if (welcome) welcome.remove();

    history.forEach(msg => {
      if (msg.id && els.messagesContainer.querySelector(`[data-msg-id="${msg.id}"]`)) return;
      els.messagesContainer.appendChild(createMessageElement(msg));
    });
    scrollToBottom();
  }
});

socket.on('newMessage', (msg) => {
  // Remove temp message by clientId (exact match)
  if (msg.clientId) {
    const temp = els.messagesContainer.querySelector(`[data-temp-id="${msg.clientId}"]`);
    if (temp) temp.remove();
  }

  // Avoid duplicate
  if (msg.id && els.messagesContainer.querySelector(`[data-msg-id="${msg.id}"]`)) return;

  const welcome = els.messagesContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  els.messagesContainer.appendChild(createMessageElement(msg));
  scrollToBottom();
});

socket.on('userJoined', (data) => {
  showToast(`${data.userName} 加入聊天室`);
});

socket.on('userLeft', (data) => {
  showToast(`${data.userName} 离开聊天室`);
});

socket.on('userList', (users) => {
  els.userList.innerHTML = '';
  users.forEach(u => {
    const div = document.createElement('div');
    div.className = 'user-item';
    const avatar = document.createElement('div');
    avatar.className = 'user-avatar';
    renderAvatar(avatar, u.userName, 32);
    const name = document.createElement('div');
    name.className = 'user-name';
    name.textContent = u.userName;
    div.appendChild(avatar);
    div.appendChild(name);
    els.userList.appendChild(div);
  });
  els.onlineCount.textContent = users.length;
});

socket.on('userTyping', (data) => {
  if (data.isTyping) {
    els.typingIndicator.classList.remove('hidden');
    els.typingText.textContent = `${data.userName} 正在输入`;
  } else {
    els.typingIndicator.classList.add('hidden');
  }
});

socket.on('messageError', (data) => {
  showToast(data.error || '发送失败', 'error');
});

// ========== Init ==========
if (user.userName) {
  els.loginModal.classList.add('hidden');
  initChat();
} else {
  showLogin();
}
