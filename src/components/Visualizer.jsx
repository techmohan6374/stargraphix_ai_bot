import React, { useEffect, useRef } from 'react';

export default function Visualizer({ getUserVolume, getAgentVolume, status }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId;

    let phase = 0;

    const render = () => {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      phase += 0.05;

      // Draw middle dividing line
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.03)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(width / 2, 0);
      ctx.lineTo(width / 2, height);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.02)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      if (status === 'connected') {
        const uVol = getUserVolume ? getUserVolume() : 0;
        const aVol = getAgentVolume ? getAgentVolume() : 0;

        // --- Draw User Wave (left half, cyan) ---
        ctx.strokeStyle = 'rgba(8, 145, 178, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(8, 145, 178, 0.2)';
        ctx.shadowBlur = 8;
        ctx.beginPath();

        // Scale factor: volume ranges from 0 to ~1, RMS is typically 0 to 0.3
        const userAmp = Math.min(centerY - 5, uVol * 150);
        for (let x = 0; x <= width / 2; x += 2) {
          const t = x / (width / 2); // 0 to 1
          const envelope = Math.sin(t * Math.PI); // Fades out at x=0 and x=width/2
          const y = centerY + Math.sin(x * 0.07 - phase * 1.5) * userAmp * envelope;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Secondary User wave
        ctx.strokeStyle = 'rgba(8, 145, 178, 0.2)';
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= width / 2; x += 2) {
          const t = x / (width / 2);
          const envelope = Math.sin(t * Math.PI);
          const y = centerY + Math.sin(x * 0.11 + phase * 2.0) * (userAmp * 0.5) * envelope;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // --- Draw Agent Wave (right half, purple) ---
        ctx.strokeStyle = 'rgba(124, 58, 237, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(124, 58, 237, 0.2)';
        ctx.shadowBlur = 8;
        ctx.beginPath();

        const agentAmp = Math.min(centerY - 5, aVol * 180);
        for (let x = width / 2; x <= width; x += 2) {
          const t = (x - width / 2) / (width / 2); // 0 to 1
          const envelope = Math.sin(t * Math.PI); // Fades out at x=width/2 and x=width
          const y = centerY + Math.sin(x * 0.07 - phase * 1.5) * agentAmp * envelope;
          if (x === width / 2) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Secondary Agent wave
        ctx.strokeStyle = 'rgba(124, 58, 237, 0.2)';
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = width / 2; x <= width; x += 2) {
          const t = (x - width / 2) / (width / 2);
          const envelope = Math.sin(t * Math.PI);
          const y = centerY + Math.sin(x * 0.11 + phase * 2.0) * (agentAmp * 0.5) * envelope;
          if (x === width / 2) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        // Flat standby line (slightly dark gray for light theme)
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 2) {
          const y = centerY + Math.sin(x * 0.03 - phase * 0.5) * 1.0;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [getUserVolume, getAgentVolume, status]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', alignItems: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: '0 8px', fontSize: '0.65rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '0.2rem', fontWeight: 600 }}>
        <span style={{ color: 'var(--accent-cyan)' }}>Mic</span>
        <span style={{ color: 'var(--accent-purple)' }}>Agent</span>
      </div>
      <canvas
        ref={canvasRef}
        width={300}
        height={50}
        style={{
          width: '100%',
          height: '50px',
          background: 'transparent',
          borderRadius: '8px'
        }}
      />
    </div>
  );
}
