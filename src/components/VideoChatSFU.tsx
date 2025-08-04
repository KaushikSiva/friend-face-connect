import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Mic, MicOff, Video, VideoOff, Phone, PhoneCall, Copy, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSFUConnection } from '@/hooks/useSFUConnection';
import { VideoGrid } from './VideoGrid';

interface VideoControlsProps {
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  isConnected: boolean;
  participantCount: number;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onEndCall: () => void;
}

const VideoControls = ({
  isAudioEnabled,
  isVideoEnabled,
  isConnected,
  participantCount,
  onToggleAudio,
  onToggleVideo,
  onEndCall
}: VideoControlsProps) => (
  <div className="flex items-center justify-center gap-4 p-6 bg-control-bg/80 backdrop-blur-md border-t border-border/20">
    <div className="flex items-center gap-2 px-4 py-2 bg-muted rounded-lg">
      <Users className="h-4 w-4 text-muted-foreground" />
      <span className="text-sm font-medium">{participantCount + 1}</span>
    </div>
    
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

    <Button
      variant="destructive"
      size="lg"
      onClick={onEndCall}
      className="px-8"
    >
      <Phone className="h-5 w-5" />
      End Call
    </Button>
  </div>
);

export const VideoChatSFU = () => {
  const [roomIdInput, setRoomIdInput] = useState('');
  const [userName, setUserName] = useState('');
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  
  const {
    isConnected,
    roomId,
    participants,
    remoteStreams,
    localStream,
    connectToSFU,
    disconnect,
    setRoomId
  } = useSFUConnection();
  
  const { toast } = useToast();

  // Generate random room ID
  const generateRoomId = () => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomIdInput(id);
    setRoomId(id);
    return id;
  };

  // Copy room ID to clipboard
  const copyRoomId = async () => {
    const idToCopy = roomId || roomIdInput;
    if (!idToCopy) return;
    
    try {
      await navigator.clipboard.writeText(idToCopy);
      toast({
        title: "Room ID copied!",
        description: "Share this ID with others to connect.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to copy",
        description: "Please copy the room ID manually.",
      });
    }
  };

  // Start new call
  const startCall = async () => {
    let currentRoomId = roomIdInput;
    if (!currentRoomId) {
      currentRoomId = generateRoomId();
    }
    console.log(`🎬 [START] Starting call with room ID: ${currentRoomId}, input: ${roomIdInput}`);
    console.log(`🎬 [START] Current state - isConnected: ${isConnected}, roomId: ${roomId}`);

    const success = await connectToSFU(currentRoomId, userName || undefined);
    console.log(`🎬 [START] Connect result: ${success}`);
    if (success) {
      toast({
        title: "Call started!",
        description: `Room ID: ${currentRoomId}. Share with others to join.`,
      });
    } else {
      console.error(`❌ [START] Failed to start call`);
    }
  };

  // Join existing call
  const joinCall = async () => {
    if (!roomIdInput) {
      toast({
        variant: "destructive",
        title: "No room ID",
        description: "Please enter a room ID to join",
      });
      return;
    }
    console.log(`🚪 [JOIN] Attempting to join room: ${roomIdInput}`);
    console.log(`🚪 [JOIN] Current state - isConnected: ${isConnected}, roomId: ${roomId}, participants: ${participants.length}`);

    const success = await connectToSFU(roomIdInput, userName || undefined);
    console.log(`🚪 [JOIN] Connect result: ${success}`);
    if (!success) {
      console.error(`❌ [JOIN] Failed to join room ${roomIdInput}`);
      toast({
        variant: "destructive",
        title: "Failed to join",
        description: "Could not connect to the room. Please check the room ID.",
      });
    }
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

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full p-8 bg-gradient-to-br from-card via-card to-muted border-border/20">
          <div className="text-center space-y-6">
            <div className="space-y-2">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
                Multi-User Video Chat
              </h1>
              <p className="text-muted-foreground">
                Connect with up to 30 people in a video call
              </p>
            </div>

            <div className="space-y-4">
              <Input
                placeholder="Your name (optional)"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
              />
              
              <div className="flex gap-2">
                <Input
                  placeholder="Enter or generate room ID"
                  value={roomIdInput}
                  onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyRoomId}
                  disabled={!roomIdInput && !roomId}
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
                disabled={!roomIdInput}
              >
                <Video className="h-5 w-5" />
                Join Call
              </Button>
            </div>

            <div className="text-xs text-muted-foreground">
              Share your room ID with others to connect
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Video Grid */}
      <div className="flex-1 relative">
        <VideoGrid
          localStream={localStream}
          remoteStreams={remoteStreams}
          localParticipantId=""
          isVideoEnabled={isVideoEnabled}
        />
        
        {/* Room Info Overlay */}
        <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded-lg px-4 py-2">
          <div className="text-white space-y-1">
            <p className="text-sm font-medium">Room: {roomId}</p>
            <p className="text-xs opacity-75">{participants.length + 1} participants</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <VideoControls
        isAudioEnabled={isAudioEnabled}
        isVideoEnabled={isVideoEnabled}
        isConnected={isConnected}
        participantCount={participants.length}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onEndCall={disconnect}
      />
    </div>
  );
};