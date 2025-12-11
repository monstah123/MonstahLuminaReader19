import React from 'react';

interface CircularProgressProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
  className?: string; // For text color override
  trackColor?: string;
  indicatorColor?: string;
}

export const CircularProgress: React.FC<CircularProgressProps> = ({ 
  progress, 
  size = 24, 
  strokeWidth = 3,
  className = "text-brand-dark dark:text-brand-gold",
  trackColor = "text-gray-200 dark:text-gray-700",
  indicatorColor = "text-brand-gold"
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;
  const fontSize = Math.max(8, Math.round(size * 0.35));

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        {/* Background Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="transparent"
          className={`${trackColor} opacity-20`}
        />
        {/* Progress Indicator */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`${indicatorColor} transition-all duration-300 ease-out`}
        />
      </svg>
      {/* Inner Percentage Text */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span 
          className={`font-bold leading-none ${className}`} 
          style={{ fontSize: `${fontSize}px` }}
        >
          {Math.round(progress)}
        </span>
      </div>
    </div>
  );
};