// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaybackTransport } from '../../app/frontend/PlaybackTransport';

afterEach(cleanup);

describe('playback transport', () => {
  it('shows loading state and keeps controls disabled until ready', () => {
    const restart = vi.fn();
    const playPause = vi.fn();
    render(<PlaybackTransport ready={false} playing={false} currentTime={0} endTime={61_000} onRestart={restart} onPlayPause={playPause} />);

    expect(screen.getByText('Loading banjo sound…')).toBeTruthy();
    expect(screen.getByText('0:00 / 1:01')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restart' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Play' })).toHaveProperty('disabled', true);
  });

  it('formats playing state and sends restart and pause actions', () => {
    const restart = vi.fn();
    const playPause = vi.fn();
    render(<PlaybackTransport ready playing currentTime={61_000} endTime={125_000} onRestart={restart} onPlayPause={playPause} top />);

    expect(screen.getByRole('group', { name: 'Top playback controls' })).toBeTruthy();
    expect(screen.getByText('Playing')).toBeTruthy();
    expect(screen.getByText('1:01 / 2:05')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restart (top)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause (top)' }));
    expect(restart).toHaveBeenCalledOnce();
    expect(playPause).toHaveBeenCalledOnce();
  });
});
