interface ProgressBarProps {
  value: number; // 0-100
}

export default function ProgressBar({ value }: ProgressBarProps) {
  return (
    <div className="progress-cell">
      <div className="progress-bar">
        <div className="progress-bar__fill" style={{ width: `${Math.min(100, value)}%` }}></div>
      </div>
      <span className="progress-label">{value}%</span>
    </div>
  );
}
