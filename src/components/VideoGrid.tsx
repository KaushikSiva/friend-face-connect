import { useRef, useEffect } from 'react';
import { Video } from 'lucide-react';

interface VideoStream {
  participantId: string;
  name?: string;
  stream: MediaStream;
}

interface VideoGridProps {
  localStream: MediaStream | null;
  remoteStreams: VideoStream[];
  localParticipantId: string;
  isVideoEnabled: boolean;
}

export const VideoGrid = ({ 
  localStream, 
  remoteStreams, 
  localParticipantId, 
  isVideoEnabled 
}: VideoGridProps) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const getGridClasses = () => {
    const totalVideos = 1 + remoteStreams.length;
    if (totalVideos <= 2) return "grid-cols-1 lg:grid-cols-2";
    if (totalVideos <= 4) return "grid-cols-2";
    if (totalVideos <= 9) return "grid-cols-3";
    return "grid-cols-4";
  };

  return (
    <div className={`grid gap-4 p-4 h-full ${getGridClasses()}`}>
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
        {!isVideoEnabled && (
          <div className="absolute inset-0 bg-video-bg flex items-center justify-center">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
              <Video className="h-8 w-8 text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Remote Videos */}
      {remoteStreams.map((videoStream) => (
        <RemoteVideo key={videoStream.participantId} videoStream={videoStream} />
      ))}
    </div>
  );
};

interface RemoteVideoProps {
  videoStream: VideoStream;
}

const RemoteVideo = ({ videoStream }: RemoteVideoProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && videoStream.stream) {
      videoRef.current.srcObject = videoStream.stream;
    }
  }, [videoStream.stream]);

  return (
    <div className="relative bg-video-bg rounded-2xl overflow-hidden shadow-lg">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
      />
      <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-1">
        <p className="text-sm text-white">{videoStream.name || `User ${videoStream.participantId.slice(0, 4)}`}</p>
      </div>
    </div>
  );
};