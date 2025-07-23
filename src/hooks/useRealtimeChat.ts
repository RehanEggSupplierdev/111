import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export interface ChatMessage {
  id: string;
  meeting_id: string;
  sender_id?: string;
  sender_name: string;
  content: string;
  created_at: string;
}

export function useRealtimeChat(meetingId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastMessageTime, setLastMessageTime] = useState<string>('');

  useEffect(() => {
    if (!meetingId) return;

    // Fetch existing messages
    const fetchMessages = async () => {
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('meeting_id', meetingId)
          .order('created_at', { ascending: true });

        if (error) throw error;
        setMessages(data || []);
        if (data && data.length > 0) {
          setLastMessageTime(data[data.length - 1].created_at);
        }
      } catch (error) {
        console.error('Error fetching messages:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();

    // Ultra-fast polling for near-instant messaging
    const pollMessages = setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('meeting_id', meetingId)
          .gt('created_at', lastMessageTime || new Date(0).toISOString())
          .order('created_at', { ascending: true });

        if (error) throw error;
        
        if (data && data.length > 0) {
          setMessages(prev => [...prev, ...data]);
          setLastMessageTime(data[data.length - 1].created_at);
        }
      } catch (error) {
        console.error('Error polling messages:', error);
      }
    }, 200); // Poll every 200ms for ultra-fast messaging

    // Also keep the realtime subscription as backup
    const channel = supabase
      .channel(`meeting-chat-${meetingId}`)
      .on('postgres_changes', 
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'messages',
          filter: `meeting_id=eq.${meetingId}`
        }, 
        (payload) => {
          const newMessage = payload.new as ChatMessage;
          setMessages(prev => {
            // Avoid duplicates
            if (prev.some(msg => msg.id === newMessage.id)) {
              return prev;
            }
            return [...prev, newMessage];
          });
          setLastMessageTime(newMessage.created_at);
        }
      )
      .subscribe();

    return () => {
      clearInterval(pollMessages);
      channel.unsubscribe();
    };
  }, [meetingId]);

  const sendMessage = async (content: string, senderName: string, senderId?: string) => {
    try {
      const { error } = await supabase
        .from('messages')
        .insert({
          meeting_id: meetingId,
          sender_id: senderId || null,
          sender_name: senderName,
          content: content.trim(),
        });

      if (error) throw error;
      
      // Immediately refresh messages after sending
      setTimeout(async () => {
        try {
          const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('meeting_id', meetingId)
            .order('created_at', { ascending: true });

          if (!error && data) {
            setMessages(data);
            if (data.length > 0) {
              setLastMessageTime(data[data.length - 1].created_at);
            }
          }
        } catch (error) {
          console.error('Error refreshing messages:', error);
        }
      }, 50); // Faster refresh after sending
      
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  };

  return {
    messages,
    loading,
    sendMessage,
  };
}