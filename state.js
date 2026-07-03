// state.js
// In-memory ephemeral state manager.
// ALL data lives here. When the process dies, everything vanishes. That is the point.

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Primary data stores
// ---------------------------------------------------------------------------

/** @type {Map<string, {id: string, name: string, color: string, roomIds: Set<string>, joinedAt: number}>} */
const users = new Map();

/** @type {Map<string, {code: string, name: string, ownerId: string|null, isPublic: boolean, description: string, category: string, channels: Map<string, {id: string, name: string, type: string, messages: Array}>, members: Set<string>, createdAt: number, destroyTimer: NodeJS.Timeout|null, isPersistent: boolean}>} */
const rooms = new Map();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOM_DESTROY_DELAY_MS = 0; // instant destruction for private rooms
const MAX_MESSAGES_PER_CHANNEL = 50;
const MAX_PINNED_MESSAGES = 50;
const ROOM_CODE_LENGTH = 6;

// Character names from the portrait/icon list for random anonymous names
const CHARACTER_NAMES = [
  'Knight', 'Warrior', 'Viking', 'Jarl', 'Samurai', 'Ronin', 'Archer',
  'Barbarian', 'Templar', 'Alchemist', 'Rogue', 'Priest', 'Lord',
  'Captain', 'Scout', 'Shinobi', 'Sage', 'Pharaoh', 'Chief',
  'Princess', 'Queen', 'Amazon', 'Witch', 'Shaman', 'Maiden',
  'Elf Ranger', 'Elf Lord', 'Elf Scout', 'Elf Sage', 'Elf Mage',
  'Elf Hunter', 'Elf Guardian', 'Gnome Tinkerer', 'Gnome Sage',
  'Phoenix', 'Dragon', 'Griffin', 'Werewolf', 'Specter',
  'Golem', 'Spirit', 'Wraith', 'Stalker', 'Lurker'
];

const COLOR_PREFIXES = [
  'Red', 'Blue', 'Green', 'Gold', 'Silver', 'Shadow', 'Crimson',
  'Azure', 'Emerald', 'Violet', 'Ivory', 'Obsidian', 'Amber',
  'Scarlet', 'Cobalt', 'Jade', 'Frost', 'Iron', 'Ashen', 'Coral'
];

// 20 bright role colours (hex strings)
const BRIGHT_COLORS = [
  '#E74C3C', // red
  '#E91E63', // pink
  '#9B59B6', // purple
  '#8E44AD', // deep purple
  '#3498DB', // blue
  '#2196F3', // light blue
  '#1ABC9C', // teal
  '#00BCD4', // cyan
  '#2ECC71', // green
  '#4CAF50', // mid green
  '#8BC34A', // lime
  '#CDDC39', // yellow-green
  '#F1C40F', // yellow
  '#FFC107', // amber
  '#FF9800', // orange
  '#FF5722', // deep orange
  '#E67E22', // carrot
  '#FD79A8', // pastel pink
  '#6C5CE7', // indigo
  '#00CEC9', // robin egg
];

// Characters used for random generation
const ALPHANUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // removed ambiguous 0/O, 1/I

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

// Strip control chars (except \n), zero-width chars.
// NOTE: No HTML entity encoding — all client rendering uses React text nodes
// which auto-escape content. HTML encoding here caused double-encoding
// (e.g. '&' → '&amp;' on server, then React renders literal '&amp;' on screen).
function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  var cleaned = str.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
  // Strip HTML tags to prevent injection in any rendering path
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  // Strip non-standard characters — allow alphanumeric, common punctuation, newlines
  cleaned = cleaned.replace(/[^a-zA-Z0-9 _\-!?,.'":;\n@#&()\/<>+=$/\\]/g, '');
  return cleaned.trim();
}

function sanitizeName(str) {
  if (typeof str !== 'string') return '';
  // Allow only alphanumeric, spaces, underscores, and hyphens
  return str.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
}

// ---------------------------------------------------------------------------
// Helper generators
// ---------------------------------------------------------------------------

function randomAlphanum(length) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += ALPHANUM[bytes[i] % ALPHANUM.length];
  }
  return result;
}

function generateAnonName() {
  var color = COLOR_PREFIXES[Math.floor(Math.random() * COLOR_PREFIXES.length)];
  var character = CHARACTER_NAMES[Math.floor(Math.random() * CHARACTER_NAMES.length)];
  var number = Math.floor(Math.random() * 99) + 1;
  var name = color + ' ' + character + ' ' + number;
  return name.slice(0, 20);
}

function generateRoomCode() {
  let code;
  let attempts = 0;
  do {
    code = randomAlphanum(ROOM_CODE_LENGTH);
    attempts++;
    if (attempts > 1000) {
      throw new Error('Failed to generate unique room code after 1000 attempts');
    }
  } while (rooms.has(code));
  return code;
}

function generateId() {
  return uuidv4();
}

function getRandomColor() {
  return BRIGHT_COLORS[Math.floor(Math.random() * BRIGHT_COLORS.length)];
}

function generateTag(source) {
  if (!source || typeof source !== 'string') return '0000';
  // HMAC-based tag: deterministic but not reversible to the account key
  var hmac = crypto.createHmac('sha256', process.env.TAG_HMAC_SECRET || 'bosscord-tag-v2').update(source).digest();
  var tag = '';
  for (var i = 0; i < 4; i++) {
    tag += ALPHANUM[hmac[i] % ALPHANUM.length];
  }
  return tag;
}

// ---------------------------------------------------------------------------
// User operations
// ---------------------------------------------------------------------------

function createUser(socketId, customName) {
  const name = (typeof customName === 'string' && sanitizeName(customName).length > 0)
    ? sanitizeName(customName).slice(0, 20)
    : generateAnonName();

  const user = {
    id: socketId,
    name: name,
    color: getRandomColor(),
    tag: generateTag(socketId),
    roomIds: new Set(),
    joinedAt: Date.now(),
  };
  users.set(socketId, user);
  return user;
}

function removeUser(socketId) {
  const user = users.get(socketId);
  if (!user) return new Set();

  const previousRooms = new Set(user.roomIds);

  for (const roomCode of previousRooms) {
    leaveRoom(socketId, roomCode);
  }

  users.delete(socketId);
  return previousRooms;
}

// ---------------------------------------------------------------------------
// Room operations
// ---------------------------------------------------------------------------

/**
 * Create a new room with default channels.
 * @param {string} socketId - creator's socket id
 * @param {string} roomName
 * @param {object} [options]
 * @param {boolean} [options.isPublic=false]
 * @param {string} [options.description='']
 * @param {string} [options.category='']
 * @param {boolean} [options.isPersistent=false] - if true, room survives when empty
 */
function createRoom(socketId, roomName, options = {}) {
  const user = users.get(socketId);
  if (!user) return null;

  const code = generateRoomCode();
  const safeName = (typeof roomName === 'string' && sanitizeText(roomName).length > 0)
    ? sanitizeText(roomName).slice(0, 64)
    : 'Unnamed Room';

  const isPublic = !!options.isPublic;
  const encrypted = !isPublic && !!options.encrypted;
  const description = (typeof options.description === 'string')
    ? options.description.trim().slice(0, 200)
    : '';
  const category = (typeof options.category === 'string')
    ? options.category.trim().slice(0, 32)
    : '';
  const isPersistent = !!options.isPersistent;

  // Default channels
  const channels = new Map();

  const generalId = generateId();
  channels.set(generalId, {
    id: generalId,
    name: 'general',
    type: 'text',
    messages: [],
    pinnedMessages: [],
  });

  const voiceId = generateId();
  channels.set(voiceId, {
    id: voiceId,
    name: 'Voice',
    type: 'voice',
    messages: [],
    pinnedMessages: [],
  });

  const videoId = generateId();
  channels.set(videoId, {
    id: videoId,
    name: 'Video',
    type: 'video',
    messages: [],
    pinnedMessages: [],
  });

  const room = {
    code: code,
    name: safeName,
    ownerId: socketId,
    isPublic: isPublic,
    encrypted: encrypted,
    description: description,
    category: category,
    channels: channels,
    members: new Set([socketId]),
    createdAt: Date.now(),
    destroyTimer: null,
    isPersistent: isPersistent,
  };

  rooms.set(code, room);
  user.roomIds.add(code);

  return room;
}

/**
 * Create a persistent system room (no owner required, survives empty).
 * Used for default public rooms.
 */
function createSystemRoom(name, description, category) {
  const code = generateRoomCode();

  const channels = new Map();

  const generalId = generateId();
  channels.set(generalId, {
    id: generalId,
    name: 'general',
    type: 'text',
    messages: [],
    pinnedMessages: [],
  });

  const voiceId = generateId();
  channels.set(voiceId, {
    id: voiceId,
    name: 'Voice',
    type: 'voice',
    messages: [],
    pinnedMessages: [],
  });

  const videoId = generateId();
  channels.set(videoId, {
    id: videoId,
    name: 'Video',
    type: 'video',
    messages: [],
    pinnedMessages: [],
  });

  const room = {
    code: code,
    name: name,
    ownerId: null,
    isPublic: true,
    description: description || '',
    category: category || '',
    channels: channels,
    members: new Set(),
    createdAt: Date.now(),
    destroyTimer: null,
    isPersistent: true,
  };

  rooms.set(code, room);
  return room;
}

function joinRoom(socketId, roomCode) {
  const user = users.get(socketId);
  const room = rooms.get(roomCode);
  if (!user || !room) return null;

  // Clear pending destroy timer
  if (room.destroyTimer) {
    clearTimeout(room.destroyTimer);
    room.destroyTimer = null;
  }

  room.members.add(socketId);
  user.roomIds.add(roomCode);

  return room;
}

function leaveRoom(socketId, roomCode) {
  const user = users.get(socketId);
  const room = rooms.get(roomCode);

  if (user) {
    user.roomIds.delete(roomCode);
  }

  if (!room) return false;

  room.members.delete(socketId);

  // Transfer ownership if the owner left but members remain
  if (room.ownerId === socketId && room.members.size > 0) {
    room.ownerId = room.members.values().next().value;
  }
  // If owner leaves a persistent room and no one is left, clear owner
  if (room.ownerId === socketId && room.members.size === 0) {
    room.ownerId = null;
  }

  // Rooms persist until the daily wipe — no auto-deletion on empty
  // Clear messages in persistent (default) rooms when empty to save memory
  if (room.members.size === 0 && room.isPersistent) {
    for (const [, channel] of room.channels) {
      channel.messages = [];
      channel.pinnedMessages = [];
    }
    room.ownerId = null;
    console.log(`[state] Room "${room.name}" (${roomCode}) messages cleared -- empty`);
  }
  return true;
}

/**
 * Delete a room entirely. Returns the Set of member socketIds that were in the
 * room at the time of deletion (so the caller can notify/kick them).
 * Returns null if the room does not exist or is persistent (system rooms).
 */
function deleteRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  // Never delete persistent/system rooms
  if (room.isPersistent) return null;

  // Snapshot member IDs before removing
  const memberIds = new Set(room.members);

  // Remove room from every member's roomIds set
  for (const memberId of memberIds) {
    const u = users.get(memberId);
    if (u) {
      u.roomIds.delete(roomCode);
    }
  }

  // Delete the room from the map
  if (room.destroyTimer) {
    clearTimeout(room.destroyTimer);
  }
  rooms.delete(roomCode);

  return memberIds;
}

// ---------------------------------------------------------------------------
// Channel operations
// ---------------------------------------------------------------------------

function createChannel(roomCode, channelName, type) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  if (room.channels.size >= 50) return null;

  const safeName = sanitizeText(channelName).slice(0, 48) || (type === 'voice' ? 'Voice' : (type === 'video' ? 'Video' : 'text'));

  const safeType = (type === 'voice') ? 'voice' : (type === 'video') ? 'video' : 'text';

  const id = generateId();
  const channel = {
    id: id,
    name: safeName,
    type: safeType,
    messages: [],
    pinnedMessages: [],
  };

  room.channels.set(id, channel);
  return channel;
}

function addMessage(roomCode, channelId, socketId, content) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const channel = room.channels.get(channelId);
  if (!channel) return null;

  const user = users.get(socketId);
  if (!user) return null;

  const message = {
    id: generateId(),
    authorId: socketId,
    authorName: user.name,
    authorColor: user.color,
    authorAvatar: user.avatar || null,
    authorTag: user.tag || '????',
    content: (function() { var maxLen = 2000; try { var parsed = JSON.parse(content); if (parsed && parsed.e2e === true && typeof parsed.ct === 'string') maxLen = 4000; } catch(e) {} return sanitizeText(content).slice(0, maxLen); })(),
    timestamp: Date.now(),
    reactions: {},
  };

  channel.messages.push(message);

  if (channel.messages.length > MAX_MESSAGES_PER_CHANNEL) {
    channel.messages = channel.messages.slice(-MAX_MESSAGES_PER_CHANNEL);
  }

  return message;
}

function deleteMessage(roomCode, channelId, messageId) {
  const room = rooms.get(roomCode);
  if (!room) return false;

  const channel = room.channels.get(channelId);
  if (!channel) return false;

  const idx = channel.messages.findIndex(m => m.id === messageId);
  if (idx < 0) return false;

  channel.messages.splice(idx, 1);
  return true;
}

// ---------------------------------------------------------------------------
// Pinned message operations
// ---------------------------------------------------------------------------

function pinMessage(roomCode, channelId, messageId) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const channel = room.channels.get(channelId);
  if (!channel) return null;

  // Don't pin the same message twice
  if (channel.pinnedMessages.some(m => m.id === messageId)) return null;

  const message = channel.messages.find(m => m.id === messageId);
  if (!message) return null;

  // Copy the message object so pinned snapshot is independent
  const pinned = {
    id: message.id,
    authorId: message.authorId,
    authorName: message.authorName,
    authorColor: message.authorColor,
    authorAvatar: message.authorAvatar,
    authorTag: message.authorTag,
    content: message.content,
    timestamp: message.timestamp,
    pinnedAt: Date.now(),
  };

  channel.pinnedMessages.unshift(pinned);

  if (channel.pinnedMessages.length > MAX_PINNED_MESSAGES) {
    channel.pinnedMessages = channel.pinnedMessages.slice(0, MAX_PINNED_MESSAGES);
  }

  return pinned;
}

function unpinMessage(roomCode, channelId, messageId) {
  const room = rooms.get(roomCode);
  if (!room) return false;

  const channel = room.channels.get(channelId);
  if (!channel) return false;

  const idx = channel.pinnedMessages.findIndex(m => m.id === messageId);
  if (idx < 0) return false;

  channel.pinnedMessages.splice(idx, 1);
  return true;
}

function getPinnedMessages(roomCode, channelId) {
  const room = rooms.get(roomCode);
  if (!room) return [];

  const channel = room.channels.get(channelId);
  if (!channel) return [];

  return channel.pinnedMessages;
}

// ---------------------------------------------------------------------------
// Reaction helpers
// ---------------------------------------------------------------------------

/**
 * Find a message by ID within a specific channel.
 */
function findMessage(roomCode, channelId, messageId) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  const channel = room.channels.get(channelId);
  if (!channel) return null;
  return channel.messages.find(m => m.id === messageId) || null;
}

/**
 * Find a message by ID across all channels in a room.
 * Returns { message, channelId } or null.
 */
function findMessageInRoom(roomCode, messageId) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  for (const [chId, channel] of room.channels) {
    const msg = channel.messages.find(m => m.id === messageId);
    if (msg) return { message: msg, channelId: chId };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function getRoomByCode(code) {
  const room = rooms.get(code);
  if (!room) return null;

  const memberList = [];
  for (const memberId of room.members) {
    const u = users.get(memberId);
    if (u) {
      memberList.push({
        id: u.id,
        name: u.name,
        color: u.color,
        tag: u.tag || '????',
        avatar: u.avatar || null,
        joinedAt: u.joinedAt,
      });
    }
  }

  const channelList = [];
  for (const [, ch] of room.channels) {
    channelList.push({
      id: ch.id,
      name: ch.name,
      type: ch.type,
      messageCount: ch.messages.length,
    });
  }

  return {
    code: room.code,
    name: room.name,
    ownerId: room.ownerId,
    isPublic: room.isPublic,
    encrypted: !!room.encrypted,
    description: room.description,
    category: room.category,
    members: memberList,
    channels: channelList,
    createdAt: room.createdAt,
  };
}

/**
 * Get all public rooms (serialized for browsing).
 */
function getPublicRooms() {
  const result = [];
  for (const [, room] of rooms) {
    if (!room.isPublic) continue;

    result.push({
      code: room.code,
      name: room.name,
      description: room.description,
      category: room.category,
      memberCount: room.members.size,
      createdAt: room.createdAt,
    });
  }

  // Sort: most members first, then by creation time
  result.sort((a, b) => {
    if (b.memberCount !== a.memberCount) return b.memberCount - a.memberCount;
    return a.createdAt - b.createdAt;
  });

  return result;
}

function getUserRooms(socketId) {
  const user = users.get(socketId);
  if (!user) return [];

  const result = [];
  for (const code of user.roomIds) {
    const serialized = getRoomByCode(code);
    if (serialized) {
      result.push(serialized);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Anonymous cleanup
// ---------------------------------------------------------------------------

function removeMessagesByAuthor(socketId) {
  let removed = 0;
  for (const [, room] of rooms) {
    for (const [, channel] of room.channels) {
      const before = channel.messages.length;
      channel.messages = channel.messages.filter(m => m.authorId !== socketId);
      removed += before - channel.messages.length;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Default public rooms — created on startup
// ---------------------------------------------------------------------------

function initDefaultRooms() {
  const defaults = [
    { name: 'Lobby', description: 'The main hangout. Meet new people here!', category: 'General' },
    { name: 'Gaming', description: 'Talk about games, find teammates, share clips.', category: 'General' },
    { name: 'Music', description: 'Share tracks, discuss artists, vibe out.', category: 'General' },
    { name: 'Chill', description: 'Relax and chat about anything.', category: 'General' },
  ];

  for (const def of defaults) {
    createSystemRoom(def.name, def.description, def.category);
    console.log(`[state] Created default public room: "${def.name}"`);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  users,
  rooms,

  generateAnonName,
  generateRoomCode,
  generateId,
  getRandomColor,
  generateTag,

  createUser,
  removeUser,

  createRoom,
  createSystemRoom,
  joinRoom,
  leaveRoom,
  deleteRoom,

  createChannel,
  addMessage,
  deleteMessage,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  removeMessagesByAuthor,
  findMessage,
  findMessageInRoom,

  getRoomByCode,
  getPublicRooms,
  getUserRooms,

  sanitizeText,
  sanitizeName,
  initDefaultRooms,
};
