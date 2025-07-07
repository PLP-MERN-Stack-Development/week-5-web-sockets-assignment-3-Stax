// client/src/App.jsx
import React, { useState, useEffect, useRef } from 'react'; // Added useRef for scroll
import io from 'socket.io-client';
import { PaperAirplaneIcon, UserGroupIcon, ChatBubbleLeftRightIcon, UserIcon } from '@heroicons/react/24/solid';

// The server URL. In a real app, this would be an environment variable.
const SOCKET_SERVER_URL = 'http://localhost:5000';

// Initialize the socket connection outside the component to prevent re-initialization on re-renders
const socket = io(SOCKET_SERVER_URL);

function App() {
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [usersInRoom, setUsersInRoom] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [selectedPrivateChatUser, setSelectedPrivateChatUser] = useState(null); // For private messaging

  // Ref for auto-scrolling to the bottom of the chat messages
  const messagesEndRef = useRef(null);

  // Function to scroll to the bottom of the chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Effect for handling Socket.io events
  useEffect(() => {
    // Connect to the server
    socket.on('connect', () => {
      console.log('Connected to server with ID:', socket.id);
    });

    // Handle incoming messages
    socket.on('message', (msg) => {
      // Always add the message to the state without filtering here
      setMessages((prevMessages) => [...prevMessages, msg]);
      // Mark messages as read when received and displayed
      // For private messages, mark as read if it's from someone else to you
      // For public messages, mark as read if it's from someone else in your current room
      if (msg.isPrivate && msg.senderId !== socket.id) {
        socket.emit('messageRead', { messageId: msg.id, roomId: msg.room }); // roomId for private is just a placeholder
      } else if (!msg.isPrivate && msg.username !== username && msg.room === room) {
        socket.emit('messageRead', { messageId: msg.id, roomId: msg.room });
      }
    });

    // Handle updates to messages (e.g., read receipts)
    socket.on('messageUpdated', (updatedMsg) => {
      setMessages((prevMessages) =>
        prevMessages.map((msg) => (msg.id === updatedMsg.id ? updatedMsg : msg))
      );
    });

    // Handle list of users in the current room
    socket.on('roomUsers', (users) => {
      setUsersInRoom(users);
    });

    // Handle typing indicators
    socket.on('typing', (typerUsername) => {
      setTypingUsers((prevTypingUsers) => {
        if (!prevTypingUsers.includes(typerUsername)) {
          return [...prevTypingUsers, typerUsername];
        }
        return prevTypingUsers;
      });
    });

    // Handle stop typing indicators
    socket.on('stopTyping', (typerUsername) => {
      setTypingUsers((prevTypingUsers) =>
        prevTypingUsers.filter((user) => user !== typerUsername)
      );
    });

    // Handle existing messages for a room when joining
    socket.on('roomMessages', (roomMessages) => {
      // When joining a room, we should replace the current messages with the room's history
      // and then add any private messages that might have been received while in another context.
      // For simplicity here, we'll just set room messages. A more robust solution
      // would merge or manage distinct message lists.
      setMessages(roomMessages);
      // Mark all existing messages as read when loaded
      roomMessages.forEach(msg => {
        if (msg.username !== username && !msg.readBy.includes(socket.id)) {
          socket.emit('messageRead', { messageId: msg.id, roomId: msg.room });
        }
      });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsLoggedIn(false); // Reset login state on disconnect
      setMessages([]);
      setUsersInRoom([]);
      setTypingUsers([]);
      setSelectedPrivateChatUser(null); // Clear private chat selection
    });

    // Clean up on component unmount
    return () => {
      socket.off('connect');
      socket.off('message');
      socket.off('messageUpdated');
      socket.off('roomUsers');
      socket.off('typing');
      socket.off('stopTyping');
      socket.off('roomMessages');
      socket.off('disconnect');
    };
  }, [username, room]); // Re-run effect if username or room changes

  // Effect to scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages, selectedPrivateChatUser]); // Scroll when messages or chat user changes

  // Function to handle joining a chat room
  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (username && room) {
      socket.emit('joinRoom', { username, room });
      setIsLoggedIn(true);
      // Do not clear messages here; let the 'roomMessages' event handle it
      setSelectedPrivateChatUser(null); // Ensure no private chat is active
    } else {
      console.log('Please enter both username and room.');
    }
  };

  // Function to handle sending a message
  const handleSendMessage = (e) => {
    e.preventDefault();
    if (message.trim()) {
      if (selectedPrivateChatUser) {
        // Send private message
        socket.emit('privateMessage', {
          recipientId: selectedPrivateChatUser.id,
          message: message.trim()
        });
      } else {
        // Send public room message
        socket.emit('chatMessage', message.trim());
      }
      setMessage('');
      socket.emit('stopTyping'); // Stop typing after sending message
    }
  };

  // Handle typing status
  const handleTyping = (e) => {
    setMessage(e.target.value);
    if (e.target.value.length > 0) {
      socket.emit('typing');
    } else {
      socket.emit('stopTyping');
    }
  };

  // Function to start a private chat
  const startPrivateChat = (user) => {
    // Only set the selected user. The message filtering happens in the render logic.
    setSelectedPrivateChatUser(user);
    console.log(`Starting private chat with ${user.username}`);
  };

  // Function to switch back to room chat
  const switchToRoomChat = () => {
    setSelectedPrivateChatUser(null);
    // When switching back to room chat, we might want to re-fetch room messages
    // or ensure the messages state is correctly populated with public messages.
    // For now, simply setting selectedPrivateChatUser to null will make the JSX filter
    // show public messages again.
    // Re-emitting joinRoom here would re-fetch messages, but might cause flicker.
    // socket.emit('joinRoom', { username, room }); // Only if you want to explicitly re-fetch room history
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-full max-w-7xl mx-auto p-4 bg-gray-100 rounded-lg shadow-xl">
      {!isLoggedIn ? (
        // Login/Join Room Form
        <div className="flex flex-col items-center justify-center w-full h-full bg-white rounded-lg p-8 shadow-md">
          <h1 className="text-4xl font-extrabold text-blue-600 mb-8">Join Chat</h1>
          <form onSubmit={handleJoinRoom} className="w-full max-w-sm space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                Username
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter your username"
                required
              />
            </div>
            <div>
              <label htmlFor="room" className="block text-sm font-medium text-gray-700 mb-2">
                Room Name
              </label>
              <input
                type="text"
                id="room"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter room name (e.g., General, Sports)"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-150 ease-in-out"
            >
              Join Chat
            </button>
          </form>
        </div>
      ) : (
        // Chat Interface
        <div className="flex flex-col md:flex-row w-full h-full bg-white rounded-lg shadow-md overflow-hidden">
          {/* Left Panel: Users in Room / Private Chat Selector */}
          <div className="w-full md:w-1/4 bg-blue-700 text-white p-4 flex flex-col border-r border-blue-600">
            <h2 className="text-2xl font-bold mb-4 flex items-center">
              <UserGroupIcon className="h-6 w-6 mr-2" />
              Users in {room}
            </h2>
            <div className="flex-grow overflow-y-auto custom-scrollbar">
              {usersInRoom.map((user) => (
                <div
                  key={user.id}
                  className={`flex items-center p-2 rounded-md mb-2 cursor-pointer transition-colors duration-200
                              ${user.id === socket.id ? 'bg-blue-600' : 'hover:bg-blue-600'}
                              ${selectedPrivateChatUser && selectedPrivateChatUser.id === user.id ? 'bg-blue-800' : ''}`}
                  onClick={() => startPrivateChat(user)}
                >
                  <UserIcon className="h-5 w-5 mr-2" />
                  <span>{user.username} {user.id === socket.id && '(You)'}</span>
                  {/* Display user's socket ID for identification in multi-user context */}
                  <span className="ml-auto text-xs opacity-70">ID: {user.id.substring(0, 4)}...</span>
                </div>
              ))}
            </div>
            {selectedPrivateChatUser && (
              <button
                onClick={switchToRoomChat}
                className="mt-4 bg-blue-600 hover:bg-blue-800 text-white py-2 px-4 rounded-md transition duration-150 ease-in-out flex items-center justify-center"
              >
                <ChatBubbleLeftRightIcon className="h-5 w-5 mr-2" />
                Back to Room Chat
              </button>
            )}
          </div>

          {/* Right Panel: Chat Messages */}
          <div className="flex-1 flex flex-col p-4">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">
              <ChatBubbleLeftRightIcon className="h-6 w-6 mr-2 text-blue-600" />
              {selectedPrivateChatUser ? `Private Chat with ${selectedPrivateChatUser.username}` : `Room: ${room}`}
            </h2>
            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
              {messages
                .filter(msg => {
                  if (selectedPrivateChatUser) {
                    // Show only private messages relevant to the selected user
                    return msg.isPrivate && (
                      (msg.senderId === socket.id && msg.recipientId === selectedPrivateChatUser.id) ||
                      (msg.senderId === selectedPrivateChatUser.id && msg.recipientId === socket.id)
                    );
                  } else {
                    // Show only public room messages
                    return !msg.isPrivate && msg.room === room;
                  }
                })
                .map((msg, index) => (
                  <div
                    key={index}
                    className={`flex ${msg.username === username ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[70%] p-3 rounded-lg shadow-md relative
                                  ${msg.username === username ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}
                    >
                      <div className="font-semibold text-sm mb-1">
                        {msg.isPrivate ? (
                          <span className="text-purple-200">
                            {msg.senderId === socket.id ? 'You' : msg.username} (Private)
                          </span>
                        ) : (
                          msg.username
                        )}
                      </div>
                      <div>{msg.text}</div>
                      <div className="text-xs opacity-75 mt-1 flex justify-between items-center">
                        <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                        {/* Read receipts for your own messages */}
                        {msg.username === username && (
                          <span className="ml-2 text-xs">
                            {msg.isPrivate ? (
                              // For private messages, check if recipient has read
                              msg.readBy && msg.readBy.includes(selectedPrivateChatUser?.id) ? (
                                <span title="Read by recipient">✓✓</span>
                              ) : (
                                <span title="Delivered">✓</span>
                              )
                            ) : (
                              // For public messages, check if others in room have read
                              msg.readBy && msg.readBy.length > 1 ? (
                                <span title={`Read by ${msg.readBy.length - 1} other(s)`}>✓✓</span>
                              ) : (
                                <span title="Delivered">✓</span>
                              )
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              <div ref={messagesEndRef} /> {/* For auto-scroll */}
            </div>

            {/* Typing indicator */}
            {typingUsers.length > 0 && (
              <div className="text-sm text-gray-600 mt-2">
                {typingUsers.join(', ')} {typingUsers.length > 1 ? 'are' : 'is'} typing...
              </div>
            )}

            {/* Message Input Form */}
            <form onSubmit={handleSendMessage} className="flex mt-4 space-x-3">
              <input
                type="text"
                value={message}
                onChange={handleTyping}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-full shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder={selectedPrivateChatUser ? `Message ${selectedPrivateChatUser.username}...` : "Type a message..."}
              />
              <button
                type="submit"
                className="bg-blue-600 text-white p-3 rounded-full hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-150 ease-in-out flex items-center justify-center"
              >
                <PaperAirplaneIcon className="h-5 w-5 rotate-90" />
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
