import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { 
  Video, VideoOff, Mic, MicOff, Monitor, MonitorOff, 
  MessageSquare, Users, Hand, PhoneOff, Settings,
  Copy, Send, MoreVertical, Sparkles
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { WebRTCManager } from '../../lib/webrtc';
import { VideoGrid } from './VideoGrid';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { useRealtimeChat } from '../../hooks/useRealtimeChat';

interface ChatMessage {
  id: string;
  sender_id: string | null;
  sender_name: string;
  content: string;
  created_at: string;
}

interface Participant {
  id: string;
  name: string;
  user_id?: string;
  joined_at: string;
}

export function MeetingRoom() {
  const { meetingCode } = useParams<{ meetingCode: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  
  // Meeting state
  const [meeting, setMeeting] = useState<any>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [participantName, setParticipantName] = useState('');
  const [participantId] = useState(uuidv4());
  
  // UI state
  const [activeTab, setActiveTab] = useState<'chat' | 'participants'>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // Media state
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [handRaisedParticipants, setHandRaisedParticipants] = useState<Set<string>>(new Set());
  const [backgroundBlurEnabled, setBackgroundBlurEnabled] = useState(false);

  // WebRTC
  const [webrtcManager, setWebrtcManager] = useState<WebRTCManager | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, { stream: MediaStream; name: string }>>(new Map());

  // Refs
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const participantsRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionStatsIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (meetingCode) {
      initializeMeeting();
    }
    return () => {
      cleanup();
    };
  }, [meetingCode]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const cleanup = () => {
    if (webrtcManager) {
      webrtcManager.leaveMeeting();
    }
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (participantsRefreshIntervalRef.current) {
      clearInterval(participantsRefreshIntervalRef.current);
    }
    if (connectionStatsIntervalRef.current) {
      clearInterval(connectionStatsIntervalRef.current);
    }
  };

  const initializeMeeting = async () => {
    try {
      // Get participant name from location state or prompt
      const name = location.state?.participantName || 
                   location.state?.hostName || 
                   prompt('Enter your name:') || 
                   'Guest';
      
      setParticipantName(name);

      // Fetch meeting details
      const { data: meetingData, error: meetingError } = await supabase
        .from('meetings')
        .select('*')
        .eq('access_code', meetingCode?.toUpperCase())
        .single();

      if (meetingError) {
        toast.error('Meeting not found');
        navigate('/');
        return;
      }
      
      setMeeting(meetingData);

      // Add participant to database
      const { error: participantError } = await supabase
        .from('participants')
        .insert({
          meeting_id: meetingData.id,
          name: name,
          user_id: null,
        });

      if (participantError) {
        console.error('Error adding participant:', participantError);
      }

      // Initialize WebRTC
      const manager = new WebRTCManager(meetingData.id, participantId, name);
      setWebrtcManager(manager);

      // Setup WebRTC callbacks
      manager.onStream((peerId, stream, participantName) => {
        console.log('Received stream from:', participantName);
        setRemoteStreams(prev => {
          const newMap = new Map(prev);
          newMap.set(peerId, { stream, name: participantName });
          return newMap;
        });
      });

      manager.onPeerLeft((peerId) => {
        console.log('Peer left:', peerId);
        setRemoteStreams(prev => {
          const newMap = new Map(prev);
          newMap.delete(peerId);
          return newMap;
        });
        setHandRaisedParticipants(prev => {
          const newSet = new Set(prev);
          newSet.delete(peerId);
          return newSet;
        });
      });

      manager.onHandRaised((participantId, name, raised) => {
        setHandRaisedParticipants(prev => {
          const newSet = new Set(prev);
          if (raised) {
            newSet.add(participantId);
            toast.success(`${name} raised their hand`);
          } else {
            newSet.delete(participantId);
          }
          return newSet;
        });
      });

      // Initialize media
      const stream = await manager.initializeMedia(true, true);
      setLocalStream(stream);

      // Join the meeting
      await manager.joinMeeting();

      // Start real-time updates
      startRealtimeUpdates(meetingData.id);
      
      // Start connection monitoring
      startConnectionMonitoring();
      
      setIsLoading(false);
      toast.success('Joined meeting successfully!');
      
    } catch (error: any) {
      console.error('Error initializing meeting:', error);
      toast.error('Failed to join meeting');
      navigate('/');
    }
  };

  const startRealtimeUpdates = (meetingId: string) => {
    // Fetch initial participants
    fetchParticipants(meetingId);

    // Set up participants refresh every 2 seconds
    participantsRefreshIntervalRef.current = setInterval(() => {
      fetchParticipants(meetingId);
    }, 1500); // Faster refresh for better real-time experience

    // Fetch initial participants immediately
    fetchParticipants(meetingId);
  };

  const startConnectionMonitoring = () => {
    // Monitor connection quality every 10 seconds
    connectionStatsIntervalRef.current = setInterval(async () => {
      if (webrtcManager) {
        const stats = await webrtcManager.getConnectionStats();
        // Log connection quality for debugging
        if (stats.size > 0) {
          console.log('Connection stats:', stats);
        }
      }
    }, 10000);
  };

  const fetchParticipants = async (meetingId: string) => {
    try {
      const { data, error } = await supabase
        .from('participants')
        .select('*')
        .eq('meeting_id', meetingId)
        .is('left_at', null)
        .order('joined_at', { ascending: true });

      if (error) throw error;
      
      // Update participants and trigger WebRTC connections for new ones
      const currentParticipantCount = participants.length;
      const newParticipantCount = data?.length || 0;
      setParticipants(data || []);
    } catch (error) {
      console.error('Error fetching participants:', error);
    }
  };

  const toggleMute = () => {
    if (webrtcManager) {
      const newMutedState = !isMuted;
      webrtcManager.toggleAudio(!newMutedState);
      setIsMuted(newMutedState);
      toast.success(newMutedState ? 'Microphone muted' : 'Microphone unmuted');
    }
  };

  const toggleCamera = () => {
    if (webrtcManager) {
      const newCameraState = !isCameraOff;
      webrtcManager.toggleVideo(!newCameraState);
      setIsCameraOff(newCameraState);
      toast.success(newCameraState ? 'Camera turned off' : 'Camera turned on');
    }
  };

  const toggleScreenShare = async () => {
    if (!webrtcManager) return;

    try {
      if (isScreenSharing) {
        // Stop screen sharing and return to camera
        const stream = await webrtcManager.initializeMedia(true, true);
        setLocalStream(stream);
        setIsScreenSharing(false);
        toast.success('Screen sharing stopped');
      } else {
        // Start screen sharing
        const screenStream = await webrtcManager.startScreenShare();
        setLocalStream(screenStream);
        setIsScreenSharing(true);
        toast.success('Screen sharing started');
        
        // Listen for screen share end
        const videoTrack = screenStream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = async () => {
            setIsScreenSharing(false);
            const stream = await webrtcManager.initializeMedia(true, true);
            setLocalStream(stream);
            toast.info('Screen sharing ended');
          };
        }
      }
    } catch (error) {
      console.error('Error toggling screen share:', error);
      toast.error('Failed to toggle screen sharing');
    }
  };

  const toggleBackgroundBlur = async () => {
    if (webrtcManager) {
      const newBlurState = !backgroundBlurEnabled;
      await webrtcManager.toggleBackgroundBlur(newBlurState);
      setBackgroundBlurEnabled(newBlurState);
      toast.success(newBlurState ? 'Background blur enabled' : 'Background blur disabled');
    }
  };

  const toggleHandRaise = async () => {
    if (!webrtcManager) return;

    const newHandRaisedState = !handRaised;
    setHandRaised(newHandRaisedState);
    await webrtcManager.raiseHand(newHandRaisedState);
    toast.success(newHandRaisedState ? 'Hand raised' : 'Hand lowered');
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !meeting?.id) return;

    try {
      const { error } = await supabase
        .from('messages')
        .insert({
          meeting_id: meeting.id,
          sender_id: null,
          sender_name: participantName,
          content: newMessage.trim(),
        });

      if (error) throw error;
      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message');
    }
  };

  // Use the real-time chat hook
  const { messages: realtimeChatMessages } = useRealtimeChat(meeting?.id || '');
  
  // Update chat messages from the hook
  useEffect(() => {
    setChatMessages(realtimeChatMessages);
  }, [realtimeChatMessages]);

  const leaveMeeting = async () => {
    try {
      // Update participant as left
      if (meeting?.id) {
        await supabase
          .from('participants')
          .update({ left_at: new Date().toISOString() })
          .eq('meeting_id', meeting.id)
          .eq('name', participantName);
      }

      cleanup();
      toast.success('Left meeting');
      navigate('/');
    } catch (error) {
      console.error('Error leaving meeting:', error);
      navigate('/');
    }
  };

  const copyMeetingLink = () => {
    const meetingLink = `${window.location.origin}/join/${meetingCode}`;
    navigator.clipboard.writeText(meetingLink);
    toast.success('Meeting link copied to clipboard!');
  };

  if (isLoading) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-lg">Joining meeting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-900 flex flex-col lg:flex-row">
      {/* Main video area */}
      <div className="flex-1 relative">
        {/* Video Grid */}
        <VideoGrid
          localStream={localStream || undefined}
          remoteStreams={remoteStreams}
          localParticipantName={participantName}
          isMuted={isMuted}
          isCameraOff={isCameraOff}
          isScreenSharing={isScreenSharing}
          backgroundBlurEnabled={backgroundBlurEnabled}
          handRaisedParticipants={handRaisedParticipants}
          localHandRaised={handRaised}
        />
        
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/50 to-transparent p-3 sm:p-6 z-10">
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center space-x-2 sm:space-x-4 flex-1 min-w-0">
              <h1 className="text-sm sm:text-xl font-semibold truncate">{meeting?.title}</h1>
              <span className="text-xs sm:text-sm opacity-75 hidden sm:inline">
                {format(new Date(), 'HH:mm')}
              </span>
              <span className="text-xs sm:text-sm bg-white/20 px-2 py-1 rounded whitespace-nowrap">
                {participants.length} participant{participants.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center space-x-1 sm:space-x-2">
              <button
                onClick={copyMeetingLink}
                className="px-2 sm:px-3 py-1 bg-white/20 rounded-lg hover:bg-white/30 transition-all text-xs sm:text-sm flex items-center gap-1 sm:gap-2"
              >
                <Copy className="w-3 sm:w-4 h-3 sm:h-4" />
                <span className="hidden sm:inline">Copy Link</span>
              </button>
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-1.5 sm:p-2 bg-white/20 rounded-lg hover:bg-white/30 transition-all lg:hidden"
              >
                <MoreVertical className="w-4 sm:w-5 h-4 sm:h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Bottom controls */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 sm:p-6 z-10">
          <div className="flex items-center justify-center space-x-2 sm:space-x-4 overflow-x-auto">
            <button
              onClick={toggleMute}
              className={`p-3 sm:p-4 rounded-full transition-all flex-shrink-0 ${
                isMuted 
                  ? 'bg-red-500 hover:bg-red-600' 
                  : 'bg-white/20 hover:bg-white/30'
              }`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? (
                <MicOff className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
              ) : (
                <Mic className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
              )}
            </button>

            <button
              onClick={toggleCamera}
              className={`p-3 sm:p-4 rounded-full transition-all flex-shrink-0 ${
                isCameraOff 
                  ? 'bg-red-500 hover:bg-red-600' 
                  : 'bg-white/20 hover:bg-white/30'
              }`}
              title={isCameraOff ? 'Turn on camera' : 'Turn off camera'}
            >
              {isCameraOff ? (
                <VideoOff className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
              ) : (
                <Video className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
              )}
            </button>

            <button
              onClick={toggleScreenShare}
              className={`p-3 sm:p-4 rounded-full transition-all flex-shrink-0 ${
                isScreenSharing 
                  ? 'bg-blue-500 hover:bg-blue-600' 
                  : 'bg-white/20 hover:bg-white/30'
              }`}
              title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
            >
              {isScreenSharing ? (
                <MonitorOff className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
              ) : (
                <Monitor className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
              )}
            </button>

            <button
              onClick={toggleHandRaise}
              className={`p-3 sm:p-4 rounded-full transition-all flex-shrink-0 ${
                handRaised 
                  ? 'bg-yellow-500 hover:bg-yellow-600' 
                  : 'bg-white/20 hover:bg-white/30'
              }`}
              title={handRaised ? 'Lower hand' : 'Raise hand'}
            >
              <Hand className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
            </button>

            <button
              onClick={toggleBackgroundBlur}
              className={`p-3 sm:p-4 rounded-full transition-all flex-shrink-0 ${
                backgroundBlurEnabled 
                  ? 'bg-purple-500 hover:bg-purple-600' 
                  : 'bg-white/20 hover:bg-white/30'
              }`}
              title={backgroundBlurEnabled ? 'Disable background blur' : 'Enable background blur'}
            >
              <Sparkles className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
            </button>

            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-3 sm:p-4 rounded-full bg-white/20 hover:bg-white/30 transition-all lg:hidden flex-shrink-0"
              title="Toggle chat"
            >
              <MessageSquare className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
            </button>

            <button
              onClick={leaveMeeting}
              className="p-3 sm:p-4 rounded-full bg-red-500 hover:bg-red-600 transition-all flex-shrink-0"
              title="Leave meeting"
            >
              <PhoneOff className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className={`w-full lg:w-80 bg-white border-t lg:border-t-0 lg:border-l border-gray-200 flex flex-col transition-all duration-300 ${
        sidebarOpen ? 'flex' : 'hidden'
      } lg:flex absolute lg:relative bottom-0 lg:bottom-auto left-0 right-0 lg:left-auto lg:right-auto h-1/2 lg:h-full z-20`}>
        {/* Sidebar header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex space-x-1">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === 'chat'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <MessageSquare className="w-3 sm:w-4 h-3 sm:h-4 inline mr-1 sm:mr-2" />
              Chat
            </button>
            <button
              onClick={() => setActiveTab('participants')}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === 'participants'
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <Users className="w-3 sm:w-4 h-3 sm:h-4 inline mr-1 sm:mr-2" />
              People ({participants.length})
            </button>
          </div>
        </div>

        {/* Sidebar content */}
        <div className="flex-1 flex flex-col">
          {activeTab === 'chat' ? (
            <>
              {/* Chat messages */}
              <div 
                ref={chatContainerRef}
                className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4"
              >
                {chatMessages.map((message) => (
                  <div key={message.id} className="flex flex-col space-y-1 sm:space-y-1">
                    <div className="flex items-center space-x-1 sm:space-x-2">
                      <span className="text-xs sm:text-sm font-medium text-gray-900 truncate">
                        {message.sender_name}
                      </span>
                      <span className="text-xs text-gray-500 flex-shrink-0">
                        {format(new Date(message.created_at), 'HH:mm')}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-gray-700 bg-gray-50 rounded-lg px-2 sm:px-3 py-1 sm:py-2 break-words">
                      {message.content}
                    </p>
                  </div>
                ))}
                {chatMessages.length === 0 && (
                  <div className="text-center text-gray-500 py-8">
                    <MessageSquare className="w-6 sm:w-8 h-6 sm:h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-xs sm:text-sm">No messages yet</p>
                    <p className="text-xs">Start the conversation!</p>
                  </div>
                )}
              </div>

              {/* Chat input */}
              <div className="p-3 sm:p-4 border-t border-gray-200">
                <form onSubmit={sendMessage} className="flex space-x-1 sm:space-x-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 px-2 sm:px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-xs sm:text-sm"
                  />
                  <button
                    type="submit"
                    disabled={!newMessage.trim()}
                    className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex-shrink-0"
                  >
                    <Send className="w-3 sm:w-4 h-3 sm:h-4" />
                  </button>
                </form>
              </div>
            </>
          ) : (
            /* Participants list */
            <div className="flex-1 overflow-y-auto p-3 sm:p-4">
              <div className="space-y-2 sm:space-y-3">
                {participants.map((participant) => (
                  <div key={participant.id} className="flex items-center space-x-2 sm:space-x-3 p-2 sm:p-3 rounded-lg hover:bg-gray-50">
                    <div className="w-8 sm:w-10 h-8 sm:h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white font-medium text-xs sm:text-sm">
                        {participant.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-1 sm:space-x-2">
                        <p className="text-xs sm:text-sm font-medium text-gray-900 truncate">
                          {participant.name}
                          {participant.name === participantName && ' (You)'}
                          {participant.name === meeting?.host_name && ' (Host)'}
                        </p>
                        {handRaisedParticipants.has(participant.id) && (
                          <Hand className="w-3 sm:w-4 h-3 sm:h-4 text-yellow-500 flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        Joined {format(new Date(participant.joined_at), 'HH:mm')}
                      </p>
                    </div>
                  </div>
                ))}
                {participants.length === 0 && (
                  <div className="text-center text-gray-500 py-8">
                    <Users className="w-6 sm:w-8 h-6 sm:h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-xs sm:text-sm">No participants yet</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}