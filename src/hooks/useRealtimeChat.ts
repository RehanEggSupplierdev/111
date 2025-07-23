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
  const [lastFetch, setLastFetch] = useState(Date.now());

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
        setLastFetch(Date.now());
      } catch (error) {
        console.error('Error fetching messages:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();

    // Real-time polling for messages (more reliable than realtime subscriptions)
    const pollMessages = setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('meeting_id', meetingId)
          .gt('created_at', new Date(lastFetch).toISOString())
          .order('created_at', { ascending: true });

        if (error) throw error;
        
        if (data && data.length > 0) {
          setMessages(prev => [...prev, ...data]);
          setLastFetch(Date.now());
        }
      } catch (error) {
        console.error('Error polling messages:', error);
      }
    }, 500); // Poll every 500ms for near real-time experience

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
          setLastFetch(Date.now());
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
      
      // Immediately fetch new messages after sending
      setTimeout(async () => {
        try {
          const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('meeting_id', meetingId)
            .order('created_at', { ascending: true });

          if (!error && data) {
            setMessages(data);
            setLastFetch(Date.now());
          }
        } catch (error) {
          console.error('Error refreshing messages:', error);
        }
      }, 100);
      
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