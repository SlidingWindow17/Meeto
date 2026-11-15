import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { dummyMeetingDetails, dummyUser } from '../assets/asset'
import VideoGrid from '../components/meeting/VideoGrid'
import {useWebRTC} from '../hooks/useWebRTC'
import ChatPanel from '../components/meeting/ChatPanel'
import { useChat } from '../hooks/useChat'
import ParticipantList from '../components/meeting/ParticipantList'
import ControlBar from '../components/meeting/ControlBar'
import WhiteboardPanel from '../components/meeting/WhiteboardPanel'
import { useWhiteboard } from '../hooks/useWhiteboard'
import CodeEditorPanel from '../components/meeting/CodeEditorPanel'
import { useCodeEditor } from '../hooks/useCodeEditor'
import toast from 'react-hot-toast'
import { useAuth, useUser } from '@clerk/react'
import api from '../config/api'
import Loader from '../components/Loader'
import { socket } from '../config/socket'

const MeetingRoom = () => {
  const {meetingId} = useParams()
  const navigate = useNavigate()
  const {user} = useUser()
  const { getToken } = useAuth()

  

  const userdata = useMemo(()=>{
    if(!user) return null;
    return {
      id: user.id,
      name: user.fullName || user.firstName || user.primaryEmailAddress?.emailAddress?.split("@")[0] || "User",
      email: user.primaryEmailAddress?.emailAddress || "",
      image: user.imageUrl || "",
    }
  },[user?.id, user?.fullName, user?.firstName, user?.primaryEmailAddress?.emailAddress, user?.imageUrl])

   const [meeting, setMeeting] = useState(null)
   const [loadingMeeting, setLoadingMeeting] = useState(true);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false)

  // Whiteboard
  const { isWhiteboardOpen, toggleWhiteboard, strokesRef } = useWhiteboard(meetingId)

  // Collaborative Code Editor (Judge0)
  const codeEditor = useCodeEditor(meetingId, userdata)

  // ── Unified Socket.IO Connection & Reconnection Management ──
  useEffect(() => {
    if (!meetingId || !userdata) return;

    const joinRoomPayload = {
      roomId: meetingId,
      user: userdata,
      audioEnabled: true,
      videoEnabled: true,
    };

    const handleConnect = () => {
      console.log("Socket.IO connected / reconnected. Joining room:", meetingId);
      socket.emit("join-room", joinRoomPayload);
    };

    if (!socket.connected) {
      socket.connect();
    } else {
      socket.emit("join-room", joinRoomPayload);
    }

    socket.on("connect", handleConnect);

    return () => {
      socket.off("connect", handleConnect);
      socket.disconnect();
    };
  }, [meetingId, userdata?.id]);

  // Fetch meeting details to verify validity BEFORE enabling WebRTC camera access
  useEffect(()=>{
    const fetchMeeting = async ()=>{
      try {
        const token = await getToken();
        const res = await api.get(`/api/meetings/${meetingId}`, {
          headers: { Authorization: `Bearer ${token}`, },
        })
        if (res.data.meeting.status === "ended"){
          toast.error("This meeting has ended");
           navigate("/dashboard");
           return;
        }
        setMeeting(res.data.meeting)
      } catch (error) {
        const errorMsg = error.response?.data?.error || "Meeting not found or has ended";
        toast.error(errorMsg);
        navigate("/dashboard");
      }finally{
        setLoadingMeeting(false);
      }
    }

    fetchMeeting();

  },[meetingId, navigate])

  const handleMeetingEnded = useCallback(()=>{
    navigate('/dashboard')
  },[navigate])

  // Initialize WebRTC
  const {localStream, remoteUsers, audioEnabled, videoEnabled, toggleAudio, toggleVideo, endMeeting} = useWebRTC(meetingId, userdata, handleMeetingEnded, Boolean(meeting))

   // Initialize Chat
   const {messages, sendMessage, unreadCount, isChatOpen, toggleChat} = useChat(meetingId, userdata)

  const hostId = meeting?.host?.id || meeting?.host;
  const isHost = Boolean(userdata?.id && hostId && hostId.toString() === userdata.id.toString())

  const handleLeave = () =>{
    toast("You left the meeting");
    navigate("/dashboard")
  }

  const handleEndMeeting = () =>{
    endMeeting();
    toast("Meeting ended for all participants");
    navigate("/dashboard")
  }

  if(loadingMeeting){
    return <Loader text="Joining meeting room..."/>
  }

  return (
    <div className='h-screen w-screen bg-slate-100 text-slate-900 flex flex-col overflow-hidden relative font-sans'>
       {/* Top Bar */}
       <header className="w-full bg-white/90 backdrop-blur-md px-6 py-3 border-b border-slate-200 flex items-center justify-between z-30 shadow-xs">
          <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-slate-900 tracking-tight">
                {dummyMeetingDetails.title} ({meetingId || dummyMeetingDetails.meetingId})
              </h2>
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse"/>
          </div>
       </header>

       {/* Main Content Area (Video Grid + Side Panels) */}
       <div className="flex-1 flex overflow-hidden relative">
          {/* Video Grid Center */}
          <VideoGrid
          localStream={localStream}
          localUser={userdata}
          remoteUsers={remoteUsers}
          audioEnabled={audioEnabled}
          videoEnabled={videoEnabled} />

          {/* In-Meeting Chat Drawer */}
          <ChatPanel 
          isOpen={isChatOpen}
          onClose={toggleChat}
          messages={messages}
          onSendMessage={sendMessage}
          currentUser={userdata}
          />

          {/* Participants Drawer */}
          <ParticipantList 
          isOpen={isParticipantsOpen}
          onClose={()=> setIsParticipantsOpen(false)}
          localUser={userdata}
          localAudio={audioEnabled}
          localVideo={videoEnabled}
          remoteUsers={remoteUsers}
          meetingHostId={dummyUser.id}
          />

          {/* Whiteboard Drawer */}
          <WhiteboardPanel
          isOpen={isWhiteboardOpen}
          onClose={toggleWhiteboard}
          roomId={meetingId}
          strokesRef={strokesRef}
          />

          {/* Collaborative IDE Drawer */}
          <CodeEditorPanel
          isOpen={codeEditor.isEditorOpen}
          onClose={codeEditor.toggleEditor}
          language={codeEditor.language}
          onLanguageChange={codeEditor.handleLanguageChange}
          code={codeEditor.codes[codeEditor.language]}
          onCodeChange={codeEditor.handleCodeChange}
          stdin={codeEditor.stdin}
          onStdinChange={codeEditor.handleStdinChange}
          output={codeEditor.output}
          isRunning={codeEditor.isRunning}
          onRun={codeEditor.runCode}
          remoteCursors={codeEditor.remoteCursors}
          myColor={codeEditor.myColor}
          onCursorChange={codeEditor.handleCursorChange}
          />
          
       </div>

    {/* Bottom Floating Control Bar */}
          <ControlBar
          roomId={meetingId || dummyMeetingDetails.meetingId}
          audioEnabled={audioEnabled}
          videoEnabled={videoEnabled}
          onToggleAudio={toggleAudio}
          onToggleVideo={toggleVideo}
          onToggleChat={toggleChat}
          onToggleParticipants={()=> setIsParticipantsOpen((prev)=> !prev)}
          onToggleWhiteboard={toggleWhiteboard}
          onToggleCodeEditor={codeEditor.toggleEditor}
          isChatOpen={isChatOpen}
          isParticipantsOpen={isParticipantsOpen}
          isWhiteboardOpen={isWhiteboardOpen}
          isCodeEditorOpen={codeEditor.isEditorOpen}
          unreadCount={unreadCount}
          participantCount={1 + remoteUsers.length}
          isHost={isHost}
          onLeave={handleLeave}
          onEndMeeting={handleEndMeeting}
          />
    </div>
  )
}

export default MeetingRoom