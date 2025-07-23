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
  private isInitialized = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(meetingId: string, participantId: string, participantName: string) {
    this.meetingId = meetingId;
    this.participantId = participantId;
    this.participantName = participantName;
    this.setupSignaling();
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

  async initializeMedia(video: boolean = true, audio: boolean = true): Promise<MediaStream> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: video ? { width: 1280, height: 720 } : false,
        audio: audio ? { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true 
        } : false
      });
      return this.localStream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      throw error;
    }
  }

  async startScreenShare(): Promise<MediaStream> {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: true
      });
      
      // Replace video track in all peer connections
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

    // Announce joining
    await this.signalingChannel.send({
      type: 'broadcast',
      event: 'user-joined',
      payload: { 
        participantId: this.participantId,
        name: this.participantName
      }
    });
  }

  private async handleUserJoined(data: { participantId: string; name: string }) {
    if (data.participantId === this.participantId) return;

    console.log('User joined:', data.name);
    await this.createPeerConnection(data.participantId, data.name, true);
  }

  private async createPeerConnection(peerId: string, name: string, isInitiator: boolean) {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };

    const peer = new RTCPeerConnection(configuration);

    // Add local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        peer.addTrack(track, this.localStream!);
      });
    }

    // Handle remote stream
    peer.ontrack = (event) => {
      console.log('Received remote stream from:', name);
      const [remoteStream] = event.streams;
      this.onStreamCallback?.(peerId, remoteStream, name);
    };

    // Handle ICE candidates
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalingChannel.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: {
            from: this.participantId,
            to: peerId,
            candidate: event.candidate
          }
        });
      }
    };

    // Handle connection state changes
    peer.onconnectionstatechange = () => {
      console.log(`Connection state with ${name}:`, peer.connectionState);
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        this.peers.delete(peerId);
        this.onPeerLeftCallback?.(peerId);
      }
    };

    this.peers.set(peerId, { peerId, peer, name });

    if (isInitiator) {
      // Create and send offer
      const offer = await peer.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await peer.setLocalDescription(offer);
      
      this.signalingChannel.send({
        type: 'broadcast',
        event: 'offer',
        payload: {
          from: this.participantId,
          to: peerId,
          offer: offer,
          name: this.participantName
        }
      });
    }
  }

  private async handleOffer(data: { from: string; to: string; offer: RTCSessionDescriptionInit; name: string }) {
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
      // Only set remote description if in appropriate state
      if (peerConnection.peer.signalingState === 'stable' || 
          peerConnection.peer.signalingState === 'have-remote-offer') {
        await peerConnection.peer.setRemoteDescription(data.offer);
      
        const answer = await peerConnection.peer.createAnswer();
        await peerConnection.peer.setLocalDescription(answer);
      
        this.signalingChannel.send({
          type: 'broadcast',
          event: 'answer',
          payload: {
            from: this.participantId,
            to: data.from,
            answer: answer,
            name: this.participantName
          }
        });
      } else {
        console.log('Cannot set remote description, wrong signaling state:', peerConnection.peer.signalingState);
      }
    }
  }

  private async handleAnswer(data: { from: string; to: string; answer: RTCSessionDescriptionInit; name: string }) {
    if (data.to !== this.participantId) return;

    console.log('Received answer from:', data.name);
    const peerConnection = this.peers.get(data.from);
    if (peerConnection && peerConnection.peer.signalingState === 'have-local-offer') {
      await peerConnection.peer.setRemoteDescription(data.answer);
    } else if (peerConnection) {
      console.log('Cannot set remote description, wrong signaling state:', peerConnection.peer.signalingState);
    }
  }

  private async handleIceCandidate(data: { from: string; to: string; candidate: RTCIceCandidateInit }) {
    if (data.to !== this.participantId) return;

    const peerConnection = this.peers.get(data.from);
    if (peerConnection) {
      await peerConnection.peer.addIceCandidate(data.candidate);
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
    }
  }

  toggleVideo(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
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
        raised: raised
      }
    });
  }

  onHandRaised(callback: (participantId: string, name: string, raised: boolean) => void) {
    this.onHandRaisedCallback = callback;
  }

  async leaveMeeting() {
    // Announce leaving
    await this.signalingChannel.send({
      type: 'broadcast',
      event: 'user-left',
      payload: { participantId: this.participantId }
    });

    // Clean up
    this.peers.forEach(({ peer }) => peer.close());
    this.peers.clear();
    
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }

    this.signalingChannel.unsubscribe();
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
      await this.signalingChannel.send({
        type: 'broadcast',
        event: 'user-joined',
        payload: { 
          participantId: this.participantId,
          name: this.participantName
        }
      });
    }, 1000);
  }
}