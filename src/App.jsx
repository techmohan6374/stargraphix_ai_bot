import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import Visualizer from './components/Visualizer';

// Automated Configurations (Hidden from UI)
const DEEPGRAM_API_KEY = 'c7e39f40831728b00238c6c3b376be5a13316912';
const VOICE_ID = 'cgSgspJ2msm6clMCkdW9';
const ENDPOINT = 'wss://agent.deepgram.com/v1/agent/converse';
const GREETING = 'Hello! Welcome to Star Graphix. How can I help you today?';

const THINK_PROMPT = `#Role
You are the virtual assistant for Star Graphix, a company providing professional graphic design, web design, and web development services to help brands shine online. Your goal is to guide users, answer questions, provide service details, share product prices, and offer contact info.

#About Star Graphix
- Tagline: Digital Solution in one place
- Leadership: The company CEOs are Veerasamy and Manohar, and Mohanraj is the Assistant CEO.
- Branches:
  - Ponnammapet Gate, Salem, Tamilnadu
  - New Bus Stand, Salem, Tamilnadu
- Contact Support:
  - Support Time: 10:00 AM to 9:00 PM
  - Email: stargraphix2010@gmail.com
  - Phone: +91 98940 33883, +91 80565 80402

#Services Offered
- Logo Design: Crafting unique, memorable logos that stand out.
- Print Design: Creating eye-catching print materials (business cards, brochures).
- Brand Identity: Developing cohesive brand identity systems.
- Website Design: Designing stunning, user-friendly websites.
- Digital Business Card: Creating interactive digital business cards.
- Web Applications: Building robust and scalable web applications.

#Products & Pricing
- E-Book: Rs.4000/-
- Flyer Design: Rs.1000/-
- Wedding Card Design: Rs.2000/-
- Instagram Posters: Rs.500/-
- Resume: Rs.350/-
- Note Book: Rs.450/-
- Digital Business Card: Rs.1000/-
- Brand Logo: Rs.1000/-
- Book Wrapper: Rs.1500/-
- Invoice: Rs.900/-
- Banner: Rs.800/-
- Business Card Design: Rs.500/-

#General Guidelines
- Be warm, friendly, and professional.
- Speak clearly and naturally in plain conversational language.
- Keep most responses to 1–2 sentences and under 150 characters unless asked for more details.
- Do not use markdown formatting (no code blocks, bold, quotes, links, asterisks).
- Use simple words and keep explanations concise.
- If asked about company details, pricing, owners (Veerasamy, Manohar, Mohanraj), or services, use the details above to answer accurately.

#Voice-Specific Instructions
- Speak in a conversational tone—your responses will be spoken aloud.
- Pause after questions to allow for replies.
- Never interrupt.

#Call Flow Objective
- Greet the caller warmly: "Hello! Welcome to Star Graphix. How can I help you today?"
- Help the user find information about services, products, pricing, location, or owners.
- Offer to submit an order or note their contact details if they want to place an order.
- Always ask if they need anything else before closing.
- Close warmly: "Thanks for calling Star Graphix. Take care and have a great day!"`;

export default function App() {
  // Widget Visibility State
  const [isOpen, setIsOpen] = useState(false);

  // Connection & Control States
  const [status, setStatus] = useState('idle'); // idle | connecting | connected | error
  const [callDuration, setCallDuration] = useState('');
  const [activeTab, setActiveTab] = useState('chat'); // chat | logs
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);

  // Lists
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('sg_bot_messages');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [logs, setLogs] = useState([]);

  // Audio References
  const audioCtxRef = useRef(null);
  const micStreamRef = useRef(null);
  const micProcessorRef = useRef(null);
  const activeSourcesRef = useRef([]);
  const nextPlayTimeRef = useRef(0);

  // Volume Meter References (accessed at 60fps in visualizer without triggering React renders)
  const userVolumeRef = useRef(0);
  const agentVolumeRef = useRef(0);

  // Timer & WebSocket References
  const wsRef = useRef(null);
  const keepAliveIntervalRef = useRef(null);
  const durationIntervalRef = useRef(null);
  const messagesEndRef = useRef(null);
  const logsEndRef = useRef(null);
  const lastActiveTimeRef = useRef(Date.now());

  // Auto Scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Persist messages to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem('sg_bot_messages', JSON.stringify(messages));
    } catch (e) {
      console.error('Failed to save messages to local storage', e);
    }
  }, [messages]);

  // Cleanup on Unmount
  useEffect(() => {
    return () => {
      disconnectSession(true);
    };
  }, []);

  const addLog = (type, category, text) => {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    setLogs(prev => [
      ...prev,
      {
        id: Math.random().toString(36).substr(2, 9),
        type,
        category,
        text,
        time
      }
    ]);
  };

  const addMessage = (role, content) => {
    lastActiveTimeRef.current = Date.now(); // Reset active timer on new message
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setMessages(prev => {
      if (prev.length > 0) {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg.role === role && lastMsg.content === content) {
          return prev;
        }
      }
      return [
        ...prev,
        {
          id: Math.random().toString(36).substr(2, 9),
          role,
          content,
          time
        }
      ];
    });
  };

  // Convert Float32Array to 16-bit Signed PCM
  const floatTo16BitPCM = (float32Array) => {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  };

  // Playback Linear16 PCM chunks
  const playPCMChunk = (arrayBuffer) => {
    lastActiveTimeRef.current = Date.now(); // Reset active timer during playback of audio chunk
    const audioCtx = audioCtxRef.current;
    if (!audioCtx) return;

    const int16Array = new Int16Array(arrayBuffer);
    const float32Array = new Float32Array(int16Array.length);
    let sum = 0;

    for (let i = 0; i < int16Array.length; i++) {
      const floatVal = int16Array[i] / 32768.0;
      float32Array[i] = floatVal;
      sum += floatVal * floatVal;
    }

    const rms = Math.sqrt(sum / int16Array.length);
    agentVolumeRef.current = rms;

    const playBuffer = audioCtx.createBuffer(1, float32Array.length, 24000);
    playBuffer.copyToChannel(float32Array, 0);

    const sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = playBuffer;
    sourceNode.connect(audioCtx.destination);

    const currentTime = audioCtx.currentTime;
    let playTime = nextPlayTimeRef.current;

    if (playTime < currentTime) {
      playTime = currentTime + 0.06;
    }

    sourceNode.start(playTime);

    const nodeRef = {
      node: sourceNode,
      time: playTime,
      duration: playBuffer.duration
    };

    activeSourcesRef.current.push(nodeRef);
    nextPlayTimeRef.current = playTime + playBuffer.duration;

    activeSourcesRef.current = activeSourcesRef.current.filter(src => {
      return currentTime <= src.time + src.duration;
    });
  };

  const clearPlaybackQueue = () => {
    activeSourcesRef.current.forEach(src => {
      try {
        src.node.stop();
      } catch (e) { }
    });
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
    agentVolumeRef.current = 0;
  };

  const startMicRecording = async () => {
    addLog('info', 'Audio', 'Initializing microphone capture...');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    micStreamRef.current = stream;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    audioCtxRef.current = audioCtx;

    const sourceNode = audioCtx.createMediaStreamSource(stream);
    const processorNode = audioCtx.createScriptProcessor(2048, 1, 1);
    micProcessorRef.current = processorNode;

    processorNode.onaudioprocess = (e) => {
      const channelData = e.inputBuffer.getChannelData(0);

      let sum = 0;
      for (let i = 0; i < channelData.length; i++) {
        sum += channelData[i] * channelData[i];
      }
      const rms = Math.sqrt(sum / channelData.length);
      userVolumeRef.current = rms;

      // If user is speaking, reset active timer
      if (rms > 0.015) {
        lastActiveTimeRef.current = Date.now();
      }

      const pcmBuffer = floatTo16BitPCM(channelData);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(pcmBuffer);
      }
    };

    const silenceGain = audioCtx.createGain();
    silenceGain.gain.setValueAtTime(0, audioCtx.currentTime);

    sourceNode.connect(processorNode);
    processorNode.connect(silenceGain);
    silenceGain.connect(audioCtx.destination);
  };

  const stopMicRecording = () => {
    if (micProcessorRef.current) {
      micProcessorRef.current.disconnect();
      micProcessorRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
  };

  const connectSession = async () => {
    if (status === 'connected' || status === 'connecting') return;

    setMessages([]);
    setLogs([]);
    clearPlaybackQueue();
    setStatus('connecting');
    addLog('info', 'System', 'Requesting microphone access...');

    try {
      await startMicRecording();
      addLog('success', 'Audio', 'Microphone stream captured.');
      addLog('info', 'System', 'Connecting to Deepgram Voice Agent...');

      const socket = new WebSocket(ENDPOINT, ['token', DEEPGRAM_API_KEY]);
      socket.binaryType = 'arraybuffer';
      wsRef.current = socket;

      socket.onopen = () => {
        addLog('success', 'WebSocket', 'WebSocket connection established.');

        lastActiveTimeRef.current = Date.now(); // Initialize active timer

        keepAliveIntervalRef.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 5000);

        let seconds = 0;
        setCallDuration('00:00');
        durationIntervalRef.current = setInterval(() => {
          // Check silence timeout
          if (Date.now() - lastActiveTimeRef.current >= 10000) {
            addLog('warning', 'System', 'Call automatically ended due to 10 seconds of inactivity.');
            addMessage('assistant', 'Call ended due to inactivity.');
            disconnectSession(true);
            return;
          }

          seconds++;
          const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
          const secs = (seconds % 60).toString().padStart(2, '0');
          setCallDuration(`${mins}:${secs}`);
        }, 1000);
      };

      socket.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'Welcome') {
              addLog('success', 'Deepgram', 'Welcome received. Config applied.');

              const settingsMessage = {
                type: "Settings",
                audio: {
                  input: {
                    encoding: "linear16",
                    sample_rate: 48000
                  },
                  output: {
                    encoding: "linear16",
                    sample_rate: 24000,
                    container: "none"
                  }
                },
                agent: {
                  speak: {
                    provider: {
                      type: "eleven_labs",
                      model_id: "eleven_multilingual_v2",
                      voice_id: VOICE_ID
                    }
                  },
                  listen: {
                    provider: {
                      type: "deepgram",
                      version: "v2",
                      model: "flux-general-en"
                    }
                  },
                  think: {
                    provider: {
                      type: "google",
                      model: "gemini-3.1-flash-lite"
                    },
                    prompt: THINK_PROMPT
                  },
                  greeting: GREETING
                }
              };

              socket.send(JSON.stringify(settingsMessage));
              addLog('info', 'Deepgram', 'Settings message dispatched.');
              setStatus('connected');

              addMessage('assistant', GREETING);

            } else if (data.type === 'SettingsApplied') {
              addLog('success', 'Deepgram', 'Settings applied successfully.');
            } else if (data.type === 'ConversationText') {
              const role = data.role;
              const textContent = data.content || data.text || '';
              if (textContent.trim()) {
                addMessage(role, textContent);
                addLog('info', 'Transcript', `${role === 'user' ? 'User' : 'Agent'}: "${textContent}"`);
              }
            } else if (data.type === 'UserStartedSpeaking') {
              addLog('warning', 'Deepgram', 'User started speaking. Interrupting agent audio.');
              lastActiveTimeRef.current = Date.now();
              setUserSpeaking(true);
              setAgentSpeaking(false);
              clearPlaybackQueue();
            } else if (data.type === 'AgentStartedSpeaking') {
              addLog('info', 'Deepgram', 'Agent started speaking.');
              lastActiveTimeRef.current = Date.now();
              setAgentSpeaking(true);
              setUserSpeaking(false);
            } else if (data.type === 'AgentAudioDone') {
              addLog('info', 'Deepgram', 'Agent finished audio stream.');
              lastActiveTimeRef.current = Date.now();
              setAgentSpeaking(false);
            } else if (data.type === 'Error') {
              addLog('error', 'Deepgram Error', data.message || JSON.stringify(data));
            }
          } catch (e) {
            addLog('error', 'JSON Parse', 'Failed to parse text message: ' + e.message);
          }
        } else if (event.data instanceof ArrayBuffer) {
          playPCMChunk(event.data);
        }
      };

      socket.onclose = (event) => {
        addLog('warning', 'WebSocket', `Connection closed.`);
        disconnectSession(false);
      };

      socket.onerror = () => {
        addLog('error', 'WebSocket', 'WebSocket error occurred.');
        setStatus('error');
      };

    } catch (err) {
      addLog('error', 'System', 'Setup failed: ' + err.message);
      disconnectSession(true);
    }
  };

  const disconnectSession = (closeSocket = true) => {
    setStatus('idle');
    setCallDuration('');
    setAgentSpeaking(false);
    setUserSpeaking(false);

    userVolumeRef.current = 0;
    agentVolumeRef.current = 0;

    stopMicRecording();

    if (keepAliveIntervalRef.current) {
      clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    clearPlaybackQueue();

    if (closeSocket && wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    if (audioCtxRef.current) {
      if (audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
      audioCtxRef.current = null;
    }

    addLog('info', 'System', 'Session disconnected.');
  };

  return (
    <div className="chatbot-widget-container">

      {/* Widget Card (Visible when open) */}
      {isOpen && (
        <div className="chatbot-card">

          {/* Header */}
          <header className="widget-header">
            <div className="widget-title-area" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={status === 'connected' ? 'var(--status-active)' : status === 'connecting' ? 'var(--status-connecting)' : status === 'error' ? 'var(--status-error)' : 'var(--status-idle)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'stroke 0.3s ease' }}><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M12 8V4H8"></path><path d="M9 13h.01"></path><path d="M15 13h.01"></path><path d="M10 16h4"></path></svg>
              <h2 className="widget-title">Voice Assistant</h2>
            </div>
            <button className="widget-close" onClick={() => setIsOpen(false)} title="Close Panel">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" x2="6" y1="6" y2="18"></line><line x1="6" x2="18" y1="6" y2="18"></line></svg>
            </button>
          </header>

          {/* Messages / logs Feed Area */}
          <div className="widget-messages">
            {activeTab === 'chat' ? (
              messages.length === 0 ? (
                <div className="empty-widget">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '8px', stroke: 'var(--text-muted)' }}><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" x2="12" y1="19" y2="22"></line></svg>
                  <h4>Ready for voice chat</h4>
                  <p style={{ fontSize: '0.8rem' }}>Click Start Session below to begin talking with the AI.</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className={`bubble-row ${msg.role}`}>
                    <div className="widget-bubble">
                      <div>{msg.content}</div>
                      <div className="bubble-meta">
                        <span>{msg.role === 'user' ? 'You' : 'AI'}</span>
                        <span>•</span>
                        <span>{msg.time}</span>
                      </div>
                    </div>
                  </div>
                ))
              )
            ) : (
              <div className="event-logs" style={{ height: '100%', margin: 0, borderRadius: 8 }}>
                {logs.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem', fontSize: '0.8rem' }}>
                    No system logs.
                  </div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className={`log-entry ${log.type}`} style={{ fontSize: '0.75rem', padding: '0.2rem' }}>
                      <span className="log-time">[{log.time}]</span>
                      <span className="log-msg" style={{ marginLeft: 6 }}>{log.text}</span>
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Interactive Voice Area (Orb & wave & controls) */}
          <div className="widget-voice-area">

            {/* Visualizer / Waveform */}
            <div className="widget-visualizer-container">
              <Visualizer
                getUserVolume={() => userVolumeRef.current}
                getAgentVolume={() => agentVolumeRef.current}
                status={status}
              />
            </div>

            {/* Siri Orb */}
            <div className="voice-orb-wrapper">
              <div style={{
                position: 'absolute',
                transform: `scale(${1 + userVolumeRef.current * 0.8})`,
                transition: 'transform 0.1s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: status === 'connected' ? 1 : 0
              }}>
                <div className={`voice-orb-pulse-ring ${status === 'connected' ? 'active-wave' : ''}`} />
              </div>
              <div style={{
                position: 'absolute',
                transform: `scale(${1 + agentVolumeRef.current * 0.8})`,
                transition: 'transform 0.1s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: status === 'connected' ? 1 : 0
              }}>
                <div className={`voice-orb-pulse-ring outer ${status === 'connected' ? 'active-wave' : ''}`} />
              </div>
              <div className={`voice-orb ${agentSpeaking ? 'speaking' : ''}`} style={{
                transform: `scale(${1 + agentVolumeRef.current * 0.4})`,
                color: 'white'
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M12 8V4H8"></path><path d="M9 13h.01"></path><path d="M15 13h.01"></path><path d="M10 16h4"></path></svg>
              </div>
            </div>

            {/* Bottom Controls */}
            <div className="widget-controls">
              {callDuration ? (
                <div className="widget-call-duration">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '2px' }}><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> {callDuration}
                </div>
              ) : (
                <button
                  className="widget-btn-icon"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onClick={() => setActiveTab(activeTab === 'chat' ? 'logs' : 'chat')}
                  title="Toggle Console Logs"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                </button>
              )}

              {status === 'idle' || status === 'error' ? (
                <button className="widget-btn widget-btn-primary" onClick={connectSession}>
                  Start Call
                </button>
              ) : (
                <button className="widget-btn widget-btn-danger" onClick={() => disconnectSession(true)}>
                  End Call
                </button>
              )}
            </div>

          </div>

        </div>
      )}

      {/* Floating Trigger Button */}
      <button
        className={`chatbot-trigger ${!isOpen ? 'pulsing' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title={isOpen ? "Close Voice Chat" : "Open Voice Chat"}
      >
        {isOpen ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" x2="6" y1="6" y2="18"></line><line x1="6" x2="18" y1="6" y2="18"></line></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="12" x="4" y="8" rx="2"></rect><path d="M12 8V4H8"></path><path d="M9 13h.01"></path><path d="M15 13h.01"></path><path d="M10 16h4"></path></svg>
        )}
      </button>

    </div>
  );
}
