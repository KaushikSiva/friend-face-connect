import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Mic, MicOff, Video, VideoOff, Phone, PhoneCall, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  
  const { toast } = useToast();

  // Generate random room ID
  const generateRoomId = () => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(id);
    return id;
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
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Store ICE candidate in localStorage for simple signaling
        const candidates = JSON.parse(localStorage.getItem(`ice-${roomId}-${isInitiating ? 'initiator' : 'joiner'}`) || '[]');
        candidates.push(event.candidate);
        localStorage.setItem(`ice-${roomId}-${isInitiating ? 'initiator' : 'joiner'}`, JSON.stringify(candidates));
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote stream');
      setRemoteStream(event.streams[0]);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        toast({
          title: "Connected!",
          description: "Video call is now active.",
        });
      }
    };

    return pc;
  };

  // Start call - simplified approach
  const startCall = async () => {
    console.log('Starting call...');
    
    let currentRoomId = roomId;
    if (!currentRoomId) {
      currentRoomId = generateRoomId();
    }

    const stream = await initializeMedia();
    if (!stream) {
      console.log('Failed to get media stream');
      return;
    }

    console.log('Media stream ready, setting connected state');
    setIsConnected(true);
    
    toast({
      title: "Call started!",
      description: "Your video is ready. Share room ID: " + currentRoomId,
    });
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
    // Clear signaling interval
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
    
    // Clear signaling data
    if (roomId) {
      localStorage.removeItem(`offer-${roomId}`);
      localStorage.removeItem(`answer-${roomId}`);
      localStorage.removeItem(`ice-${roomId}-initiator`);
      localStorage.removeItem(`ice-${roomId}-joiner`);
    }
    
    setRemoteStream(null);
    setIsConnected(false);
    setIsInitiating(false);
    
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
                onClick={testLocalVideo}
                variant="default"
                size="lg"
                className="w-full"
              >
                <Video className="h-5 w-5" />
                Test Local Video
              </Button>

              <Button
                onClick={startCall}
                variant="outline"
                size="lg"
                className="w-full"
              >
                <PhoneCall className="h-5 w-5" />
                Start Video Call
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