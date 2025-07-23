import { supabase } from './supabase';

export interface PeerConnection {
  peerId: string;
  peer: RTCPeerConnection;
  stream?: MediaStream;
  name: string;
}

export class WebRTCManager {
  private localStream: MediaStream | null = null;
  private peers: Map<string, PeerConnection> = new Map();
  private meetingId: string;
  private participantId: string;
  private participantName: string;
  private onStreamCallback?: (peerId: string, stream: MediaStream, name: string) => void;
  private onPeerLeftCallback?: (peerId: string) => void;
  private onHandRaisedCallback?: (participantId: string, name: string, raised: boolean) => void;
  private signalingChannel: any;
  private presenceChannel: any;
  private isInitialized = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private participantCheckInterval: NodeJS.Timeout | null = null;
  private backgroundBlurEnabled = false;

  constructor(meetingId: string, participantId: string, participantName: string) {
    this.meetingId = meetingId;
    this.participantId = participantId;
    this.participantName = participantName;
    this.setupSignaling();
    this.setupPresenceTracking();
  }

  private setupSignaling() {
    this.signalingChannel = supabase
      .channel(`webrtc-${this.meetingId}`)
      .on('broadcast', { event: 'offer' }, (payload) => {
        this.handleOffer(payload.payload);
      })
      .on('broadcast', { event: 'answer' }, (payload) => {
        this.handleAnswer(payload.payload);
      })
      .on('broadcast', { event: 'ice-candidate' }, (payload) => {
        this.handleIceCandidate(payload.payload);
      })
      .on('broadcast', { event: 'user-joined' }, (payload) => {
        this.handleUserJoined(payload.payload);
      })
      .on('broadcast', { event: 'user-left' }, (payload) => {
        this.handleUserLeft(payload.payload);
      })
      .on('broadcast', { event: 'hand-raised' }, (payload) => {
        if (payload.payload.participantId !== this.participantId) {
          this.onHandRaisedCallback?.(
            payload.payload.participantId, 
            payload.payload.name, 
            payload.payload.raised
          );
        }
      })
      .on('broadcast', { event: 'media-state-changed' }, (payload) => {
        this.handleMediaStateChanged(payload.payload);
      })
      .subscribe();

    // Handle connection state changes for auto-reconnect
    this.signalingChannel.on('system', {}, (payload: any) => {
      if (payload.status === 'CHANNEL_ERROR' && this.reconnectAttempts < this.maxReconnectAttempts) {
        console.log('Channel error, attempting to reconnect...');
        this.reconnectAttempts++;
        setTimeout(() => {
          this.setupSignaling();
        }, 1000 * this.reconnectAttempts);
      }
    });
  }

  private setupPresenceTracking() {
    // Real-time presence tracking for instant participant detection
    this.presenceChannel = supabase
      .channel(`presence-${this.meetingId}`)
      .on('presence', { event: 'sync' }, () => {
        const state = this.presenceChannel.presenceState();
        console.log('Presence sync:', state);
        this.handlePresenceSync(state);
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        console.log('User joined presence:', newPresences);
        newPresences.forEach((presence: any) => {
          if (presence.participantId !== this.participantId) {
            this.handleUserJoined({
              participantId: presence.participantId,
              name: presence.name
            });
          }
        });
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        console.log('User left presence:', leftPresences);
        leftPresences.forEach((presence: any) => {
          this.handleUserLeft({ participantId: presence.participantId });
        });
      })
      .subscribe();

    // Start heartbeat for presence
    this.startHeartbeat();
  }

  private startHeartbeat() {
    // Send heartbeat every 10 seconds to maintain presence
    this.heartbeatInterval = setInterval(async () => {
      if (this.presenceChannel) {
        await this.presenceChannel.track({
          participantId: this.participantId,
          name: this.participantName,
          online_at: new Date().toISOString()
        });
      }
    }, 10000);

    // Check for new participants every 3 seconds
    this.participantCheckInterval = setInterval(async () => {
      await this.checkForNewParticipants();
    }, 3000);
  }

  private async checkForNewParticipants() {
    try {
      const { data, error } = await supabase
        .from('participants')
        .select('*')
        .eq('meeting_id', this.meetingId)
        .is('left_at', null);

      if (error) throw error;

      // Check for participants not in our peer list
      data?.forEach(participant => {
        if (participant.name !== this.participantName && 
            !this.peers.has(participant.id)) {
          console.log('Found new participant:', participant.name);
          this.handleUserJoined({
            participantId: participant.id,
            name: participant.name
          });
        }
      });
    } catch (error) {
      console.error('Error checking for new participants:', error);
    }
  }

  private handlePresenceSync(state: any) {
    Object.keys(state).forEach(key => {
      const presences = state[key];
      presences.forEach((presence: any) => {
        if (presence.participantId !== this.participantId && 
            !this.peers.has(presence.participantId)) {
          this.handleUserJoined({
            participantId: presence.participantId,
            name: presence.name
          });
        }
      });
    });
  }

  async initializeMedia(video: boolean = true, audio: boolean = true): Promise<MediaStream> {
    try {
      const constraints: MediaStreamConstraints = {
        video: video ? { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode: 'user'
        } : false,
        audio: audio ? { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 2
        } : false
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Apply background blur if enabled
      if (this.backgroundBlurEnabled && video) {
        await this.applyBackgroundBlur();
      }

      return this.localStream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      throw error;
    }
  }

  async toggleBackgroundBlur(enabled: boolean) {
    this.backgroundBlurEnabled = enabled;
    
    if (this.localStream && this.localStream.getVideoTracks().length > 0) {
      if (enabled) {
        await this.applyBackgroundBlur();
      } else {
        await this.removeBackgroundBlur();
      }
    }
  }

  private async applyBackgroundBlur() {
    try {
      // Check if browser supports background blur
      if (!('MediaStreamTrackProcessor' in window)) {
        console.warn('Background blur not supported in this browser');
        return;
      }

      const videoTrack = this.localStream?.getVideoTracks()[0];
      if (!videoTrack) return;

      // Create a canvas for processing
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const video = document.createElement('video');
      
      video.srcObject = new MediaStream([videoTrack]);
      video.play();

      video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const processFrame = () => {
          if (ctx && this.backgroundBlurEnabled) {
            ctx.filter = 'blur(10px)';
            ctx.drawImage(video, 0, 0);
            
            // Draw the person (simplified - in production you'd use ML for person detection)
            ctx.filter = 'none';
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(video, 0, 0);
            
            requestAnimationFrame(processFrame);
          }
        };
        processFrame();
      };

      // Replace video track with processed stream
      const processedStream = canvas.captureStream(30);
      const processedTrack = processedStream.getVideoTracks()[0];
      
      // Replace track in all peer connections
      this.peers.forEach(({ peer }) => {
        const sender = peer.getSenders().find(s => 
          s.track && s.track.kind === 'video'
        );
        if (sender) {
          sender.replaceTrack(processedTrack);
        }
      });

      // Replace in local stream
      this.localStream?.removeTrack(videoTrack);
      this.localStream?.addTrack(processedTrack);
      
    } catch (error) {
      console.error('Error applying background blur:', error);
    }
  }

  private async removeBackgroundBlur() {
    try {
      // Reinitialize media without blur
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: true
      });

      const videoTrack = newStream.getVideoTracks()[0];
      
      // Replace track in all peer connections
      this.peers.forEach(({ peer }) => {
        const sender = peer.getSenders().find(s => 
          s.track && s.track.kind === 'video'
        );
        if (sender) {
          sender.replaceTrack(videoTrack);
        }
      });

      // Update local stream
      if (this.localStream) {
        this.localStream.getVideoTracks().forEach(track => track.stop());
        this.localStream.removeTrack(this.localStream.getVideoTracks()[0]);
        this.localStream.addTrack(videoTrack);
      }
      
    } catch (error) {
      console.error('Error removing background blur:', error);
    }
  }

  async startScreenShare(): Promise<MediaStream> {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          cursor: 'always',
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      
      // Replace video track in all peer connections with high quality
      const videoTrack = screenStream.getVideoTracks()[0];
      this.peers.forEach(({ peer }) => {
        const sender = peer.getSenders().find(s => 
          s.track && s.track.kind === 'video'
        );
        if (sender && videoTrack) {
          sender.replaceTrack(videoTrack);
        }
      });

      // Handle screen share end
      videoTrack.onended = async () => {
        if (this.localStream) {
          const videoTrack = this.localStream.getVideoTracks()[0];
          this.peers.forEach(({ peer }) => {
            const sender = peer.getSenders().find(s => 
              s.track && s.track.kind === 'video'
            );
            if (sender && videoTrack) {
              sender.replaceTrack(videoTrack);
            }
          });
        }
      };

      return screenStream;
    } catch (error) {
      console.error('Error starting screen share:', error);
      throw error;
    }
  }

  async joinMeeting() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Track presence immediately
    await this.presenceChannel.track({
      participantId: this.participantId,
      name: this.participantName,
      online_at: new Date().toISOString()
    });

    // Announce joining with enhanced signaling
    await this.signalingChannel.send({
      type: 'broadcast',
      event: 'user-joined',
      payload: { 
        participantId: this.participantId,
        name: this.participantName,
        timestamp: Date.now()
      }
    });

    // Wait a bit then check for existing participants
    setTimeout(async () => {
      await this.checkForNewParticipants();
    }, 1000);
  }

  private async handleUserJoined(data: { participantId: string; name: string }) {
    if (data.participantId === this.participantId) return;
    if (this.peers.has(data.participantId)) return; // Already connected

    console.log('User joined:', data.name);
    await this.createPeerConnection(data.participantId, data.name, true);
  }

  private async createPeerConnection(peerId: string, name: string, isInitiator: boolean) {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    };

    const peer = new RTCPeerConnection(configuration);

    // Enhanced audio/video configuration
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        const sender = peer.addTrack(track, this.localStream!);
        
        // Configure encoding parameters for better quality
        if (track.kind === 'video') {
          const params = sender.getParameters();
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = 2500000; // 2.5 Mbps for video
            params.encodings[0].maxFramerate = 30;
            sender.setParameters(params);
          }
        } else if (track.kind === 'audio') {
          const params = sender.getParameters();
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = 128000; // 128 kbps for audio
            sender.setParameters(params);
          }
        }
      });
    }

    // Handle remote stream with enhanced processing
    peer.ontrack = (event) => {
      console.log('Received remote stream from:', name);
      const [remoteStream] = event.streams;
      
      // Enhance audio quality
      const audioTracks = remoteStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = true;
        // Apply audio enhancements if supported
        if ('getSettings' in track) {
          const settings = track.getSettings();
          console.log('Remote audio settings:', settings);
        }
      });

      this.onStreamCallback?.(peerId, remoteStream, name);
    };

    // Enhanced ICE handling
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalingChannel.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: {
            from: this.participantId,
            to: peerId,
            candidate: event.candidate,
            timestamp: Date.now()
          }
        });
      }
    };

    // Enhanced connection state monitoring
    peer.onconnectionstatechange = () => {
      console.log(`Connection state with ${name}:`, peer.connectionState);
      
      if (peer.connectionState === 'connected') {
        console.log(`Successfully connected to ${name}`);
        // Reset reconnect attempts on successful connection
        this.reconnectAttempts = 0;
      } else if (peer.connectionState === 'failed') {
        console.log(`Connection failed with ${name}, attempting reconnect...`);
        this.handleConnectionFailure(peerId, name);
      } else if (peer.connectionState === 'disconnected') {
        console.log(`Disconnected from ${name}`);
        setTimeout(() => {
          if (peer.connectionState === 'disconnected') {
            this.handleConnectionFailure(peerId, name);
          }
        }, 5000);
      }
    };

    // Monitor ICE connection state
    peer.oniceconnectionstatechange = () => {
      console.log(`ICE connection state with ${name}:`, peer.iceConnectionState);
      
      if (peer.iceConnectionState === 'failed') {
        console.log(`ICE connection failed with ${name}, restarting ICE...`);
        peer.restartIce();
      }
    };

    this.peers.set(peerId, { peerId, peer, name });

    if (isInitiator) {
      try {
        // Create offer with enhanced options
        const offer = await peer.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
          iceRestart: false
        });
        
        await peer.setLocalDescription(offer);
        
        this.signalingChannel.send({
          type: 'broadcast',
          event: 'offer',
          payload: {
            from: this.participantId,
            to: peerId,
            offer: offer,
            name: this.participantName,
            timestamp: Date.now()
          }
        });
      } catch (error) {
        console.error('Error creating offer:', error);
        this.peers.delete(peerId);
      }
    }
  }

  private async handleConnectionFailure(peerId: string, name: string) {
    console.log(`Handling connection failure for ${name}`);
    
    // Remove failed connection
    const peerConnection = this.peers.get(peerId);
    if (peerConnection) {
      peerConnection.peer.close();
      this.peers.delete(peerId);
      this.onPeerLeftCallback?.(peerId);
    }

    // Attempt to reconnect after a delay
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(async () => {
        console.log(`Attempting to reconnect to ${name} (attempt ${this.reconnectAttempts})`);
        await this.createPeerConnection(peerId, name, true);
      }, 2000 * this.reconnectAttempts);
    }
  }

  private async handleOffer(data: { from: string; to: string; offer: RTCSessionDescriptionInit; name: string; timestamp?: number }) {
    if (data.to !== this.participantId) return;

    console.log('Received offer from:', data.name);
    
    // Handle simultaneous offers (glare condition)
    let peerConnection = this.peers.get(data.from);
    if (peerConnection && peerConnection.peer.signalingState === 'have-local-offer') {
      // Use tie-breaker: lexicographically smaller ID processes the offer
      if (this.participantId < data.from) {
        console.log('Ignoring offer due to glare condition');
        return;
      } else {
        // Close existing connection and create new one
        peerConnection.peer.close();
        this.peers.delete(data.from);
        peerConnection = null;
      }
    }
    
    if (!peerConnection) {
      await this.createPeerConnection(data.from, data.name, false);
      peerConnection = this.peers.get(data.from);
    }
    
    if (peerConnection) {
      try {
        // Only set remote description if in appropriate state
        if (peerConnection.peer.signalingState === 'stable' || 
            peerConnection.peer.signalingState === 'have-remote-offer') {
          await peerConnection.peer.setRemoteDescription(data.offer);
        
          const answer = await peerConnection.peer.createAnswer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
          });
          await peerConnection.peer.setLocalDescription(answer);
        
          this.signalingChannel.send({
            type: 'broadcast',
            event: 'answer',
            payload: {
              from: this.participantId,
              to: data.from,
              answer: answer,
              name: this.participantName,
              timestamp: Date.now()
            }
          });
        } else {
          console.log('Cannot set remote description, wrong signaling state:', peerConnection.peer.signalingState);
        }
      } catch (error) {
        console.error('Error handling offer:', error);
        this.peers.delete(data.from);
      }
    }
  }

  private async handleAnswer(data: { from: string; to: string; answer: RTCSessionDescriptionInit; name: string; timestamp?: number }) {
    if (data.to !== this.participantId) return;

    console.log('Received answer from:', data.name);
    const peerConnection = this.peers.get(data.from);
    if (peerConnection) {
      try {
        if (peerConnection.peer.signalingState === 'have-local-offer') {
          await peerConnection.peer.setRemoteDescription(data.answer);
        } else {
          console.log('Cannot set remote description, wrong signaling state:', peerConnection.peer.signalingState);
        }
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    }
  }

  private async handleIceCandidate(data: { from: string; to: string; candidate: RTCIceCandidateInit; timestamp?: number }) {
    if (data.to !== this.participantId) return;

    const peerConnection = this.peers.get(data.from);
    if (peerConnection) {
      try {
        await peerConnection.peer.addIceCandidate(data.candidate);
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    }
  }

  private async handleUserLeft(data: { participantId: string }) {
    console.log('User left:', data.participantId);
    const peerConnection = this.peers.get(data.participantId);
    if (peerConnection) {
      peerConnection.peer.close();
      this.peers.delete(data.participantId);
      this.onPeerLeftCallback?.(data.participantId);
    }
  }

  private async handleMediaStateChanged(data: { participantId: string; audio: boolean; video: boolean }) {
    // Handle remote participant media state changes
    console.log('Media state changed:', data);
  }

  onStream(callback: (peerId: string, stream: MediaStream, name: string) => void) {
    this.onStreamCallback = callback;
  }

  onPeerLeft(callback: (peerId: string) => void) {
    this.onPeerLeftCallback = callback;
  }

  toggleAudio(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
      
      // Notify other participants
      this.signalingChannel.send({
        type: 'broadcast',
        event: 'media-state-changed',
        payload: {
          participantId: this.participantId,
          audio: enabled,
          video: this.localStream.getVideoTracks().some(track => track.enabled)
        }
      });
    }
  }

  toggleVideo(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
      
      // Notify other participants
      this.signalingChannel.send({
        type: 'broadcast',
        event: 'media-state-changed',
        payload: {
          participantId: this.participantId,
          audio: this.localStream.getAudioTracks().some(track => track.enabled),
          video: enabled
        }
      });
    }
  }

  async raiseHand(raised: boolean) {
    await this.signalingChannel.send({
      type: 'broadcast',
      event: 'hand-raised',
      payload: {
        participantId: this.participantId,
        name: this.participantName,
        raised: raised,
        timestamp: Date.now()
      }
    });
  }

  onHandRaised(callback: (participantId: string, name: string, raised: boolean) => void) {
    this.onHandRaisedCallback = callback;
  }

  async leaveMeeting() {
    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.participantCheckInterval) {
      clearInterval(this.participantCheckInterval);
    }

    // Untrack presence
    if (this.presenceChannel) {
      await this.presenceChannel.untrack();
    }

    // Announce leaving
    await this.signalingChannel.send({
      type: 'broadcast',
      event: 'user-left',
      payload: { 
        participantId: this.participantId,
        timestamp: Date.now()
      }
    });

    // Clean up connections
    this.peers.forEach(({ peer }) => peer.close());
    this.peers.clear();
    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }

    // Unsubscribe from channels
    this.signalingChannel.unsubscribe();
    this.presenceChannel.unsubscribe();
  }

  // Method to force refresh connection
  async refreshConnection() {
    console.log('Refreshing WebRTC connection...');
    this.reconnectAttempts = 0;
    
    // Close existing connections
    this.peers.forEach(({ peer }) => peer.close());
    this.peers.clear();
    
    // Unsubscribe and resubscribe to signaling
    this.signalingChannel.unsubscribe();
    this.setupSignaling();
    
    // Re-announce presence
    setTimeout(async () => {
      await this.presenceChannel.track({
        participantId: this.participantId,
        name: this.participantName,
        online_at: new Date().toISOString()
      });

      await this.signalingChannel.send({
        type: 'broadcast',
        event: 'user-joined',
        payload: { 
          participantId: this.participantId,
          name: this.participantName,
          timestamp: Date.now()
        }
      });
    }, 1000);
  }

  // Get connection statistics
  async getConnectionStats(): Promise<Map<string, RTCStatsReport>> {
    const stats = new Map<string, RTCStatsReport>();
    
    for (const [peerId, { peer }] of this.peers) {
      try {
        const report = await peer.getStats();
        stats.set(peerId, report);
      } catch (error) {
        console.error(`Error getting stats for ${peerId}:`, error);
      }
    }
    
    return stats;
  }
}