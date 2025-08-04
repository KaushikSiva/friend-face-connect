import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface VideoStream {
  participantId: string;
  name?: string;
  stream: MediaStream;
}

interface Participant {
  id: string;
  name?: string;
}

export const useSupabaseVideoChat = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<VideoStream[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  
  const channelRef = useRef<RealtimeChannel | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const participantIdRef = useRef<string>(`user-${Math.random().toString(36).substring(2, 10)}`);
  
  const { toast } = useToast();

  // Update remote stream names when participants change
  useEffect(() => {
    setRemoteStreams(prevStreams => 
      prevStreams.map(stream => {
        const participant = participants.find(p => p.id === stream.participantId);
        return {
          ...stream,
          name: participant?.name || stream.name
        };
      })
    );
  }, [participants]);

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
      if (event.candidate && channelRef.current) {
        console.log(`🧊 [ICE] Sending ICE candidate to ${participantId}`);
        channelRef.current.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: {
            targetParticipantId: participantId,
            fromParticipantId: participantIdRef.current,
            candidate: event.candidate
          }
        });
      }
    };

    pc.ontrack = (event) => {
      console.log(`🎥 [TRACK] Received remote stream from ${participantId}`, event);
      const stream = event.streams[0];
      
      if (!stream) {
        console.error(`❌ [TRACK] No stream in track event from ${participantId}`);
        return;
      }
      
      console.log(`📺 [TRACK] Stream has ${stream.getTracks().length} tracks:`, stream.getTracks().map(t => `${t.kind}:${t.enabled}`));
      
      setRemoteStreams(prev => {
        const existing = prev.find(s => s.participantId === participantId);
        if (existing) {
          console.log(`🔄 [TRACK] Updating existing stream for ${participantId}`);
          return prev.map(s => 
            s.participantId === participantId 
              ? { ...s, stream }
              : s
          );
        }
        
        console.log(`➕ [TRACK] Adding new stream for ${participantId}`);
        return [...prev, { participantId, stream, name: undefined }];
      });
      
      // Update stream names from participants
      setParticipants(currentParticipants => {
        const participant = currentParticipants.find(p => p.id === participantId);
        if (participant?.name) {
          setRemoteStreams(currentStreams => 
            currentStreams.map(s => 
              s.participantId === participantId 
                ? { ...s, name: participant.name }
                : s
            )
          );
        }
        return currentParticipants;
      });
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`🔗 [PC] ICE connection state for ${participantId}: ${pc.iceConnectionState}`);
    };

    peerConnectionsRef.current.set(participantId, pc);
    return pc;
  };

  const createOfferForParticipant = async (participantId: string, streamToUse?: MediaStream) => {
    const currentStream = streamToUse || localStream;
    if (!currentStream) {
      console.error(`❌ [OFFER] No local stream available for ${participantId}`);
      return;
    }

    const existingPc = peerConnectionsRef.current.get(participantId);
    if (existingPc) {
      console.log(`🗑️ [OFFER] Closing existing connection for ${participantId}`);
      existingPc.close();
      peerConnectionsRef.current.delete(participantId);
    }

    const pc = createPeerConnection(participantId);
    
    console.log(`📺 [STREAM] Adding ${currentStream.getTracks().length} tracks to peer connection for ${participantId}`);
    currentStream.getTracks().forEach(track => {
      console.log(`🎬 [TRACK] Adding track: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState}`);
      pc.addTrack(track, currentStream);
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log(`📤 [OFFER] Sending offer to ${participantId}`, offer);

    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'offer',
        payload: {
          targetParticipantId: participantId,
          fromParticipantId: participantIdRef.current,
          offer
        }
      });
    }
  };

  const handleOffer = async (fromParticipantId: string, offer: RTCSessionDescriptionInit, streamToUse?: MediaStream) => {
    console.log(`📥 [OFFER] Received offer from ${fromParticipantId}`);
    
    const currentStream = streamToUse || localStream;
    if (!currentStream) {
      console.error(`❌ [OFFER] No local stream available when handling offer from ${fromParticipantId}`);
      return;
    }

    const existingPc = peerConnectionsRef.current.get(fromParticipantId);
    if (existingPc) {
      console.log(`🗑️ [OFFER] Closing existing connection for ${fromParticipantId}`);
      existingPc.close();
      peerConnectionsRef.current.delete(fromParticipantId);
    }

    const pc = createPeerConnection(fromParticipantId);
    
    console.log(`📺 [OFFER-STREAM] Adding ${currentStream.getTracks().length} tracks to peer connection for ${fromParticipantId}`);
    currentStream.getTracks().forEach(track => {
      console.log(`🎬 [OFFER-TRACK] Adding track: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState}`);
      pc.addTrack(track, currentStream);
    });

    await pc.setRemoteDescription(offer);
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.log(`📤 [ANSWER] Sending answer to ${fromParticipantId}`, answer);

    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'answer',
        payload: {
          targetParticipantId: fromParticipantId,
          fromParticipantId: participantIdRef.current,
          answer
        }
      });
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

  const connectToRoom = useCallback(async (targetRoomId: string, name?: string) => {
    console.log(`🚀 [SUPABASE] === Connecting to room: ${targetRoomId} ===`);
    
    try {
      // Initialize media first
      console.log(`📷 [MEDIA] Initializing media devices...`);
      const stream = await initializeMedia();
      if (!stream) {
        console.error(`❌ [MEDIA] Failed to initialize media`);
        return false;
      }
      console.log(`✅ [MEDIA] Media initialized with ${stream.getTracks().length} tracks`);

      // Create Supabase Realtime channel for the room
      const channel = supabase.channel(`room-${targetRoomId}`, {
        config: {
          presence: {
            key: participantIdRef.current,
          },
        },
      });

      channelRef.current = channel;

      // Handle presence events (join/leave)
      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState();
          console.log('📊 [PRESENCE] Presence sync:', state);
          
          const allParticipants = Object.keys(state).map(key => {
            const presenceData = state[key][0] as any; // Presence data structure
            console.log(`📋 [PRESENCE] Participant ${key} has presence data:`, presenceData);
            return {
              id: key,
              name: presenceData?.name
            };
          });
          
          const otherParticipants = allParticipants.filter(p => p.id !== participantIdRef.current);
          console.log(`👥 [PRESENCE] All participants:`, allParticipants);
          console.log(`👥 [PRESENCE] Other participants:`, otherParticipants);
          setParticipants(otherParticipants);
          console.log(`👥 [PRESENCE] Found ${otherParticipants.length} other participants:`, otherParticipants.map(p => p.id));
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
          console.log(`🆕 [PRESENCE] Participant joined: ${key}`, newPresences);
          if (key !== participantIdRef.current) {
            // Only the participant with the lower ID creates the offer to prevent simultaneous offers
            if (participantIdRef.current < key) {
              console.log(`📤 [OFFER-CREATE] Creating offer for new participant ${key} (I have lower ID)`);
              createOfferForParticipant(key, stream);
            } else {
              console.log(`⏳ [WAIT] Waiting for offer from ${key} (they have lower ID)`);
            }
            
            toast({
              title: "Participant joined",
              description: (newPresences[0] as any)?.name || `User ${key.slice(0, 4)} joined the call`,
            });
          }
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          console.log(`👋 [PRESENCE] Participant left: ${key}`, leftPresences);
          
          // Clean up peer connection
          const pc = peerConnectionsRef.current.get(key);
          if (pc) {
            pc.close();
            peerConnectionsRef.current.delete(key);
          }
          
          setRemoteStreams(prev => prev.filter(s => s.participantId !== key));
          
          toast({
            title: "Participant left",
            description: "User left the call",
          });
        })
        .on('broadcast', { event: 'offer' }, ({ payload }) => {
          if (payload.targetParticipantId === participantIdRef.current) {
            handleOffer(payload.fromParticipantId, payload.offer, stream);
          }
        })
        .on('broadcast', { event: 'answer' }, ({ payload }) => {
          if (payload.targetParticipantId === participantIdRef.current) {
            handleAnswer(payload.fromParticipantId, payload.answer);
          }
        })
        .on('broadcast', { event: 'ice-candidate' }, ({ payload }) => {
          if (payload.targetParticipantId === participantIdRef.current) {
            handleIceCandidate(payload.fromParticipantId, payload.candidate);
          }
        });

      // Subscribe and track presence
      const status = await channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`📡 [SUPABASE] Subscribed to room ${targetRoomId}`);
          
          // IMPORTANT: Stream should already be available from initializeMedia above
          console.log(`✅ [STREAM] Using stream with ${stream.getTracks().length} tracks`);
          
          // Track our presence
          const presenceTrackStatus = await channel.track({
            name: name || `User ${participantIdRef.current.slice(0, 4)}`,
            online_at: new Date().toISOString(),
          });
          
          console.log(`📍 [PRESENCE] Track status:`, presenceTrackStatus);
          console.log(`📍 [PRESENCE] Tracking with name: "${name || `User ${participantIdRef.current.slice(0, 4)}`}"`);
          
          
          setIsConnected(true);
          setRoomId(targetRoomId);
          
          toast({
            title: "Connected!",
            description: `Joined room ${targetRoomId}`,
          });
        } else {
          console.error(`❌ [SUPABASE] Failed to subscribe: ${status}`);
        }
      });

      console.log(`🔌 [SUPABASE] Subscription status:`, status);
      return true;
      
    } catch (error) {
      console.error('❌ [SUPABASE] Connection failed:', error);
      toast({
        variant: "destructive",
        title: "Connection Failed",
        description: "Could not establish connection to video server.",
      });
      return false;
    }
  }, [toast]);

  const disconnect = useCallback(() => {
    console.log('🔌 [SUPABASE] Disconnecting...');
    
    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    
    // Unsubscribe from channel
    if (channelRef.current) {
      channelRef.current.unsubscribe();
      channelRef.current = null;
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
    connectToRoom,
    disconnect,
    setRoomId
  };
};