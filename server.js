const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

// ========== Database Setup ==========
let dbReady = false;
let MessageModel = null;
let useMongo = false;

// Try MongoDB first
const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
  try {
    const mongoose = require('mongoose');
    const messageSchema = new mongoose.Schema({
      roomId: { type: String, default: 'general' },
      userId: { type: String, required: true },
      userName: { type: String, required: true },
      type: { type: String, default: 'text' },
      content: { type: String },
      fileUrl: { type: String },
      fileName: { type: String },
      fileSize: { type: Number },
      mimeType: { type: String },
      clientId: { type: String },
      createdAt: { type: Date, default: Date.now }
    });
    messageSchema.index({ roomId: 1, createdAt: -1 });
    MessageModel = mongoose.model('Message', messageSchema);

    mongoose.connect(MONGODB_URI)
      .then(() => {
        console.log('[DB] MongoDB connected');
        dbReady = true;
        useMongo = true;
      })
      .catch(err => {
        console.error('[DB] MongoDB failed, falling back to JSON:', err.message);
        initJsonDb();
      });
  } catch (e) {
    console.error('[DB] Mongoose not available, using JSON:', e.message);
    initJsonDb();
  }
} else {
  initJsonDb();
}

// JSON fallback
const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const MAX_MESSAGES = 5000;
let jsonMessages = [];

function initJsonDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      jsonMessages = JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    }
  } catch (e) { console.error('[DB] JSON load error:', e.message); }
  dbReady = true;
  console.log('[DB] JSON database ready (' + jsonMessages.length + ' messages)');
}

function saveJsonMessages() {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(jsonMessages, null, 0));
  } catch (e) { console.error('[DB] JSON save error:', e.message); }
}

// DB helpers
function toIsoString(val) {
  if (!val) return new Date().toISOString();
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

async function saveMessage(msg) {
  if (useMongo && MessageModel) {
    const doc = new MessageModel(msg);
    await doc.save();
    return { ...msg, id: doc._id.toString(), createdAt: toIsoString(doc.createdAt) };
  } else {
    const entry = { ...msg, id: Date.now(), createdAt: new Date().toISOString() };
    jsonMessages.push(entry);
    if (jsonMessages.length > MAX_MESSAGES) jsonMessages = jsonMessages.slice(-MAX_MESSAGES);
    saveJsonMessages();
    return entry;
  }
}

async function getMessages(roomId, before, limit) {
  if (useMongo && MessageModel) {
    const query = { roomId };
    if (before) query._id = { $lt: before };
    const docs = await MessageModel.find(query).sort({ createdAt: -1 }).limit(limit).lean();
    return docs.map(d => ({
      id: d._id.toString(),
      roomId: d.roomId,
      userId: d.userId,
      userName: d.userName,
      type: d.type,
      content: d.content,
      fileUrl: d.fileUrl,
      fileName: d.fileName,
      fileSize: d.fileSize,
      mimeType: d.mimeType,
      clientId: d.clientId,
      createdAt: toIsoString(d.createdAt)
    })).reverse();
  } else {
    let filtered = jsonMessages.filter(m => m.roomId === roomId);
    if (before) filtered = filtered.filter(m => m.id < before);
    return filtered.slice(-limit);
  }
}

async function getRecentMessages(roomId, limit) {
  if (useMongo && MessageModel) {
    const docs = await MessageModel.find({ roomId }).sort({ createdAt: -1 }).limit(limit).lean();
    return docs.map(d => ({
      id: d._id.toString(),
      roomId: d.roomId,
      userId: d.userId,
      userName: d.userName,
      type: d.type,
      content: d.content,
      fileUrl: d.fileUrl,
      fileName: d.fileName,
      fileSize: d.fileSize,
      mimeType: d.mimeType,
      clientId: d.clientId,
      createdAt: toIsoString(d.createdAt)
    })).reverse();
  } else {
    return jsonMessages.filter(m => m.roomId === roomId).slice(-limit);
  }
}

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
app.get('/api/messages', async (req, res) => {
  try {
    const roomId = req.query.roomId || 'general';
    const before = req.query.before || null;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const messages = await getMessages(roomId, before, limit);
    res.json({ success: true, messages });
  } catch (err) {
    console.error('[API] Get messages error:', err);
    res.status(500).json({ success: false, error: '数据库错误' });
  }
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

  socket.on('join', async ({ userId, userName }) => {
    const safeName = sanitizeHtml(userName?.slice(0, 20)) || `访客${socket.id.slice(0, 6)}`;
    const safeUserId = String(userId || `guest-${socket.id.slice(0, 8)}`).slice(0, 50);

    users.set(socket.id, {
      socketId: socket.id,
      userId: safeUserId,
      userName: safeName,
      joinedAt: new Date().toISOString()
    });

    // Send recent messages
    try {
      const recent = await getRecentMessages('general', 100);
      socket.emit('messageHistory', recent);
    } catch (err) {
      console.error('[Socket] Load history error:', err);
      socket.emit('messageHistory', []);
    }

    // Notify
    socket.broadcast.emit('userJoined', {
      userName: safeName,
      userCount: getOnlineUsers().length
    });

    io.emit('userList', getOnlineUsers());
  });

  socket.on('sendMessage', async ({ userId, userName, type, content, fileUrl, fileName, fileSize, mimeType, clientId }, callback) => {
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

    try {
      const msgData = {
        roomId: 'general',
        userId,
        userName,
        type: safeType,
        content: safeContent,
        fileUrl: fileUrl || null,
        fileName: safeFileName,
        fileSize: fileSize || null,
        mimeType: mimeType || null,
        clientId: clientId || null
      };

      const saved = await saveMessage(msgData);

      const message = {
        id: saved.id,
        clientId: saved.clientId,
        roomId: saved.roomId,
        userId: saved.userId,
        userName: saved.userName,
        type: saved.type,
        content: saved.content,
        fileUrl: saved.fileUrl,
        fileName: saved.fileName,
        fileSize: saved.fileSize,
        mimeType: saved.mimeType,
        createdAt: saved.createdAt
      };

      io.emit('newMessage', message);
      if (typeof callback === 'function') callback({ success: true });
    } catch (err) {
      console.error('[Socket] Save message error:', err);
      socket.emit('messageError', { error: '消息保存失败' });
      if (typeof callback === 'function') callback({ error: '保存失败' });
    }
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
  console.log(`[Server] Storage: ${useMongo ? 'MongoDB' : 'JSON file'}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}\n`);
});
