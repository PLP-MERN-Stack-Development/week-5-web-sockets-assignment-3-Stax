// server/server.js

// Load environment variables from .env file (if present)
require('dotenv').config();

// Import necessary modules
const express = require('express'); // Express.js for handling HTTP requests
const http = require('http');     // HTTP module for creating a server
const { Server } = require('socket.io'); // Socket.io for real-time bidirectional communication
const cors = require('cors');     // CORS for enabling cross-origin requests

// Initialize Express app
const app = express();

// Use CORS middleware to allow requests from the client-side
// This is crucial for development where client and server might be on different ports
app.use(cors());

// Create an HTTP server using the Express app
const server = http.createServer(app);

// Initialize Socket.io server
// The 'cors' option here allows the Socket.io server to accept connections
// from the specified origin (your React client's development server).
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // <--- CHANGE THIS TO http://localhost:3000
    methods: ["GET", "POST"]
  }
});

// In-memory data stores for simplicity.
// In a real application, you would use a database (e.g., MongoDB, PostgreSQL).
const users = new Map(); // Stores active users: Map<socket.id, { username, room, id }>
const rooms = new Map(); // Stores chat rooms: Map<roomId, { name, messages: [], users: [] }>
const messages = []; // Stores all messages for a general chat (or can be per room)

// --- Socket.io Event Handling ---
// This section defines how the server reacts to different Socket.io events.

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle 'joinRoom' event when a user wants to join a specific chat room
  socket.on('joinRoom', ({ username, room }) => {
    // Leave any previously joined rooms
    if (users.has(socket.id)) {
      const prevUser = users.get(socket.id);
      socket.leave(prevUser.room);
      // Remove user from previous room's user list
      if (rooms.has(prevUser.room)) {
        const prevRoomData = rooms.get(prevUser.room);
        prevRoomData.users = prevRoomData.users.filter(u => u.id !== socket.id);
        if (prevRoomData.users.length === 0) {
          rooms.delete(prevUser.room); // Delete room if no users left
        } else {
          io.to(prevUser.room).emit('roomUsers', prevRoomData.users);
        }
      }
    }

    // Store user information
    const user = { id: socket.id, username, room };
    users.set(socket.id, user);
    socket.join(room); // Join the specified room

    // Initialize room if it doesn't exist
    if (!rooms.has(room)) {
      rooms.set(room, { name: room, messages: [], users: [] });
    }
    const currentRoom = rooms.get(room);
    currentRoom.users.push(user);

    // Emit a welcome message to the user who joined
    socket.emit('message', {
      username: 'ChatBot',
      text: `Welcome to the ${room} chat room!`,
      timestamp: new Date().toISOString()
    });

    // Broadcast to other users in the room that a new user has joined
    socket.to(room).emit('message', {
      username: 'ChatBot',
      text: `${username} has joined the chat.`,
      timestamp: new Date().toISOString()
    });

    // Send updated list of users in the room to everyone in that room
    io.to(room).emit('roomUsers', currentRoom.users);

    // Send existing messages for the room to the newly joined user
    socket.emit('roomMessages', currentRoom.messages);

    console.log(`${username} (${socket.id}) joined room: ${room}`);
  });

  // Handle 'chatMessage' event when a user sends a message
  socket.on('chatMessage', (msg) => {
    const user = users.get(socket.id);
    if (user) {
      const message = {
        id: Date.now(), // Unique ID for read receipts
        username: user.username,
        text: msg,
        room: user.room,
        timestamp: new Date().toISOString(),
        readBy: [user.id] // Mark as read by sender initially
      };
      // Store message in the room's message history
      if (rooms.has(user.room)) {
        rooms.get(user.room).messages.push(message);
      }
      // Emit the message to everyone in the same room
      io.to(user.room).emit('message', message);
      console.log(`Message from ${user.username} in ${user.room}: ${msg}`);
    }
  });

  // Handle 'typing' event when a user starts typing
  socket.on('typing', () => {
    const user = users.get(socket.id);
    if (user) {
      // Broadcast to others in the room that this user is typing
      socket.to(user.room).emit('typing', user.username);
    }
  });

  // Handle 'stopTyping' event when a user stops typing
  socket.on('stopTyping', () => {
    const user = users.get(socket.id);
    if (user) {
      // Broadcast to others in the room that this user has stopped typing
      socket.to(user.room).emit('stopTyping', user.username);
    }
  });

  // Handle 'messageRead' event for read receipts
  socket.on('messageRead', ({ messageId, roomId }) => {
    const user = users.get(socket.id);
    if (user && rooms.has(roomId)) {
      const roomMessages = rooms.get(roomId).messages;
      const messageToUpdate = roomMessages.find(msg => msg.id === messageId);

      if (messageToUpdate && !messageToUpdate.readBy.includes(user.id)) {
        messageToUpdate.readBy.push(user.id);
        // Emit updated message to all clients in the room to reflect read status
        io.to(roomId).emit('messageUpdated', messageToUpdate);
        console.log(`Message ${messageId} in room ${roomId} read by ${user.username}`);
      }
    }
  });

  // Handle 'privateMessage' event for private messaging
  socket.on('privateMessage', ({ recipientId, message }) => {
    const sender = users.get(socket.id);
    const recipient = users.get(recipientId);

    if (sender && recipient) {
      const privateMsg = {
        id: Date.now(),
        username: sender.username,
        text: message,
        isPrivate: true,
        senderId: sender.id,
        recipientId: recipient.id,
        timestamp: new Date().toISOString(),
        readBy: [sender.id]
      };
      // Send message to the recipient
      io.to(recipientId).emit('message', privateMsg);
      // Also send to the sender's own socket to display in their chat
      socket.emit('message', privateMsg);
      console.log(`Private message from ${sender.username} to ${recipient.username}: ${message}`);
    } else {
      socket.emit('message', {
        username: 'ChatBot',
        text: 'Recipient not found or offline for private message.',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Handle 'disconnect' event when a user leaves
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      // Remove user from the active users map
      users.delete(socket.id);

      // Remove user from the room's user list
      if (rooms.has(user.room)) {
        const currentRoom = rooms.get(user.room);
        currentRoom.users = currentRoom.users.filter(u => u.id !== socket.id);
        // If no users left in the room, delete the room (optional, depending on requirements)
        if (currentRoom.users.length === 0) {
          rooms.delete(user.room);
          console.log(`Room ${user.room} is now empty and deleted.`);
        } else {
          // Notify others in the room that the user has left
          io.to(user.room).emit('message', {
            username: 'ChatBot',
            text: `${user.username} has left the chat.`,
            timestamp: new Date().toISOString()
          });
          // Update user list for the room
          io.to(user.room).emit('roomUsers', currentRoom.users);
        }
      }
      console.log(`User disconnected: ${user.username} (${socket.id})`);
    } else {
      console.log(`User disconnected: ${socket.id} (unknown user)`);
    }
  });
});

// Define a simple root route for the server
app.get('/', (req, res) => {
  res.send('Socket.io chat server is running!');
});

// Set the port for the server to listen on
const PORT = process.env.PORT || 5000;

// Start the server
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
