const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

// ========== JSON Database ==========
const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const MAX_MESSAGES = 5000;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function loadMessages() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    }
  } catch (e) { console.error('[DB] Load error:', e.message); }
  return [];
}

function saveMessages(messages) {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 0));
  } catch (e) { console.error('[DB] Save error:', e.message); }
}

let messages = loadMessages();

// ========== Config ==========
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_MESSAGE_LENGTH = 500;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  maxHttpBufferSize: 1 * 1024 * 1024,
  cors: { origin: '*' }
});

// ========== Middleware ==========
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// ========== File Upload ==========
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^\x00-\x7F]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const blockedExts = ['.exe', '.bat', '.cmd', '.sh', '.php', '.jsp', '.asp', '.dll', '.scr', '.com', '.vbs', '.js', '.jar'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blockedExts.includes(ext)) return cb(new Error('不安全的文件类型'));
    cb(null, true);
  }
});

// ========== Helpers ==========
function sanitizeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ========== Routes ==========
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get messages with pagination
app.get('/api/messages', (req, res) => {
  const roomId = req.query.roomId || 'general';
  const before = req.query.before ? parseInt(req.query.before) : null;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  let filtered = messages.filter(m => m.roomId === roomId);
  if (before) filtered = filtered.filter(m => m.id < before);

  const result = filtered.slice(-limit);
  res.json({ success: true, messages: result });
});

// File upload
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '没有文件' });

    const isImage = req.file.mimetype.startsWith('image/');
    const fileUrl = `/uploads/${req.file.filename}`;

    res.json({
      success: true,
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      isImage
    });
  } catch (err) {
    console.error('[API] Upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Error handler for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, error: `文件大小超过 ${MAX_FILE_SIZE / 1024 / 1024}MB 限制` });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err) return res.status(400).json({ success: false, error: err.message });
  next();
});

// ========== Socket.IO ==========
const users = new Map();

function getOnlineUsers() {
  const result = [];
  const seen = new Set();
  for (const u of users.values()) {
    if (!seen.has(u.userId)) {
      seen.add(u.userId);
      result.push({ userId: u.userId, userName: u.userName });
    }
  }
  return result;
}

io.on('connection', (socket) => {
  console.log('[Socket] Connected:', socket.id);

  socket.on('join', ({ userId, userName }) => {
    const safeName = sanitizeHtml(userName?.slice(0, 20)) || `用户${socket.id.slice(0, 6)}`;
    const safeUserId = String(userId || `guest-${socket.id.slice(0, 8)}`).slice(0, 50);

    users.set(socket.id, {
      socketId: socket.id,
      userId: safeUserId,
      userName: safeName,
      joinedAt: new Date().toISOString()
    });

    // Send recent messages
    const recent = messages.filter(m => m.roomId === 'general').slice(-100);
    socket.emit('messageHistory', recent);

    // Notify
    socket.broadcast.emit('userJoined', {
      userName: safeName,
      userCount: getOnlineUsers().length
    });

    io.emit('userList', getOnlineUsers());
  });

  socket.on('sendMessage', ({ userId, userName, type, content, fileUrl, fileName, fileSize, mimeType, clientId }, callback) => {
    const user = users.get(socket.id);
    if (!user) {
      if (typeof callback === 'function') callback({ error: '未登录' });
      return;
    }

    const safeType = ['text', 'image', 'file'].includes(type) ? type : 'text';
    const safeContent = safeType === 'text'
      ? sanitizeHtml(String(content || '').slice(0, MAX_MESSAGE_LENGTH))
      : (content || '');
    const safeFileName = fileName ? sanitizeHtml(String(fileName).slice(0, 255)) : null;

    const message = {
      id: Date.now(),
      clientId: clientId || null,
      roomId: 'general',
      userId,
      userName,
      type: safeType,
      content: safeContent,
      fileUrl: fileUrl || null,
      fileName: safeFileName,
      fileSize: fileSize || null,
      mimeType: mimeType || null,
      createdAt: new Date().toISOString()
    };

    messages.push(message);
    if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
    saveMessages(messages);

    io.emit('newMessage', message);
    if (typeof callback === 'function') callback({ success: true });
  });

  socket.on('typing', ({ userId, isTyping }) => {
    const user = users.get(socket.id);
    if (!user) return;
    socket.broadcast.emit('userTyping', { userId, userName: user.userName, isTyping });
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      socket.broadcast.emit('userLeft', {
        userName: user.userName,
        userCount: getOnlineUsers().length
      });
      io.emit('userList', getOnlineUsers());
    }
    console.log('[Socket] Disconnected:', socket.id);
  });
});

// ========== Start Server ==========
server.listen(PORT, HOST, () => {
  console.log(`\n[Server] Chat server running on http://localhost:${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}\n`);
});
