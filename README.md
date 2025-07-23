# Metstack - Professional Video Conferencing Platform

A modern, real-time video conferencing application built with React, TypeScript, and Supabase.

## ✨ Features

### 🎥 **High-Quality Video Conferencing**
- HD video calls (1280x720 @ 30fps)
- Crystal clear audio with advanced processing
- Real-time screen sharing
- Background blur effects
- Professional video grid layouts

### 🚀 **Real-Time Communication**
- Instant messaging (sub-second delivery)
- Real-time participant detection
- No refresh needed for new participants
- Live participant count updates
- Hand raising with notifications

### 🎛️ **Advanced Controls**
- Audio/video toggle with visual feedback
- Screen sharing with automatic detection
- Background blur toggle
- Hand raising system
- Professional meeting controls

### 📱 **Fully Responsive Design**
- Mobile-first approach
- Optimized for phones, tablets, and desktops
- Touch-friendly controls
- Adaptive layouts for all screen sizes

### 🔒 **Secure & Reliable**
- WebRTC peer-to-peer connections
- Automatic connection recovery
- Multiple STUN servers for better connectivity
- Real-time connection monitoring

## 🛠️ **Technology Stack**

- **Frontend**: React 18, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL, Real-time subscriptions)
- **Video**: WebRTC, Daily.co integration ready
- **State Management**: React Hooks
- **Routing**: React Router DOM
- **UI Components**: Lucide React icons
- **Build Tool**: Vite

## 🚀 **Getting Started**

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd metstack
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Add your Supabase credentials
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

## 📋 **Environment Variables**

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## 🏗️ **Project Structure**

```
src/
├── components/
│   ├── Home/           # Landing page components
│   ├── Layout/         # Header and layout components
│   ├── Meeting/        # Meeting room and controls
│   └── Auth/           # Authentication components
├── hooks/              # Custom React hooks
├── lib/                # Utilities and configurations
│   ├── supabase.ts     # Supabase client
│   ├── webrtc.ts       # WebRTC manager
│   └── daily.ts        # Daily.co integration
└── contexts/           # React contexts
```

## 🎯 **Key Features Implementation**

### Real-Time Participant Detection
- Dual presence tracking (Supabase + polling)
- Automatic WebRTC connection establishment
- No manual refresh required

### Advanced Audio/Video Processing
- Echo cancellation and noise suppression
- Automatic gain control
- High-quality encoding parameters
- Background blur with canvas processing

### Ultra-Fast Messaging
- 200ms polling + WebSocket subscriptions
- Smart message deduplication
- Instant UI updates

### Professional UI/UX
- Mobile-responsive design
- Touch-friendly controls
- Adaptive video grid layouts
- Professional meeting interface

## 🔧 **Database Schema**

The application uses the following main tables:
- `meetings` - Meeting information and access codes
- `participants` - Meeting participants and join/leave tracking
- `messages` - Real-time chat messages

## 🚀 **Deployment**

The application is ready for deployment on platforms like:
- Netlify
- Vercel
- Railway
- Any static hosting service

## 📱 **Browser Support**

- Chrome 88+ (recommended)
- Firefox 85+
- Safari 14+
- Edge 88+

## 🤝 **Contributing**

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 **License**

This project is licensed under the MIT License.

## 👨‍💻 **Credits**

**Created by @aftabstack**

Professional video conferencing platform with real-time collaboration features.

---

© 2025 Metstack. All rights reserved.