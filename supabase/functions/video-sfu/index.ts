import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Participant {
  id: string;
  socket: WebSocket;
  roomId: string;
  name?: string;
}

interface Room {
  id: string;
  participants: Map<string, Participant>;
  createdAt: Date;
}

// Global state management - using globalThis to ensure state persistence across invocations
if (!globalThis.videoSFUState) {
  globalThis.videoSFUState = {
    rooms: new Map<string, Room>(),
    participants: new Map<WebSocket, Participant>()
  };
  console.log("🎥 [SFU] Initialized global state");
}

const rooms = globalThis.videoSFUState.rooms;
const participants = globalThis.videoSFUState.participants;

// Cleanup inactive rooms every 5 minutes
setInterval(() => {
  const now = new Date();
  for (const [roomId, room] of rooms.entries()) {
    const inactiveTime = now.getTime() - room.createdAt.getTime();
    if (inactiveTime > 30 * 60 * 1000 && room.participants.size === 0) { // 30 minutes
      console.log(`🧹 [CLEANUP] Removing inactive room: ${roomId}`);
      rooms.delete(roomId);
    }
  }
}, 5 * 60 * 1000);

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { headers } = req;
  const upgradeHeader = headers.get("upgrade") || "";

  if (upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket connection", { status: 400 });
  }

  console.log("🚀 [SFU] New WebSocket connection attempt");

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => {
    console.log("✅ [SFU] WebSocket connection established");
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log(`📨 [SFU] Received message:`, message.type);
      
      handleMessage(socket, message);
    } catch (error) {
      console.error("❌ [SFU] Error parsing message:", error);
      sendError(socket, "Invalid JSON message");
    }
  };

  socket.onclose = () => {
    console.log("🔌 [SFU] WebSocket connection closed");
    handleDisconnect(socket);
  };

  socket.onerror = (error) => {
    console.error("💥 [SFU] WebSocket error:", error);
    handleDisconnect(socket);
  };

  return response;
});

function handleMessage(socket: WebSocket, message: any) {
  const { type } = message;

  switch (type) {
    case 'join-room':
      handleJoinRoom(socket, message);
      break;
    case 'offer':
      handleOffer(socket, message);
      break;
    case 'answer':
      handleAnswer(socket, message);
      break;
    case 'ice-candidate':
      handleIceCandidate(socket, message);
      break;
    case 'leave-room':
      handleLeaveRoom(socket);
      break;
    default:
      console.warn(`⚠️ [SFU] Unknown message type: ${type}`);
      sendError(socket, `Unknown message type: ${type}`);
  }
}

function handleJoinRoom(socket: WebSocket, message: any) {
  const { roomId, participantId, name } = message;
  
  console.log(`🏠 [ROOM] Participant ${participantId} joining room ${roomId}`);

  // Create room if it doesn't exist
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      participants: new Map(),
      createdAt: new Date()
    });
    console.log(`🆕 [ROOM] Created new room: ${roomId}`);
  }

  const room = rooms.get(roomId)!;
  
  // Create participant
  const participant: Participant = {
    id: participantId,
    socket,
    roomId,
    name
  };

  // Add participant to room and global map
  room.participants.set(participantId, participant);
  participants.set(socket, participant);

  // Notify participant of successful join
  sendMessage(socket, {
    type: 'joined-room',
    roomId,
    participantId,
    participantCount: room.participants.size
  });

  // Notify existing participants about new join
  broadcastToRoom(roomId, {
    type: 'participant-joined',
    participantId,
    name,
    participantCount: room.participants.size
  }, participantId);

  // Send list of existing participants to new participant
  const existingParticipants = Array.from(room.participants.values())
    .filter(p => p.id !== participantId)
    .map(p => ({ id: p.id, name: p.name }));

  if (existingParticipants.length > 0) {
    sendMessage(socket, {
      type: 'existing-participants',
      participants: existingParticipants
    });
  }

  console.log(`✅ [ROOM] Participant ${participantId} successfully joined room ${roomId}. Total participants: ${room.participants.size}`);
}

function handleOffer(socket: WebSocket, message: any) {
  const { targetParticipantId, offer } = message;
  const participant = participants.get(socket);
  
  if (!participant) {
    sendError(socket, "Participant not found");
    return;
  }

  console.log(`📤 [OFFER] From ${participant.id} to ${targetParticipantId}`);

  const room = rooms.get(participant.roomId);
  if (!room) {
    sendError(socket, "Room not found");
    return;
  }

  const targetParticipant = room.participants.get(targetParticipantId);
  if (!targetParticipant) {
    sendError(socket, "Target participant not found");
    return;
  }

  // Forward offer to target participant
  sendMessage(targetParticipant.socket, {
    type: 'offer',
    fromParticipantId: participant.id,
    offer
  });
}

function handleAnswer(socket: WebSocket, message: any) {
  const { targetParticipantId, answer } = message;
  const participant = participants.get(socket);
  
  if (!participant) {
    sendError(socket, "Participant not found");
    return;
  }

  console.log(`📤 [ANSWER] From ${participant.id} to ${targetParticipantId}`);

  const room = rooms.get(participant.roomId);
  if (!room) {
    sendError(socket, "Room not found");
    return;
  }

  const targetParticipant = room.participants.get(targetParticipantId);
  if (!targetParticipant) {
    sendError(socket, "Target participant not found");
    return;
  }

  // Forward answer to target participant
  sendMessage(targetParticipant.socket, {
    type: 'answer',
    fromParticipantId: participant.id,
    answer
  });
}

function handleIceCandidate(socket: WebSocket, message: any) {
  const { targetParticipantId, candidate } = message;
  const participant = participants.get(socket);
  
  if (!participant) {
    sendError(socket, "Participant not found");
    return;
  }

  const room = rooms.get(participant.roomId);
  if (!room) {
    sendError(socket, "Room not found");
    return;
  }

  const targetParticipant = room.participants.get(targetParticipantId);
  if (!targetParticipant) {
    sendError(socket, "Target participant not found");
    return;
  }

  // Forward ICE candidate to target participant
  sendMessage(targetParticipant.socket, {
    type: 'ice-candidate',
    fromParticipantId: participant.id,
    candidate
  });
}

function handleLeaveRoom(socket: WebSocket) {
  handleDisconnect(socket);
}

function handleDisconnect(socket: WebSocket) {
  const participant = participants.get(socket);
  
  if (!participant) {
    return;
  }

  console.log(`👋 [DISCONNECT] Participant ${participant.id} leaving room ${participant.roomId}`);

  const room = rooms.get(participant.roomId);
  if (room) {
    // Remove participant from room
    room.participants.delete(participant.id);
    
    // Notify other participants
    broadcastToRoom(participant.roomId, {
      type: 'participant-left',
      participantId: participant.id,
      participantCount: room.participants.size
    });

    console.log(`📊 [ROOM] Room ${participant.roomId} now has ${room.participants.size} participants`);
  }

  // Remove from global participants map
  participants.delete(socket);
}

function sendMessage(socket: WebSocket, message: any) {
  try {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  } catch (error) {
    console.error("❌ [SEND] Error sending message:", error);
  }
}

function sendError(socket: WebSocket, error: string) {
  sendMessage(socket, {
    type: 'error',
    error
  });
}

function broadcastToRoom(roomId: string, message: any, excludeParticipantId?: string) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  for (const participant of room.participants.values()) {
    if (excludeParticipantId && participant.id === excludeParticipantId) {
      continue;
    }
    sendMessage(participant.socket, message);
  }
}

console.log("🎥 [SFU] Video SFU server started");