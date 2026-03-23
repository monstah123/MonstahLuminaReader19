import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
}

export const Visualizer: React.FC<VisualizerProps> = ({ analyser, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser ? analyser.frequencyBinCount : 64;
    const dataArray = new Uint8Array(bufferLength);
    // State for fake data smoothing
    const targetData = new Float32Array(bufferLength);
    const currentData = new Float32Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      if (analyser) {
        analyser.getByteFrequencyData(dataArray);
      } else {
        // Simulated audio data
        if (isPlaying) {
            // Update targets sporadically
            if (Math.random() < 0.2) {
                for (let i = 0; i < bufferLength; i++) {
                    const noise = Math.random() * 180;
                    // Lower frequencies tend to be higher
                    const weight = 1 - (i / bufferLength); 
                    targetData[i] = noise * weight + (Math.random() * 50);
                }
            }
            // Smoothly approach targets
            for (let i = 0; i < bufferLength; i++) {
                currentData[i] += (targetData[i] - currentData[i]) * 0.2;
                dataArray[i] = currentData[i];
            }
        } else {
            // Quickly decay to 0
            for (let i = 0; i < bufferLength; i++) {
                targetData[i] = 0;
                currentData[i] += (targetData[i] - currentData[i]) * 0.1;
                dataArray[i] = currentData[i];
            }
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * (analyser ? 2.5 : 2);
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2;

        const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
        gradient.addColorStop(0, '#d4af37'); // Gold
        gradient.addColorStop(1, '#f5f5dc'); // Cream

        ctx.fillStyle = gradient;
        
        if (barHeight > 0) {
             ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        }

        x += barWidth + 1;
      }
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [analyser, isPlaying]);

  return (
    <canvas 
      ref={canvasRef} 
      width={300} 
      height={60} 
      className="w-full h-[60px] opacity-80"
    />
  );
};