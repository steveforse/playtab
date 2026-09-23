import './PlaybackTransport.css';

type Props = {
  ready: boolean; playing: boolean; currentTime: number; endTime: number;
  onRestart: () => void; onPlayPause: () => void; top?: boolean; ariaLabel?: string; updating?: boolean;
};
const seconds = (milliseconds: number) => `${Math.floor(milliseconds / 60000)}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}`;

export function PlaybackTransport({ ready, playing, currentTime, endTime, onRestart, onPlayPause, top = false, ariaLabel, updating = false }: Props) {
  const suffix = ariaLabel ? '' : top ? ' (top)' : '';
  const pauseOnly = playing || updating;
  return <div className="transport" role="group" aria-label={ariaLabel ?? (top ? 'Top playback controls' : 'Bottom playback controls')}>
    <button className="icon-button" aria-label={`Restart${suffix}`} disabled={!ready && !updating} onClick={onRestart}>↤</button>
    <button className="play-button" aria-label={`${pauseOnly ? 'Pause' : 'Play'}${suffix}`} disabled={!ready && !updating} onClick={onPlayPause}>{pauseOnly ? 'Ⅱ' : '▶'}</button>
    <div className={top ? 'top-player-status' : 'player-status'}><strong>{updating ? 'Updating score' : playing ? 'Playing' : ready ? 'Ready when you are' : 'Loading banjo sound…'}</strong><span>{seconds(currentTime)} / {seconds(endTime)}</span></div>
  </div>;
}
