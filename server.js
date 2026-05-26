const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  maxHttpBufferSize: 5 * 1024 * 1024 // 5MB for image uploads
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Explicit root route to ensure index.html is served
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Store connected users
const users = new Map();
const messageHistory = [];
const MAX_HISTORY = 100;

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // User joins
  socket.on('join', (username) => {
    const user = {
      id: socket.id,
      username: username || `用户${socket.id.slice(0, 6)}`,
      joinTime: new Date()
    };
    users.set(socket.id, user);
    socket.username = user.username;

    // Send message history
    socket.emit('messageHistory', messageHistory);

    // Notify others
    socket.broadcast.emit('userJoined', {
      username: user.username,
      userCount: users.size
    });

    // Update user list for everyone
    io.emit('userList', Array.from(users.values()));
  });

  // Handle text message
  socket.on('sendMessage', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const message = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      type: 'text',
      username: user.username,
      content: data.content,
      timestamp: new Date().toISOString()
    };

    messageHistory.push(message);
    if (messageHistory.length > MAX_HISTORY) {
      messageHistory.shift();
    }

    io.emit('newMessage', message);
  });

  // Handle image message
  socket.on('sendImage', (data) => {
    const user = users.get(socket.id);
    if (!user) return;

    const message = {
      id: Date.now() + Math.random().toString(36).substr(2, 9),
      type: 'image',
      username: user.username,
      imageData: data.imageData,
      timestamp: new Date().toISOString()
    };

    messageHistory.push(message);
    if (messageHistory.length > MAX_HISTORY) {
      messageHistory.shift();
    }

    io.emit('newMessage', message);
  });

  // Handle typing indicator
  socket.on('typing', (isTyping) => {
    const user = users.get(socket.id);
    if (!user) return;

    socket.broadcast.emit('userTyping', {
      username: user.username,
      isTyping
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      socket.broadcast.emit('userLeft', {
        username: user.username,
        userCount: users.size
      });
      io.emit('userList', Array.from(users.values()));
    }
    console.log('Disconnected:', socket.id);
  });
});

// Get all local IP addresses
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

server.listen(PORT, HOST, () => {
  const ips = getLocalIPs();
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║          聊天服务器已启动                ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  本机访问: http://localhost:${PORT}        ║`);
  ips.forEach(ip => {
    const padding = ' '.repeat(Math.max(0, 15 - ip.length));
    console.log(`║  局域网:   http://${ip}:${PORT}${padding}  ║`);
  });
  console.log('╚══════════════════════════════════════════╝');
  console.log('\n将局域网地址分享给同事即可一起聊天\n');
});
