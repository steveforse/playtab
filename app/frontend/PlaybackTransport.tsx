import './PlaybackTransport.css';

type Props = {
  ready: boolean; playing: boolean; currentTime: number; endTime: number;
  onRestart: () => void; onPlayPause: () => void; top?: boolean; ariaLabel?: string;
};
const seconds = (milliseconds: number) => `${Math.floor(milliseconds / 60000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}`;

export function PlaybackTransport({ ready, playing, currentTime, endTime, onRestart, onPlayPause, top = false, ariaLabel }: Props) {
  const suffix = ariaLabel ? '' : top ? ' (top)' : '';
  return <div className="transport" role="group" aria-label={ariaLabel ?? (top ? 'Top playback controls' : 'Bottom playback controls')}>
    <button className="icon-button" aria-label={`Restart${suffix}`} disabled={!ready} onClick={onRestart}>↤</button>
    <button className="play-button" aria-label={`${playing ? 'Pause' : 'Play'}${suffix}`} disabled={!ready} onClick={onPlayPause}>{playing ? 'Ⅱ' : '▶'}</button>
    <div className={top ? 'top-player-status' : 'player-status'}><strong>{playing ? 'Playing' : ready ? 'Ready when you are' : 'Loading banjo sound…'}</strong><span>{seconds(currentTime)} / {seconds(endTime)}</span></div>
  </div>;
}
