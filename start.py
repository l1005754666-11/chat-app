#!/usr/bin/env python3
"""
公司内部聊天服务器 - Python 版
无需安装 Node.js，只要有 Python 3 即可运行
"""

import http.server
import socketserver
import json
import os
import sys
import threading
import time
import urllib.parse
from pathlib import Path

# Try to use websockets, fall back to simple HTTP polling if not available
try:
    import asyncio
    import websockets
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    print("[注意] 未安装 websockets 库，将使用 HTTP 轮询模式")
    print("如需实时推送，请运行: pip install websockets")
    print()

PORT = int(os.environ.get("PORT", "3000"))
HOST = "0.0.0.0"

# Store messages and users
messages = []
users = {}
user_counter = 0

# HTML content
HTML_CONTENT = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>在线聊天室</title>
<style>
:root { --primary:#6366f1; --primary-dark:#4f46e5; --bg:#f1f5f9; --surface:#fff; --text:#1e293b; --text-secondary:#64748b; --border:#e2e8f0; --success:#22c55e; --radius:12px; --radius-sm:8px; --shadow-lg:0 10px 15px -3px rgba(0,0,0,0.1); }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--bg); color:var(--text); height:100vh; overflow:hidden; }
.icon { width:20px; height:20px; stroke:currentColor; stroke-width:2; fill:none; stroke-linecap:round; stroke-linejoin:round; flex-shrink:0; }
.icon-sm { width:16px; height:16px; }
.icon-lg { width:48px; height:48px; stroke-width:1.5; }
.icon-md { width:22px; height:22px; }
.modal { position:fixed; inset:0; background:rgba(15,23,42,0.6); display:flex; align-items:center; justify-content:center; z-index:1000; backdrop-filter:blur(4px); }
.modal.hidden { display:none !important; }
.modal-content { background:var(--surface); border-radius:var(--radius); padding:40px; width:90%; max-width:420px; box-shadow:var(--shadow-lg); animation:slideUp 0.3s ease; }
@keyframes slideUp { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
.login-header { text-align:center; margin-bottom:30px; }
.login-header svg { color:var(--primary); margin-bottom:16px; }
.login-header h2 { font-size:24px; font-weight:600; }
.avatar-preview { width:80px; height:80px; border-radius:50%; margin:0 auto 20px; background:var(--bg); display:flex; align-items:center; justify-content:center; overflow:hidden; }
.avatar-preview img { width:100%; height:100%; object-fit:cover; }
.login-form input { width:100%; padding:14px 18px; border:2px solid var(--border); border-radius:var(--radius-sm); font-size:16px; margin-bottom:16px; outline:none; }
.login-form input:focus { border-color:var(--primary); }
.btn-primary { width:100%; padding:14px; background:var(--primary); color:white; border:none; border-radius:var(--radius-sm); font-size:16px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; }
.btn-primary:hover { background:var(--primary-dark); }
.image-modal { background:rgba(0,0,0,0.9); }
.image-modal .modal-content { background:transparent; box-shadow:none; padding:0; max-width:90%; }
.image-modal img { max-width:100%; max-height:85vh; border-radius:var(--radius-sm); }
.close-btn { position:absolute; top:20px; right:20px; background:rgba(255,255,255,0.2); color:white; border:none; width:40px; height:40px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.close-btn:hover { background:rgba(255,255,255,0.3); }
.chat-app { display:flex; height:100vh; }
.chat-app.hidden { display:none !important; }
.sidebar { width:260px; background:var(--surface); border-right:1px solid var(--border); display:flex; flex-direction:column; flex-shrink:0; }
.sidebar-header { padding:20px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
.sidebar-header h3 { font-size:14px; font-weight:600; color:var(--text-secondary); display:flex; align-items:center; gap:8px; }
.user-count { background:#818cf8; color:white; font-size:12px; font-weight:600; padding:2px 8px; border-radius:10px; }
.user-list { flex:1; overflow-y:auto; padding:12px; }
.user-item { display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:var(--radius-sm); }
.user-item:hover { background:var(--bg); }
.user-item .avatar { width:36px; height:36px; border-radius:50%; flex-shrink:0; }
.user-item .user-name { font-size:14px; font-weight:500; }
.user-item .user-status { font-size:12px; color:var(--text-secondary); }
.online-dot { width:8px; height:8px; background:var(--success); border-radius:50%; flex-shrink:0; }
.sidebar-footer { padding:16px; border-top:1px solid var(--border); }
.current-user { display:flex; align-items:center; gap:10px; }
.current-user .avatar { width:32px; height:32px; border-radius:50%; }
.chat-area { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.chat-header { padding:16px 24px; background:var(--surface); border-bottom:1px solid var(--border); display:flex; align-items:center; gap:16px; flex-shrink:0; }
.sidebar-toggle { display:none; background:none; border:none; color:var(--text); cursor:pointer; padding:4px; }
.header-title { display:flex; align-items:center; gap:10px; font-size:18px; font-weight:600; flex:1; }
.header-title svg { color:var(--primary); }
.header-status { display:flex; align-items:center; gap:8px; font-size:14px; color:var(--text-secondary); }
.status-dot { width:8px; height:8px; border-radius:50%; background:var(--success); animation:pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
.messages-container { flex:1; overflow-y:auto; padding:20px 24px; display:flex; flex-direction:column; gap:4px; }
.welcome-message { text-align:center; padding:40px 20px; color:var(--text-secondary); }
.welcome-content svg { color:#818cf8; margin-bottom:16px; }
.welcome-content p { font-size:18px; font-weight:500; color:var(--text); margin-bottom:8px; }
.message { display:flex; gap:12px; max-width:70%; animation:fadeIn 0.3s ease; margin-bottom:8px; }
@keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
.message.own { align-self:flex-end; flex-direction:row-reverse; }
.message.system { align-self:center; max-width:100%; margin:8px 0; }
.message-avatar { width:36px; height:36px; border-radius:50%; flex-shrink:0; align-self:flex-end; }
.message-content { display:flex; flex-direction:column; gap:4px; }
.message.own .message-content { align-items:flex-end; }
.message-header { display:flex; align-items:center; gap:8px; font-size:12px; }
.message.own .message-header { flex-direction:row-reverse; }
.message-author { font-weight:600; }
.message-time { color:var(--text-secondary); }
.message-body { padding:12px 16px; background:var(--surface); border-radius:var(--radius); border:1px solid var(--border); font-size:14px; line-height:1.5; word-break:break-word; }
.message.own .message-body { background:var(--primary); color:white; border-color:var(--primary); }
.message.system .message-body { background:var(--bg); color:var(--text-secondary); font-size:13px; padding:8px 16px; }
.message-image { max-width:300px; max-height:300px; border-radius:var(--radius); cursor:pointer; border:1px solid var(--border); }
.message-image:hover { transform:scale(1.02); }
.typing-indicator { padding:8px 24px; display:flex; align-items:center; gap:8px; font-size:13px; color:var(--text-secondary); }
.typing-indicator.hidden { display:none !important; }
.typing-dots { display:flex; gap:4px; }
.typing-dots span { width:6px; height:6px; background:var(--text-secondary); border-radius:50%; animation:bounce 1.4s ease-in-out infinite; }
.typing-dots span:nth-child(2){animation-delay:0.2s} .typing-dots span:nth-child(3){animation-delay:0.4s}
@keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }
.input-area { background:var(--surface); border-top:1px solid var(--border); padding:12px 24px 16px; flex-shrink:0; }
.input-toolbar { display:flex; gap:8px; margin-bottom:8px; }
.toolbar-btn { background:none; border:none; color:var(--text-secondary); cursor:pointer; padding:6px; border-radius:var(--radius-sm); width:36px; height:36px; display:flex; align-items:center; justify-content:center; }
.toolbar-btn:hover { color:var(--primary); background:var(--bg); }
.input-row { display:flex; gap:12px; align-items:flex-end; }
.text-input-wrapper { flex:1; position:relative; }
.text-input-wrapper input { width:100%; padding:12px 50px 12px 16px; border:2px solid var(--border); border-radius:var(--radius); font-size:15px; outline:none; }
.text-input-wrapper input:focus { border-color:var(--primary); }
.char-count { position:absolute; right:12px; top:50%; transform:translateY(-50%); font-size:11px; color:var(--text-secondary); pointer-events:none; }
.send-btn { width:44px; height:44px; border-radius:50%; background:var(--primary); color:white; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.send-btn:hover { background:var(--primary-dark); }
.toast { position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(100px); background:#333; color:white; padding:12px 24px; border-radius:var(--radius-sm); font-size:14px; z-index:2000; opacity:0; transition:all 0.3s; }
.toast.show { opacity:1; transform:translateX(-50%) translateY(0); }
::-webkit-scrollbar { width:6px; }
::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:3px; }
@media (max-width:768px) {
  .sidebar { position:fixed; left:0; top:0; bottom:0; z-index:100; transform:translateX(-100%); transition:transform 0.3s; box-shadow:var(--shadow-lg); }
  .sidebar.open { transform:translateX(0); }
  .sidebar-toggle { display:flex; }
  .message { max-width:85%; }
  .message-image { max-width:200px; max-height:200px; }
  .messages-container { padding:16px; }
}
</style>
</head>
<body>
<div id="loginModal" class="modal">
  <div class="modal-content">
    <div class="login-header">
      <svg class="icon-lg" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      <h2>欢迎加入聊天室</h2>
    </div>
    <div class="login-form">
      <div class="avatar-preview" id="avatarPreview"></div>
      <input type="text" id="usernameInput" placeholder="输入你的昵称" maxlength="20" autofocus>
      <button id="joinBtn" class="btn-primary">
        <svg class="icon-sm" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13.8 12H3"/></svg>
        进入聊天室
      </button>
    </div>
  </div>
</div>

<div id="imageModal" class="modal image-modal hidden">
  <div class="modal-content">
    <button class="close-btn" id="closeImageModal">
      <svg class="icon-sm" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
    <img id="previewImage" src="" alt="Preview">
  </div>
</div>

<div id="chatApp" class="chat-app hidden">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <h3><svg class="icon-sm" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>在线用户</h3>
      <span class="user-count" id="userCount">0</span>
    </div>
    <div class="user-list" id="userList"></div>
    <div class="sidebar-footer"><div class="current-user" id="currentUser"></div></div>
  </aside>
  <main class="chat-area">
    <header class="chat-header">
      <button class="sidebar-toggle" id="sidebarToggle">
        <svg class="icon-md" viewBox="0 0 24 24"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
      </button>
      <div class="header-title">
        <svg class="icon-md" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        <span>在线聊天室</span>
      </div>
      <div class="header-status">
        <span class="status-dot"></span>
        <span id="onlineCount">0 人在线</span>
      </div>
    </header>
    <div class="messages-container" id="messagesContainer">
      <div class="welcome-message">
        <div class="welcome-content">
          <svg class="icon-lg" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          <p>欢迎来到聊天室！</p>
          <span>发送消息开始聊天吧</span>
        </div>
      </div>
    </div>
    <div class="typing-indicator hidden" id="typingIndicator">
      <span id="typingText"></span>
      <div class="typing-dots"><span></span><span></span><span></span></div>
    </div>
    <footer class="input-area">
      <div class="input-toolbar">
        <button class="toolbar-btn" id="imageBtn" title="发送图片">
          <svg class="icon-md" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </button>
        <input type="file" id="imageInput" accept="image/*" hidden>
      </div>
      <div class="input-row">
        <div class="text-input-wrapper">
          <input type="text" id="messageInput" placeholder="输入消息..." autocomplete="off" maxlength="500">
          <span class="char-count" id="charCount">0/500</span>
        </div>
        <button class="send-btn" id="sendBtn" title="发送">
          <svg class="icon-sm" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </div>
    </footer>
  </main>
</div>
<div class="toast" id="toast"></div>

<script>
const API_URL = '';
const POLL_INTERVAL = 1000;

let userId = 'user_' + Math.random().toString(36).substr(2, 9);
let username = '';
let typingTimeout = null;
let lastMessageId = 0;
let isPolling = false;

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
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebarToggle'),
  imageModal: document.getElementById('imageModal'),
  previewImage: document.getElementById('previewImage'),
  closeImageModal: document.getElementById('closeImageModal'),
  toast: document.getElementById('toast')
};

function generateAvatar(seed, size=80) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  let h = 0;
  for(let i=0;i<seed.length;i++) h = seed.charCodeAt(i)+((h<<5)-h);
  h = Math.abs(h%360);
  ctx.beginPath();
  ctx.arc(size/2,size/2,size/2,0,Math.PI*2);
  ctx.fillStyle = `hsl(${h},${60+Math.abs(h%20)}%,${45+Math.abs(h%15)}%)`;
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${size*0.45}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(seed.charAt(0).toUpperCase(),size/2,size/2+size*0.05);
  return c.toDataURL('image/png');
}

function showToast(msg) { els.toast.textContent = msg; els.toast.classList.add('show'); setTimeout(()=>els.toast.classList.remove('show'),3000); }
function escapeHtml(t) { const d=document.createElement('div'); d.textContent=t; return d.innerHTML; }
function formatTime(iso) { const d=new Date(iso); return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; }

async function api(path, data) {
  try {
    const res = await fetch(API_URL + '/api' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, username, ...data })
    });
    return await res.json();
  } catch(e) { console.error(e); return null; }
}

function addMessage(msg) {
  const welcome = els.messagesContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();
  const isOwn = msg.username === username;
  const isSystem = msg.type === 'system';
  const div = document.createElement('div');
  div.className = `message ${isOwn?'own':''} ${isSystem?'system':''}`;
  if (isSystem) {
    div.innerHTML = `<div class="message-content"><div class="message-body">${escapeHtml(msg.content)}</div></div>`;
  } else {
    const avatar = msg.avatar || generateAvatar(msg.username, 36);
    let body = '';
    if (msg.type === 'text') body = `<div class="message-body">${escapeHtml(msg.content)}</div>`;
    else if (msg.type === 'image') body = `<img src="${msg.imageData}" class="message-image" alt="图片" onclick="openImagePreview('${msg.imageData}')">`;
    div.innerHTML = `<img src="${avatar}" class="message-avatar" alt=""><div class="message-content"><div class="message-header"><span class="message-author">${escapeHtml(msg.username)}</span><span class="message-time">${formatTime(msg.timestamp)}</span></div>${body}</div>`;
  }
  els.messagesContainer.appendChild(div);
  els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
}

function updateUserList(userList) {
  els.userList.innerHTML = '';
  userList.forEach(u => {
    const div = document.createElement('div');
    div.className = 'user-item';
    div.innerHTML = `<img src="${u.avatar || generateAvatar(u.username,36)}" class="avatar" alt=""><div class="user-info"><div class="user-name">${escapeHtml(u.username)}</div><div class="user-status">在线</div></div><div class="online-dot"></div>`;
    els.userList.appendChild(div);
  });
  els.userCount.textContent = userList.length;
  els.onlineCount.textContent = `${userList.length} 人在线`;
}

async function joinChat() {
  username = els.usernameInput.value.trim() || `用户${Math.random().toString(36).substr(2,4)}`;
  els.loginModal.classList.add('hidden');
  els.chatApp.classList.remove('hidden');
  els.currentUser.innerHTML = `<img src="${generateAvatar(username,32)}" class="avatar" alt=""><span>${escapeHtml(username)}</span>`;
  await api('/join', { avatar: generateAvatar(username, 80) });
  startPolling();
  els.messageInput.focus();
}

async function sendMessage() {
  const content = els.messageInput.value.trim();
  if (!content) return;
  await api('/message', { type: 'text', content, avatar: generateAvatar(username, 36) });
  els.messageInput.value = '';
  els.charCount.textContent = '0/500';
}

async function sendImage(dataUrl) {
  await api('/message', { type: 'image', imageData: dataUrl, avatar: generateAvatar(username, 36) });
}

async function poll() {
  if (!isPolling) return;
  const data = await api('/poll', { lastId: lastMessageId });
  if (data) {
    if (data.messages) {
      data.messages.forEach(m => { if (m.id > lastMessageId) { addMessage(m); lastMessageId = m.id; } });
    }
    if (data.users) updateUserList(data.users);
    if (data.typing) {
      els.typingIndicator.classList.remove('hidden');
      els.typingText.textContent = `${data.typing} 正在输入`;
    } else {
      els.typingIndicator.classList.add('hidden');
    }
  }
  setTimeout(poll, POLL_INTERVAL);
}

function startPolling() { isPolling = true; poll(); }

els.joinBtn.addEventListener('click', joinChat);
els.usernameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') joinChat(); });
els.usernameInput.addEventListener('input', () => { els.avatarPreview.innerHTML = `<img src="${generateAvatar(els.usernameInput.value.trim()||'?',80)}" alt="">`; });
els.sendBtn.addEventListener('click', sendMessage);
els.messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendMessage(); } });
els.messageInput.addEventListener('input', () => {
  els.charCount.textContent = `${els.messageInput.value.length}/500`;
  api('/typing', {});
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => api('/typing_done', {}), 2000);
});
els.imageBtn.addEventListener('click', () => els.imageInput.click());
els.imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file || !file.type.startsWith('image/')) { showToast('请选择图片文件'); return; }
  if (file.size > 5*1024*1024) { showToast('图片不能超过5MB'); return; }
  const reader = new FileReader();
  reader.onload = (ev) => { sendImage(ev.target.result); els.imageInput.value = ''; };
  reader.readAsDataURL(file);
});

els.messagesContainer.addEventListener('dragover', (e) => { e.preventDefault(); els.messagesContainer.style.background = '#e0f2fe'; });
els.messagesContainer.addEventListener('dragleave', () => { els.messagesContainer.style.background = ''; });
els.messagesContainer.addEventListener('drop', (e) => {
  e.preventDefault(); els.messagesContainer.style.background = '';
  for (const file of e.dataTransfer.files) {
    if (file.type.startsWith('image/')) { const r = new FileReader(); r.onload = (ev) => sendImage(ev.target.result); r.readAsDataURL(file); }
  }
});
document.addEventListener('paste', (e) => {
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith('image/')) { const blob = item.getAsFile(); const r = new FileReader(); r.onload = (ev) => sendImage(ev.target.result); r.readAsDataURL(blob); }
  }
});

window.openImagePreview = (src) => { els.previewImage.src = src; els.imageModal.classList.remove('hidden'); };
els.closeImageModal.addEventListener('click', () => els.imageModal.classList.add('hidden'));
els.imageModal.addEventListener('click', (e) => { if (e.target === els.imageModal) els.imageModal.classList.add('hidden'); });
els.sidebarToggle.addEventListener('click', () => els.sidebar.classList.toggle('open'));
document.addEventListener('click', (e) => { if (window.innerWidth <= 768 && !els.sidebar.contains(e.target) && !els.sidebarToggle.contains(e.target)) els.sidebar.classList.remove('open'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { els.imageModal.classList.add('hidden'); els.sidebar.classList.remove('open'); } });

window.addEventListener('beforeunload', () => { navigator.sendBeacon(API_URL + '/api/leave', JSON.stringify({ userId })); });

els.avatarPreview.innerHTML = `<img src="${generateAvatar('?',80)}" alt="">`;
</script>
</body>
</html>"""


class ChatHandler(http.server.BaseHTTPRequestHandler):
    """Custom HTTP handler for chat API and serving the HTML page."""

    def log_message(self, format, *args):
        """Suppress default logging."""
        pass

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def _send_html(self, html, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(html.encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self._send_html(HTML_CONTENT)
        else:
            self.send_error(404)

    def do_POST(self):
        global user_counter, messages

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')

        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self._send_json({'error': 'Invalid JSON'}, 400)
            return

        path = self.path
        user_id = data.get('userId', '')
        username = data.get('username', '匿名')

        if path == '/api/join':
            user_counter += 1
            users[user_id] = {
                'id': user_id,
                'username': username,
                'avatar': data.get('avatar', ''),
                'lastSeen': time.time()
            }
            # Add system message
            msg_id = int(time.time() * 1000)
            messages.append({
                'id': msg_id,
                'type': 'system',
                'content': f'{username} 加入聊天室',
                'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ')
            })
            self._send_json({'success': True, 'userCount': len(users)})

        elif path == '/api/message':
            msg_id = int(time.time() * 1000) + len(messages)
            msg = {
                'id': msg_id,
                'type': data.get('type', 'text'),
                'username': username,
                'avatar': data.get('avatar', ''),
                'content': data.get('content', ''),
                'imageData': data.get('imageData', ''),
                'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ')
            }
            messages.append(msg)
            # Keep only last 100 messages
            if len(messages) > 100:
                messages = messages[-100:]
            self._send_json({'success': True, 'id': msg_id})

        elif path == '/api/poll':
            last_id = data.get('lastId', 0)
            new_messages = [m for m in messages if m['id'] > last_id]

            # Update user's last seen
            if user_id in users:
                users[user_id]['lastSeen'] = time.time()

            # Clean up inactive users (30 seconds timeout)
            current_time = time.time()
            removed_users = []
            for uid, user in list(users.items()):
                if current_time - user['lastSeen'] > 30:
                    removed_users.append(user)
                    del users[uid]

            # Add leave messages
            for user in removed_users:
                msg_id = int(time.time() * 1000)
                messages.append({
                    'id': msg_id,
                    'type': 'system',
                    'content': f"{user['username']} 离开聊天室",
                    'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ')
                })

            self._send_json({
                'messages': new_messages,
                'users': list(users.values()),
                'typing': None
            })

        elif path == '/api/typing':
            self._send_json({'success': True})

        elif path == '/api/typing_done':
            self._send_json({'success': True})

        elif path == '/api/leave':
            if user_id in users:
                username = users[user_id]['username']
                del users[user_id]
                msg_id = int(time.time() * 1000)
                messages.append({
                    'id': msg_id,
                    'type': 'system',
                    'content': f'{username} 离开聊天室',
                    'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ')
                })
            self._send_json({'success': True})

        else:
            self.send_error(404)


def get_local_ips():
    """Get all local IP addresses."""
    ips = []
    try:
        import socket
        hostname = socket.gethostname()
        ip = socket.gethostbyname(hostname)
        if ip and not ip.startswith('127.'):
            ips.append(ip)
    except:
        pass

    # Try to get more IPs
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(('10.255.255.255', 1))
            ip = s.getsockname()[0]
            if ip not in ips and not ip.startswith('127.'):
                ips.insert(0, ip)
        except:
            pass
        finally:
            s.close()
    except:
        pass

    return ips


def main():
    """Start the chat server."""
    global PORT

    if len(sys.argv) > 1:
        PORT = int(sys.argv[1])

    # Allow address reuse
    socketserver.ThreadingTCPServer.allow_reuse_address = True

    httpd = None
    original_port = PORT

    # Try ports until one works
    while PORT < original_port + 100:
        try:
            httpd = socketserver.ThreadingTCPServer((HOST, PORT), ChatHandler)
            break
        except OSError as e:
            if e.errno == 48:  # Address already in use
                print(f'  端口 {PORT} 被占用，尝试 {PORT + 1}...')
                PORT += 1
            else:
                raise

    if httpd is None:
        print('错误: 无法找到可用端口')
        sys.exit(1)

    ips = get_local_ips()

    print('\n' + '=' * 52)
    print('  聊天服务器已启动')
    print('=' * 52)
    print(f'  本机访问: http://localhost:{PORT}')
    for ip in ips:
        print(f'  局域网:   http://{ip}:{PORT}')
    print('=' * 52)
    print('\n  按 Ctrl+C 停止服务器\n')
    sys.stdout.flush()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n\n服务器已停止')
        httpd.shutdown()
        sys.exit(0)


if __name__ == '__main__':
    main()
