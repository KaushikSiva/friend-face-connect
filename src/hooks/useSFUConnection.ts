import { useState, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

interface VideoStream {
  participantId: string;
  name?: string;
  stream: MediaStream;
}

interface Participant {
  id: string;
  name?: string;
}

export const useSFUConnection = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<VideoStream[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const participantIdRef = useRef<string>(Math.random().toString(36).substring(2, 10));
  
  const { toast } = useToast();

  const initializeMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true
      });
      setLocalStream(stream);
      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      toast({
        variant: "destructive",
        title: "Camera/Microphone Error",
        description: "Please allow access to camera and microphone.",
      });
      return null;
    }
  };

  const createPeerConnection = (participantId: string) => {
    console.log(`🔗 [PC] Creating peer connection for ${participantId}`);
    
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        console.log(`🧊 [ICE] Sending ICE candidate to ${participantId}`);
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          targetParticipantId: participantId,
          candidate: event.candidate
        }));
      }
    };

    pc.ontrack = (event) => {
      console.log(`🎥 [TRACK] Received remote stream from ${participantId}`);
      const stream = event.streams[0];
      
      setRemoteStreams(prev => {
        const existing = prev.find(s => s.participantId === participantId);
        if (existing) {
          return prev.map(s => 
            s.participantId === participantId 
              ? { ...s, stream }
              : s
          );
        }
        
        return [...prev, { participantId, stream, name: undefined }];
      });
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`🔗 [PC] ICE connection state for ${participantId}: ${pc.iceConnectionState}`);
    };

    peerConnectionsRef.current.set(participantId, pc);
    return pc;
  };

  const createOfferForParticipant = async (participantId: string, stream?: MediaStream) => {
    const currentStream = stream || localStream;
    console.log(`🔗 [OFFER] Creating offer for participant ${participantId}, stream available: ${!!currentStream}`);
    const pc = createPeerConnection(participantId);
    
    // Add local stream to peer connection
    if (currentStream) {
      console.log(`📺 [STREAM] Adding ${currentStream.getTracks().length} tracks to peer connection`);
      currentStream.getTracks().forEach(track => {
        console.log(`🎬 [TRACK] Adding track: ${track.kind}, enabled: ${track.enabled}`);
        pc.addTrack(track, currentStream);
      });
    } else {
      console.warn(`⚠️ [STREAM] No stream available when creating offer for ${participantId}`);
    }
    
    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log(`📤 [OFFER] Sending offer to ${participantId}`);
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'offer',
        targetParticipantId: participantId,
        offer
      }));
    }
  };

  const connectToSFU = useCallback(async (targetRoomId: string, name?: string) => {
    try {
      console.log(`🚀 [SFU] Connecting to room: ${targetRoomId} with name: ${name}`);
      
      // Initialize media first
      console.log(`📷 [MEDIA] Initializing media devices...`);
      const stream = await initializeMedia();
      if (!stream) {
        console.error(`❌ [MEDIA] Failed to initialize media`);
        return false;
      }
      console.log(`✅ [MEDIA] Media initialized with ${stream.getTracks().length} tracks`);

      // Store current stream reference for use in message handlers
      const currentStreamRef = { current: stream };

      // Connect to SFU WebSocket
      console.log(`🔌 [WS] Connecting to WebSocket...`);
      const ws = new WebSocket(`wss://pbxormchfloeaqrkhbvz.functions.supabase.co/video-sfu`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('📡 [SFU] WebSocket connected, sending join-room message');
        // Join room
        ws.send(JSON.stringify({
          type: 'join-room',
          roomId: targetRoomId,
          participantId: participantIdRef.current,
          name
        }));
        console.log(`📤 [JOIN] Sent join-room message for room ${targetRoomId}, participant ${participantIdRef.current}`);
      };

      ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log(`📨 [SFU] Received message:`, message.type, message);

        switch (message.type) {
          case 'joined-room':
            console.log(`✅ [JOIN] Successfully joined room ${message.roomId}`);
            setIsConnected(true);
            setRoomId(message.roomId);
            toast({
              title: "Connected!",
              description: `Joined room ${message.roomId}`,
            });
            break;

          case 'existing-participants':
            console.log(`👥 [EXISTING] Found ${message.participants.length} existing participants:`, message.participants);
            setParticipants(message.participants);
            // Create peer connections for existing participants
            for (const participant of message.participants) {
              console.log(`📤 [OFFER-CREATE] Creating offer for existing participant ${participant.id}`);
              await createOfferForParticipant(participant.id, currentStreamRef.current);
            }
            break;

          case 'participant-joined':
            console.log(`🆕 [NEW-PARTICIPANT] New participant joined: ${message.participantId}`);
            setParticipants(prev => [...prev, { id: message.participantId, name: message.name }]);
            // Create offer for new participant
            console.log(`📤 [OFFER-CREATE] Creating offer for new participant ${message.participantId}`);
            await createOfferForParticipant(message.participantId, currentStreamRef.current);
            toast({
              title: "Participant joined",
              description: message.name || `User ${message.participantId.slice(0, 4)} joined the call`,
            });
            break;

          case 'participant-left':
            // Remove participant and clean up peer connection
            const pc = peerConnectionsRef.current.get(message.participantId);
            if (pc) {
              pc.close();
              peerConnectionsRef.current.delete(message.participantId);
            }
            
            setParticipants(prev => prev.filter(p => p.id !== message.participantId));
            setRemoteStreams(prev => prev.filter(s => s.participantId !== message.participantId));
            
            toast({
              title: "Participant left",
              description: `User left the call`,
            });
            break;

          case 'offer':
            await handleOffer(message.fromParticipantId, message.offer, currentStreamRef.current);
            break;

          case 'answer':
            await handleAnswer(message.fromParticipantId, message.answer);
            break;

          case 'ice-candidate':
            await handleIceCandidate(message.fromParticipantId, message.candidate);
            break;

          case 'error':
            console.error('❌ [SFU] Server error:', message.error);
            toast({
              variant: "destructive",
              title: "Server Error",
              description: message.error,
            });
            break;
        }
      };

      ws.onclose = () => {
        console.log('🔌 [SFU] WebSocket disconnected');
        setIsConnected(false);
      };

      ws.onerror = (error) => {
        console.error('💥 [SFU] WebSocket error:', error);
        toast({
          variant: "destructive",
          title: "Connection Error",
          description: "Failed to connect to video server.",
        });
      };

      return true;
    } catch (error) {
      console.error('❌ [SFU] Connection failed:', error);
      return false;
    }
  }, [toast]);


  const handleOffer = async (fromParticipantId: string, offer: RTCSessionDescriptionInit, stream?: MediaStream) => {
    console.log(`📥 [OFFER] Received offer from ${fromParticipantId}`);
    
    const pc = createPeerConnection(fromParticipantId);
    const currentStream = stream || localStream;
    
    // Add local stream to peer connection
    if (currentStream) {
      console.log(`📺 [OFFER-STREAM] Adding ${currentStream.getTracks().length} tracks to peer connection`);
      currentStream.getTracks().forEach(track => {
        pc.addTrack(track, currentStream);
      });
    }
    
    await pc.setRemoteDescription(offer);
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'answer',
        targetParticipantId: fromParticipantId,
        answer
      }));
    }
  };

  const handleAnswer = async (fromParticipantId: string, answer: RTCSessionDescriptionInit) => {
    console.log(`📥 [ANSWER] Received answer from ${fromParticipantId}`);
    
    const pc = peerConnectionsRef.current.get(fromParticipantId);
    if (pc) {
      await pc.setRemoteDescription(answer);
    }
  };

  const handleIceCandidate = async (fromParticipantId: string, candidate: RTCIceCandidateInit) => {
    console.log(`🧊 [ICE] Received ICE candidate from ${fromParticipantId}`);
    
    const pc = peerConnectionsRef.current.get(fromParticipantId);
    if (pc) {
      await pc.addIceCandidate(candidate);
    }
  };

  const disconnect = useCallback(() => {
    console.log('🔌 [SFU] Disconnecting...');
    
    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    
    // Reset state
    setIsConnected(false);
    setParticipants([]);
    setRemoteStreams([]);
    setRoomId('');
    
    toast({
      title: "Disconnected",
      description: "Left the video call",
    });
  }, [localStream, toast]);

  return {
    isConnected,
    roomId,
    participants,
    remoteStreams,
    localStream,
    participantId: participantIdRef.current,
    connectToSFU,
    disconnect,
    setRoomId
  };
};