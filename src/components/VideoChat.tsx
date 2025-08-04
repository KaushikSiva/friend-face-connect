import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Mic, MicOff, Video, VideoOff, Phone, PhoneCall, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface VideoControlsProps {
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isConnected: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onEndCall: () => void;
  onStartCall: () => void;
}

const VideoControls = ({
  isAudioEnabled,
  isVideoEnabled,
  isConnected,
  onToggleAudio,
  onToggleVideo,
  onEndCall,
  onStartCall
}: VideoControlsProps) => (
  <div className="flex items-center justify-center gap-4 p-6 bg-control-bg/80 backdrop-blur-md border-t border-border/20">
    <Button
      variant="control"
      size="lg"
      onClick={onToggleAudio}
      className={!isAudioEnabled ? "bg-destructive hover:bg-destructive/90" : ""}
    >
      {isAudioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
    </Button>
    
    <Button
      variant="control"
      size="lg"
      onClick={onToggleVideo}
      className={!isVideoEnabled ? "bg-destructive hover:bg-destructive/90" : ""}
    >
      {isVideoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
    </Button>

    {isConnected ? (
      <Button
        variant="destructive"
        size="lg"
        onClick={onEndCall}
        className="px-8"
      >
        <Phone className="h-5 w-5" />
        End Call
      </Button>
    ) : (
      <Button
        variant="success"
        size="lg"
        onClick={onStartCall}
        className="px-8"
      >
        <PhoneCall className="h-5 w-5" />
        Start Call
      </Button>
    )}
  </div>
);

export const VideoChat = () => {
  const [roomId, setRoomId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isInitiating, setIsInitiating] = useState(false);
  const [connectionState, setConnectionState] = useState<string>('new');
  const [iceCandidatesReceived, setIceCandidatesReceived] = useState(0);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const subscriptionRef = useRef<any>(null);
  
  const { toast } = useToast();

  // Generate random room ID
  const generateRoomId = () => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(id);
    return id;
  };

  // Supabase signaling functions
  const storeSignalingData = async (roomId: string, type: string, data: any) => {
    try {
      const { error } = await supabase
        .from('signaling')
        .insert({
          room_id: roomId,
          type: type,
          data: data
        });
      
      if (error) {
        console.error('Error storing signaling data:', error);
      } else {
        console.log('Stored signaling data:', type, 'for room:', roomId);
      }
    } catch (error) {
      console.error('Failed to store signaling data:', error);
    }
  };

  const getSignalingData = async (roomId: string, type: string) => {
    try {
      const { data, error } = await supabase
        .from('signaling')
        .select('data')
        .eq('room_id', roomId)
        .eq('type', type)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (error) {
        console.error('Error getting signaling data:', error);
        return null;
      }
      
      return data?.[0]?.data || null;
    } catch (error) {
      console.error('Failed to get signaling data:', error);
      return null;
    }
  };

  // Subscribe to signaling changes
  const subscribeToSignaling = (roomId: string, callback: (type: string, data: any) => void) => {
    console.log('Setting up real-time subscription for room:', roomId);
    const subscription = supabase
      .channel(`signaling-${roomId}`)
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'signaling',
          filter: `room_id=eq.${roomId}`
        }, 
        (payload) => {
          console.log('Received real-time signaling data:', payload.new);
          callback(payload.new.type, payload.new.data);
        }
      )
      .subscribe((status) => {
        console.log('Subscription status:', status);
      });
    
    return subscription;
  };

  // Copy room ID to clipboard
  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      toast({
        title: "Room ID copied!",
        description: "Share this ID with your friend to connect.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to copy",
        description: "Please copy the room ID manually.",
      });
    }
  };

  // Initialize media stream
  const initializeMedia = async () => {
    try {
      console.log('Requesting media access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true
      });
      
      console.log('Media stream obtained:', stream);
      setLocalStream(stream);
      
      // Wait for next frame to ensure video element is ready
      setTimeout(() => {
        if (localVideoRef.current && stream) {
          localVideoRef.current.srcObject = stream;
          console.log('Local video element updated');
        }
      }, 100);
      
      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      toast({
        variant: "destructive",
        title: "Camera/Microphone Error",
        description: "Please allow access to camera and microphone. " + error.message,
      });
      return null;
    }
  };

  // Create peer connection with proper signaling
  const createPeerConnection = () => {
    console.log('Creating new peer connection...');
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = (event) => {
      console.log('ICE candidate generated:', event.candidate);
      if (event.candidate) {
        storeSignalingData(roomId, 'ice_candidate', event.candidate);
      } else {
        console.log('ICE gathering complete');
      }
    };

    pc.ontrack = (event) => {
      console.log('Remote track received:', event.streams);
      const stream = event.streams[0];
      setRemoteStream(stream);
      
      setTimeout(() => {
        if (remoteVideoRef.current && stream) {
          remoteVideoRef.current.srcObject = stream;
          console.log('Remote video element updated');
        }
      }, 100);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      setConnectionState(pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        toast({
          title: "Connected!",
          description: "Video call is now active.",
        });
      } else if (pc.connectionState === 'failed') {
        toast({
          variant: "destructive",
          title: "Connection failed",
          description: "Unable to establish connection.",
        });
      }
    };

    return pc;
  };

  // Start call as initiator
  const startCall = async () => {
    console.log('Starting call as initiator...');
    
    let currentRoomId = roomId;
    if (!currentRoomId) {
      currentRoomId = generateRoomId();
    }

    const stream = await initializeMedia();
    if (!stream) return;

    setIsInitiating(true);
    setIsConnected(true);

    // Create peer connection
    const pc = createPeerConnection();
    peerConnectionRef.current = pc;

    // Add local stream to peer connection
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    // Create and set offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Store offer for the other peer using Supabase
    await storeSignalingData(currentRoomId, 'offer', offer);
    console.log('Offer created and stored for room:', currentRoomId);

    // Set up real-time subscription for signaling
    const subscription = subscribeToSignaling(currentRoomId, async (type, data) => {
      if (type === 'answer' && peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(data as unknown as RTCSessionDescriptionInit);
        console.log('Answer received via real-time');
      } else if (type === 'ice_candidate' && peerConnectionRef.current) {
        await peerConnectionRef.current.addIceCandidate(data as unknown as RTCIceCandidateInit);
        console.log('ICE candidate received via real-time');
        setIceCandidatesReceived(prev => prev + 1);
      }
    });
    subscriptionRef.current = subscription;
    
    toast({
      title: "Call started!",
      description: "Share room ID: " + currentRoomId + " with your friend",
    });
  };

  // Join existing call
  const joinCall = async () => {
    if (!roomId) {
      toast({
        variant: "destructive",
        title: "No room ID",
        description: "Please enter a room ID to join",
      });
      return;
    }

    console.log('Joining call in room:', roomId);

    const stream = await initializeMedia();
    if (!stream) return;

    setIsConnected(true);

    // Create peer connection
    const pc = createPeerConnection();
    peerConnectionRef.current = pc;

    // Add local stream
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    // Get stored offer from Supabase
    const storedOffer = await getSignalingData(roomId, 'offer');
    if (!storedOffer) {
      toast({
        variant: "destructive",
        title: "Room not found",
        description: "No active call found in room " + roomId,
      });
      setIsConnected(false);
      return;
    }

    // Set remote description and create answer
    await pc.setRemoteDescription(storedOffer as unknown as RTCSessionDescriptionInit);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Store answer using Supabase
    await storeSignalingData(roomId, 'answer', answer);
    console.log('Answer created and stored for room:', roomId);

    // Set up real-time subscription for ICE candidates
    const subscription = subscribeToSignaling(roomId, async (type, data) => {
      if (type === 'ice_candidate' && peerConnectionRef.current) {
        await peerConnectionRef.current.addIceCandidate(data as unknown as RTCIceCandidateInit);
        console.log('ICE candidate received via real-time');
        setIceCandidatesReceived(prev => prev + 1);
      }
    });
    subscriptionRef.current = subscription;

    toast({
      title: "Joined call!",
      description: "Connected to room " + roomId,
    });
  };

  // Signaling check function
  const startSignalingCheck = (currentRoomId: string) => {
    const checkSignaling = async () => {
      if (!peerConnectionRef.current) return;

      // Check for answer (if initiator)
      if (isInitiating) {
        const answer = await getSignalingData(currentRoomId, 'answer');
        if (answer) {
          peerConnectionRef.current.setRemoteDescription(answer as unknown as RTCSessionDescriptionInit);
          console.log('Answer received and set');
        }
      }

      // Check for ICE candidates
      const remoteCandidates = await getSignalingData(currentRoomId, 'ice_candidate');
      if (remoteCandidates) {
        peerConnectionRef.current?.addIceCandidate(remoteCandidates as unknown as RTCIceCandidateInit);
      }
    };

    // Check every 3 seconds
    (window as any).signalingInterval = setInterval(checkSignaling, 3000);
  };

  // Test function to just show local video
  const testLocalVideo = async () => {
    console.log('Testing local video only...');
    const stream = await initializeMedia();
    if (stream) {
      console.log('Local video test successful');
      setIsConnected(true);
    }
  };

  // End call
  const endCall = () => {
    // Unsubscribe from real-time updates
    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current);
      subscriptionRef.current = null;
    }
    
    // Clear signaling interval (if still using)
    if ((window as any).signalingInterval) {
      clearInterval((window as any).signalingInterval);
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    
    setRemoteStream(null);
    setIsConnected(false);
    setIsInitiating(false);
    setConnectionState('new');
    setIceCandidatesReceived(0);
    
    toast({
      title: "Call ended",
      description: "The video call has been disconnected.",
    });
  };

  // Toggle audio
  const toggleAudio = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsAudioEnabled(!isAudioEnabled);
    }
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoEnabled(!isVideoEnabled);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      endCall();
    };
  }, []);

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-8 bg-gradient-to-br from-card via-card to-muted border-border/20">
          <div className="text-center space-y-6">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
                Video Chat
              </h1>
              <p className="text-muted-foreground">
                Connect with your friend via video call
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Enter or generate room ID"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyRoomId}
                  disabled={!roomId}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>

              <Button
                onClick={generateRoomId}
                variant="outline"
                className="w-full"
              >
                Generate New Room ID
              </Button>

              <Button
                onClick={startCall}
                variant="default"
                size="lg"
                className="w-full"
              >
                <PhoneCall className="h-5 w-5" />
                Start New Call
              </Button>

              <Button
                onClick={joinCall}
                variant="outline"
                size="lg"
                className="w-full"
                disabled={!roomId}
              >
                <Video className="h-5 w-5" />
                Join Call
              </Button>
            </div>

            <div className="text-xs text-muted-foreground">
              Share your room ID with your friend to connect
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Video Area */}
      <div className="flex-1 relative grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
        {/* Remote Video */}
        <div className="relative bg-video-bg rounded-2xl overflow-hidden shadow-lg">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
          {!remoteStream && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-2">
                <div className="w-24 h-24 bg-muted rounded-full flex items-center justify-center mx-auto">
                  <Video className="h-12 w-12 text-muted-foreground" />
                </div>
                <p className="text-muted-foreground">Waiting for friend...</p>
                <p className="text-sm text-muted-foreground">Room: {roomId}</p>
              </div>
            </div>
          )}
        </div>

        {/* Local Video */}
        <div className="relative bg-video-bg rounded-2xl overflow-hidden shadow-lg">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover scale-x-[-1]"
          />
          <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-1">
            <p className="text-sm text-white">You</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <VideoControls
        isAudioEnabled={isAudioEnabled}
        isVideoEnabled={isVideoEnabled}
        isConnected={isConnected}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onEndCall={endCall}
        onStartCall={startCall}
      />
    </div>
  );
};